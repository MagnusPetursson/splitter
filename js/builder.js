// print-splitter geometry builder.
//
// Runs the Manifold boolean kernel (manifold-3d WASM) on a plan produced by
// the Go server. The same module runs in the browser (inside a Web Worker)
// and under Node for the acceptance tests, so what is tested is what ships.
//
// Conventions shared with the Go planner:
//   * A node's plane is n·x = d. The "neg" child is n·x < d, "pos" n·x > d.
//   * A joint frame has origin on the cut plane, Z = n (neg → pos).
//   * Point-joint builders work in a local frame where the male/"A" side is
//     z < 0 and features protrude into z > 0 ("B"). Joints whose male is on
//     the pos side are built in a frame flipped about X.

const SQ2 = Math.SQRT2;

export function createBuilder(wasm) {
  const { Manifold, CrossSection } = wasm;
  wasm.setMinCircularEdgeLength && wasm.setMinCircularEdgeLength(0.4);
  wasm.setMinCircularAngle && wasm.setMinCircularAngle(7.5);

  const garbage = [];
  const keep = (m) => { garbage.push(m); return m; };
  function collect() {
    while (garbage.length) {
      const g = garbage.pop();
      try { g.delete(); } catch (_) { /* already freed */ }
    }
  }

  // ---------- small linear algebra ----------
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

  // column-major 4x4 from axes + origin (local → world)
  function frameMat(o, x, y, z) {
    return [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, o[0], o[1], o[2], 1];
  }
  // inverse of a rigid frame (world → local)
  function frameInv(o, x, y, z) {
    const t = [-dot(x, o), -dot(y, o), -dot(z, o)];
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, t[0], t[1], t[2], 1];
  }

  // ---------- tree helpers ----------
  function pathOf(tree, id, excludeNode = -1) {
    const hs = [];
    while (id !== tree.root && id >= 0) {
      const p = tree.nodes[id].parent;
      if (p < 0) break;
      const pn = tree.nodes[p];
      if (p !== excludeNode) hs.push({ n: pn.cut.n, d: pn.cut.d, side: pn.neg === id ? -1 : 1, node: p });
      id = p;
    }
    return hs.reverse();
  }
  // inset > 0 shrinks the cell (used to keep seam features from different
  // faces from colliding in a part's corners)
  function trimTo(m, hs, inset = 0) {
    let r = m;
    for (const h of hs) {
      r = keep(r.trimByPlane(scale(h.n, h.side), h.side * h.d + inset));
      if (r.isEmpty()) break;
    }
    return r;
  }

  // ---------- 2D profiles ----------
  function circle(r) { return keep(CrossSection.circle(r, Math.max(16, Math.ceil(2 * Math.PI * r / 0.4)))); }

  // teardrop: circle + 45° roof pointing along `up` (unit 2D) so a horizontal
  // hole prints without support
  function holeProfile(r, up) {
    const c = circle(r);
    if (!up) return c;
    const [ux, uy] = up;
    const px = -uy, py = ux;
    const k = r / SQ2;
    const quad = keep(new CrossSection([[[0, 0], [k * (ux + px), k * (uy + py)], [r * SQ2 * ux, r * SQ2 * uy], [k * (ux - px), k * (uy - py)]]]));
    return keep(c.add(quad));
  }

  // peg profile (male); flattened on the underside when printed horizontally
  function pegProfile(shape, d, up) {
    let p;
    if (shape === 'hex') p = keep(CrossSection.circle(d / Math.sqrt(3), 6));
    else if (shape === 'd') {
      p = circle(d / 2);
      const cut = keep(CrossSection.square([d, d * 2], true).translate([d / 2 + d * 0.3, 0]));
      p = keep(p.subtract(cut));
    } else p = circle(d / 2);
    if (up) {
      // remove the lowest 15 % so the peg underside is a short flat, not a
      // 90° overhang
      const r = d / 2;
      const ang = Math.atan2(up[1], up[0]) * 180 / Math.PI;
      const cut = keep(CrossSection.square([4 * d, 2 * d], true).translate([0, -r - d + 0.3 * r]).rotate(ang - 90));
      p = keep(p.subtract(cut));
    }
    return p;
  }

  // extrude a profile from z0 to z1 (any order)
  function prism(cs, z0, z1) {
    const lo = Math.min(z0, z1), hi = Math.max(z0, z1);
    if (hi - lo < 1e-6) return null;
    return keep(keep(cs.extrude(hi - lo)).translate([0, 0, lo]));
  }
  // conical mouth chamfer at z=0 opening outward, depth ch, into +z (dir=1) or -z (dir=-1)
  function mouth(r, ch, dir) {
    const m = keep(circle(r + ch).extrude(ch, 0, 0, r / (r + ch)));
    return dir > 0 ? m : keep(m.mirror([0, 0, 1]));
  }
  function unionAll(list) {
    const l = list.filter(Boolean);
    if (!l.length) return null;
    if (l.length === 1) return l[0];
    return keep(Manifold.union(l));
  }

  // ---------- point joint features (local frame) ----------
  // returns { cutA, cutB, addA, pins: [{mesh, d, len}] }
  function pointFeatures(j, upA, upB) {
    const c = j.clear;
    const out = { cutA: [], cutB: [], addA: [], pins: [] };
    const kind = j.kind;
    if (kind === 'dowel' || kind === 'press' || kind === 'filament') {
      const r = j.d / 2 + c;
      const hA = j.holeNeg, hB = j.holePos; // dowels are never flipped
      out.cutA.push(prism(holeProfile(r, upA), -hA, 0.01), mouth(r, 0.4, -1));
      out.cutB.push(prism(holeProfile(r, upB), -0.01, hB), mouth(r, 0.4, 1));
      if (j.glue) {
        // glue escape: a shallow axial groove along each hole
        const g = keep(CrossSection.square([0.8, 0.9], false).translate([r - 0.3, -0.45]));
        out.cutA.push(prism(g, -hA, 0));
        out.cutB.push(prism(g, 0, hB));
      }
      if (kind !== 'filament') out.pins.push(makePin(j.d, Math.max(2, hA + hB - 0.6)));
      return out;
    }
    if (kind === 'peg' || kind === 'keyed') {
      const prof = pegProfile(j.shape || 'round', j.d, upA);
      const L = j.depth;
      const ch = Math.min(0.6, L / 4);
      const body = prism(prof, -0.5, L - ch);
      const tip = keep(keep(prof.extrude(ch, 0, 0, Math.max(0.5, 1 - 2 * ch / j.d))).translate([0, 0, L - ch]));
      out.addA.push(body, tip);
      const sock = keep(pegProfile(j.shape || 'round', j.d, null).offset(c, 'Round'));
      let sp = sock;
      if (upB) sp = keep(sock.add(holeProfile(j.d / 2 + c, upB)));
      out.cutB.push(prism(sp, -0.01, L + 0.4), mouth(j.d / 2 + c, 0.4, 1));
      return out;
    }
    if (kind === 'magnet') {
      const r = j.d / 2 + c;
      const h = j.depth + 0.2;
      out.cutA.push(prism(holeProfile(r, upA), -h, 0.01));
      out.cutB.push(prism(holeProfile(r, upB), -0.01, h));
      return out;
    }
    if (kind === 'insert') {
      const sp = SCREWS[j.size] || SCREWS.M3;
      const ri = sp.insertD / 2;
      out.cutA.push(prism(holeProfile(ri, upA), -(sp.insertL + 1), 0.01), mouth(ri, 0.5, -1));
      const L1 = Math.max(1.5, j.screwLen - 0.8 * sp.insertL);
      out.cutB.push(prism(holeProfile(sp.clear / 2, upB), -0.01, L1 + 0.01));
      out.cutB.push(prism(holeProfile(sp.head / 2 + 0.3, upB), L1, L1 + 400));
      return out;
    }
    if (kind === 'bolt') {
      const sp = SCREWS[j.size] || SCREWS.M3;
      const L = j.screwLen;
      const Lb = Math.max(2, (L - sp.nutH - 0.5) / 2);
      const zSeat = Lb - L + sp.nutH + 0.5;
      const af = sp.nutAF + 2 * c;
      out.cutA.push(prism(holeProfile(sp.clear / 2, upA), zSeat - 0.01, 0.01));
      out.cutA.push(prism(keep(CrossSection.circle(af / Math.sqrt(3), 6)), zSeat - 400, zSeat));
      out.cutB.push(prism(holeProfile(sp.clear / 2, upB), -0.01, Lb + 0.01));
      out.cutB.push(prism(holeProfile(sp.head / 2 + 0.3, upB), Lb, Lb + 400));
      return out;
    }
    if (kind === 'snap') {
      const w = j.d, L = j.depth, tb = 1.8, h = 0.9, hl = 1.6;
      // beam + hook profile in (x, z); extruded along y
      const beam = keep(new CrossSection([[[-tb / 2, -1], [tb / 2, -1], [tb / 2, L], [-tb / 2, L]]]));
      const hook = keep(new CrossSection([[[-tb / 2, L - hl], [-tb / 2 - h, L - hl], [-tb / 2 - 0.15, L], [-tb / 2, L]]]));
      const prof = keep(beam.add(hook));
      const solid = keep(keep(keep(prof.extrude(w)).translate([0, 0, -w / 2])).rotate([90, 0, 0]));
      out.addA.push(solid);
      const slot = keep(Manifold.cube([tb + h + 2 * c, w + 2 * c, L + c + 0.01], false)).translate([-tb / 2 - c, -w / 2 - c, -0.01]);
      const seat = keep(Manifold.cube([h + c, w + 2 * c, hl + 2 * c], false)).translate([-tb / 2 - h - c, -w / 2 - c, L - hl - c]);
      out.cutB.push(keep(slot), keep(seat));
      return out;
    }
    return out;
  }

  // a separate dowel pin, printed lying on a flat (the flat doubles as an
  // air/glue escape). Returned in its own print frame (on z = 0).
  function makePin(d, len) {
    const r = d / 2;
    const ch = Math.min(0.5, r / 3);
    const body = keep(circle(r).extrude(len - 2 * ch)).translate([0, 0, ch]);
    const t0 = keep(circle(r - ch).extrude(ch, 0, 0, r / (r - ch)));
    const t1 = keep(keep(circle(r).extrude(ch, 0, 0, (r - ch) / r)).translate([0, 0, len - ch]));
    let pin = keep(Manifold.union([keep(body), t0, t1]));
    // flat: remove 12 % of the diameter on one side
    const flat = keep(Manifold.cube([d, d, len + 2], false)).translate([-d / 2, -r - d + 0.24 * r, -1]);
    pin = keep(pin.subtract(keep(flat)));
    // lay along X with the flat down
    pin = keep(keep(pin.rotate([0, 90, 0])).rotate([90, 0, 0]));
    const bb = pin.boundingBox();
    pin = keep(pin.translate([-bb.min[0], -bb.min[1], -bb.min[2]]));
    return { manifold: pin, d, len };
  }

  // ---------- seam features ----------
  function sectionOf(M, face, poly) {
    const f = face.frame;
    const local = keep(M.transform(frameInv(f.o, f.u, f.v, f.n)));
    let s = keep(local.slice(0));
    if (poly && poly.length >= 3) s = keep(s.intersect(keep(new CrossSection([poly]))));
    return { s, local };
  }

  function stripes(seam, region, kindPolar) {
    // alternate finger regions (even → A, odd → B)
    const b = region.bounds();
    const span = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1]) * 2 + 10;
    const even = [], odd = [];
    const c = seam.center;
    if (kindPolar) {
      const step = Math.max(0.05, Math.min(seam.angStep || 0.2, Math.PI / 4));
      const n = Math.ceil(2 * Math.PI / step);
      const st = 2 * Math.PI / n;
      for (let k = 0; k < n; k++) {
        const a0 = seam.axis + k * st, a1 = a0 + st;
        const tri = [[c[0], c[1]], [c[0] + span * Math.cos(a0), c[1] + span * Math.sin(a0)], [c[0] + span * Math.cos(a1), c[1] + span * Math.sin(a1)]];
        (k % 2 === 0 ? even : odd).push([tri]);
      }
    } else {
      const ax = [Math.cos(seam.axis), Math.sin(seam.axis)];
      const pp = [-ax[1], ax[0]];
      const p = seam.pitch;
      const n = Math.ceil(span / p);
      for (let k = -n; k < n; k++) {
        const t0 = k * p, t1 = t0 + p;
        const q = (t, s) => [c[0] + ax[0] * t + pp[0] * s, c[1] + ax[1] * t + pp[1] * s];
        const rect = [q(t0, -span), q(t1, -span), q(t1, span), q(t0, span)];
        (((k % 2) + 2) % 2 === 0 ? even : odd).push([rect]);
      }
    }
    const E = keep(CrossSection.union(even.map((p) => keep(new CrossSection(p)))));
    const O = keep(CrossSection.union(odd.map((p) => keep(new CrossSection(p)))));
    return { A: keep(region.intersect(E)), B: keep(region.intersect(O)) };
  }

  // Seam features in *world* space: { addNeg, addPos, cutNeg, cutPos } where
  // add* are already clipped to the other leaf's cell.
  function seamFeatures(M, tree, face, patch, seam, cornerInset) {
    const f = face.frame;
    const toWorld = frameMat(f.o, f.u, f.v, f.n);
    const c = seam.clear;
    // keep seam features a little away from neighbouring parts on the same
    // face: inset the patch polygon (cell intersection) by clearance + 0.3 mm
    let poly = patch.poly;
    if (poly && poly.length >= 3) {
      const cs = keep(keep(new CrossSection([poly])).offset(-(c + 0.3), 'Miter', 2));
      const pp = cs.toPolygons();
      poly = pp.length ? pp[0] : null;
      if (!poly) return null;
    }
    const { s: region } = sectionOf(M, face, poly);
    if (region.isEmpty()) return null;
    const D = seam.depth;
    const res = { addNeg: [], addPos: [], cutNeg: [], cutPos: [] };
    // clip male features to the receiving part's cell, but not by this cut's
    // own plane: the 0.3 mm root overlap must stay so the union is volumetric
    const negHS = pathOf(tree, patch.negLeaf, patch.node);
    const posHS = pathOf(tree, patch.posLeaf, patch.node);
    const W = (m) => (m ? keep(m.transform(toWorld)) : null);
    const inM = (m) => (m ? keep(m.intersect(M)) : null);
    // male side helpers: "neg male" means material from the neg part extends into z>0
    const maleNeg = seam.male !== 'pos';
    const pushMale = (prof, toPos) => {
      // toPos: feature lives in z∈[0,D] (owned by neg) else z∈[-D,0] (owned by pos)
      const solid = inM(W(toPos ? prism(prof, -0.3, D) : prism(prof, -D, 0.3)));
      // cavities are subtracted from the partner only (which lies inside M),
      // so they are not intersected with M: that would create coincident
      // skins and zero-width slivers along the surface
      // the cavity also reaches c past the plane: where interleaved fingers
      // change sides at the plane, the clearance bands must overlap or the
      // finger corners meet with ~0 gap
      const cav = W(toPos ? prism(keep(prof.offset(c, 'Round')), -2 * c - 0.01, D + c) : prism(keep(prof.offset(c, 'Round')), -D - c, 2 * c + 0.01));
      if (toPos) {
        if (solid) res.addNeg.push(trimTo(solid, posHS, cornerInset));
        if (cav) res.cutPos.push(cav);
      } else {
        if (solid) res.addPos.push(trimTo(solid, negHS, cornerInset));
        if (cav) res.cutNeg.push(cav);
      }
    };
    if (seam.kind === 'finger') {
      const { A, B } = stripes(seam, region, seam.mode === 'polar');
      // shrink each finger slightly at the strip boundary too, so neighbours
      // never share a face
      if (!A.isEmpty()) pushMale(A, true);
      if (!B.isEmpty()) pushMale(B, false);
    } else if (seam.kind === 'tongue') {
      const t = keep(region.offset(-seam.inset, 'Round'));
      if (!t.isEmpty()) pushMale(t, maleNeg);
    } else if (seam.kind === 'lap') {
      const hull = keep(region.hull());
      const inner = keep(region.intersect(keep(hull.offset(-seam.wall / 2, 'Round'))));
      if (!inner.isEmpty()) pushMale(inner, maleNeg);
    } else if (seam.kind === 'dovetail') {
      const w0 = seam.width, Dv = D;
      const w1 = w0 + 2 * Dv * Math.tan((seam.flank || 15) * Math.PI / 180);
      // trapezoid in (p, z) with p perpendicular to the slide axis
      const trap0 = keep(new CrossSection([[[-w0 / 2, -0.3], [w0 / 2, -0.3], [w1 / 2, Dv], [-w1 / 2, Dv]]]));
      // true offset keeps the flank clearance uniform (not just in x)
      const trap = (cc) => (cc > 0 ? keep(trap0.offset(cc, 'Miter', 3)) : trap0);
      const big = 4000;
      const mk = (cc) => {
        // profile in XY (x = across the rail, y = face normal), extruded along
        // Z, then mapped: x → p, y → n, Z → slide axis s
        const m = keep(keep(trap(cc).extrude(big)).translate([0, 0, -big / 2]));
        const sx = Math.cos(seam.axis), sy = Math.sin(seam.axis);
        const pdir = [-sy, sx, 0];
        const cx = seam.center[0] + pdir[0] * seam.offset;
        const cy = seam.center[1] + pdir[1] * seam.offset;
        return keep(m.transform(frameMat([cx, cy, 0], pdir, [0, 0, 1], [sx, sy, 0])));
      };
      const rail = mk(0);
      const slot = mk(c);
      // limit the rail to the patch region footprint (keeps it off other parts)
      const fp = keep(keep(region.offset(0.01)).extrude(Dv + 2 * c + 1)).translate([0, 0, -0.5]);
      const railC = keep(rail.intersect(keep(fp)));
      const fpS = keep(keep(region.offset(c + 0.01)).extrude(Dv + 2 * c + 1)).translate([0, 0, -0.5]);
      const slotC = keep(slot.intersect(keep(fpS)));
      const solid = inM(W(railC));
      const cav = W(slotC);
      if (maleNeg) {
        res.addNeg.push(trimTo(solid, posHS, cornerInset));
        res.cutPos.push(cav);
      } else {
        const sm = inM(W(keep(railC.mirror([0, 0, 1]))));
        const cm = W(keep(slotC.mirror([0, 0, 1])));
        res.addPos.push(trimTo(sm, negHS, cornerInset));
        res.cutNeg.push(cm);
      }
    }
    return res;
  }

  // ---------- main build ----------
  function toManifold(mesh) {
    const m = new wasm.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices });
    m.merge();
    const man = new Manifold(m);
    const st = man.status();
    if (st !== 'NoError') throw new Error('input mesh rejected by Manifold: ' + st);
    return man;
  }

  // plan: Go plan JSON. options.zeroClear builds every joint with zero
  // clearance (used by tests to prove engagement).
  function build(M, plan, options = {}) {
    const progress = options.onProgress || (() => {});
    const tree = plan.tree;
    const faceBy = {};
    for (const f of plan.faces) faceBy[f.node] = f;
    const t0 = Date.now();

    // 1) leaf cells by recursive splitting
    const cells = {};
    const stack = [[tree.root, M]];
    while (stack.length) {
      const [id, m] = stack.pop();
      const n = tree.nodes[id];
      if (!n.cut) { cells[id] = m; continue; }
      const [pos, neg] = m.splitByPlane(n.cut.n, n.cut.d);
      keep(pos); keep(neg);
      stack.push([n.neg, neg], [n.pos, pos]);
    }
    progress({ phase: 'cut', done: 1, total: 1 });

    // 2) joint features
    const adds = {}, cuts = {};
    const push = (tab, leaf, m) => { if (!m || m.isEmpty()) return; (tab[leaf] = tab[leaf] || []).push(m); };
    const pins = [];
    const jointInfo = [];
    const patchBy = {};
    for (const p of plan.patches) patchBy[p.id] = p;
    let k = 0;
    const jointsTotal = plan.joints.length + plan.patches.filter((p) => p.seam && p.seam.kind !== 'none').length;
    for (const j0 of plan.joints) {
      const j = { ...j0 };
      if (options.zeroClear) j.clear = 0;
      if (options.clearOverride != null) j.clear = options.clearOverride;
      const p = patchBy[j.patch];
      if (!p) continue;
      const flip = j.male === 'pos';
      // frame (flip about X when the male is on the pos side)
      const X = j.x, Y = flip ? scale(j.y, -1) : j.y, Z = flip ? scale(j.z, -1) : j.z;
      const mat = frameMat(j.origin, X, Y, Z);
      const leafA = flip ? p.posLeaf : p.negLeaf;
      const leafB = flip ? p.negLeaf : p.posLeaf;
      const fixUp = (u) => (u ? (flip ? [u[0], -u[1]] : u) : null);
      const upA = fixUp(flip ? j.upPos : j.upNeg);
      const upB = fixUp(flip ? j.upNeg : j.upPos);
      const jj = flip ? { ...j, holeNeg: j.holePos, holePos: j.holeNeg } : j;
      const feat = pointFeatures(jj, upA, upB);
      for (const m of feat.cutA) if (m) push(cuts, leafA, keep(m.transform(mat)));
      for (const m of feat.cutB) if (m) push(cuts, leafB, keep(m.transform(mat)));
      // point-joint males are inset from the face boundary by the planner and
      // start 0.5 mm inside their own part, so they are not trimmed
      for (const m of feat.addA) if (m) push(adds, leafA, keep(m.transform(mat)));
      for (const pin of feat.pins) pins.push({ joint: j.id, ...pin });
      jointInfo.push({ id: j.id, leafA, leafB, kind: j.kind });
      progress({ phase: 'joints', done: ++k, total: jointsTotal });
    }
    // seam males stay this far from a receiving part's other cut faces, so
    // tongues/fingers arriving from two faces never meet in a corner
    let maxSeam = 0;
    for (const p of plan.patches) if (p.seam && p.seam.kind !== 'none') maxSeam = Math.max(maxSeam, p.seam.depth + p.seam.clear);
    const cornerInset = maxSeam > 0 ? maxSeam + 0.5 : 0;
    for (const p of plan.patches) {
      if (!p.seam || p.seam.kind === 'none') continue;
      const seam = { ...p.seam };
      if (options.zeroClear) seam.clear = 0;
      if (options.clearOverride != null) seam.clear = options.clearOverride;
      const r = seamFeatures(M, tree, faceBy[p.node], p, seam, cornerInset);
      if (r) {
        r.addNeg.forEach((m) => push(adds, p.negLeaf, m));
        r.addPos.forEach((m) => push(adds, p.posLeaf, m));
        r.cutNeg.forEach((m) => push(cuts, p.negLeaf, m));
        r.cutPos.forEach((m) => push(cuts, p.posLeaf, m));
      }
      progress({ phase: 'joints', done: ++k, total: jointsTotal });
    }

    // 3) assemble each leaf, decompose into bodies
    const parts = [];
    const leaves = plan.leaves;
    let li = 0;
    for (const leaf of leaves) {
      li++;
      const cell = cells[leaf.id];
      if (!cell || cell.isEmpty()) continue;
      let r = cell;
      const a = unionAll(adds[leaf.id] || []);
      if (a) r = keep(r.add(a));
      const c = unionAll(cuts[leaf.id] || []);
      if (c) r = keep(r.subtract(c));
      const bodies = r.decompose().map(keep);
      bodies.sort((x, y) => y.volume() - x.volume());
      let bi = 0;
      for (const b of bodies) {
        const v = b.volume();
        if (v < 1) continue; // sub-mm³ crumbs from tangential cuts
        const suffix = bodies.length > 1 && bi > 0 ? String.fromCharCode(97 + bi) : '';
        parts.push({ leaf: leaf.id, label: leaf.label + suffix, manifold: b, volume: v, status: b.status(), genus: b.genus() });
        bi++;
      }
      progress({ phase: 'parts', done: li, total: leaves.length });
    }
    return { parts, pins, cells, adds, cuts, ms: Date.now() - t0 };
  }

  function meshOf(m) {
    const g = m.getMesh();
    let pos = g.vertProperties;
    if (g.numProp !== 3) {
      const n = pos.length / g.numProp;
      const p3 = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) for (let k2 = 0; k2 < 3; k2++) p3[i * 3 + k2] = pos[i * g.numProp + k2];
      pos = p3;
    }
    return { positions: new Float32Array(pos), indices: new Uint32Array(g.triVerts) };
  }

  // ---------- joint test coupon ----------
  // Two bars: pegs on one, sockets with graded clearances on the other, plus
  // a pair of dowel holes per clearance step and dot markers for the step.
  function coupon(opts) {
    const d = opts.d || 5;
    const steps = opts.steps || [0.05, 0.1, 0.15, 0.2, 0.25, 0.3];
    const pitch = Math.max(d * 2.2, 11);
    const L = pitch * steps.length + 6;
    const W = Math.max(14, d * 2.4), T = Math.max(6, d * 1.2);
    let A = keep(Manifold.cube([L, W, T]));
    let B = keep(Manifold.cube([L, W, T]));
    const pegL = Math.min(6, d * 1.2);
    const dots = [];
    steps.forEach((c, i) => {
      const x = 3 + pitch * (i + 0.5);
      const prof = circle(d / 2);
      const peg = prism(prof, T - 0.5, T + pegL - 0.5);
      const tip = keep(keep(prof.extrude(0.5, 0, 0, 1 - 1 / d)).translate([0, 0, T + pegL - 0.5]));
      A = keep(A.add(keep(Manifold.union([peg, tip])).translate([x, W / 2, 0])));
      const hole = keep(prism(circle(d / 2 + c), -0.01, pegL + 0.6).translate([x, W / 2, T - pegL - 0.6 + 0.01]));
      B = keep(B.subtract(hole));
      // dot markers on the side: i+1 dimples
      for (let k2 = 0; k2 <= i; k2++) {
        const dz = keep(Manifold.sphere(0.6, 12)).translate([x - (i * 1.6) / 2 + k2 * 1.6, 0, T / 2]);
        dots.push(dz);
      }
    });
    const dm = unionAll(dots);
    if (dm) { A = keep(A.subtract(dm)); B = keep(B.subtract(dm)); }
    // place B next to A, sockets facing up
    B = keep(keep(B.mirror([0, 0, 1])).translate([0, W + 6, T]));
    return { parts: [{ label: 'coupon-pegs', manifold: A }, { label: 'coupon-sockets', manifold: B }], steps, d };
  }

  return { build, toManifold, meshOf, coupon, collect, pathOf, trimTo, frameInv, frameMat, sectionOf };
}

export const SCREWS = {
  'M2.5': { clear: 2.9, head: 5.0, headH: 2.5, insertD: 3.6, insertL: 4.0, nutAF: 5.0, nutH: 2.0 },
  M3: { clear: 3.4, head: 6.0, headH: 3.0, insertD: 4.0, insertL: 5.7, nutAF: 5.5, nutH: 2.4 },
  M4: { clear: 4.5, head: 7.6, headH: 4.0, insertD: 5.6, insertL: 8.1, nutAF: 7.0, nutH: 3.2 },
  M5: { clear: 5.5, head: 9.0, headH: 5.0, insertD: 6.4, insertL: 9.5, nutAF: 8.0, nutH: 4.0 },
};

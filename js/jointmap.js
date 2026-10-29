// 2D joint map of one cut face: distance field, contact patches, joints.
// The same class draws the small inline preview in the side panel and the
// large zoomable editor overlay ({zoomable: true, fill: true}).
import { partColor } from './viewer.js?v=30a0f0c';

function b64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const ROOM = '#5cc98a';

// Marching squares on the distance raster: line segments (in face mm) of
// the iso-line "distance to the wall = thr". Drawn as vectors, the edge of
// the green "room for this joint" region stays crisp at any zoom.
function isoSegments(edt, lab, r, thr) {
  const t = Math.min(255, (thr / r.maxD) * 255);
  const v = (i, j) => (i < 0 || j < 0 || i >= r.w || j >= r.h || !lab[j * r.w + i] ? -1 : edt[j * r.w + i]);
  const segs = [];
  // sample points are cell centres
  const P = (i, j) => [r.origin[0] + (i + 0.5) * r.res, r.origin[1] + (j + 0.5) * r.res];
  const lerp = (a, b, va, vb) => { const f = (t - va) / ((vb - va) || 1e-9); return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; };
  for (let j = -1; j < r.h; j++) {
    for (let i = -1; i < r.w; i++) {
      const a = v(i, j), b = v(i + 1, j), c = v(i + 1, j + 1), d = v(i, j + 1);
      const code = (a >= t ? 1 : 0) | (b >= t ? 2 : 0) | (c >= t ? 4 : 0) | (d >= t ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const pa = P(i, j), pb = P(i + 1, j), pc = P(i + 1, j + 1), pd = P(i, j + 1);
      const e = [lerp(pa, pb, a, b), lerp(pb, pc, b, c), lerp(pc, pd, c, d), lerp(pd, pa, d, a)];
      const add = (x, y) => segs.push([e[x], e[y]]);
      switch (code) {
        case 1: case 14: add(3, 0); break;
        case 2: case 13: add(0, 1); break;
        case 3: case 12: add(3, 1); break;
        case 4: case 11: add(1, 2); break;
        case 6: case 9: add(0, 2); break;
        case 7: case 8: add(3, 2); break;
        case 5: add(3, 0); add(1, 2); break;
        case 10: add(0, 1); add(2, 3); break;
        default: break;
      }
    }
  }
  return segs;
}

export class JointMap {
  constructor(canvas, cb = {}, opts = {}) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.cb = cb;
    this.zoomable = !!opts.zoomable;
    this.fill = !!opts.fill;
    // preview: the inline map only selects contacts (by their labels) and
    // otherwise opens the editor at the clicked point
    this.preview = !!opts.preview;
    this.addMode = false;
    this.showField = true;
    this.drag = null;
    this.z = 1; this.pan = [0, 0];
    this.pointers = new Map();
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => { this.pointers.delete(e.pointerId); this.drag = null; this.panning = null; });
    if (this.zoomable) {
      canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const cp = this.canvasPoint(e);
        this.zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016)), cp);
      }, { passive: false });
    }
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  set(plan, face, opts = {}) {
    const sameFace = this.face && face && this.face.node === face.node;
    this.plan = plan;
    this.face = face;
    this.opts = opts;
    this.img = null;
    if (!sameFace) { this.z = 1; this.pan = [0, 0]; }
    if (face && face.raster) {
      const r = face.raster;
      this.edt = b64(r.edt);
      this.lab = b64(r.label);
      this.rw = r.w; this.rh = r.h;
    }
    this.iso = null;
    this.draw();
  }

  dpr() { return Math.min(2, window.devicePixelRatio || 1); }

  base() {
    const f = this.face;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const l of f.loops) for (const p of l) { u0 = Math.min(u0, p[0]); u1 = Math.max(u1, p[0]); v0 = Math.min(v0, p[1]); v1 = Math.max(v1, p[1]); }
    const W = this.c.width, H = this.c.height;
    const pad = (this.zoomable ? 44 : 18) * this.dpr();
    const s = Math.min((W - 2 * pad) / (u1 - u0 || 1), (H - 2 * pad) / (v1 - v0 || 1));
    const ox = (W - s * (u1 - u0)) / 2 - s * u0;
    const oy = (H + s * (v1 - v0)) / 2 + s * v0;
    return { s, ox, oy, W, H };
  }

  view() {
    const b = this.base();
    const z = this.z, cx = b.W / 2, cy = b.H / 2, px = this.pan[0], py = this.pan[1];
    const s = b.s * z;
    return {
      s,
      toC: (p) => [cx + z * (b.ox + b.s * p[0] - cx) + px, cy + z * (b.oy - b.s * p[1] - cy) + py],
      toF: (x, y) => [(((x - px - cx) / z + cx) - b.ox) / b.s, (b.oy - ((y - py - cy) / z + cy)) / b.s],
    };
  }

  // zoom by factor keeping canvas point cp fixed
  zoomAt(f, cp) {
    if (!this.face) return;
    const b = this.base();
    const z0 = this.z;
    const z1 = Math.max(1, Math.min(this.maxZoom(), z0 * f));
    if (z1 === z0) return;
    const cx = b.W / 2, cy = b.H / 2;
    cp = cp || [cx, cy];
    for (const k of [0, 1]) {
      const c = k ? cy : cx;
      const x0 = (cp[k] - c - this.pan[k]) / z0 + c; // unzoomed canvas coordinate
      this.pan[k] = cp[k] - c - z1 * (x0 - c);
    }
    this.z = z1;
    if (z1 === 1) this.pan = [0, 0];
    this.draw();
    this.cb.onView && this.cb.onView(this.z);
  }

  // enough to see a 1 mm feature as ~40 px
  maxZoom() { const b = this.base(); return Math.max(4, (40 * this.dpr()) / b.s); }

  fit() { this.z = 1; this.pan = [0, 0]; this.draw(); this.cb.onView && this.cb.onView(this.z); }

  // pan so face point p is visible, zooming in to show ~span mm if asked
  focusOn(p, span) {
    if (!this.face) return;
    const b = this.base();
    if (span) this.z = Math.max(1, Math.min(this.maxZoom(), Math.min(b.W, b.H) / (span * b.s)));
    const V = this.view();
    const q = V.toC(p);
    const m = 60 * this.dpr();
    if (span || q[0] < m || q[1] < m || q[0] > b.W - m || q[1] > b.H - m) {
      this.pan[0] += b.W / 2 - q[0];
      this.pan[1] += b.H / 2 - q[1];
    }
    this.draw();
    this.cb.onView && this.cb.onView(this.z);
  }

  canvasPoint(e) {
    const r = this.c.getBoundingClientRect();
    return [(e.clientX - r.left) * (this.c.width / r.width), (e.clientY - r.top) * (this.c.height / r.height)];
  }

  patchAt(q) {
    const r = this.face.raster;
    if (!r) return null;
    const i = Math.floor((q[0] - r.origin[0]) / r.res), j = Math.floor((q[1] - r.origin[1]) / r.res);
    if (i < 0 || j < 0 || i >= r.w || j >= r.h) return null;
    const l = this.lab[j * r.w + i];
    return l ? this.face.patches[l - 1] : null;
  }

  distAt(q) {
    const r = this.face.raster;
    const i = Math.floor((q[0] - r.origin[0]) / r.res), j = Math.floor((q[1] - r.origin[1]) / r.res);
    if (i < 0 || j < 0 || i >= r.w || j >= r.h) return 0;
    return (this.edt[j * r.w + i] / 255) * r.maxD;
  }

  // is there any spot on this face with at least thr mm to the wall?
  roomFor(thr) {
    const r = this.face && this.face.raster;
    if (!r) return false;
    const t = (thr / r.maxD) * 255;
    for (let k = 0; k < this.edt.length; k++) if (this.lab[k] && this.edt[k] >= t) return true;
    return false;
  }

  joints() { return this.plan ? this.plan.joints.filter((j) => this.face.patches.includes(j.patch)) : []; }

  threshold() { return Math.max(this.opts.threshold || 0, this.drag ? this.drag.j.rreq || 0 : 0); }

  draw() {
    const ctx = this.ctx;
    // keep the backing store at CSS size × DPR
    const rect = this.c.getBoundingClientRect();
    if (rect.width > 0) {
      const dpr = this.dpr();
      const w = Math.round(rect.width * dpr), h = Math.round((this.fill ? rect.height : rect.width * 0.7) * dpr);
      if (h > 0 && (this.c.width !== w || this.c.height !== h)) { this.c.width = w; this.c.height = h; }
    }
    this.contactLabels = [];
    ctx.clearRect(0, 0, this.c.width, this.c.height);
    if (!this.face || !this.face.loops || !this.face.loops.length) return;
    const V = this.view();
    const r = this.face.raster;
    const leafIdx = {};
    this.plan.leaves.forEach((l, i) => { leafIdx[l.id] = i; });
    const thr = this.threshold();
    const dpr = this.dpr();
    if (r) {
      // field image
      const cv = document.createElement('canvas');
      cv.width = r.w; cv.height = r.h;
      const ic = cv.getContext('2d');
      const im = ic.createImageData(r.w, r.h);
      const pcol = this.face.patches.map((pid) => {
        const p = this.plan.patches[pid];
        const hex = partColor(leafIdx[p.posLeaf] || 0);
        return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
      });
      for (let j = 0; j < r.h; j++) {
        for (let i = 0; i < r.w; i++) {
          const k = j * r.w + i;
          const l = this.lab[k];
          const o = ((r.h - 1 - j) * r.w + i) * 4;
          if (!l) { im.data[o + 3] = 0; continue; }
          const c = pcol[l - 1] || [200, 200, 200];
          const d = this.edt[k] / 255;
          const dm = d * r.maxD;
          let f = this.showField ? 0.35 + 0.65 * Math.sqrt(d) : 0.8;
          let rr = c[0] * f, gg = c[1] * f, bb = c[2] * f;
          if (thr > 0) {
            if (dm >= thr) { rr = rr * 0.35 + 50; gg = gg * 0.35 + 150; bb = bb * 0.35 + 80; } else { rr *= 0.45; gg *= 0.45; bb *= 0.45; }
          }
          im.data[o] = rr; im.data[o + 1] = gg; im.data[o + 2] = bb; im.data[o + 3] = 255;
        }
      }
      ic.putImageData(im, 0, 0);
      const a = V.toC([r.origin[0], r.origin[1] + r.h * r.res]);
      ctx.imageSmoothingEnabled = this.z < 3 && r.w < 200;
      ctx.drawImage(cv, a[0], a[1], r.w * r.res * V.s, r.h * r.res * V.s);
      // crisp vector edge of the "room" region
      if (thr > 0) {
        if (!this.iso || this.iso.thr !== thr) this.iso = { thr, segs: isoSegments(this.edt, this.lab, r, thr) };
        ctx.strokeStyle = ROOM;
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        for (const [p, q] of this.iso.segs) { const A = V.toC(p), B = V.toC(q); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); }
        ctx.stroke();
      }
    }
    // outlines
    ctx.lineWidth = 1.5 * (this.zoomable ? dpr : 1);
    ctx.strokeStyle = '#e6ebf0';
    ctx.beginPath();
    for (const l of this.face.loops) {
      l.forEach((p, i) => { const q = V.toC(p); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
      ctx.closePath();
    }
    ctx.stroke();
    // patch labels + seams
    const fpx = Math.round((this.zoomable ? 14 : 12) * dpr);
    ctx.font = `600 ${fpx}px Inter, "Segoe UI", system-ui, sans-serif`;
    ctx.lineJoin = 'round';
    const occupied = [];
    const label = (t, x, y, col) => {
      // Use real glyph bounds, including the halo; move only colliding labels.
      ctx.textAlign = 'center';
      const m = ctx.measureText(t), pad = 3 * dpr;
      const left = m.actualBoundingBoxLeft + pad, right = m.actualBoundingBoxRight + pad;
      const top = m.actualBoundingBoxAscent + pad, bottom = m.actualBoundingBoxDescent + pad;
      const clampX = (v) => Math.max(left, Math.min(this.c.width - right, v));
      const clampY = (v) => Math.max(top, Math.min(this.c.height - bottom, v));
      const box = (xx, yy) => ({ left: xx - left, right: xx + right, top: yy - top, bottom: yy + bottom });
      const free = (b) => !occupied.some((a) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
      x = clampX(x); y = clampY(y);
      let b = box(x, y);
      if (!free(b)) {
        const step = top + bottom + dpr;
        const candidates = [];
        for (let yy = top; yy <= this.c.height - bottom; yy += step)
          for (let xx = left; xx <= this.c.width - right; xx += left + right + dpr)
            candidates.push({ x: xx, y: yy, distance: Math.hypot(xx - x, yy - y) });
        candidates.sort((a, b) => a.distance - b.distance);
        const next = candidates.find((p) => free(box(p.x, p.y)));
        if (next) { x = next.x; y = next.y; b = box(x, y); }
      }
      occupied.push(b);
      // label badge: rounded backing instead of a heavy halo
      ctx.fillStyle = 'rgba(13,19,20,0.82)'; ctx.beginPath(); (ctx.roundRect ? ctx.roundRect(b.left - dpr, b.top, b.right - b.left + 2 * dpr, b.bottom - b.top, 4 * dpr) : ctx.rect(b.left, b.top, b.right - b.left, b.bottom - b.top)); ctx.fill();
      ctx.fillStyle = col; ctx.fillText(t, x, y);
      return { ...b, x, y };
    };
    // joints first reserve their marker area so labels avoid covering them
    const marks = this.joints().map((j) => {
      const q = V.toC(j.p);
      const rf = Math.max((this.zoomable ? 9 : 2.5) * dpr, (j.d || 3) / 2 * V.s);
      occupied.push({ left: q[0] - rf, right: q[0] + rf, top: q[1] - rf, bottom: q[1] + rf });
      return { j, q, rf };
    });
    ctx.textAlign = 'center';
    for (const pid of this.face.patches) {
      const p = this.plan.patches[pid];
      const q = V.toC(p.centroid);
      if (q[0] < -50 || q[1] < -50 || q[0] > this.c.width + 50 || q[1] > this.c.height + 50) continue;
      const col = pid === this.opts.patch ? '#ffffff' : (p.fallback || p.single ? '#e8b04a' : '#dbe3ea');
      const b = label(document.body.dataset.expert==='true'?`C${pid}`:`Contact ${this.face.patches.indexOf(pid)+1}`,  q[0], q[1] - fpx * 0.6, col);
      this.contactLabels.push({ ...b, pid });
      // A leader preserves the association when edge clamping/packing moves an ID.
      ctx.lineWidth = dpr; ctx.strokeStyle = col;
      ctx.beginPath(); ctx.moveTo(q[0], q[1]);
      ctx.lineTo(Math.max(b.left, Math.min(b.right, q[0])), Math.max(b.top, Math.min(b.bottom, q[1])));
      ctx.stroke();
    }
    // joints
    this.marks = marks;
    for (const { j, q, rf } of marks) {
      const rq = j.rreq * V.s;
      ctx.setLineDash([4 * dpr, 3 * dpr]);
      ctx.lineWidth = dpr;
      ctx.strokeStyle = '#ffffff90';
      ctx.beginPath(); ctx.arc(q[0], q[1], rq, 0, 2 * Math.PI); ctx.stroke();
      ctx.setLineDash([]);
      const sel = j.id === this.opts.joint || j.id === this.opts.hover;
      ctx.fillStyle = (j.warnings && j.warnings.length) ? '#e0564a' : (sel ? '#e07a3f' : '#f5f5f5');
      ctx.strokeStyle = '#0b0e12';
      ctx.lineWidth = (sel ? 3 : 1.5) * (this.zoomable ? dpr : 1);
      ctx.beginPath(); ctx.arc(q[0], q[1], rf, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      if (sel && this.zoomable) {
        ctx.strokeStyle = '#e07a3f'; ctx.lineWidth = 2 * dpr;
        ctx.beginPath(); ctx.arc(q[0], q[1], rf + 5 * dpr, 0, 2 * Math.PI); ctx.stroke();
      }
      ctx.textAlign = 'left';
      label(document.body.dataset.expert==='true'?`J${j.id}`:`Pin ${this.joints().findIndex(x=>x.id===j.id)+1}`,  q[0] + rf + 3 * dpr, q[1] - rf, '#ffffff');
      ctx.textAlign = 'center';
    }
    if (this.addMode && !this.zoomable && !this.preview) {
      ctx.fillStyle = '#e07a3f';
      ctx.textAlign = 'left';
      label('click to add a joint · green = room for this type', 10, this.c.height - 10, '#e07a3f');
    }
  }

  // touch needs bigger targets than a mouse
  hitRadius() {
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    return (this.zoomable ? (coarse ? 24 : 16) : 14 * (this.c.width / 600) / this.dpr()) * this.dpr();
  }

  hitJoint(cp) {
    const V = this.view();
    let best = null, bd = this.hitRadius();
    for (const j of this.joints()) {
      const q = V.toC(j.p);
      const d = Math.hypot(q[0] - cp[0], q[1] - cp[1]);
      if (d < Math.max(bd, (j.d || 3) / 2 * V.s)) { best = j; bd = d; }
    }
    return best;
  }

  down(e) {
    if (!this.face) return;
    const cp = this.canvasPoint(e);
    if (this.preview) {
      const hit = this.contactLabels.find((b) => cp[0] >= b.left && cp[0] <= b.right && cp[1] >= b.top && cp[1] <= b.bottom);
      if (hit) { this.cb.onSelectPatch && this.cb.onSelectPatch(hit.pid); return; }
      const j = this.hitJoint(cp);
      this.cb.onOpen && this.cb.onOpen(j ? j.p : this.view().toF(cp[0], cp[1]), j ? j.id : null);
      return;
    }
    if (this.zoomable) {
      this.pointers.set(e.pointerId, cp);
      this.c.setPointerCapture(e.pointerId);
      if (this.pointers.size === 2) {
        // second finger: pinch, abandon any drag
        if (this.drag) { this.drag.j.p = this.drag.p0; this.drag = null; this.draw(); }
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
        this.panning = null;
        return;
      }
    }
    const j = this.hitJoint(cp);
    if (j && !this.addMode) {
      this.drag = { j, moved: false, p0: j.p.slice(), cp };
      this.c.setPointerCapture(e.pointerId);
      this.cb.onSelectJoint && this.cb.onSelectJoint(j.id);
      return;
    }
    if (this.zoomable) {
      // decide on pointer-up: a click selects/adds, a drag pans
      this.panning = { cp, pan0: this.pan.slice(), moved: false };
      return;
    }
    this.click(cp);
  }

  click(cp) {
    const hit = !this.addMode && this.contactLabels.find((b) => cp[0] >= b.left && cp[0] <= b.right && cp[1] >= b.top && cp[1] <= b.bottom);
    if (hit) {
      this.cb.onSelectPatch && this.cb.onSelectPatch(hit.pid);
      return;
    }
    const q = this.view().toF(cp[0], cp[1]);
    const pid = this.patchAt(q);
    if (this.addMode) {
      if (pid != null) this.cb.onAdd && this.cb.onAdd(pid, q);
      else this.cb.onMiss && this.cb.onMiss();
      return;
    }
    this.cb.onSelectPatch && this.cb.onSelectPatch(pid);
  }

  move(e) {
    const cp = this.canvasPoint(e);
    if (this.zoomable && this.pointers.has(e.pointerId)) {
      this.pointers.set(e.pointerId, cp);
      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        this.pan[0] += c[0] - this.pinch.c[0];
        this.pan[1] += c[1] - this.pinch.c[1];
        this.zoomAt(d / (this.pinch.d || d), c);
        this.pinch = { d, c };
        this.draw();
        return;
      }
    }
    if (this.panning) {
      const dx = cp[0] - this.panning.cp[0], dy = cp[1] - this.panning.cp[1];
      if (!this.panning.moved && Math.hypot(dx, dy) < 6 * this.dpr()) return;
      this.panning.moved = true;
      this.pan = [this.panning.pan0[0] + dx, this.panning.pan0[1] + dy];
      this.c.style.cursor = 'grabbing';
      this.draw();
      return;
    }
    if (!this.drag) {this.cb.onHover?.(this.hitJoint(cp)?.id??null);return;}
    if (!this.drag.moved && Math.hypot(cp[0] - this.drag.cp[0], cp[1] - this.drag.cp[1]) < 3 * this.dpr()) return;
    const q = this.view().toF(cp[0], cp[1]);
    this.drag.j.p = q;
    this.drag.moved = true;
    this.draw();
  }

  up(e) {
    if (this.zoomable) {
      this.pointers.delete(e.pointerId);
      if (this.pinch) { if (this.pointers.size < 2) this.pinch = null; this.panning = null; return; }
    }
    if (this.panning) {
      const p = this.panning;
      this.panning = null;
      this.c.style.cursor = '';
      if (!p.moved) this.click(p.cp);
      return;
    }
    if (this.drag && this.drag.moved) {
      const q = this.drag.j.p;
      const pid = this.patchAt(q);
      const j = this.drag.j;
      this.drag = null;
      this.cb.onMove && this.cb.onMove(j, q, pid);
      return;
    }
    this.drag = null;
  }
}

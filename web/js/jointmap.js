// 2D joint map of one cut face: distance field, contact patches, joints.
import { partColor } from './viewer.js';

function b64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class JointMap {
  constructor(canvas, cb = {}) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.cb = cb;
    this.addMode = false;
    this.showField = true;
    this.drag = null;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  set(plan, face, opts = {}) {
    this.plan = plan;
    this.face = face;
    this.opts = opts;
    this.img = null;
    if (face && face.raster) {
      const r = face.raster;
      this.edt = b64(r.edt);
      this.lab = b64(r.label);
      this.rw = r.w; this.rh = r.h;
    }
    this.draw();
  }

  view() {
    const f = this.face;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const l of f.loops) for (const p of l) { u0 = Math.min(u0, p[0]); u1 = Math.max(u1, p[0]); v0 = Math.min(v0, p[1]); v1 = Math.max(v1, p[1]); }
    const W = this.c.width, H = this.c.height;
    const pad = 18;
    const s = Math.min((W - 2 * pad) / (u1 - u0 || 1), (H - 2 * pad) / (v1 - v0 || 1));
    const ox = (W - s * (u1 - u0)) / 2 - s * u0;
    const oy = (H + s * (v1 - v0)) / 2 + s * v0;
    return { s, toC: (p) => [ox + s * p[0], oy - s * p[1]], toF: (x, y) => [(x - ox) / s, (oy - y) / s] };
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

  joints() { return this.plan ? this.plan.joints.filter((j) => this.face.patches.includes(j.patch)) : []; }

  draw() {
    const ctx = this.ctx;
    // keep the backing store at CSS size × DPR
    const rect = this.c.getBoundingClientRect();
    if (rect.width > 0) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(rect.width * dpr), h = Math.round(rect.width * 0.7 * dpr);
      if (this.c.width !== w || this.c.height !== h) { this.c.width = w; this.c.height = h; }
    }
    ctx.clearRect(0, 0, this.c.width, this.c.height);
    if (!this.face || !this.face.loops || !this.face.loops.length) return;
    const V = this.view();
    const r = this.face.raster;
    const leafIdx = {};
    this.plan.leaves.forEach((l, i) => { leafIdx[l.id] = i; });
    const thr = this.opts.threshold || 0;
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
          if (thr > 0 && this.showField) {
            if (dm >= thr) { rr = rr * 0.6 + 40; gg = gg * 0.6 + 110; bb = bb * 0.6 + 60; } else { rr *= 0.55; gg *= 0.55; bb *= 0.55; }
          }
          im.data[o] = rr; im.data[o + 1] = gg; im.data[o + 2] = bb; im.data[o + 3] = 255;
        }
      }
      ic.putImageData(im, 0, 0);
      const a = V.toC([r.origin[0], r.origin[1] + r.h * r.res]);
      ctx.imageSmoothingEnabled = r.w < 200;
      ctx.drawImage(cv, a[0], a[1], r.w * r.res * V.s, r.h * r.res * V.s);
    }
    // outlines
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#e6ebf0';
    ctx.beginPath();
    for (const l of this.face.loops) {
      l.forEach((p, i) => { const q = V.toC(p); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
      ctx.closePath();
    }
    ctx.stroke();
    // patch labels + seams
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const fpx = Math.round(12 * dpr);
    ctx.font = `600 ${fpx}px system-ui`;
    ctx.lineJoin = 'round';
    const label = (t, x, y, col) => {
      // keep labels inside the canvas (shell sections put centroids near the edge)
      const hw = ctx.measureText(t).width / 2 + 4 * dpr;
      x = Math.max(hw, Math.min(this.c.width - hw, x));
      y = Math.max(fpx, Math.min(this.c.height - 4 * dpr, y));
      ctx.lineWidth = 3 * dpr; ctx.strokeStyle = '#0b0e12'; ctx.strokeText(t, x, y); ctx.fillStyle = col; ctx.fillText(t, x, y);
    };
    ctx.textAlign = 'center';
    for (const pid of this.face.patches) {
      const p = this.plan.patches[pid];
      const q = V.toC(p.centroid);
      const ln = this.plan.leaves[leafIdx[p.negLeaf]].label, lp = this.plan.leaves[leafIdx[p.posLeaf]].label;
      let t = `${ln} ↔ ${lp}`;
      if (p.seam && p.seam.kind !== 'none') t += ` · ${p.seam.kind}`;
      label(t, q[0], q[1] - fpx * 0.6, pid === this.opts.patch ? '#ffffff' : '#dbe3ea');
      label(`wall ${p.thickness.toFixed(1)} mm · max Ø${(2 * p.rmax).toFixed(1)}`, q[0], q[1] + fpx * 0.8, '#aab6c2');
      if (p.fallback) label(`⚠ ${p.fallback.want} → ${p.fallback.got.replace('tongue-and-groove', 'T&G')}: ${p.fallback.reason}`, q[0], q[1] + fpx * 2.2, '#e8b04a');
      else if (p.single) label('⚠ only one joint fits: can rotate', q[0], q[1] + fpx * 2.2, '#e8b04a');
    }
    // joints
    for (const j of this.joints()) {
      const q = V.toC(j.p);
      const rf = Math.max(2.5, (j.d || 3) / 2 * V.s);
      const rq = j.rreq * V.s;
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#ffffff80';
      ctx.beginPath(); ctx.arc(q[0], q[1], rq, 0, 2 * Math.PI); ctx.stroke();
      ctx.setLineDash([]);
      const sel = j.id === this.opts.joint;
      ctx.fillStyle = (j.warnings && j.warnings.length) ? '#e0564a' : (sel ? '#e07a3f' : '#f5f5f5');
      ctx.strokeStyle = '#0b0e12';
      ctx.lineWidth = sel ? 3 : 1.5;
      ctx.beginPath(); ctx.arc(q[0], q[1], rf, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      ctx.textAlign = 'left';
      label(`J${j.id}`, q[0] + rf + 3 * dpr, q[1] - rf, '#ffffff');
      ctx.textAlign = 'center';
    }
    if (this.addMode) {
      ctx.fillStyle = '#e07a3f';
      ctx.textAlign = 'left';
      label('click to add a joint · green = room for this type', 10, this.c.height - 10, '#e07a3f');
    }
  }

  hitJoint(cp) {
    const V = this.view();
    let best = null, bd = 14 * (this.c.width / 600);
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
    const j = this.hitJoint(cp);
    if (j && !this.addMode) {
      this.drag = { j, moved: false };
      this.c.setPointerCapture(e.pointerId);
      this.cb.onSelectJoint && this.cb.onSelectJoint(j.id);
      return;
    }
    const q = this.view().toF(cp[0], cp[1]);
    const pid = this.patchAt(q);
    if (this.addMode) {
      if (pid != null) this.cb.onAdd && this.cb.onAdd(pid, q);
      return;
    }
    this.cb.onSelectPatch && this.cb.onSelectPatch(pid);
  }

  move(e) {
    if (!this.drag) return;
    const cp = this.canvasPoint(e);
    const q = this.view().toF(cp[0], cp[1]);
    this.drag.j.p = q;
    this.drag.moved = true;
    this.draw();
  }

  up() {
    if (this.drag && this.drag.moved) {
      const q = this.drag.j.p;
      const pid = this.patchAt(q);
      this.cb.onMove && this.cb.onMove(this.drag.j, q, pid);
    }
    this.drag = null;
  }
}

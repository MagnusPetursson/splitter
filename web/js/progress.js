// Large-mesh limits, estimates and the staged progress panel.
//
// The numbers below are measured, not guessed (docs/large-meshes.md): the
// Go planner compiled to WebAssembly on a 905k-triangle helmet and 4× / 16×
// subdivided copies of a 226k one, in Node and headless Chrome.

export const LIMITS = {
  // simplify for planning above this many triangles, down to `target`,
  // stopping early if the quadric error would exceed `maxError` mm
  threshold: 600000,
  target: 400000,
  maxError: 0.05,
  // keep the full-detail mesh (for exports cut from the original) up to
  // this many triangles: ~24 bytes per triangle in the planner, but the
  // geometry kernel needs ~1 kB per triangle to cut it (measured: 3.7 GB
  // extra at 3.6 M triangles, 2.9 GB at 1.8 M), so above this exports use
  // the simplified mesh
  keepOriginal: 1500000,
  // estimated peak memory (MB) at which we warn / refuse before loading
  warnMB: 1500,
  refuseMB: 3000,
};

// Allow overriding limits for testing and for people who know their
// machine: localStorage['ps.limits'] = '{"threshold":300000}'.
try {
  const o = JSON.parse(localStorage.getItem('ps.limits') || 'null');
  if (o && typeof o === 'object') Object.assign(LIMITS, o);
} catch (_) { /* ignore */ }

// Triangle count of a file without parsing it. Binary STL is exact (from
// its header); the rest are byte-size estimates.
export async function estimateTris(file) {
  const name = (file.name || '').toLowerCase();
  const size = file.size;
  if (name.endsWith('.stl') && size >= 84) {
    const head = new Uint8Array(await file.slice(0, 84).arrayBuffer());
    const n = new DataView(head.buffer).getUint32(80, true);
    if (84 + 50 * n === size) return { tris: n, exact: true, format: 'binary STL' };
    return { tris: Math.round(size / 250), exact: false, format: 'ASCII STL' };
  }
  if (name.endsWith('.obj')) return { tris: Math.round(size / 40), exact: false, format: 'OBJ' };
  if (name.endsWith('.3mf')) return { tris: Math.round(size / 12), exact: false, format: '3MF' };
  return { tris: Math.round(size / 50), exact: false, format: 'mesh' };
}

const MB = 1 << 20;
// Peak WebAssembly memory of the Go planner (it never shrinks), measured:
// load+repair ≈ file bytes + 260 B/triangle; planning ≈ 440 B/triangle of
// the planned mesh; plus the geometry kernel (Manifold) and the 3D view
// in the same tab, ≈ 250 B per planned triangle.
export function estimateMemMB(tris, bytes, simplify) {
  const planned = simplify ? Math.min(tris, LIMITS.target) : tris;
  const load = bytes + 260 * tris + (simplify ? 120 * tris : 0);
  const plan = 440 * planned + (simplify && tris <= LIMITS.keepOriginal ? 24 * tris : 0);
  return (Math.max(load, plan) + 250 * planned) / MB;
}

// Wall-clock estimates (s), from the same measurements (planning scales
// with the planned triangles and the number of cuts; ~3 cuts here).
export function estimateLoadSec(tris, simplify) {
  return 1 + 7e-6 * tris + (simplify ? 1.6e-5 * tris : 0);
}
export function estimatePlanSec(tris) { return 15 + 1.05e-4 * tris; }

export function fmtTris(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 2)} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} k`;
  return String(n);
}
export function fmtDur(s) {
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60), r = s % 60;
  return `${m}:${String(r).padStart(2, '0')} min`;
}
export function fmtMem(mb) { return mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`; }

// ---------------- staged progress panel ----------------
const $ = (id) => document.getElementById(id);

export const LOAD_STAGES = [
  ['read', 'Read'], ['parse', 'Parse'], ['repair', 'Repair'], ['simplify', 'Simplify'], ['measure', 'Measure'], ['index', 'Index'], ['kernel', 'Kernel'],
];
export const PLAN_STAGES = [['cut', 'Find cuts'], ['faces', 'Analyse cut faces'], ['joints', 'Place joints']];

// map planner messages to stages
const PLAN_MSG = [[/^analysing cut faces/, 'faces'], [/^placing joints/, 'joints'], [/^planning cuts|^searching cut/, 'cut']];

export class Progress {
  constructor() {
    this.el = $('busy');
    this.active = false;
    this.timer = 0;
    $('busyCancel').addEventListener('click', () => { if (this.onCancel) { const f = this.onCancel; this.onCancel = null; $('busyCancel').disabled = true; $('busyCancel').textContent = 'Cancelling…'; f(); } });
  }

  // start(title, {stages, est (s), cancel: fn, kind: 'load'|'plan'})
  start(title, opts = {}) {
    this.active = true;
    this.kind = opts.kind || '';
    this.t0 = performance.now();
    this.est = opts.est || 0;
    this.stages = opts.stages || [];
    this.cur = null;
    this.frac = null;
    this.cut = { k: 0, n: opts.cuts || 0, sub: 0 };
    this.onCancel = opts.cancel || null;
    this.seen = new Set();
    this.el.classList.remove('hidden');
    this.el.classList.add('staged');
    $('busyTitle').textContent = title;
    const c = $('busyCancel');
    c.classList.toggle('hidden', !this.onCancel);
    c.disabled = false; c.textContent = 'Cancel';
    $('busyStages').innerHTML = this.stages.map(([k, l]) => `<li data-stage="${k}">${l}</li>`).join('');
    $('busyText').textContent = opts.message || '';
    this.setFrac(null);
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 500);
    this.tick();
  }

  setStage(k) {
    if (!k || k === this.cur) return;
    this.cur = k;
    this.seen.add(k);
    const order = this.stages.map((s) => s[0]);
    const ci = order.indexOf(k);
    for (const li of $('busyStages').children) {
      const i = order.indexOf(li.dataset.stage);
      li.className = i < ci ? (this.seen.has(li.dataset.stage) ? 'done' : 'skip') : i === ci ? 'on' : '';
    }
  }

  setFrac(f) {
    this.frac = f;
    this.el.classList.toggle('indet', f == null);
    if (f != null) $('busyFill').style.width = Math.round(100 * Math.max(0.02, Math.min(1, f))) + '%';
  }

  // m: {stage, done, total, message} from the planner (or a plain string)
  update(m) {
    if (!this.active) return;
    if (typeof m === 'string') m = { message: m };
    let stage = m.stage;
    if (stage === 'plan' || (!stage && this.kind === 'plan')) {
      const hit = PLAN_MSG.find(([re]) => re.test(m.message || ''));
      stage = hit ? hit[1] : null;
    }
    if (stage === 'candidates' || stage === 'support') {
      const f = m.total ? m.done / m.total : 0;
      this.cut.sub = stage === 'candidates' ? 0.6 * f : 0.6 + 0.4 * f;
      this.cut.what = stage === 'candidates' ? `cut planes ${m.done}/${m.total}` : `support check ${m.done}/${m.total}`;
      stage = 'cut';
    } else if (stage === 'cut') {
      this.cut.k = m.done; this.cut.n = Math.max(m.total || 0, m.done); this.cut.sub = 0; this.cut.what = '';
    }
    if (this.kind === 'plan') {
      this.setStage(stage || this.cur);
      if (this.cur === 'cut' && this.cut.k) {
        const n = Math.max(1, this.cut.n);
        this.setFrac(Math.min(0.9, 0.9 * ((this.cut.k - 1) + this.cut.sub) / n));
        const of = this.cut.k > (this.cut.est || n) ? ' (more than estimated)' : n > 1 ? ` of ~${n}` : '';
        $('busyText').textContent = `Cut ${this.cut.k}${of}${this.cut.what ? ' · evaluating ' + this.cut.what : ''}`;
        if (!this.cut.est) this.cut.est = n;
      } else if (this.cur === 'faces') {
        this.setFrac(0.91); $('busyText').textContent = 'Analysing the cut faces';
      } else if (this.cur === 'joints') {
        this.setFrac(0.92 + 0.08 * (m.total ? m.done / m.total : 0));
        $('busyText').textContent = m.total ? `Placing joints · contact ${Math.min(m.done + 1, m.total)}/${m.total}` : 'Placing joints';
      } else if (m.message) $('busyText').textContent = cap(m.message);
      return;
    }
    if (stage) this.setStage(stage);
    if (m.total && m.stage) this.setFrac(m.done / m.total); else if (m.stage) this.setFrac(null);
    const extra = m.total > 1 && m.stage === 'simplify' ? ` · ${Math.round(100 * m.done / m.total)} %` : m.total > 1 && m.stage === 'upload' ? '' : '';
    if (m.message) $('busyText').textContent = cap(m.message) + extra;
    else if (extra) $('busyText').textContent = $('busyText').textContent.replace(/ · \d+ %$/, '') + extra;
  }

  tick() {
    if (!this.active) return;
    const el = (performance.now() - this.t0) / 1000;
    let left = '';
    if (this.kind === 'plan' && this.frac != null && this.frac > 0.08) left = ` · about ${fmtDur(el * (1 - this.frac) / this.frac)} left`;
    else if (this.est > 3) left = el < this.est ? ` · estimate ≈ ${fmtDur(this.est)}` : ' · taking longer than estimated';
    $('busyTime').textContent = `elapsed ${fmtDur(el)}${left}`;
  }

  end() {
    this.active = false;
    this.onCancel = null;
    clearInterval(this.timer);
    this.el.classList.add('hidden');
    this.el.classList.remove('staged');
  }

  elapsed() { return (performance.now() - this.t0) / 1000; }
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
export const msgText = (m) => cap(typeof m === 'string' ? m : (m && m.message) || '');

// ---------------- crash breadcrumb ----------------
// A tab that runs out of memory dies without running any of our code. We
// leave a note before heavy work and clear it afterwards; a note still
// there on the next start means the tab died during that step.
const CRUMB = 'ps.inflight';
export function crumbSet(what) { try { localStorage.setItem(CRUMB, JSON.stringify({ ...what, t: Date.now() })); } catch (_) { /* ignore */ } }
export function crumbClear() { try { localStorage.removeItem(CRUMB); } catch (_) { /* ignore */ } }
export function crumbTake() {
  try {
    const c = JSON.parse(localStorage.getItem(CRUMB) || 'null');
    localStorage.removeItem(CRUMB);
    return c && Date.now() - c.t < 6 * 3600e3 ? c : null;
  } catch (_) { return null; }
}

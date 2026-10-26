// print-splitter UI controller.
import { Viewer, partColor, KIND_COLORS } from './viewer.js';
import { JointMap } from './jointmap.js';
import { createBackend } from './backend.js';

const $ = (id) => document.getElementById(id);
const api = (p) => new URL(p, document.baseURI).href;
const fmt = (x, d = 1) => (Math.round(x * 10 ** d) / 10 ** d).toLocaleString('en-US', { maximumFractionDigits: d });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const S = {
  printers: [], kinds: null, fitsDefault: null,
  model: null, mesh: null, plan: null, built: null, export: null,
  sel: {}, face: null, addMode: false, planSeq: 0, workerReady: false, planWasAuto: false, comparison: null,
};

// ---------------- infrastructure ----------------
let toastT = 0;
function toast(msg, err = false, ms = 4200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('err', err);
  t.classList.remove('hidden');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.add('hidden'), ms);
}
function busy(text, frac = null) {
  const b = $('busy');
  if (text === false) { b.classList.add('hidden'); return; }
  b.classList.remove('hidden');
  $('busyText').textContent = text;
  b.classList.toggle('indet', frac == null);
  if (frac != null) $('busyFill').style.width = Math.round(100 * Math.max(0.02, Math.min(1, frac))) + '%';
}
let BE = null; // planner backend (local WASM or server)
let DEFAULTS = null; // form values before any saved settings are applied
function save() {
  const s = {
    printer: $('printer').value, bedX: $('bedX').value, bedY: $('bedY').value, bedZ: $('bedZ').value,
    margin: $('margin').value, nozzle: $('nozzle').value, minPiece: $('minPiece').value, style: $('jointStyle').value,
    upright: $('upright').checked, tilted: $('tilted').checked, supportWeight: $('supportWeight').value,
    fits: Object.fromEntries([...document.querySelectorAll('[data-fit]')].map((i) => [i.dataset.fit, i.value])),
  };
  localStorage.setItem('ps.settings', JSON.stringify(s));
}
function load() {
  try { return JSON.parse(localStorage.getItem('ps.settings') || 'null'); } catch (_) { return null; }
}

// ---------------- worker ----------------
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const pending = {};
worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'progress') {
    const lbl = { cut: 'cutting', joints: 'building joints', parts: 'assembling parts', verify: 'verifying' }[m.phase] || m.phase;
    busy(`Building in your browser (Manifold WASM): ${lbl} ${m.total > 1 ? `${m.done}/${m.total}` : ''}`, m.phase === 'parts' ? 0.6 + 0.35 * m.done / m.total : m.phase === 'joints' ? 0.15 + 0.45 * m.done / Math.max(1, m.total) : m.phase === 'verify' ? 0.97 : 0.1);
    return;
  }
  const key = m.type === 'error' ? Object.keys(pending)[0] : m.type;
  const p = pending[key] || pending[Object.keys(pending)[0]];
  if (!p) return;
  delete pending[p.key];
  if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m);
};
function work(type, payload, expect, transfer) {
  return new Promise((resolve, reject) => {
    pending[expect] = { key: expect, resolve, reject };
    worker.postMessage({ type, ...payload }, transfer || []);
  });
}

// ---------------- setup ----------------
const viewer = new Viewer($('viewport'), {
  onPick: (h) => onPick(h),
  onCutDrag: (node, d) => { const inp = $('cutOffset'); if (inp) { inp.value = fmt(d, 2); $('cutOffsetNum').value = fmt(d, 2); } },
  onCutDragEnd: (node, d) => setCut(node, null, d),
});
const jmap = new JointMap($('jointMap'), {
  onSelectJoint: (id) => selectJoint(id),
  onSelectPatch: (pid) => { S.sel.patch = pid; S.sel.joint = null; renderJointPanel(); },
  onMove: (j, q, pid) => moveJoint(j, q, pid),
  onAdd: (pid, q) => addJoint(pid, q),
});

async function init() {
  BE = await createBackend();
  document.body.dataset.mode = BE.mode;
  $('privacy').textContent = BE.mode === 'local'
    ? 'Runs entirely in your browser: your model is never uploaded.'
    : 'Server mode: models are processed by this print-splitter server.';
  const pr = await BE.printers();
  S.printers = pr.printers;
  S.fitsDefault = { 0.4: pr.fits, 0.6: pr.fits06 };
  const sel = $('printer');
  const makers = [...new Set(pr.printers.map((p) => p.maker))];
  for (const mk of makers) {
    const g = document.createElement('optgroup');
    g.label = mk;
    for (const p of pr.printers.filter((x) => x.maker === mk)) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = `${p.name} — ${p.x}×${p.y}×${p.z}`;
      g.appendChild(o);
    }
    sel.appendChild(g);
  }
  const o = document.createElement('option'); o.value = 'custom'; o.textContent = 'Custom volume…'; sel.appendChild(o);
  S.kinds = await BE.kinds();
  const ak = $('addKind');
  for (const k of S.kinds.point) { const op = document.createElement('option'); op.value = k.kind; op.textContent = k.label; ak.appendChild(op); }
  DEFAULTS = { margin: $('margin').value, minPiece: $('minPiece').value, style: 'glued' };
  const bv = $('buildVer');
  if (bv.dataset.v.startsWith('__')) bv.textContent = 'dev build';
  const saved = load();
  $('restoredNote').classList.toggle('hidden', !saved);
  if (saved) {
    sel.value = saved.printer || 'prusa-core-one';
    for (const k of ['bedX', 'bedY', 'bedZ', 'margin', 'nozzle', 'minPiece']) if (saved[k]) $(k).value = saved[k];
    if (saved.style) $('jointStyle').value = saved.style;
    if (saved.supportWeight != null && Number.isFinite(+saved.supportWeight)) $('supportWeight').value = saved.supportWeight;
    $('upright').checked = !!saved.upright; $('tilted').checked = !!saved.tilted;
    for (const i of document.querySelectorAll('[data-fit]')) if (saved.fits && saved.fits[i.dataset.fit]) i.value = saved.fits[i.dataset.fit];
    if (sel.value !== 'custom') applyPrinter(false);
  } else {
    sel.value = 'prusa-core-one';
    applyPrinter(true);
  }
  updateBed();
  updateSupportPreference();
  bind();
}

function styleLabel(v) { const o = [...$('jointStyle').options].find((x) => x.value === v); return o ? o.textContent : v; }
function resetDefaults() {
  localStorage.removeItem('ps.settings');
  $('printer').value = 'prusa-core-one';
  $('margin').value = DEFAULTS.margin; $('minPiece').value = DEFAULTS.minPiece;
  const changed = $('jointStyle').value !== DEFAULTS.style;
  $('jointStyle').value = DEFAULTS.style;
  $('upright').checked = false; $('tilted').checked = false;
  $('supportWeight').value = '0.5'; updateSupportPreference();
  applyPrinter(true);
  updateBed();
  $('restoredNote').classList.add('hidden');
  toast(`Defaults restored: ${styleLabel(DEFAULTS.style)}, ${$('printer').selectedOptions[0].textContent}`);
  if (S.plan && changed) runPlan('joints');
}
function supportPreference(w) { return w === 0 ? 'Parts first' : w === 1 ? 'Support first' : w === 0.5 ? 'Balanced' : `Support weight ${w.toFixed(2)}`; }
function updateSupportPreference() {
  const w = +$('supportWeight').value;
  $('supportValue').textContent = supportPreference(w);
  $('supportPending').classList.toggle('hidden', !S.plan || Math.abs((S.plan.settings.supportWeight ?? 0.5) - w) < 0.001);
}
function onStyleChange() {
  save();
  if (!S.plan) return;
  const n = S.plan.joints.filter((j) => j.locked).length + S.plan.patches.filter((p) => p.seam && p.seam.locked && p.seam.kind !== 'none').length;
  const note = $('styleNote');
  note.textContent = `Joints re-placed as ${styleLabel($('jointStyle').value)} on the current cuts${n ? `; ${n} manual joint${n > 1 ? 's' : ''} kept` : ''}.`;
  note.classList.remove('hidden');
  runPlan('joints');
}

function applyPrinter(resetFits) {
  const p = S.printers.find((x) => x.id === $('printer').value);
  if (!p) return;
  $('bedX').value = p.x; $('bedY').value = p.y; $('bedZ').value = p.z;
  $('nozzle').value = String(p.nozzle);
  $('printerSource').innerHTML = `Volume per <a href="${esc(p.source)}" target="_blank" rel="noopener">manufacturer spec</a>${p.note ? ' · ' + esc(p.note) : ''}`;
  if (resetFits) setFits();
}
function setFits() {
  const f = S.fitsDefault[+$('nozzle').value >= 0.55 ? 0.6 : 0.4];
  for (const i of document.querySelectorAll('[data-fit]')) i.value = f[i.dataset.fit].toFixed(2);
}
function settings() {
  const fits = Object.fromEntries([...document.querySelectorAll('[data-fit]')].map((i) => [i.dataset.fit, +i.value]));
  return {
    bed: { X: +$('bedX').value, Y: +$('bedY').value, Z: +$('bedZ').value }, margin: +$('margin').value,
    minPiece: +$('minPiece').value, nozzle: +$('nozzle').value, jointStyle: $('jointStyle').value, fits,
    autoSplit: true, autoJoints: true, maxParts: 64, upright: $('upright').checked, tilted: $('tilted').checked, supportWeight: +$('supportWeight').value,
  };
}
function usable() { const s = settings(); return { x: s.bed.X - 2 * s.margin, y: s.bed.Y - 2 * s.margin, z: s.bed.Z - s.margin }; }
function updateBed() {
  const u = usable();
  viewer.setBed(u.x, u.y, u.z);
  hud();
}

function bind() {
  const drop = $('drop');
  $('fileInput').addEventListener('change', (e) => { if (e.target.files[0]) upload(e.target.files[0]); e.target.value = ''; });
  for (const ev of ['dragover', 'dragenter']) document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); });
  document.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) upload(f); });
  for (const b of document.querySelectorAll('[data-sample]')) b.addEventListener('click', () => loadSample(b.dataset.sample));
  $('printer').addEventListener('change', () => { if ($('printer').value !== 'custom') applyPrinter(true); updateBed(); save(); });
  for (const id of ['bedX', 'bedY', 'bedZ', 'margin']) $(id).addEventListener('input', () => { if (id.startsWith('bed')) $('printer').value = 'custom'; updateBed(); save(); });
  $('nozzle').addEventListener('change', () => { setFits(); save(); });
  for (const id of ['minPiece', 'upright', 'tilted']) $(id).addEventListener('change', save);
  $('jointStyle').addEventListener('change', onStyleChange);
  $('supportWeight').addEventListener('input', () => { updateSupportPreference(); save(); });
  $('resetDefaults').addEventListener('click', resetDefaults);
  for (const i of document.querySelectorAll('[data-fit]')) i.addEventListener('change', save);
  $('autoSplit').addEventListener('click', () => runPlan('auto'));
  $('buildBtn').addEventListener('click', build);
  $('exportBtn').addEventListener('click', exportPkg);
  $('couponBtn').addEventListener('click', coupon);
  $('explode').addEventListener('input', (e) => { viewer.setExplode(+e.target.value); viewer.applyView(); });
  $('explode').addEventListener('change', () => { if (viewer.view === 'parts') viewer.frame(viewer.explodedBox()); });
  $('applyScale').addEventListener('click', applyScale);
  $('units').addEventListener('change', () => { $('scalePct').value = String(+$('units').value * 100); });
  $('addJointMode').addEventListener('click', () => setAddMode(!S.addMode));
  $('showField').addEventListener('change', (e) => { jmap.showField = e.target.checked; jmap.draw(); });
  $('addKind').addEventListener('change', () => renderJointPanel());
  for (const b of document.querySelectorAll('#views button')) b.addEventListener('click', () => setView(b.dataset.view));
  $('helpBtn').addEventListener('click', () => $('helpDlg').showModal());
  $('licLink').addEventListener('click', (e) => { e.preventDefault(); $('licDlg').showModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (['1', '2', '3', '4'].includes(e.key)) setView(['model', 'cuts', 'parts', 'plates'][+e.key - 1]);
    if (e.key === 'Escape') { setAddMode(false); select({}); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel.joint != null) deleteJoint(S.sel.joint);
    else if (e.key === 'Delete' && S.sel.cut != null) deleteCut(S.sel.cut);
    if (e.key === 'a' || e.key === 'A') setAddMode(!S.addMode);
  });
}

function setView(v) {
  for (const b of document.querySelectorAll('#views button')) b.classList.toggle('on', b.dataset.view === v);
  viewer.setView(v);
  if (v === 'cuts') viewer.highlight();
  hud();
}

// ---------------- model ----------------
async function upload(file) {
  if (file.size > 300 * 1024 * 1024) { toast('File is larger than the 300 MB limit', true); return; }
  busy(`Loading ${file.name}`, 0.02);
  try {
    const info = await BE.load(file, (m, f) => busy(m, f));
    await onModel(info);
  } catch (err) { busy(false); toast(err.message, true, 8000); }
}
async function loadSample(name) {
  busy(`Fetching sample ${name}`);
  try {
    const r = await fetch(api(`samples/${name}`));
    const b = await r.blob();
    upload(new File([b], name));
  } catch (err) { busy(false); toast(err.message, true); }
}

async function onModel(info) {
  S.model = info;
  S.plan = null; S.built = null; S.export = null; S.sel = {}; S.comparison = null; S.planWasAuto = false;
  busy('Loading repaired mesh', null);
  const buf = await BE.mesh(info);
  const dv = new DataView(buf);
  const nv = dv.getUint32(4, true), nt = dv.getUint32(8, true);
  const positions = new Float32Array(buf, 12, nv * 3);
  const indices = new Uint32Array(buf, 12 + nv * 12, nt * 3);
  S.mesh = { positions, indices };
  $('empty').classList.add('hidden');
  viewer.setModel(positions, indices);
  setView('model');
  busy('Loading model into the geometry kernel', null);
  try {
    await work('mesh', { mesh: { positions: positions.slice(), indices: indices.slice() } }, 'meshok');
    S.workerReady = true;
  } catch (err) { toast('Geometry kernel rejected the mesh: ' + err.message, true, 10000); S.workerReady = false; }
  busy(false);
  renderModelInfo();
  $('autoSplit').disabled = false;
  $('buildBtn').disabled = true; $('exportBtn').disabled = true;
  $('planSummary').classList.add('hidden'); $('cutEditor').classList.add('hidden'); $('partEditor').classList.add('hidden');
  $('faceList').innerHTML = ''; $('mapWrap').classList.add('hidden');
  $('buildInfo').classList.add('hidden'); $('exportInfo').classList.add('hidden');
  hud();
}

function renderModelInfo() {
  const m = S.model;
  $('modelTitle').textContent = `${m.name} · ${fmt(m.size[0])} × ${fmt(m.size[1])} × ${fmt(m.size[2])} mm`;
  const r = m.repair;
  const badges = [];
  badges.push(r.closed ? '<span class="badge ok">watertight</span>' : '<span class="badge bad">not closed</span>');
  if (r.weldedVertices) badges.push(`<span class="badge">${r.weldedVertices.toLocaleString()} vertices welded</span>`);
  if (r.holesFilled) badges.push(`<span class="badge warn">${r.holesFilled} hole(s) capped</span>`);
  if (r.flippedFaces) badges.push(`<span class="badge warn">${r.flippedFaces.toLocaleString()} faces re-oriented</span>`);
  if (r.invertedShells) badges.push(`<span class="badge warn">${r.invertedShells} inside-out shell(s) fixed</span>`);
  if (r.duplicateRemoved) badges.push(`<span class="badge warn">${r.duplicateRemoved} duplicate faces removed</span>`);
  if (r.degenerateRemoved) badges.push(`<span class="badge warn">${r.degenerateRemoved} degenerate faces removed</span>`);
  if (r.debrisRemoved) badges.push(`<span class="badge warn">${r.debrisRemoved} debris shell(s) dropped</span>`);
  if (r.nonManifoldResolved) badges.push(`<span class="badge warn">${r.nonManifoldResolved} non-manifold edges split</span>`);
  if (r.shells > 1) badges.push(`<span class="badge">${r.shells} shells</span>`);
  $('modelInfo').innerHTML = `<div class="kv"><b>Size</b><span>${fmt(m.size[0])} × ${fmt(m.size[1])} × ${fmt(m.size[2])} mm</span>
    <b>Volume</b><span>${fmt(m.volume / 1000)} cm³ (≈ ${fmt(m.volume / 1000 * 1.24, 0)} g PLA solid)</span>
    <b>Mesh</b><span>${m.tris.toLocaleString()} triangles · ${m.format}</span></div>
    <div class="badges">${badges.join('')}</div>
    ${(r.notes || []).map((n) => `<div class="small warnc">${esc(n)}</div>`).join('')}
    ${m.unitHint ? `<div class="small warnc">⚠ ${esc(m.unitHint)}</div>` : ''}`;
  $('modelInfo').classList.remove('hidden');
  $('unitRow').classList.remove('hidden');
  $('scalePct').value = String(Math.round(m.scale * 100 * 1000) / 1000);
}

async function applyScale() {
  if (!S.model) return;
  const f = +$('scalePct').value / 100;
  if (!(f > 0)) return;
  try {
    busy('Rescaling', null);
    const info = await BE.scale(S.model, f);
    await onModel(info);
    toast(`Scaled to ${fmt(f * 100)} %`);
  } catch (err) { busy(false); toast(err.message, true); }
}

function hud() {
  const h = $('hud');
  const u = usable();
  if (!S.model) { h.innerHTML = ''; return; }
  const s = S.model.size;
  const fitsAsIs = s[0] <= u.x && s[1] <= u.y && s[2] <= u.z;
  let html = `<div class="fit ${fitsAsIs ? 'yes' : 'no'}">Whole model ${fmt(s[0])} × ${fmt(s[1])} × ${fmt(s[2])} mm ${fitsAsIs ? 'fits as placed' : 'does not fit as placed'} · usable ${fmt(u.x)} × ${fmt(u.y)} × ${fmt(u.z)}</div>`;
  if (S.plan) {
    const n = S.plan.leaves.filter((l) => !l.empty).length;
    const bad = S.plan.leaves.filter((l) => !l.empty && !l.fits).length;
    html += `<br><div class="fit ${bad ? 'no' : 'yes'}">Split: ${n} part${n > 1 ? 's' : ''} · ${bad ? bad + ' do not fit' : 'every part fits in its print orientation'} · ${S.plan.joints.length} point joints · ${S.plan.patches.filter((p) => p.seam && p.seam.kind !== 'none').length} seams</div>`;
  }
  h.innerHTML = html;
}

// ---------------- planning ----------------
function lockedJoints() { return S.plan ? S.plan.joints.filter((j) => j.locked) : []; }
function seamOverrides() {
  if (!S.plan) return [];
  const faceBy = Object.fromEntries(S.plan.faces.map((f) => [f.node, f]));
  // anchor = deepest point of the patch; the centroid of a ring-shaped
  // section lies in the hole and would not find the patch again
  return S.plan.patches.filter((p) => p.seam && p.seam.locked).map((p) => ({ at: p.anchor, seam: p.seam }));
}
// per-contact joint style choices ("use seam here", "use dowels anyway")
function styleOverrides() {
  if (!S.plan) return [];
  return S.plan.patches.filter((p) => p.style || p.force).map((p) => ({ at: p.anchor, style: p.style || '', force: !!p.force }));
}
function setPatchStyle(p, style, force) {
  // an explicit per-contact choice replaces that contact's joints
  S.plan.joints = S.plan.joints.filter((j) => j.patch !== p.id);
  p.seam = null;
  p.style = style; p.force = force;
  S.sel = { cut: p.node, patch: p.id };
  runPlan('joints');
}

async function runPlan(mode, opts = {}) {
  if (!S.model) return;
  S.selJointAt = null;
  if (S.sel.joint != null && S.plan) { const j = S.plan.joints.find((x) => x.id === S.sel.joint); if (j) S.selJointAt = j.origin; }
  const seq = ++S.planSeq;
  const st = settings();
  if (mode !== 'auto') st.autoSplit = !!opts.autoSplit;
  const body = { settings: st, mode };
  if (mode !== 'auto') {
    body.tree = opts.tree || S.plan.tree;
    body.joints = opts.joints || lockedJoints();
    body.seams = opts.seams || seamOverrides();
    body.styles = styleOverrides();
  }
  busy(mode === 'auto' ? 'Planning cuts' : 'Updating plan', null);
  try {
    const plan = await BE.plan(S.model, body, (m) => busy(m[0].toUpperCase() + m.slice(1), null));
    if (seq !== S.planSeq) return;
    busy(false);
    onPlan(plan, mode === 'auto');
  } catch (err) { busy(false); toast(err.message, true, 8000); }
}

function onPlan(plan, fresh) {
  const signature = (s) => JSON.stringify({ ...s, supportWeight: null });
  S.comparison = fresh && S.planWasAuto && S.plan && signature(S.plan.settings) === signature(plan.settings)
    ? { parts: S.plan.leaves.filter((l) => !l.empty).length, volume: S.plan.leaves.reduce((s, l) => s + (l.supportVolume || 0), 0), weight: S.plan.settings.supportWeight ?? 0.5 } : null;
  S.planWasAuto = fresh;
  S.plan = plan;
  updateSupportPreference();
  S.built = null; S.export = null;
  if (fresh) { S.sel = {}; $('styleNote').classList.add('hidden'); }
  viewer.setPlan(plan);
  viewer.clear('parts'); viewer.clear('plates');
  setView('cuts');
  renderPlan();
  renderFaces();
  if (S.sel.cut != null && plan.tree.nodes[S.sel.cut] && plan.tree.nodes[S.sel.cut].cut) {
    // re-find an edited joint by position (server renumbers joints)
    let jid = null;
    if (S.sel.joint != null && S.selJointAt) {
      let bd = 0.5;
      for (const j of plan.joints) { const d = Math.hypot(j.origin[0] - S.selJointAt[0], j.origin[1] - S.selJointAt[1], j.origin[2] - S.selJointAt[2]); if (d < bd) { bd = d; jid = j.id; } }
    }
    select(jid != null ? { cut: S.sel.cut, joint: jid, patch: plan.joints.find((j) => j.id === jid).patch } : { cut: S.sel.cut });
  } else select({});
  $('buildBtn').disabled = !S.workerReady;
  $('exportBtn').disabled = true;
  $('buildInfo').classList.add('hidden'); $('exportInfo').classList.add('hidden');
  hud();
  const w = plan.warnings || [];
  if (w.length) toast(w[0], true, 7000);
}

function renderPlan() {
  const p = S.plan;
  const leaves = p.leaves.filter((l) => !l.empty);
  const bad = leaves.filter((l) => !l.fits);
  const cuts = p.tree.nodes.filter((n) => n.cut);
  const previous = S.comparison ? `<div class="small mute" style="margin-top:6px">Previous auto plan (${esc(supportPreference(S.comparison.weight))}): ${S.comparison.parts} part${S.comparison.parts === 1 ? '' : 's'} · proxy ≈ ${fmt(S.comparison.volume / 1000, 0)} cm³</div>` : '';
  const chips = leaves.map((l) => {
    const i = p.leaves.indexOf(l);
    return `<div class="chip ${l.fits ? 'ok' : 'bad'} ${S.sel.leaf === l.id ? 'sel' : ''}" data-leaf="${l.id}" title="${esc(l.printFace)} down · support proxy ≈ ${fmt((l.supportVolume || 0) / 1000)} cm³ · ${fmt(l.extent[0])}×${fmt(l.extent[1])}×${fmt(l.extent[2])} mm${l.warnings ? ' · ' + esc(l.warnings.join('; ')) : ''}"><span class="sw" style="background:${partColor(i)}"></span>${l.label}<span class="x">${l.fits ? '✓' : '✗'} ↕${fmt(l.extent[2], 0)}</span></div>`;
  }).join('');
  const cutChips = cuts.map((n) => `<div class="chip ${S.sel.cut === n.id ? 'sel' : ''}" data-cut="${n.id}" title="${esc(n.reason || 'manual cut')}"><span class="sw" style="background:#e07a3f"></span>${cutName(n.id)}<span class="x">${axisName(n.cut.n)} ${fmt(n.cut.d, 0)}</span></div>`).join('');
  const fbs = p.patches.filter((x) => x.fallback || x.single);
  const fallbackNote = fbs.length ? `<div class="fblist">${fbs.map((x) => `<button class="fbitem ${x.fallback ? '' : 'single'}" data-fbpatch="${x.id}" title="${esc(x.fallback ? x.fallback.why : (x.notes || []).join('; '))}">⚠ ${cutName(x.node)} ${contactName(x)}: ${x.fallback ? `${esc(fbText(x.fallback))}` : esc(singleNote(x))}</button>`).join('')}</div>` : '';
  $('planSummary').innerHTML = `${fallbackNote}<div><span class="big">${leaves.length}</span> part${leaves.length === 1 ? '' : 's'} · ${bad.length ? `<span class="badc">${bad.length} do not fit</span> <button class="small" id="autoComplete">Auto-complete</button>` : '<span class="okc">all fit</span>'} · calculated in ${fmt(p.timing.total, 1)} s</div>
    <div class="support-estimate"><b>Support proxy ≈ ${fmt(leaves.reduce((a, l) => a + (l.supportVolume || 0), 0) / 1000, 0)} cm³</b><br><span class="small mute">Downward faces steeper than 45° × height to bed. Before joints; excludes bridges and support density.<br>${esc(supportPreference(p.settings.supportWeight ?? 0.5))} · verify in your slicer.</span>${previous}</div>
    <div class="small mute" style="margin-top:6px">Parts (click to select, then add a cut through it)</div><div class="partlist">${chips}</div>
    <div class="small mute" style="margin-top:6px">Cuts (click, then drag the arrow in the 3D view or edit below)</div><div class="partlist">${cutChips || '<span class="mute small">none — the model fits as one part</span>'}</div>`;
  $('planSummary').classList.remove('hidden');
  for (const c of $('planSummary').querySelectorAll('[data-leaf]')) c.addEventListener('click', () => select({ leaf: +c.dataset.leaf }));
  for (const c of $('planSummary').querySelectorAll('[data-cut]')) c.addEventListener('click', () => select({ cut: +c.dataset.cut }));
  for (const c of $('planSummary').querySelectorAll('[data-fbpatch]')) c.addEventListener('click', () => { const x = S.plan.patches[+c.dataset.fbpatch]; select({ cut: x.node, patch: x.id }); });
  const ac = $('autoComplete');
  if (ac) ac.addEventListener('click', () => runPlan('tree', { autoSplit: true }));
}

function leafName(id) { const l = S.plan.leaves.find((x) => x.id === id); return l ? l.label : '?'; }
function contactName(p) { return `${leafName(p.negLeaf)}↔${leafName(p.posLeaf)}`; }
function fbText(fb) { return `${fb.want} → ${fb.got}: ${fb.reason}`; }
function singleNote(p) { return ((p.notes || []).find((n) => n.startsWith('only one')) || 'only one joint fits').split(':')[0]; }
function cutName(id) { const n = S.plan && S.plan.tree.nodes[id]; return (n && n.label) || `Cut ${id}`; }

function axisName(n) {
  const a = n.map(Math.abs);
  if (a[0] > 0.9999) return 'X'; if (a[1] > 0.9999) return 'Y'; if (a[2] > 0.9999) return 'Z';
  return `(${n.map((x) => fmt(x, 2)).join(',')})`;
}

function select(sel) {
  S.sel = sel;
  viewer.select(sel);
  if (S.plan) renderPlan();
  renderCutEditor();
  renderPartEditor();
  if (sel.joint != null || sel.cut != null) {
    const j = sel.joint != null && S.plan ? S.plan.joints.find((x) => x.id === sel.joint) : null;
    const node = j ? S.plan.patches[j.patch].node : sel.cut;
    if (node != null) selectFace(node, false);
  }
  renderJointPanel();
}

function onPick(h) {
  if (!h) { select({}); return; }
  if (h.pick === 'cut') {
    if (S.addMode) {
      const f = S.plan.faces.find((x) => x.node === h.node);
      const fr = f.frame;
      const d = [0, 1, 2].map((k) => h.point[k] - fr.o[k]);
      const q = [d[0] * fr.u[0] + d[1] * fr.u[1] + d[2] * fr.u[2], d[0] * fr.v[0] + d[1] * fr.v[1] + d[2] * fr.v[2]];
      selectFace(h.node, false);
      const pid = jmap.patchAt(q);
      if (pid != null) addJoint(pid, q); else toast('That point is not on the cut face', true);
      return;
    }
    select({ cut: h.node });
  } else if (h.pick === 'joint') { const pj = S.plan.joints.find((x) => x.id === h.joint); select({ joint: h.joint, patch: pj.patch, cut: S.plan.patches[pj.patch].node }); }
  else if (h.pick === 'patch') { const p = S.plan.patches[h.patch]; select({ cut: p.node }); S.sel.patch = h.patch; renderJointPanel(); }
  else if (h.pick === 'part') select({ leaf: h.leaf });
}

// ---------------- cut editing ----------------
function renderCutEditor() {
  const el = $('cutEditor');
  if (S.sel.cut == null || !S.plan) { el.classList.add('hidden'); return; }
  const n = S.plan.tree.nodes[S.sel.cut];
  if (!n || !n.cut) { el.classList.add('hidden'); return; }
  const f = S.plan.faces.find((x) => x.node === n.id);
  // offset range: the parent cell's extent along n (approximate with model box)
  const b = S.model.bounds;
  const cs = [];
  for (const x of [b[0][0], b[1][0]]) for (const y of [b[0][1], b[1][1]]) for (const z of [b[0][2], b[1][2]]) cs.push(n.cut.n[0] * x + n.cut.n[1] * y + n.cut.n[2] * z);
  const lo = Math.min(...cs), hi = Math.max(...cs);
  const patches = S.plan.patches.filter((p) => p.node === n.id);
  el.innerHTML = `<h3>${cutName(n.id)} ${n.locked ? '<span class="badge">manual</span>' : '<span class="badge">auto</span>'}</h3>
    <div class="reason">${esc(n.reason || 'placed by you')}</div>
    <div class="small">Normal ${axisName(n.cut.n)} · section ${fmt(f ? f.area : 0, 0)} mm² · ${patches.length} contact patch(es)</div>
    <label>Offset along normal (mm)<input type="range" id="cutOffset" min="${lo}" max="${hi}" step="0.1" value="${n.cut.d}"></label>
    <div class="row three"><label>Offset<input id="cutOffsetNum" type="number" step="0.1" value="${fmt(n.cut.d, 2)}"></label>
      <label>Tilt A (°)<input id="tiltA" type="number" step="1" value="0"></label><label>Tilt B (°)<input id="tiltB" type="number" step="1" value="0"></label></div>
    <div class="btns"><button class="small" data-ax="x">⟂ X</button><button class="small" data-ax="y">⟂ Y</button><button class="small" data-ax="z">⟂ Z</button>
      <button class="small primary" id="cutApply">Apply</button><button class="small danger" id="cutDelete">Delete cut</button></div>
    <div class="small mute">Drag the arrow in the 3D view to slide the cut. Tilt rotates the plane about its in-plane axes. Deleting merges everything below this cut back into one part.</div>`;
  el.classList.remove('hidden');
  $('cutOffset').addEventListener('input', (e) => { $('cutOffsetNum').value = fmt(+e.target.value, 2); previewCut(n.id, +e.target.value); });
  $('cutOffset').addEventListener('change', (e) => setCut(n.id, null, +e.target.value));
  $('cutApply').addEventListener('click', () => {
    const a = (+$('tiltA').value * Math.PI) / 180, bb = (+$('tiltB').value * Math.PI) / 180;
    let nn = n.cut.n;
    if (a || bb) {
      const fr = f.frame;
      // rotate the normal about U by a and about V by b
      const rot = (v, k, t) => { const c = Math.cos(t), s = Math.sin(t); const kv = k[0] * v[0] + k[1] * v[1] + k[2] * v[2]; const cr = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]]; return [0, 1, 2].map((i) => v[i] * c + cr[i] * s + k[i] * kv * (1 - c)); };
      nn = rot(rot(nn, fr.u, a), fr.v, bb);
    }
    // keep the plane through the face centre when tilting
    const fr = f.frame;
    const pc = patches[0] ? patches[0].centroid : [0, 0];
    const c3 = [0, 1, 2].map((k) => fr.o[k] + fr.u[k] * pc[0] + fr.v[k] * pc[1]);
    const dOff = +$('cutOffsetNum').value - n.cut.d;
    const d = nn[0] * c3[0] + nn[1] * c3[1] + nn[2] * c3[2] + dOff;
    setCut(n.id, nn, d);
  });
  for (const bt of el.querySelectorAll('[data-ax]')) bt.addEventListener('click', () => {
    const nn = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[bt.dataset.ax];
    const fr = f.frame; const pc = patches[0] ? patches[0].centroid : [0, 0];
    const c3 = [0, 1, 2].map((k) => fr.o[k] + fr.u[k] * pc[0] + fr.v[k] * pc[1]);
    setCut(n.id, nn, nn[0] * c3[0] + nn[1] * c3[1] + nn[2] * c3[2]);
  });
  $('cutDelete').addEventListener('click', () => deleteCut(n.id));
}

function previewCut(node, d) {
  const g = viewer.cutMeshes && viewer.cutMeshes[node];
  if (!g) return;
  const n = g.userData.n;
  const base = S.plan.tree.nodes[node].cut.d;
  const o = S.plan.faces.find((f) => f.node === node).frame.o;
  g.position.set(o[0], o[1], o[2]).addScaledVector(n, d - base);
  viewer.dirty();
}

function cloneTree() { return JSON.parse(JSON.stringify(S.plan.tree)); }

function setCut(node, n, d) {
  const t = cloneTree();
  const nd = t.nodes[node];
  if (n) nd.cut.n = n;
  nd.cut.d = d;
  nd.locked = true;
  nd.reason = 'moved by you';
  runPlan('tree', { tree: t, autoSplit: false });
}

function deleteCut(node) {
  const t = cloneTree();
  const nd = t.nodes[node];
  nd.cut = null; nd.neg = -1; nd.pos = -1; nd.reason = '';
  S.sel = {};
  runPlan('tree', { tree: t, autoSplit: false });
}

function renderPartEditor() {
  const el = $('partEditor');
  if (S.sel.leaf == null || !S.plan) { el.classList.add('hidden'); return; }
  const l = S.plan.leaves.find((x) => x.id === S.sel.leaf);
  if (!l) { el.classList.add('hidden'); return; }
  const bm = l.bounds;
  el.innerHTML = `<h3>Part ${l.label}</h3>
    <div class="kv small"><b>Print size</b><span>${fmt(l.extent[0])} × ${fmt(l.extent[1])} × ${fmt(l.extent[2])} mm ${l.fits ? '<span class="okc">fits</span>' : '<span class="badc">does not fit</span>'}</span>
    <b>Bed face</b><span>${esc(l.printFace)}</span><b>Overhang</b><span>${fmt(l.overhang * 100, 0)} % of surface</span></div>
    ${(l.warnings || []).map((w) => `<div class="small warnc">${esc(w)}</div>`).join('')}
    <div class="btns"><span class="small mute">Add a cut through its centre:</span><button class="small" data-add="x">X</button><button class="small" data-add="y">Y</button><button class="small" data-add="z">Z</button>
      ${l.fits ? '' : '<button class="small primary" id="autoThis">Auto-split this part</button>'}</div>`;
  el.classList.remove('hidden');
  const c = [(bm.Min[0] + bm.Max[0]) / 2, (bm.Min[1] + bm.Max[1]) / 2, (bm.Min[2] + bm.Max[2]) / 2];
  for (const b of el.querySelectorAll('[data-add]')) b.addEventListener('click', () => {
    const n = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[b.dataset.add];
    const t = cloneTree();
    const id = l.id;
    const neg = t.nodes.length, pos = neg + 1;
    t.nodes.push({ id: neg, parent: id, neg: -1, pos: -1 }, { id: pos, parent: id, neg: -1, pos: -1 });
    Object.assign(t.nodes[id], { cut: { n, d: n[0] * c[0] + n[1] * c[1] + n[2] * c[2] }, neg, pos, locked: true, reason: 'added by you', label: '' });
    S.sel = { cut: id };
    runPlan('tree', { tree: t, autoSplit: false });
  });
  const at = $('autoThis');
  if (at) at.addEventListener('click', () => runPlan('tree', { autoSplit: true }));
}

// ---------------- joints ----------------
function renderFaces() {
  const fl = $('faceList');
  const faces = S.plan.faces.filter((f) => f.loops && f.loops.length);
  if (!faces.length) { fl.innerHTML = '<span class="small mute">No cuts — nothing to join.</span>'; $('mapWrap').classList.add('hidden'); return; }
  fl.innerHTML = faces.map((f) => {
    const js = S.plan.joints.filter((j) => f.patches.includes(j.patch)).length;
    const sm = S.plan.patches.filter((p) => p.node === f.node && p.seam && p.seam.kind !== 'none').length;
    const warn = S.plan.patches.some((p) => p.node === f.node && (p.fallback || p.single));
    return `<button data-face="${f.node}" class="${S.face === f.node ? 'sel' : ''} ${warn ? 'warn' : ''}">${warn ? '⚠ ' : ''}${cutName(f.node)} · ${js ? js + ' joints' : ''}${js && sm ? ' + ' : ''}${sm ? sm + ' seam' : ''}${!js && !sm ? 'butt' : ''}</button>`;
  }).join('');
  for (const b of fl.querySelectorAll('[data-face]')) b.addEventListener('click', () => { selectFace(+b.dataset.face, true); });
  if (S.face == null || !faces.find((f) => f.node === S.face)) selectFace(faces[0].node, false);
  else selectFace(S.face, false);
}

function selectFace(node, alsoCut) {
  S.face = node;
  for (const b of $('faceList').querySelectorAll('[data-face]')) b.classList.toggle('sel', +b.dataset.face === node);
  const f = S.plan.faces.find((x) => x.node === node);
  $('mapWrap').classList.remove('hidden');
  if (S.sel.patch == null || !f.patches.includes(S.sel.patch)) S.sel.patch = f.patches[0];
  jmap.set(S.plan, f, mapOpts());
  if (alsoCut) select({ cut: node });
  else renderJointPanel();
}

function mapOpts() {
  const kind = $('addKind').value;
  const proto = protoJoint(kind);
  return { patch: S.sel.patch, joint: S.sel.joint, threshold: S.addMode ? proto.rreq : 0 };
}

function setAddMode(on) {
  S.addMode = on;
  $('addJointMode').classList.toggle('on', on);
  jmap.addMode = on;
  if (S.plan && S.face != null) jmap.set(S.plan, S.plan.faces.find((x) => x.node === S.face), mapOpts());
}

// client-side estimate of the footprint radius (server recomputes exactly)
function protoJoint(kind) {
  const st = settings();
  const fit = { press: 'press', snap: 'snap', peg: 'slip', magnet: 'glue', insert: 'glue', bolt: 'glue' }[kind] || 'glue';
  const c = st.fits[fit] || 0.15;
  const wall = Math.max(1.2, 2 * st.nozzle * 1.05);
  const d = { dowel: 5, press: 5, filament: 1.75, peg: 5, keyed: 5, magnet: 6, snap: 6 }[kind] || 0;
  let rreq = d / 2 + c + wall;
  if (kind === 'insert') rreq = 3 + c + wall;
  if (kind === 'bolt') rreq = 3.3 + wall;
  if (kind === 'snap') rreq = Math.hypot(d / 2 + c, 2.3) + wall;
  return { kind, fit, d, rreq };
}

function selectJoint(id) {
  // keep the cut selected too: hiding the cut editor would shift the joint
  // map under the pointer in the middle of a drag
  const pj = S.plan.joints.find((j) => j.id === id);
  S.sel = { joint: id, patch: pj.patch, cut: S.plan.patches[pj.patch].node };
  viewer.select(S.sel);
  renderCutEditor(); renderPartEditor();
  renderJointPanel();
}

function renderJointPanel() {
  if (!S.plan || S.face == null) return;
  const f = S.plan.faces.find((x) => x.node === S.face);
  if (!f) return;
  jmap.set(S.plan, f, mapOpts());
  // seam editor for the selected patch
  const pid = S.sel.patch != null ? S.sel.patch : f.patches[0];
  const p = S.plan.patches[pid];
  const se = $('seamEditor');
  if (p) {
    const ln = (id) => S.plan.leaves.find((l) => l.id === id).label;
    const sm = p.seam || { kind: 'none' };
    const opts = ['none', ...S.kinds.seam.map((k) => k.kind)].map((k) => `<option value="${k}" ${sm.kind === k ? 'selected' : ''}>${k === 'none' ? 'No seam joint' : S.kinds.seam.find((x) => x.kind === k).label}</option>`).join('');
    se.innerHTML = `<h3>Contact C${pid} · ${ln(p.negLeaf)} ↔ ${ln(p.posLeaf)}</h3>
      <div class="small mute">${fmt(p.area, 0)} mm² · wall ≈ ${fmt(p.thickness)} mm · largest inscribed Ø${fmt(2 * p.rmax)} mm${p.ring ? ' · shell section' : ''}</div>
      ${fallbackBlock(p)}
      ${(p.notes || []).filter((n) => !(p.single && n.startsWith('only one'))).map((n) => `<div class="small warnc">${esc(n)}</div>`).join('')}
      ${seamWallWarn(p, sm)}
      <div class="row two"><label>Seam joint<select id="seamKind">${opts}</select></label><label>Depth (mm)<input id="seamDepth" type="number" step="0.5" min="1" max="40" value="${fmt(sm.depth || 6, 1)}"></label></div>
      <div class="row three"><label>Finger width<input id="seamPitch" type="number" step="0.5" min="2" max="60" value="${fmt(sm.pitch || 8, 1)}"></label>
        <label>Clearance<input id="seamClear" type="number" step="0.01" min="0" max="1" value="${fmt(sm.clear || settings().fits.seam, 2)}"></label>
        <label>Male side<select id="seamMale"><option value="neg" ${sm.male !== 'pos' ? 'selected' : ''}>${ln(p.negLeaf)}</option><option value="pos" ${sm.male === 'pos' ? 'selected' : ''}>${ln(p.posLeaf)}</option></select></label></div>
      <div class="btns"><button class="small primary" id="seamApply">Apply seam</button></div>`;
    $('seamApply').addEventListener('click', () => applySeam(p));
    for (const b of se.querySelectorAll('[data-pstyle]')) b.addEventListener('click', () => setPatchStyle(p, b.dataset.pstyle, b.dataset.force === '1'));
  } else se.innerHTML = '';
  // joint editor
  const je = $('jointEditor');
  const j = S.sel.joint != null ? S.plan.joints.find((x) => x.id === S.sel.joint) : null;
  if (!j) { je.classList.add('hidden'); return; }
  const pp = S.plan.patches[j.patch];
  const ln = (id) => S.plan.leaves.find((l) => l.id === id).label;
  const kindOpts = S.kinds.point.map((k) => `<option value="${k.kind}" ${j.kind === k.kind ? 'selected' : ''}>${k.label}</option>`).join('');
  const desc = (S.kinds.point.find((k) => k.kind === j.kind) || {}).desc || '';
  const sizeField = (j.kind === 'insert' || j.kind === 'bolt')
    ? `<label>Size<select id="jSize">${['M2.5', 'M3', 'M4', 'M5'].map((s) => `<option ${j.size === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label><label>Screw length<input id="jScrew" type="number" step="1" min="4" max="80" value="${j.screwLen}"></label>`
    : `<label>Ø (mm)<input id="jD" type="number" step="0.5" min="1" max="30" value="${fmt(j.d, 2)}"></label><label>${j.kind === 'magnet' ? 'Thickness' : j.kind === 'snap' ? 'Beam length' : 'Depth'}<input id="jDepth" type="number" step="0.5" min="1" max="60" value="${fmt(j.depth, 1)}"></label>`;
  je.innerHTML = `<h3>Joint J${j.id} ${j.locked ? '<span class="badge">manual</span>' : '<span class="badge">auto</span>'}</h3>
    <div class="small mute">${esc(desc)}</div>
    <div class="row two"><label>Type<select id="jKind">${kindOpts}</select></label><label>Fit<select id="jFit">${['glue', 'press', 'slip', 'snap'].map((x) => `<option ${j.fit === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div>
    <div class="row two">${sizeField}</div>
    ${['peg', 'keyed', 'insert', 'bolt', 'snap'].includes(j.kind) ? `<div class="row two"><label>${j.kind === 'insert' ? 'Insert in' : j.kind === 'bolt' ? 'Nut in' : 'Male on'}<select id="jMale"><option value="neg" ${j.male === 'neg' ? 'selected' : ''}>${ln(pp.negLeaf)}</option><option value="pos" ${j.male === 'pos' ? 'selected' : ''}>${ln(pp.posLeaf)}</option></select></label>${j.kind === 'keyed' ? `<label>Shape<select id="jShape"><option value="hex" ${j.shape === 'hex' ? 'selected' : ''}>hex</option><option value="d" ${j.shape === 'd' ? 'selected' : ''}>D</option></select></label>` : '<span></span>'}</div>` : ''}
    <div class="small">Clearance ${fmt(j.clear, 2)} mm · holes ${fmt(j.holeNeg)} / ${fmt(j.holePos)} mm · material behind face ${fmt(j.availNeg)} / ${fmt(j.availPos)} mm</div>
    ${(j.warnings || []).map((w) => `<div class="small badc">⚠ ${esc(w)}</div>`).join('')}
    <div class="btns"><button class="small primary" id="jApply">Apply</button><button class="small danger" id="jDel">Delete joint</button></div>
    <div class="small mute">Drag the joint on the map to move it.</div>`;
  je.classList.remove('hidden');
  $('jKind').addEventListener('change', () => { j.kind = $('jKind').value; j.d = 0; j.depth = 0; j.size = ''; j.screwLen = 0; j.shape = ''; j.fit = protoJoint(j.kind).fit; updateJoint(j); });
  $('jApply').addEventListener('click', () => {
    j.fit = $('jFit').value;
    if ($('jD')) j.d = +$('jD').value;
    if ($('jDepth')) j.depth = +$('jDepth').value;
    if ($('jSize')) j.size = $('jSize').value;
    if ($('jScrew')) j.screwLen = +$('jScrew').value;
    if ($('jMale')) j.male = $('jMale').value;
    if ($('jShape')) j.shape = $('jShape').value;
    updateJoint(j);
  });
  $('jDel').addEventListener('click', () => deleteJoint(j.id));
}

function minWall() { return Math.max(1.2, 2 * +$('nozzle').value * 1.05); }
// badge + actions for a contact that did not get the chosen style
function fallbackBlock(p) {
  const fb = p.fallback;
  const own = p.style || p.force ? `<button class="small" data-pstyle="" data-force="0">Back to automatic (${esc(styleLabel($('jointStyle').value))})</button>` : '';
  if (fb) {
    const btn = fb.forced
      ? `<div class="small why">Forcing ${esc(fb.want.toLowerCase())} does not work here either.</div>`
      : `<button class="small" data-pstyle="${esc(p.style || '')}" data-force="1" title="Try ${esc(fb.want.toLowerCase())} again with relaxed limits (2 mm minimum hole depth, 2-perimeter walls)">Use ${esc(fb.want.toLowerCase())} here anyway</button>`;
    return `<div class="fb small"><div class="head">⚠ ${esc(fbText(fb))}</div><div class="why">${esc(fb.why)}</div><div class="btns">${btn}${own}</div></div>`;
  }
  if (p.single) {
    return `<div class="fb small"><div class="head">⚠ ${esc(singleNote(p))}</div><div class="why">One pin is a pivot: the parts can rotate about it. Keyed pegs or a seam stop that.</div>
      <div class="btns"><button class="small" data-pstyle="seam" data-force="0">Use seam here</button><button class="small" data-pstyle="keyed" data-force="0">Use keyed peg here</button>${own}</div></div>`;
  }
  return own ? `<div class="btns">${own}</div>` : '';
}
function seamWallWarn(p, sm) {
  const need = { tongue: 3, lap: 2 }[sm.kind];
  if (!need || !sm.locked || p.thickness >= need * minWall()) return '';
  return `<div class="small warnc">⚠ ${sm.kind === 'tongue' ? 'Tongue and groove' : 'Half lap'} wants a wall ≥ ${fmt(need * minWall())} mm; this one is ${fmt(p.thickness)} mm.</div>`;
}

// any edit makes the whole patch manual so its other joints stay put
function lockPatch(pid) {
  for (const x of S.plan.joints) if (x.patch === pid) x.locked = true;
  // keep the patch's seam too: a locked patch gets no automatic joints
  const p = S.plan.patches[pid];
  if (p && p.seam && p.seam.kind !== 'none') p.seam.locked = true;
}
function jointOrigin(j, q) {
  const p = S.plan.patches[j.patch];
  const fr = S.plan.faces.find((f) => f.node === p.node).frame;
  return [0, 1, 2].map((k) => fr.o[k] + fr.u[k] * q[0] + fr.v[k] * q[1]);
}
function updateJoint(j) {
  lockPatch(j.patch);
  j.locked = true; j.auto = false;
  j.origin = jointOrigin(j, j.p);
  S.sel = { joint: j.id, patch: j.patch, cut: S.plan.patches[j.patch].node };
  runPlan('joints');
}
function moveJoint(j, q, pid) {
  if (pid == null) { toast('Joint must stay on the cut face', true); renderJointPanel(); return; }
  if (pid !== j.patch) { lockPatch(pid); j.patch = pid; }
  j.p = q;
  updateJoint(j);
}
function addJoint(pid, q) {
  const kind = $('addKind').value;
  const pr = protoJoint(kind);
  lockPatch(pid);
  const j = { id: 100000 + Math.floor(Math.random() * 1e6), patch: pid, kind, p: q, angle: S.plan.patches[pid].axis, male: 'neg', fit: pr.fit, d: 0, depth: 0, auto: false, locked: true };
  j.origin = jointOrigin(j, q);
  S.plan.joints.push(j);
  S.sel = { patch: pid, cut: S.plan.patches[pid].node };
  runPlan('joints');
}
function deleteJoint(id) {
  const j = S.plan.joints.find((x) => x.id === id);
  if (!j) return;
  lockPatch(j.patch);
  S.plan.joints = S.plan.joints.filter((x) => x.id !== id);
  // keep the patch manual even if it is now empty: mark with a 'none' seam lock
  const p = S.plan.patches[j.patch];
  if (!S.plan.joints.some((x) => x.patch === j.patch) && !(p.seam && p.seam.kind !== 'none')) p.seam = { kind: 'none', locked: true, depth: 0, clear: 0 };
  S.sel = { patch: j.patch, cut: S.plan.patches[j.patch].node };
  runPlan('joints');
}
function applySeam(p) {
  const kind = $('seamKind').value;
  const st = settings();
  const old = p.seam || {};
  p.seam = {
    ...old, kind, depth: +$('seamDepth').value, pitch: +$('seamPitch').value, clear: +$('seamClear').value, male: $('seamMale').value,
    fit: kind === 'dovetail' ? 'slip' : 'glue', glue: kind !== 'dovetail', center: p.centroid, axis: p.axis, wall: p.thickness, locked: true, auto: false,
    mode: kind === 'finger' ? (p.ring ? 'polar' : 'linear') : '', angStep: p.ring && p.rmean > 0 ? +$('seamPitch').value / p.rmean : 0,
    inset: kind === 'tongue' ? Math.max(st.nozzle * 2.1, p.thickness / 3) : 0, width: kind === 'dovetail' ? Math.min(14, Math.max(4, p.rmax * 0.8)) : 0, flank: 15, offset: 0,
  };
  // keep its point joints too
  lockPatch(p.id);
  runPlan('joints');
}

// ---------------- build & export ----------------
async function build() {
  if (!S.plan) return;
  $('buildBtn').disabled = true;
  busy('Building parts in your browser (Manifold WASM)', 0.05);
  const t0 = performance.now();
  try {
    const res = await work('build', { plan: S.plan }, 'built');
    S.built = res;
    viewer.pins = res.pins;
    viewer.setParts(res.parts, S.plan);
    setView('parts');
    renderBuild(res, performance.now() - t0);
    $('exportBtn').disabled = false;
  } catch (err) { toast('Build failed: ' + err.message, true, 10000); }
  busy(false);
  $('buildBtn').disabled = false;
}

function renderBuild(res, ms) {
  const leafIdx = Object.fromEntries(S.plan.leaves.map((l, i) => [l.id, i]));
  const ok = res.parts.every((p) => p.status === 'NoError');
  const maxInt = Math.max(0, ...res.checks.map((c) => c.interference));
  const rows = res.parts.map((p) => `<tr><td><span class="sw" style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${partColor(leafIdx[p.leaf])}"></span> ${p.label}</td><td>${fmt(p.volume / 1000)} cm³</td><td>${p.status === 'NoError' ? '<span class="okc">manifold ✓</span>' : '<span class="badc">' + p.status + '</span>'}</td><td>genus ${p.genus}</td></tr>`).join('');
  const pins = res.pins.map((p) => `<tr><td>pin Ø${fmt(p.d, 2)}</td><td>${fmt(p.len)} mm</td><td>× ${p.count}</td><td></td></tr>`).join('');
  $('buildInfo').innerHTML = `<div>${ok ? '<span class="okc">All parts are closed manifolds.</span>' : '<span class="badc">Some parts failed.</span>'} ${fmt(ms / 1000, 1)} s</div>
    <table class="ver">${rows}${pins}</table>
    <div class="small">Mating checks: max interference ${fmt(maxInt, 3)} mm³ ${maxInt < 0.05 ? '<span class="okc">✓</span>' : '<span class="badc">✗</span>'} · material added outside the model ${fmt(res.outside, 2)} mm³ · voids (holes + clearances) ${fmt(100 * res.voids / res.original, 2)} %</div>`;
  $('buildInfo').classList.remove('hidden');
}

function psm(mesh) {
  const nv = mesh.positions.length / 3, nt = mesh.indices.length / 3;
  const buf = new ArrayBuffer(12 + nv * 12 + nt * 12);
  new Uint8Array(buf, 0, 4).set([80, 83, 77, 49]);
  const dv = new DataView(buf);
  dv.setUint32(4, nv, true); dv.setUint32(8, nt, true);
  new Float32Array(buf, 12, nv * 3).set(mesh.positions);
  new Uint32Array(buf, 12 + nv * 12, nt * 3).set(mesh.indices);
  return new Blob([buf]);
}

function linkList(res) {
  const nice = (f) => f.replace(/^parts\//, '').replace(/^plates\//, '');
  const groups = { pkg: [], plates: [], parts: [], other: [] };
  for (const f of res.files) {
    if (f === res.zip) groups.pkg.push(f);
    else if (f.startsWith('plates/')) groups.plates.push(f);
    else if (f.startsWith('parts/')) groups.parts.push(f);
    else groups.other.push(f);
  }
  const li = (f, label) => { const dl = res.download(f); return `<li><a href="${res.href(f)}" ${dl ? `download="${esc(dl)}"` : ''} ${f.endsWith('.html') ? 'target="_blank" rel="noopener"' : ''}>${esc(label || nice(f))}</a></li>`; };
  return `<ul class="filelist">${li(res.zip, '⬇ ' + res.zip + ' (everything)')}${li('assembly.html', '📄 Assembly sheet')}${groups.other.filter((f) => f.endsWith('.3mf')).map((f) => li(f)).join('')}</ul>
    <details><summary class="small">${groups.plates.length} plate 3MF · ${groups.parts.length} STL</summary><ul class="filelist">${groups.plates.map((f) => li(f)).join('')}${groups.parts.map((f) => li(f)).join('')}</ul></details>`;
}

async function exportPkg() {
  if (!S.built) return;
  $('exportBtn').disabled = true;
  busy('Packaging: orienting parts, packing plates, writing 3MF/STL and the assembly sheet', null);
  try {
    // snapshot of the exploded parts for the assembly sheet
    const prevView = viewer.view;
    setView('parts');
    viewer.frame(viewer.explodedBox());
    const png = await (await fetch(viewer.snapshot(1400, 800, true))).blob();
    setView(prevView);
    const parts = [], files = [];
    S.built.parts.forEach((p) => { parts.push({ label: p.label, leaf: p.leaf, kind: 'part', count: 1, file: 'm' + files.length }); files.push(psm(p.mesh)); });
    S.built.pins.forEach((p) => { parts.push({ label: `pin_d${fmt(p.d, 2)}_L${fmt(p.len)}`, leaf: -1, kind: 'pin', count: p.count, file: 'm' + files.length, d: p.d, len: p.len }); files.push(psm(p.mesh)); });
    const res = await BE.export(S.model, parts, files, S.plan, null, png, (m) => busy(m[0].toUpperCase() + m.slice(1), null));
    S.export = res;
    $('exportInfo').innerHTML = `<div><b>${res.parts.length}</b> files on <b>${res.plates}</b> plate(s) ${res.warnings && res.warnings.length ? '<span class="warnc">· ' + esc(res.warnings.join('; ')) + '</span>' : '<span class="okc">· all closed, all fit</span>'}</div>${linkList(res)}`;
    $('exportInfo').classList.remove('hidden');
    toast('Export ready');
  } catch (err) { toast('Export failed: ' + err.message, true, 10000); }
  busy(false);
  $('exportBtn').disabled = false;
}

async function coupon() {
  const d = +$('couponD').value, s0 = +$('couponStart').value, ds = +$('couponStep').value;
  const steps = [0, 1, 2, 3, 4, 5].map((i) => Math.round((s0 + i * ds) * 1000) / 1000);
  busy('Building joint coupon', null);
  try {
    const r = await work('coupon', { opts: { d, steps } }, 'coupon');
    const parts = r.parts.map((p, i) => ({ label: p.label, leaf: -1, kind: 'coupon', count: 1, file: 'm' + i }));
    const u = usable();
    const res = await BE.export(null, parts, r.parts.map((p) => psm(p.mesh)), { settings: { margin: +$('margin').value, fits: settings().fits, nozzle: +$('nozzle').value }, usable: { X: u.x, Y: u.y, Z: u.z }, leaves: [], patches: [], joints: [], faces: [], tree: { nodes: [{ id: 0, parent: -1, neg: -1, pos: -1 }], root: 0 } }, { X: u.x, Y: u.y, Z: u.z });
    $('couponInfo').innerHTML = `<div class="small">Steps (radial clearance, mm): ${steps.map((s, i) => `<b>${i + 1}</b> dot${i ? 's' : ''} = ${s.toFixed(2)}`).join(' · ')}</div>${linkList(res)}`;
    $('couponInfo').classList.remove('hidden');
  } catch (err) { toast('Coupon failed: ' + err.message, true); }
  busy(false);
}

init().catch((err) => toast('Startup failed: ' + err.message, true, 15000));
window.__ps = S; // for debugging and end-to-end tests
window.__jmap = jmap;
window.__viewer = viewer;

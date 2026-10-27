// Merged layer on top of the five-step flow: viewer-first presentation, the
// expert object outliner/inspector/command palette and the single output state.
// It owns no planner state; every action calls the same app functions the
// step panels use, so simple and expert modes always edit one plan.
import * as THREE from 'three';
import {readiness} from './readiness.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = (x, d = 1) => (Math.round(x * 10 ** d) / 10 ** d).toLocaleString('en-US', {maximumFractionDigits: d});
const phone = () => matchMedia('(max-width:760px)').matches;
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };

export class MergeLayer {
  constructor(app) {
    this.a = app; this.v = app.viewer; this.S = app.S;
    this.stale = false; this.hadBuild = false; this.sheetOpen = null; this.outlinerOpen = null;
    this.paletteItems = []; this.paletteIndex = 0;
    this.bindViewer(); this.bindSheet(); this.bindOutliner(); this.bindPalette(); this.bindResult(); this.bindCutFields(); this.bindKeys();
    this.sync();
  }

  // ---------- viewer-first presentation ----------
  bindViewer() {
    const hint = $('gestureHint');
    hint.hidden = store('ps.gestureHint') === '0';
    $('dismissGesture').addEventListener('click', () => { hint.hidden = true; store('ps.gestureHint', '0'); this.v.renderer.domElement.focus(); });
    // Cut drags snap to 1 mm / 5°; hold Shift for 0.1 mm / 1° (lane A).
    const snap = fine => { this.v.tc.setTranslationSnap(fine ? 0.1 : 1); this.v.tc.setRotationSnap((fine ? 1 : 5) * Math.PI / 180); };
    snap(false);
    addEventListener('keydown', e => { if (e.key === 'Shift') snap(true); });
    addEventListener('keyup', e => { if (e.key === 'Shift') snap(false); });
    addEventListener('blur', () => snap(false));
    // The triad is the live camera basis, drawn after every rendered frame.
    const prev = this.v.cb.onFrame;
    this.v.cb.onFrame = () => { prev?.(); this.triad(); this.cutFieldsLive(); };
    this.triad();
    // Layout changes (sheet, outliner, step chrome) resize the canvas. Re-fit only
    // while the camera is still in its framed pose; never undo a user's orbit.
    let last = '';
    new ResizeObserver(() => {
      const r = $('viewport').getBoundingClientRect(), key = `${Math.round(r.width)}x${Math.round(r.height)}`;
      if (key === last) return; last = key;
      if (this.v.cameraPose === 'iso' && !this.v.tc.dragging && this.v.box) requestAnimationFrame(() => { this.v.resize(); this.v.frameCurrent(); });
    }).observe($('viewport'));
  }
  triad() {
    const q = this.v.camera.quaternion.clone().invert(), key = q.toArray().map(x => x.toFixed(3)).join();
    if (key === this.triadKey) return; this.triadKey = key;
    const axes = [[1,0,0,'X','#ffa69c'],[0,1,0,'Y','#b6ed88'],[0,0,1,'Z','#a8d8ee']];
    $('triadLines').innerHTML = axes.map(([x,y,z,name,color]) => {
      const n = new THREE.Vector3(x,y,z).applyQuaternion(q), px = 37 + n.x * 22, py = 37 - n.y * 22;
      return `<line x1="37" y1="37" x2="${px.toFixed(1)}" y2="${py.toFixed(1)}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/><text x="${(px + n.x * 8).toFixed(1)}" y="${(py - n.y * 8 + 4).toFixed(1)}" text-anchor="middle" fill="${color}" font-size="13" font-weight="700">${name}</text>`;
    }).join('');
  }

  // Phone bottom sheet: one summary line and the step's details on demand.
  bindSheet() {
    this.sheetOpen = store('ps.sheet') === 'open' ? true : null;
    $('sheetToggle').addEventListener('click', () => { this.sheetOpen = !this.isSheetOpen(); store('ps.sheet', this.sheetOpen ? 'open' : 'peek'); this.sync(); if (this.sheetOpen) $('side').querySelector('.step:not([hidden])')?.focus({preventScroll:true}); });
    addEventListener('resize', () => this.sync());
  }
  isSheetOpen() {
    if (!phone()) return true;
    const step = document.body.dataset.step;
    if (step === 'load' || !this.S.model) return true;
    return this.sheetOpen ?? false;
  }
  summary() {
    const S = this.S, step = document.body.dataset.step;
    if (!S.model) return 'Load a model to begin.';
    if (step === 'fit') {
      const over = $('fitVerdict').classList.contains('over');
      const t = $('fitVerdict').textContent.replace(/^[^:]+:\s*/, '');
      return over ? t.split(' Splitting')[0].replace(/ for the usable space \([^)]*\)/g, '') : 'Fits as placed.';
    }
    if (!S.plan) return 'Ready to plan cuts.';
    const parts = S.plan.leaves.filter(l => !l.empty), bad = parts.filter(l => !l.fits).length;
    if (step === 'split' || step === 'join') {
      if (S.sel.joint != null) { const j = S.plan.joints.find(x => x.id === S.sel.joint); if (j) return `${this.a.jointName(j)} · Ø${fmt(j.d || 0, 2)} mm`; }
      if (S.sel.cut != null && S.plan.tree.nodes[S.sel.cut]?.cut) return `${this.a.cutName(S.sel.cut)} selected · drag it in the view`;
      return `${parts.length} parts · ${bad ? bad + ' do not fit' : 'all fit'} · ${S.plan.joints.length} pins`;
    }
    if (step === 'export') return S.export ? 'Downloads ready.' : S.built ? 'Parts built. Prepare downloads.' : this.stale ? 'Changes since last build. Rebuild.' : 'Build parts, then download.';
    return '';
  }

  // ---------- result card (Split and Join) ----------
  bindResult() {
    $('adjustPlan').addEventListener('click', () => {
      const cut = this.S.plan?.tree.nodes.find(n => n.cut);
      this.a.FLOW.go('split', {focus:false});
      if (cut) { this.a.select({cut: cut.id}); this.a.DIRECT.feedback('Drag the blue arrow to move this cut · Tilt cut for the A/B rings · Esc cancels'); }
      this.v.renderer.domElement.focus();
    });
  }
  renderResult() {
    const S = this.S, step = document.body.dataset.step, card = $('resultCard');
    const show = !!S.plan && !S.settingsDirty && S.planWasAuto && (step === 'split' || step === 'join') && S.sel.cut == null && S.sel.joint == null && S.sel.leaf == null;
    card.hidden = !show;
    // One automatic-split button: inside the result card as Regenerate while a
    // reviewed plan is shown, otherwise in its Split-step place.
    const btn = $('autoSplit'), home = $('autoSplitHome');
    if (show && btn.parentElement !== $('resultActions')) $('resultActions').append(btn);
    if (!show && btn.previousElementSibling !== home) home.after(btn);
    const label = show ? 'Regenerate' : S.plan ? 'Plan cuts again' : 'Plan cuts automatically';
    if (btn.firstChild?.nodeType === 3 && btn.firstChild.textContent.trim() !== label) btn.firstChild.textContent = label + ' ';
    btn.classList.toggle('primary', !show); btn.classList.toggle('wide', !show);
    if (!show) return;
    const parts = S.plan.leaves.filter(l => !l.empty), bad = parts.filter(l => !l.fits).length;
    const cuts = S.plan.tree.nodes.filter(n => n.cut).length, seams = S.plan.patches.filter(p => p.seam && p.seam.kind !== 'none').length;
    const warn = S.plan.patches.filter(p => p.fallback || p.single).length;
    $('resultTitle').textContent = `Auto split: ${parts.length} part${parts.length === 1 ? '' : 's'}${bad ? `, ${bad} still too big` : ', all fit'}`;
    $('resultText').textContent = `${cuts} cut${cuts === 1 ? '' : 's'} · ${S.plan.joints.length} pins${seams ? ` · ${seams} seams` : ''}${warn ? ` · ${warn} joint warning${warn === 1 ? '' : 's'} to review` : ''}. Adjust a cut in the view, or regenerate with the current settings.`;
  }

  // ---------- selected cut values in the viewport ----------
  bindCutFields() {
    const apply = () => {
      const S = this.S; if (S.sel.cut == null) return;
      const ids = ['fieldOffset', 'fieldTiltA', 'fieldTiltB'];
      if (ids.some(id => !$(id).reportValidity())) return;
      if (!$('cutOffsetNum')) return;
      $('cutOffsetNum').value = $('fieldOffset').value; $('tiltA').value = $('fieldTiltA').value || 0; $('tiltB').value = $('fieldTiltB').value || 0;
      $('cutApply').click();
    };
    for (const id of ['fieldOffset', 'fieldTiltA', 'fieldTiltB']) {
      $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } if (e.key === 'Escape') { e.preventDefault(); this.cutKey = null; this.syncCutFields(); e.target.blur(); this.v.renderer.domElement.focus(); } });
      $(id).addEventListener('change', () => { if (matchMedia('(pointer:coarse)').matches) apply(); });
    }
  }
  syncCutFields() {
    const S = this.S, n = S.plan?.tree.nodes[S.sel.cut];
    const show = document.body.dataset.step === 'split' && this.v.view === 'cuts' && !!n?.cut && !this.stageExpandedPhone();
    $('cutFields').hidden = !show; if (!show) { this.cutKey = null; return; }
    const key = JSON.stringify([n.id, n.cut]);
    if (key === this.cutKey) return; this.cutKey = key;
    if (!$('cutFields').contains(document.activeElement)) { $('fieldOffset').value = n.cut.d.toFixed(1); $('fieldTiltA').value = 0; $('fieldTiltB').value = 0; }
  }
  cutFieldsLive() {
    if ($('cutFields').hidden || !this.v.tc.dragging || this.v.tc.mode !== 'translate') return;
    $('fieldOffset').value = this.v.dragD.toFixed(1);
  }
  stageExpandedPhone() { return false; }

  // ---------- expert outliner ----------
  bindOutliner() {
    $('objectsBtn').addEventListener('click', () => { this.outlinerOpen = !this.isOutlinerOpen(); this.sync(); if (this.outlinerOpen) $('outlinerTree').querySelector('button')?.focus(); else $('objectsBtn').focus(); });
    $('outlinerClose').addEventListener('click', () => { this.outlinerOpen = false; this.sync(); $('objectsBtn').focus(); });
    $('outlinerTree').addEventListener('keydown', e => {
      const items = [...$('outlinerTree').querySelectorAll('button')], i = items.indexOf(document.activeElement);
      if (i < 0) return;
      const to = {ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1}[e.key];
      if (to != null) { e.preventDefault(); items[Math.max(0, Math.min(items.length - 1, to))].focus(); }
      if (e.key === 'Escape') { e.preventDefault(); this.outlinerOpen = false; this.sync(); $('objectsBtn').focus(); }
    });
    $('outlinerTree').addEventListener('click', e => { const b = e.target.closest('button[data-obj]'); if (b) this.choose(JSON.parse(b.dataset.obj), {focusEditor: false}); });
  }
  isOutlinerOpen() { return document.body.dataset.expert === 'true' && !!this.S.model && (this.outlinerOpen ?? !phone()); }
  objects() {
    const S = this.S, list = [];
    if (!S.model) return list;
    list.push({group: 'Model', label: S.model.name, meta: `${S.model.size.map(x => fmt(x, 0)).join(' × ')} mm`, obj: {type: 'model'}});
    if (!S.plan) return list;
    for (const n of S.plan.tree.nodes.filter(n => n.cut)) list.push({group: 'Cuts', label: this.a.cutName(n.id), meta: `${n.locked ? 'manual' : 'auto'} · ${fmt(n.cut.d, 1)} mm`, obj: {type: 'cut', id: n.id}, on: S.sel.cut === n.id && S.sel.joint == null && document.body.dataset.step !== 'join'});
    S.plan.leaves.forEach(l => { if (!l.empty) list.push({group: 'Parts', label: `Part ${l.label}`, meta: `${l.fits ? 'fits' : 'too big'} · ${l.extent.map(x => fmt(x, 0)).join('×')}`, obj: {type: 'part', id: l.id}, on: S.sel.leaf === l.id, bad: !l.fits}); });
    for (const p of S.plan.patches) {
      const js = S.plan.joints.filter(j => j.patch === p.id);
      list.push({group: 'Contacts & joints', label: `${this.a.cutName(p.node)} · ${this.a.contactName(p)}`, meta: `${js.length} pin${js.length === 1 ? '' : 's'}${p.seam && p.seam.kind !== 'none' ? ' · ' + p.seam.kind + ' seam' : ''}`, obj: {type: 'contact', id: p.id}, on: S.sel.patch === p.id && S.sel.joint == null && document.body.dataset.step === 'join', bad: !!(p.fallback || p.single), depth: 0});
      for (const j of js) list.push({group: 'Contacts & joints', label: this.a.jointName(j), meta: `${j.kind} · Ø${fmt(j.d || 0, 2)}`, obj: {type: 'joint', id: j.id}, on: S.sel.joint === j.id, depth: 1, bad: !!(j.warnings && j.warnings.length)});
    }
    return list;
  }
  renderOutliner() {
    const tree = $('outlinerTree'), items = this.objects();
    const key = JSON.stringify(items.map(i => [i.group, i.label, i.meta, i.on, i.bad]));
    if (key === this.outlineKey) return; this.outlineKey = key;
    const focused = document.activeElement?.closest?.('#outlinerTree button')?.dataset.obj;
    const groups = [...new Set(items.map(i => i.group))];
    tree.innerHTML = groups.map(g => `<section><h3>${esc(g)}</h3><ul>${items.filter(i => i.group === g).map(i => `<li${i.depth ? ' class="nested"' : ''}><button data-obj='${esc(JSON.stringify(i.obj))}' ${i.on ? 'aria-current="true"' : ''} class="${i.bad ? 'warn' : ''}"><span>${i.bad ? '⚠ ' : ''}${esc(i.label)}</span><small>${esc(i.meta)}</small></button></li>`).join('')}</ul></section>`).join('');
    if (focused) [...tree.querySelectorAll('button[data-obj]')].find(b => b.dataset.obj === focused)?.focus({preventScroll: true});
  }
  choose(o, {focusEditor = true} = {}) {
    const {S, FLOW, select} = this.a;
    if (o.type === 'model') { select({}); FLOW.go('fit', {focus: focusEditor}); this.v.frameCurrent(); }
    if (o.type === 'cut') { FLOW.go('split', {focus: false}); select({cut: o.id}); }
    if (o.type === 'part') { FLOW.go('split', {focus: false}); select({leaf: o.id}); }
    if (o.type === 'contact') { const p = S.plan.patches[o.id]; FLOW.go('join', {focus: false}); select({cut: p.node}); S.sel.patch = p.id; this.a.renderJointPanel(); }
    if (o.type === 'joint') { const j = S.plan.joints.find(x => x.id === o.id); if (!j) return; FLOW.go('join', {focus: false}); select({joint: j.id, patch: j.patch, cut: S.plan.patches[j.patch].node}); }
    this.sync();
    if (focusEditor) requestAnimationFrame(() => $('inspectorTitle').focus({preventScroll: false}));
  }

  // One inspector heading for the current selection; the step panel below it
  // holds that object's full editor, so there is still only one editor.
  renderInspector() {
    const S = this.S, el = $('selectionInspector');
    const on = document.body.dataset.expert === 'true' && !!S.plan && ['split', 'join'].includes(document.body.dataset.step);
    el.hidden = !on; if (!on) return;
    let title = 'Nothing selected', facts = 'Select a cut, part, contact or joint in the view, the Objects list or with Ctrl K.';
    if (S.sel.joint != null) { const j = S.plan.joints.find(x => x.id === S.sel.joint); if (j) { title = this.a.jointName(j); facts = `${j.kind} · Ø${fmt(j.d || 0, 2)} mm · depth ${fmt(j.holeNeg || 0, 1)} / ${fmt(j.holePos || 0, 1)} mm into each part · clearance ${fmt(j.clear || 0, 2)} mm. Edit it in the pin card below.`; } }
    else if (S.sel.leaf != null) { const l = S.plan.leaves.find(x => x.id === S.sel.leaf); if (l) { title = `Part ${l.label}`; facts = `${l.extent.map(x => fmt(x, 1)).join(' × ')} mm · ${l.fits ? 'fits' : 'does not fit'} · ${l.printFace} down. Add a cut through it below.`; } }
    else if (document.body.dataset.step === 'join' && S.sel.patch != null && S.plan.patches[S.sel.patch]) { const p = S.plan.patches[S.sel.patch]; title = `Contact ${this.a.contactName(p)}`; facts = `${fmt(p.area || 0, 0)} mm² · ${S.plan.joints.filter(j => j.patch === p.id).length} pins${p.fallback ? ' · ' + p.fallback.reason : ''}. Joint settings are below.`; }
    else if (S.sel.cut != null && S.plan.tree.nodes[S.sel.cut]?.cut) { const n = S.plan.tree.nodes[S.sel.cut]; title = this.a.cutName(n.id); facts = `${n.locked ? 'Manual' : 'Automatic'} · offset ${fmt(n.cut.d, 1)} mm · ${n.reason || 'placed by you'}. Precise values are below; drag it in the view.`; }
    if ($('inspectorTitle').textContent !== title) $('inspectorTitle').textContent = title;
    if ($('inspectorFacts').textContent !== facts) $('inspectorFacts').textContent = facts;
  }

  // ---------- output state: one authoritative build/export status ----------
  renderOutput() {
    const S = this.S;
    if (S.built) { this.hadBuild = true; this.stale = false; this.builtPlan = S.plan; }
    else if (this.hadBuild && S.plan && this.builtPlan !== S.plan) this.stale = true;
    if (!S.plan) { this.stale = false; this.hadBuild = false; }
    const el = $('outputState');
    const text = S.export ? 'Downloads match the current plan.' : S.built ? 'Parts are built from the current plan. Downloads are not prepared yet.' : this.stale ? 'Changes since last build. Rebuild to update the parts and downloads.' : '';
    el.hidden = !text; if (el.textContent !== text) el.textContent = text; el.dataset.state = S.export ? 'current' : S.built ? 'built' : this.stale ? 'stale' : '';
    const build = $('buildBtn'), label = this.stale && !S.built ? 'Rebuild parts' : 'Build parts';
    if (build.firstChild?.nodeType === 3 && build.firstChild.textContent.trim() !== label) build.firstChild.textContent = label + ' ';
    const exp = document.querySelector('#flowNav [data-step="export"] small');
    if (exp && this.stale && !S.built && document.body.dataset.step !== 'export' && !S.settingsDirty) exp.textContent = 'Rebuild needed';
  }

  // ---------- command palette (Ctrl K) ----------
  bindPalette() {
    $('commandBtn').addEventListener('click', () => this.openPalette());
    $('paletteInput').addEventListener('input', () => { this.paletteIndex = 0; this.renderPalette(); });
    $('paletteInput').addEventListener('keydown', e => {
      const n = this.paletteItems.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (n) this.paletteIndex = (this.paletteIndex + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; this.renderPalette(false); }
      if (e.key === 'Home' && n) { e.preventDefault(); this.paletteIndex = 0; this.renderPalette(false); }
      if (e.key === 'End' && n) { e.preventDefault(); this.paletteIndex = n - 1; this.renderPalette(false); }
      if (e.key === 'Enter') { e.preventDefault(); this.runCommand(this.paletteItems[this.paletteIndex]); }
    });
    $('paletteList').addEventListener('click', e => { const li = e.target.closest('[role=option]'); if (li) this.runCommand(this.paletteItems[+li.dataset.i]); });
    $('paletteDlg').addEventListener('close', () => { const back = this.paletteReturn; this.paletteReturn = null; if (back?.isConnected && back.checkVisibility()) back.focus(); });
  }
  openPalette() {
    if ($('paletteDlg').open || document.querySelector('dialog[open]')) return;
    this.paletteReturn = document.activeElement;
    $('paletteInput').value = ''; this.paletteIndex = 0; this.renderPalette();
    $('paletteDlg').showModal(); $('paletteInput').focus();
  }
  commands() {
    const {S, FLOW} = this.a, busy = !$('busy').classList.contains('hidden'), ready = readiness(S), out = [];
    const add = (label, run, why = null, hint = '') => out.push({label, run, why: busy ? 'Busy' : why, hint});
    const steps = [['load','Load'],['fit','Fit'],['split','Split'],['join','Join'],['export','Export']];
    steps.forEach(([s, name], i) => add(`Go to step ${i + 1}: ${name}`, () => FLOW.go(s), FLOW.allowed(s) ? null : (S.model ? 'Find cuts first' : 'Load a model first'), 'Step'));
    add('Open a model file…', () => $('fileInput').click(), null, 'Load');
    for (const b of document.querySelectorAll('[data-sample]')) if (!out.some(c => c.sample === b.dataset.sample)) { add(`Load sample: ${b.dataset.sample.replace(/_/g, ' ').replace(/\.stl$/, '')}`, () => b.click(), null, 'Load'); out.at(-1).sample = b.dataset.sample; }
    add(`Plan cuts for ${FLOW.printerName()}`, () => { FLOW.go('split', {focus: false}); $('autoSplit').click(); }, S.model ? null : 'Load a model first', 'Split');
    add('Auto-complete the remaining oversized parts', () => $('autoComplete')?.click(), S.plan && !S.plan.fits && $('autoComplete') ? null : 'All parts already fit', 'Split');
    add(this.stale ? 'Rebuild parts' : 'Build parts', () => { FLOW.go('export', {focus: false}); $('buildBtn').click(); }, !S.plan ? 'Find cuts first' : !ready.ok ? ready.text : null, 'Export');
    add('Prepare downloads', () => { FLOW.go('export', {focus: false}); $('exportBtn').click(); }, S.built ? null : 'Build parts first', 'Export');
    add('Download ZIP package', () => document.querySelector('#exportInfo a[download$=".zip"]')?.click(), S.export ? null : 'Prepare downloads first', 'Export');
    add('Generate joint test coupon', () => { FLOW.go('export', {focus: false}); $('couponBtn').click(); }, S.workerReady ? null : 'Geometry engine still loading', 'Export');
    add('Undo plan edit', () => $('editUndo').click(), $('editUndo').disabled ? 'Nothing to undo' : null, 'Ctrl Z');
    add('Redo plan edit', () => $('editRedo').click(), $('editRedo').disabled ? 'Nothing to redo' : null, 'Ctrl Shift Z');
    add('Fit model in view', () => this.v.frameCurrent(), S.model ? null : 'Load a model first', 'F');
    for (const [v, name, k] of [['model','Model',1],['cuts','Cuts',2],['parts','Parts',3],['plates','Plates',4]]) add(`Show ${name} presentation`, () => this.a.setView(v), (v === 'cuts' && !S.plan) || (['parts','plates'].includes(v) && !S.built) ? (v === 'cuts' ? 'Find cuts first' : 'Build parts first') : !S.model ? 'Load a model first' : null, String(k));
    add(document.body.dataset.expert === 'true' ? 'Switch to guided mode' : 'Switch to expert mode', () => $('expertMode').click(), null, 'Mode');
    add('Show object list', () => { this.outlinerOpen = true; FLOW.mode(true); this.sync(); $('outlinerTree').querySelector('button')?.focus(); }, S.model ? null : 'Load a model first', 'Objects');
    if (S.sel.cut != null && S.sel.joint == null && S.plan?.tree.nodes[S.sel.cut]?.cut) add(`Delete ${this.a.cutName(S.sel.cut)}`, () => this.a.deleteCut(S.sel.cut), null, 'Delete');
    if (S.sel.joint != null) { const j = S.plan?.joints.find(x => x.id === S.sel.joint); if (j) add(`Delete ${this.a.jointName(j)}`, () => this.a.deleteJoint(j.id), null, 'Delete'); }
    add('Add a pin on the selected cut face', () => { FLOW.go('join', {focus: false}); $('viewAddJoint').click(); }, S.plan && S.face != null ? null : 'Find cuts first', 'A');
    add('Printer and clearances', () => { FLOW.go('fit'); $('printerAdvanced').open = true; $('printer').focus(); }, S.model ? null : 'Load a model first', 'Fit');
    add('Joint style for all contacts', () => { FLOW.go('join'); $('jointStyle').focus(); }, S.plan ? null : 'Find cuts first', 'Join');
    add('Open the large joint editor', () => $('openEditor').click(), S.plan && S.face != null ? null : 'Find cuts first', 'Join');
    add('Reset settings to defaults', () => $('resetDefaults').click(), null, 'Settings');
    add('Quick help', () => $('helpBtn').click(), null, 'Help');
    add('Open the guide', () => window.open('guide.html', '_blank', 'noopener'), null, 'Help');
    for (const o of this.objects()) if (o.obj.type !== 'model') add(`Select ${o.label}`, () => this.choose(o.obj), null, o.group);
    return out;
  }
  renderPalette(rebuild = true) {
    if (rebuild) {
      const q = $('paletteInput').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      // Label matches rank above matches that rely on the group/shortcut hint.
      const all = this.commands().filter(c => q.every(w => (c.label + ' ' + c.hint).toLowerCase().includes(w)));
      const inLabel = c => q.every(w => c.label.toLowerCase().includes(w));
      this.paletteItems = [...all.filter(inLabel), ...all.filter(c => !inLabel(c))].slice(0, 40);
      this.paletteIndex = Math.min(this.paletteIndex, Math.max(0, this.paletteItems.length - 1));
    }
    const list = $('paletteList');
    list.innerHTML = this.paletteItems.map((c, i) => `<li id="cmd-${i}" role="option" data-i="${i}" aria-selected="${i === this.paletteIndex}" ${c.why ? 'aria-disabled="true"' : ''}><span>${esc(c.label)}</span><small>${esc(c.why || c.hint)}</small></li>`).join('') || '<li class="none" role="presentation">No matching command</li>';
    if (this.paletteItems.length) { $('paletteInput').setAttribute('aria-activedescendant', `cmd-${this.paletteIndex}`); $(`cmd-${this.paletteIndex}`).scrollIntoView({block: 'nearest'}); }
    else $('paletteInput').removeAttribute('aria-activedescendant');
    $('paletteStatus').textContent = `${this.paletteItems.length} command${this.paletteItems.length === 1 ? '' : 's'}`;
  }
  runCommand(c) {
    if (!c) return;
    if (c.why) { $('paletteStatus').textContent = `${c.label} is unavailable: ${c.why}.`; return; }
    this.paletteReturn = null; $('paletteDlg').close();
    c.run(); this.sync();
  }

  bindKeys() {
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        if ($('jointDlg') && !$('jointDlg').classList.contains('hidden')) return;
        e.preventDefault(); if ($('paletteDlg').open) $('paletteDlg').close(); else this.openPalette();
      }
    });
  }

  // ---------- sync ----------
  sync() {
    const S = this.S, expert = document.body.dataset.expert === 'true';
    const open = this.isSheetOpen();
    document.body.dataset.sheet = phone() && S.model && document.body.dataset.step !== 'load' ? (open ? 'open' : 'peek') : 'full';
    $('sheetToggle').setAttribute('aria-expanded', String(open));
    const why = document.body.dataset.step === 'fit' && $('fitVerdict').classList.contains('over');
    $('sheetToggle').textContent = open ? 'Less' : why ? 'Why?' : 'Details';
    const sum = this.summary(); if ($('sheetSummary').textContent !== sum) $('sheetSummary').textContent = sum;
    const ol = this.isOutlinerOpen();
    $('outliner').hidden = !ol; $('objectsBtn').setAttribute('aria-expanded', String(ol)); $('objectsBtn').hidden = !expert || !S.model;
    document.body.dataset.outliner = String(ol);
    if (ol) this.renderOutliner();
    this.renderInspector(); this.renderResult(); this.renderOutput(); this.syncCutFields();
    $('commandBtn').hidden = !expert;
    if (phone()) { const step = document.body.dataset.step, t = step === 'split' && S.plan ? 'Drag the blue arrow to move a cut · two fingers pan' : step === 'join' ? 'Tap a pin to edit · drag to move it' : 'Drag to orbit · pinch to zoom · two fingers pan'; if ($('viewerHint').textContent !== t) $('viewerHint').textContent = t; }
  }
}

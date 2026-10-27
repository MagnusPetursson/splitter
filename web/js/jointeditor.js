// Pop-out joint editor: a large, zoomable view of one cut face on top of
// the main window. It drives the same plan as the inline map (the app's
// callbacks), so every change also shows in the 3D view.
import { JointMap } from './jointmap.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class JointEditor {
  // app: { S, cutName(node), selectFace(node), selectJoint(id), selectPatch(pid),
  //        addJoint(pid, q), moveJoint(j, q, pid), deleteJoint(id), setAddMode(on),
  //        protoJoint(kind), mapOpts(), toast(msg, err), onLayout() }
  constructor(app) {
    this.app = app;
    this.el = $('jointDlg');
    this.open = false;
    this.map = new JointMap($('jdMap'), {
      onSelectJoint: (id) => app.selectJoint(id),
      onHover: id=>app.hoverJoint?.(id),
      onSelectPatch: (pid) => { if (pid != null) app.selectPatch(pid); },
      onMove: (j, q, pid) => app.moveJoint(j, q, pid),
      onAdd: (pid, q) => app.addJoint(pid, q),
      onMiss: () => app.toast('That point is outside the cut face: click inside the coloured area.', true),
      onView: (z) => { $('jdZoom').textContent = `${Math.round(z * 100)} %`; },
    }, { zoomable: true, fill: true });
    $('jdClose').addEventListener('click', () => this.close());
    $('jdIn').addEventListener('click', () => this.map.zoomAt(1.5));
    $('jdOut').addEventListener('click', () => this.map.zoomAt(1 / 1.5));
    $('jdFit').addEventListener('click', () => this.map.fit());
    $('jdAdd').addEventListener('click', () => app.setAddMode(!app.S.addMode));
    $('jdKind').addEventListener('change', () => { app.S.addKindTouched = true; $('addKind').value = $('jdKind').value; $('addKind').dispatchEvent(new Event('change')); });
    $('jdField').addEventListener('change', (e) => { this.map.showField = e.target.checked; $('showField').checked = e.target.checked; this.map.draw(); });
    $('jdDock').addEventListener('click', () => this.setDock(!this.docked));
    this.el.addEventListener('keydown', (e) => this.key(e));
    this.docked = localStorage.getItem('ps.jdDock') === '1';
    this.nudge = null;
  }

  isPhone() { return window.matchMedia('(max-width: 760px)').matches; }

  // "Beside 3D": the editor takes the left part of the window and the 3D
  // view stays visible (and live) on the right.
  setDock(on) {
    this.docked = on;
    localStorage.setItem('ps.jdDock', on ? '1' : '0');
    this.layout();
  }

  layout() {
    const dock = this.open && this.docked && !this.isPhone();
    this.el.classList.toggle('docked', dock);
    this.el.setAttribute('aria-modal', String(!dock));
    for (const node of document.querySelectorAll('.top, #flowNav, .side, .flow-footer, .stage')) node.inert = this.open && (!dock || !node.classList.contains('stage'));
    document.body.classList.toggle('jd-docked', dock);
    $('jdDock').textContent = this.docked ? 'Full view' : 'Beside 3D';
    $('jdDock').title = this.docked ? 'Use the whole window for the editor' : 'Show the 3D view beside the editor (changes appear there live)';
    $('jdDock').classList.toggle('hidden', this.isPhone());
    this.app.onLayout && this.app.onLayout();
    // the canvas changed size: re-fit once the new layout is in place
    if (this.open) requestAnimationFrame(() => this.map.fit());
  }

  // open on a face; focus = face point to zoom to (optional)
  show(node, opts = {}) {
    const S = this.app.S;
    if (!S.plan) return;
    this.returnFocus = document.activeElement;
    this.open = true;
    this.el.classList.remove('hidden');
    this.el.setAttribute('aria-hidden', 'false');
    // the contact/joint editors live in the overlay while it is open
    if (!this.home) { const marker=document.createComment('joint editors return here'); $('seamEditor').before(marker); this.home={parent:marker.parentNode,marker}; }
    $('jdSide').append($('contactList'), $('seamEditor'), $('jointEditor'));
    // Keep progress and cancellation in the modal's accessible subtree.
    this.el.append($('busy'));
    $('jdKind').innerHTML = $('addKind').innerHTML;
    $('jdKind').value = $('addKind').value;
    $('jdField').checked = $('showField').checked;
    this.map.showField = $('showField').checked;
    if (opts.add != null) this.app.setAddMode(opts.add);
    if (node != null && node !== S.face) this.app.selectFace(node);
    this.layout();
    this.render();
    requestAnimationFrame(() => {
      this.map.draw();
      if (opts.at) this.map.focusOn(opts.at, opts.span || 40);
      else this.map.fit();
      $('jdMap').focus();
    });
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.flushNudge();
    this.el.classList.add('hidden');
    this.el.setAttribute('aria-hidden', 'true');
    document.querySelector('.stage').append($('busy'));
    // put the editors back under the inline map
    this.home.parent.insertBefore($('seamEditor'), this.home.marker);
    this.home.parent.insertBefore($('jointEditor'), this.home.marker);
    $('mapWrap').insertBefore($('contactList'),$('mapWrap').querySelector('details'));
    this.app.setAddMode(false);
    this.layout();
    if (this.returnFocus?.isConnected) this.returnFocus.focus();
    else $('openEditor').focus();
  }

  face() { const S = this.app.S; return S.plan && S.plan.faces.find((f) => f.node === S.face); }

  // called by the app whenever the plan, selection or add mode changes
  render() {
    if (!this.open) return;
    const S = this.app.S;
    const f = this.face();
    if (!f) { this.close(); return; }
    $('jdTitle').textContent = `Joints · ${this.app.cutName(f.node)}`;
    // cut switcher
    const faces = S.plan.faces.filter((x) => x.loops && x.loops.length);
    $('jdFaces').innerHTML = faces.map((x) => `<button data-jdface="${x.node}" class="small ${x.node === f.node ? 'sel' : ''}" aria-pressed="${x.node === f.node}">${esc(this.app.cutName(x.node))}</button>`).join('');
    for (const b of $('jdFaces').querySelectorAll('[data-jdface]')) b.addEventListener('click', () => { this.app.selectFace(+b.dataset.jdface); this.map.fit(); });
    this.map.addMode = S.addMode;
    this.map.set(S.plan, f, this.app.mapOpts());
    $('jdAdd').classList.toggle('on', S.addMode);
    $('jdAdd').setAttribute('aria-pressed', String(!!S.addMode));
    $('jdAdd').innerHTML = S.addMode ? 'Adding… <kbd>Esc</kbd> to stop' : `<svg class="i" aria-hidden="true"><use href="#i-plus"/></svg>Add joint`;
    $('jdKind').value = $('addKind').value;
    // joint chips: Tab-able, show selection
    const js = this.map.joints();
    $('jdJoints').innerHTML = js.length
      ? js.map((j) => `<button data-jdj="${j.id}" class="jchip ${j.id === S.sel.joint ? 'sel' : ''} ${j.warnings && j.warnings.length ? 'bad' : ''}" aria-pressed="${j.id === S.sel.joint}" title="${esc(j.kind)} · C${j.patch}">J${j.id}<span>${esc(j.kind)}</span></button>`).join('')
      : '<span class="small mute">No point joints on this face.</span>';
    $('jdJoints').querySelectorAll('[data-jdj]').forEach((b) => b.addEventListener('click', () => {this.pick(+b.dataset.jdj);$('jdMap').focus();}));
    this.hint();
  }

  hint() {
    const S = this.app.S;
    const h = $('jdHint');
    if (!S.addMode) { h.classList.add('hidden'); return; }
    const pr = this.app.protoJoint($('addKind').value);
    const room = this.map.roomFor(pr.rreq);
    const kind = $('addKind').selectedOptions[0] ? $('addKind').selectedOptions[0].textContent : pr.kind;
    h.innerHTML = room
      ? `Click a <b class="okc">green</b> spot to place a <b>${esc(kind.toLowerCase())}</b>: green = enough wall around the joint centre (a spot ≥ ${(2 * pr.rreq).toFixed(1)} mm across) · <kbd>Enter</kbd> places it at the view centre · <kbd>Esc</kbd> stops`
      : `<b class="warnc">No room for a ${esc(kind.toLowerCase())} on this face</b>: it needs a spot ≥ ${(2 * pr.rreq).toFixed(1)} mm across. Try a smaller joint type or a seam.`;
    h.classList.remove('hidden');
  }

  pick(id) {
    this.app.selectJoint(id);
    const j = this.map.joints().find((x) => x.id === id);
    if (j) this.map.focusOn(j.p);
    const b = $('jdJoints').querySelector(`[data-jdj="${id}"]`);
    if (b && document.activeElement && document.activeElement.closest && document.activeElement.closest('#jdJoints')) b.focus();
  }

  step(dir) {
    const js = this.map.joints();
    if (!js.length) return;
    const S = this.app.S;
    let i = js.findIndex((j) => j.id === S.sel.joint);
    i = i < 0 ? (dir > 0 ? 0 : js.length - 1) : (i + dir + js.length) % js.length;
    this.pick(js[i].id);
  }

  // keyboard nudging: move the selected joint by 0.5 mm per press and
  // commit once the keys go quiet
  nudgeBy(du, dv) {
    const S = this.app.S;
    const j = S.sel.joint != null && S.plan.joints.find((x) => x.id === S.sel.joint);
    if (!j) return;
    if (!this.nudge) this.nudge = { j, p0: j.p.slice() };
    j.p = [j.p[0] + du, j.p[1] + dv];
    this.map.draw();
    clearTimeout(this.nudge.t);
    this.nudge.t = setTimeout(() => this.flushNudge(), 700);
  }

  flushNudge() {
    const n = this.nudge;
    if (!n) return;
    clearTimeout(n.t);
    this.nudge = null;
    const pid = this.map.patchAt(n.j.p);
    if (pid == null) { n.j.p = n.p0; this.map.draw(); this.app.toast('A joint must stay on the cut face', true); return; }
    this.app.moveJoint(n.j, n.j.p, pid);
  }

  key(e) {
    const t = e.target;
    const typing = t.matches && t.matches('input, select, textarea');
    const onMap = t === $('jdMap');
    e.stopPropagation(); // the main window's shortcuts must not fire
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }
    if (e.key === 'Tab') {
      // keep focus inside the dialog
      const f = [...this.el.querySelectorAll('button:not([disabled]), select, input, canvas[tabindex], [tabindex="0"]')].filter((x) => x.offsetParent !== null);
      const i = f.indexOf(t);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      return;
    }
    if (typing) return;
    const S = this.app.S;
    switch (e.key) {
      case '+': case '=': e.preventDefault(); this.map.zoomAt(1.5); return;
      case '-': case '_': e.preventDefault(); this.map.zoomAt(1 / 1.5); return;
      case '0': case 'f': case 'F': e.preventDefault(); this.map.fit(); return;
      case 'a': case 'A': e.preventDefault(); this.app.setAddMode(!S.addMode); return;
      case 'Delete': case 'Backspace':
        if (S.sel.joint != null) { e.preventDefault(); this.app.deleteJoint(S.sel.joint); }
        return;
      case 'Enter':
        if (onMap && S.addMode) {
          e.preventDefault();
          const c = $('jdMap');
          const q = this.map.view().toF(c.width / 2, c.height / 2);
          const pid = this.map.patchAt(q);
          if (pid != null) this.app.addJoint(pid, q); else this.app.toast('The centre of the view is not on the cut face: pan first.', true);
        }
        return;

      default: break;
    }
    if (e.key.startsWith('Arrow') && (onMap || (t.closest && t.closest('#jdJoints')))) {
      e.preventDefault();
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
      if (e.altKey) { this.map.pan[0]+=d[0]*35*this.map.dpr(); this.map.pan[1]-=d[1]*35*this.map.dpr(); this.map.draw(); }
      else if (e.shiftKey) this.nudgeBy(0.5 * d[0], 0.5 * d[1]);
      else this.step(d[0] + (d[0] ? 0 : -d[1]) > 0 ? 1 : -1);
    }
  }
}

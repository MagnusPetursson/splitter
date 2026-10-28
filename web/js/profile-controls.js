import {PROFILE_KEY, MAX_FILE_BYTES, FIT_KEYS, profileName, normalizeSettings, readProfiles, importProfiles, exportProfiles} from './profiles.js';
const $ = id => document.getElementById(id);

export class ProfileControls {
  constructor({printers, capture, apply, notify, openFits}) {
    Object.assign(this,{printers,capture,apply,notify,openFits});
    this.state = {version:1,activeId:null,profiles:[]};
    this.last = null;
    try { Object.assign(this,readProfiles(localStorage,printers)); }
    catch (e) { this.unavailable = true; this.error = `Profiles unavailable: ${e.message}`; }
    $('profilePicker').addEventListener('change',()=>this.select($('profilePicker').value));
    $('profileSave').addEventListener('click',()=>this.save());
    $('profileManage').addEventListener('click',()=>this.open());
    $('profileDialog').addEventListener('keydown',e=>{
      e.stopPropagation(); // Model shortcuts must not act behind this modal.
      if (e.key !== 'Tab') return;
      const items = [...$('profileDialog').querySelectorAll('button, input, select, summary')].filter(el=>!el.disabled&&el.checkVisibility());
      const first = items[0], last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault();last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault();first.focus(); }
    });
    $('profileClose').addEventListener('click',()=>$('profileDialog').close());
    $('profileCancel').addEventListener('click',()=>$('profileDialog').close());
    $('profileSaveAs').addEventListener('click',()=>this.naming(false));
    $('profileRename').addEventListener('click',()=>this.naming(true));
    $('profileNameForm').addEventListener('submit',e=>{e.preventDefault();this.submitName();});
    $('profileDelete').addEventListener('click',()=>{
      $('profileDeleteText').textContent = `Delete “${this.current().name}”? Current printer settings will stay in use.`;
      this.pane('delete','Delete profile');$('profileCancel').focus();
    });
    $('profileDeleteConfirm').addEventListener('click',()=>{
      const state = {...this.state,activeId:null,profiles:this.state.profiles.filter(p=>p.id!==this.state.activeId)};
      if (this.commit(state)) { $('profileDialog').close();this.say('Profile deleted. Current settings kept.'); }
    });
    $('profileExport').addEventListener('click',()=>{
      $('profileExportScope').value = this.current() ? 'current' : 'all';
      $('profileExportScope').options[0].disabled = !this.current();
      this.pane('export','Export profiles');$('profileDownload').focus();
    });
    $('profileDownload').addEventListener('click',()=>this.download());
    $('profileImport').addEventListener('click',()=>{
      $('profileFile').value = '';$('profileImportStatus').textContent = '';
      $('profileImportAdjustments').hidden = true;
      this.pane('import','Import profiles');$('profileFile').focus();
    });
    $('profileFile').addEventListener('change',()=>this.importFile());
    $('saveMeasuredFits').addEventListener('click',()=>this.current()?this.save():this.openName());
    $('couponEnterFits').addEventListener('click',()=>this.openFits());
    // Reflect edits as they happen, not only on blur. Existing handlers retain
    // last-used behaviour; profile Save is always an explicit operation.
    for (const e of document.querySelectorAll('#printer, #bedX, #bedY, #bedZ, #nozzle, #margin, #minPiece, #jointStyle, [data-fit]')) e.addEventListener('input',()=>this.sync());
    this.sync();
  }
  current() { return this.state.profiles.find(p=>p.id===this.state.activeId); }
  values() { return normalizeSettings(this.capture(),this.printers); }
  say(message) { this.notify(message);$('profileStatus').textContent = message; }
  commit(next) {
    if (this.unavailable) { this.notify(this.error,true);return false; }
    try { localStorage.setItem(PROFILE_KEY,JSON.stringify(next)); }
    catch { this.error = 'Could not save profiles in this browser. Free some browser storage, then try again.';this.notify(this.error,true);$('profileDialogError').textContent = this.error;return false; }
    this.state = next;this.error = '';this.sync();return true;
  }
  sync() {
    const picker = $('profilePicker'), before = picker.value;
    // Preserve keyboard interaction/focus: rebuild only when the list changes.
    const signature = JSON.stringify(this.state.profiles.map(p=>[p.id,p.name]));
    if (signature !== this.signature) {
      this.signature = signature;picker.replaceChildren(new Option('No profile',''));
      for (const p of this.state.profiles) picker.add(new Option(p.name,p.id));
      picker.value = before;
    }
    picker.value = this.state.activeId || '';
    const current = this.current();let values;
    picker.title = current?.name || 'No profile';
    $('profileCurrent').textContent = current ? `Current: ${current.name}` : 'Current settings · not saved as a profile';
    let adjusted = false;
    try { const r = this.values();values = r.settings;adjusted = r.warnings.length>0; } catch { /* incomplete field while typing */ }
    this.modified = !!current && (adjusted || !values || JSON.stringify(current.settings)!==JSON.stringify(values));
    $('profileStatus').textContent = this.error || (current ? this.modified ? 'Modified · Save to keep' : 'Saved in this browser' : '');
    $('profileStatus').hidden = !current && !this.error;
    $('profileSave').disabled = !this.modified || this.unavailable;
    for (const id of ['profileRename','profileDelete']) $(id).disabled = !current || this.unavailable;
    $('profileSaveAs').disabled = !!this.unavailable || this.state.profiles.length>=100;
    $('profileImport').disabled = !!this.unavailable;
    $('profileExport').disabled = !this.state.profiles.length;
    picker.disabled = !!this.unavailable;
    const fitsChanged = current && (!values || FIT_KEYS.some(k=>current.settings.fits[k]!==values.fits[k]));
    $('saveMeasuredFits').hidden = !!this.unavailable || (!!current && !fitsChanged);
    $('saveMeasuredFits').textContent = current ? 'Save fits to profile' : 'Save as profile…';
  }
  select(id) {
    // Do not overwrite unsaved values on reload. Only an explicit selection
    // applies a profile; the unnamed option just detaches it from current values.
    const next = this.state.profiles.find(p=>p.id===id);
    if (!this.commit({...this.state,activeId:next?.id||null})) { this.sync();return; }
    if (next) this.apply(next.settings);
    this.sync();
  }
  save() {
    const current = this.current();if (!current) return this.openName();
    try {
      const r = this.values();
      const next = {...this.state,profiles:this.state.profiles.map(p=>p.id===current.id?{...p,settings:r.settings}:p)};
      if (this.commit(next)) { this.apply(r.settings);this.sync();this.notify(r.warnings.length ? `Profile saved. Adjusted ${r.warnings.join('; ')}` : 'Profile saved.'); }
    } catch (e) { this.notify(e.message,true); }
  }
  open() { this.pane('menu','Profiles');$('profileDialog').showModal();$('profileSaveAs').focus(); }
  openName() { this.open();this.naming(false); }
  pane(name,title) {
    for (const e of document.querySelectorAll('[data-profile-pane]')) e.hidden = e.dataset.profilePane !== name;
    $('profileDialogTitle').textContent = title;$('profileDialogError').textContent = '';
    $('profileCancel').hidden = name === 'menu';$('profileCancel').textContent = 'Cancel';
  }
  naming(rename) {
    this.rename = rename;this.pane('name',rename?'Rename profile':'Save profile as');
    $('profileName').value = rename ? this.current().name : '';
    $('profileName').setCustomValidity('');$('profileName').focus();$('profileName').select();
  }
  submitName() {
    try {
      const name = profileName($('profileName').value), current = this.current();
      if (this.state.profiles.some(p=>p.name===name&&(!this.rename||p.id!==current.id))) throw Error('That name is already used. Choose another name.');
      const r = this.rename ? null : this.values();
      const id = this.rename ? current.id : crypto.randomUUID();
      const profiles = this.rename ? this.state.profiles.map(p=>p.id===id?{...p,name}:p) : [...this.state.profiles,{id,name,settings:r.settings}];
      if (profiles.length>100) throw Error('Keep at most 100 profiles in this browser.');
      if (this.commit({...this.state,activeId:id,profiles})) {
        if (r) this.apply(r.settings);
        this.sync();$('profileDialog').close();this.notify(r?.warnings.length?`Profile saved. Adjusted ${r.warnings.join('; ')}`:this.rename?'Profile renamed.':'Profile saved.');
      }
    } catch (e) { $('profileDialogError').textContent = e.message; }
  }
  download() {
    const data = exportProfiles(this.state,$('profileExportScope').value==='current'?this.state.activeId:null);
    const url = URL.createObjectURL(new Blob([data],{type:'application/json'})), a = document.createElement('a');
    a.href = url;a.download = 'splitter-profiles.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
  async importFile() {
    const file = $('profileFile').files[0];if (!file) return;
    const status = $('profileImportStatus');status.textContent = '';
    $('profileImportAdjustments').hidden = true;$('profileCancel').textContent = 'Cancel';
    try {
      if (file.size>MAX_FILE_BYTES) throw Error('Profile file must be 256 kB or smaller.');
      const r = importProfiles(await file.text(),this.state,this.printers);
      if (!this.commit(r.state)) throw Error(this.error);
      status.textContent = `Imported ${r.count} ${r.count===1?'profile':'profiles'}: ${r.names.join(', ')}. Current settings unchanged.${r.warnings.length?' Adjusted values are listed below.':''}`;
      $('profileImportAdjustments').hidden = !r.warnings.length;
      $('profileImportWarnings').replaceChildren(...r.warnings.map(w=>{const li=document.createElement('li');li.textContent=w;return li;}));
      $('profileCancel').textContent = 'Done';
    } catch (e) { status.textContent = e.message; }
  }
}

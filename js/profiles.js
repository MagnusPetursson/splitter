// Printer/material data only. No DOM, network, geometry or model preferences.
// v1 deliberately exports names + settings, not browser-local ids/selection.
export const PROFILE_KEY = 'ps.profiles';
export const MAX_FILE_BYTES = 262144;
export const FIT_KEYS = ['press', 'glue', 'slip', 'snap', 'seam'];
const STYLES = ['glued','filament','pegs','keyed','finger','tongue','lap','press','snap','magnets','dovetail','screws','bolts'];
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const empty = () => ({version:1, activeId:null, profiles:[]});
const base = () => ({printer:'prusa-core-one',bedX:250,bedY:220,bedZ:270,nozzle:.4,margin:3,minPiece:15,style:'glued',fits:{press:.05,glue:.15,slip:.2,snap:.25,seam:.15}});
export function profileName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(value)) throw Error('Use a profile name of 1–80 characters, without control characters.');
  return value.trim();
}
export function normalizeSettings(raw, printers) {
  if (!object(raw) || !object(raw.fits)) throw Error('A profile needs printer settings and all five fit clearances.');
  const warnings = [];
  const number = (v, key) => {
    if (!(typeof v === 'number' || typeof v === 'string' && v.trim() !== '') || !Number.isFinite(Number(v)) || Number(v) < 0) throw Error(`Invalid ${key}: use a finite, non-negative number.`);
    return Number(v);
  };
  const adjust = (value, next, key) => { if (value !== next) warnings.push(`${({bedX:'Bed X (mm)',bedY:'Bed Y (mm)',bedZ:'Bed Z (mm)',minPiece:'Minimum piece (mm)'}[key] || key)}: ${value} → ${next}`); return next; };
  const bound = (v, min, max, key) => adjust(v, Math.max(min, Math.min(max, v)), key);
  if (typeof raw.printer !== 'string') throw Error('A profile needs a printer id.');
  const preset = printers.find(p => p.id === raw.printer);
  const s = {printer:preset ? preset.id : 'custom'};
  if (!preset && raw.printer !== 'custom') warnings.push(`Unknown printer “${raw.printer}”: using custom volume`);
  for (const axis of ['X','Y','Z']) {
    const key = 'bed' + axis, v = number(raw[key], key);
    s[key] = preset ? adjust(v, preset[axis.toLowerCase()], key) : bound(v,20,2000,key);
  }
  const nozzle = number(raw.nozzle,'nozzle');
  s.nozzle = adjust(nozzle,[.25,.4,.6,.8].includes(nozzle) ? nozzle : .4,'nozzle');
  let margin = number(raw.margin,'margin');
  // Planner fallbacks: tree.go Settings.Normalize. Also leave positive usable
  // space for small custom beds (the planner does not guard that combination).
  margin = adjust(margin, margin > 40 ? 3 : margin, 'margin');
  s.margin = bound(margin,0,Math.max(0,Math.min(s.bedX/2,s.bedY/2,s.bedZ)-1),'margin');
  const min = number(raw.minPiece,'minPiece');
  s.minPiece = adjust(min,min === 0 ? 15 : Math.max(3,Math.min(200,min)),'minPiece');
  if (!STYLES.includes(raw.style)) throw Error('Unknown joint style.');
  s.style = raw.style;
  const defaults = base().fits, extra = s.nozzle >= .55 ? .05 : 0;
  s.fits = {};
  for (const key of FIT_KEYS) {
    const value = number(raw.fits[key],`fits.${key}`);
    // joints.go FitTable.normalize: zero or >2 means use the nozzle default.
    s.fits[key] = adjust(value,value === 0 || value > 2 ? Math.round((defaults[key]+extra)*100)/100 : value,`fits.${key}`);
  }
  return {settings:s, warnings};
}
function validateRecord(p, printers) {
  if (!object(p)) throw Error('Invalid profile record.');
  const name = profileName(p.name), r = normalizeSettings(p.settings,printers);
  return {name, settings:r.settings, warnings:r.warnings};
}
export function readProfiles(storage, printers) {
  const text = storage.getItem(PROFILE_KEY);
  let state = empty();
  if (text !== null) {
    const raw = JSON.parse(text);
    if (!object(raw) || raw.version !== 1) throw Error('Unsupported saved profile version. Export or back up browser storage before changing it.');
    if (!Array.isArray(raw.profiles) || raw.profiles.length > 100) throw Error('Invalid saved profile list.');
    const ids = new Set();
    const profiles = raw.profiles.map(p => {
      const r = validateRecord(p,printers);
      if (typeof p.id !== 'string' || !p.id || p.id.length > 100 || ids.has(p.id)) throw Error('Invalid saved profile id.');
      ids.add(p.id);return {id:p.id,name:r.name,settings:r.settings};
    });
    state = {version:1,activeId:ids.has(raw.activeId) ? raw.activeId : null,profiles};
  }
  // Lazy, lossless migration: keep ps.settings intact, create no named profile.
  // Last-used model preferences remain in ps.settings, outside the profile.
  let last = null;
  const oldText = storage.getItem('ps.settings');
  if (oldText !== null) {
    let old;
    try { old = JSON.parse(oldText); } catch { old = {}; }
    if (!object(old)) old = {};
    const defaults = base(), numeric = v => (typeof v === 'number' || typeof v === 'string' && v.trim() !== '') && Number.isFinite(Number(v)) && Number(v) >= 0;
    const working = {...defaults,...old,fits:{...defaults.fits,...(object(old.fits)?old.fits:{})}};
    // Old fields were stored on change, even while invalid. Repair the working
    // copy only; one broken legacy field must not disable a valid profile list.
    for (const key of ['bedX','bedY','bedZ','nozzle','margin','minPiece']) if (!numeric(working[key])) working[key] = defaults[key];
    for (const key of FIT_KEYS) if (!numeric(working.fits[key])) working.fits[key] = 0; // nozzle default
    if (typeof working.printer !== 'string') working.printer = defaults.printer;
    if (!STYLES.includes(working.style)) working.style = defaults.style;
    const r = normalizeSettings(working,printers);
    last = {...old,...r.settings};
  }
  return {state,last};
}
export function importProfiles(text, state, printers) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw Error('Profile file must be 256 kB or smaller.');
  let raw;
  try { raw = JSON.parse(text); } catch { throw Error('Invalid JSON. Choose a Splitter profile export.'); }
  if (!object(raw) || raw.format !== 'splitter-profiles' || raw.version !== 1) throw Error('Expected a Splitter profiles file, version 1.');
  if (!Array.isArray(raw.profiles) || !raw.profiles.length) throw Error('The file contains no profiles.');
  if (raw.profiles.length + state.profiles.length > 100) throw Error('Keep at most 100 profiles in this browser.');
  // Validate everything before making any change. Import never overwrites.
  const records = raw.profiles.map(p => validateRecord(p,printers));
  const names = new Set(state.profiles.map(p => p.name)), warnings = [];
  const added = records.map(r => {
    let name = r.name, n = 2;
    while (names.has(name)) { const suffix = ` (${n++})`; name = r.name.slice(0,80-suffix.length) + suffix; }
    names.add(name);warnings.push(...r.warnings.map(w => `${name}: ${w}`));
    return {id:crypto.randomUUID(),name,settings:r.settings};
  });
  return {state:{...state,profiles:[...state.profiles,...added]},count:added.length,names:added.map(p=>p.name),warnings};
}
export function exportProfiles(state, id = null) {
  const selected = id === null ? state.profiles : state.profiles.filter(p=>p.id===id);
  if (!selected.length) throw Error('No saved profiles to export.');
  return JSON.stringify({format:'splitter-profiles',version:1,profiles:selected.map(({name,settings})=>({name,settings}))},null,2) + '\n';
}

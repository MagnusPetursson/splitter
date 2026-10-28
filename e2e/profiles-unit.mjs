// Pure browser-storage contract, exercised without a DOM or a planner mock.
import {test} from 'node:test';
import assert from 'node:assert/strict';
const moduleURL = new URL('../web/js/profiles.js', import.meta.url);
const api = await import(moduleURL).catch(e => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
  return {}; // Baseline: no profile feature yet; fail on the missing contract below.
});
const printers = [{id:'prusa-mini', x:180,y:180,z:180,nozzle:.4}, {id:'prusa-core-one',x:250,y:220,z:270,nozzle:.4}];
const settings = {printer:'prusa-mini',bedX:180,bedY:180,bedZ:180,nozzle:.6,margin:3,minPiece:15,style:'glued',fits:{press:.11,glue:.21,slip:.26,snap:.31,seam:.22}};
const memory = (initial={}) => { const data = new Map(Object.entries(initial)); return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}; };
const file = (profiles,version=1) => JSON.stringify({format:'splitter-profiles',version,profiles});
const normalize = s => api.normalizeSettings(s,printers).settings;

test('profiles expose normalisation, migration, safe import and export contracts',()=>{
  for(const k of ['normalizeSettings','readProfiles','importProfiles','exportProfiles']) assert.equal(typeof api[k],'function',`Missing profile behaviour: ${k}`);
});
test('retains independent nozzle and all five measured fits, excludes model state',()=>{
  assert.deepEqual(normalize({...settings,upright:true,tilted:true,supportWeight:1,model:'private.stl',plan:{},scale:3}),settings);
});
test('known preset uses its manufacturer volume, not an injected bed',()=>{
  assert.equal(normalize({...settings,bedX:999}).bedX,180);
});
test('unknown or removed printer keeps the custom bed and nozzle',()=>{
  assert.deepEqual(normalize({...settings,printer:'prusa-mini-06',bedX:185}),{...settings,printer:'custom',bedX:185});
});
test('normalisation matches planner fallbacks, applies UI volume limits and prevents an unusable margin',()=>{
  const r=api.normalizeSettings({...settings,printer:'custom',bedX:4,bedY:9000,margin:400,minPiece:999,fits:{...settings.fits,press:0,glue:3}},printers);
  assert.equal(r.settings.bedX,20);assert.equal(r.settings.bedY,2000);assert.equal(r.settings.margin,3);assert.equal(r.settings.minPiece,200);
  assert.equal(r.settings.fits.press,.1);assert.equal(r.settings.fits.glue,.2);assert.ok(r.warnings.length);
  assert.ok(normalize({...settings,printer:'custom',bedX:20,margin:30}).margin < 10);
});
test('rejects non-finite, negative and nonnumeric profile values',()=>{
  for(const v of [NaN,Infinity,-1,'garbage',null,{},true]) assert.throws(()=>normalize({...settings,margin:v}),/margin/i);
});
test('legacy strings migrate without creating a personal profile or losing last-used state',()=>{
  const legacy={...settings,nozzle:'0.6',margin:'0',upright:true,supportWeight:0,fits:{...settings.fits,press:'0.11'}};
  const raw=JSON.stringify(legacy),store=memory({'ps.settings':raw});
  const r=api.readProfiles(store,printers);
  assert.deepEqual(r.state,{version:1,activeId:null,profiles:[]});assert.equal(r.last.nozzle,.6);assert.equal(r.last.margin,0);assert.equal(r.last.upright,true);assert.equal(r.last.supportWeight,0);
  assert.equal(store.getItem('ps.settings'),raw);assert.equal(store.getItem('ps.profiles'),null);
});
test('empty browser ships zero profiles',()=>assert.deepEqual(api.readProfiles(memory(),printers).state.profiles,[]));
test('migration preserves zero fits in the legacy record, normalises the working values',()=>{
  const raw=JSON.stringify({...settings,fits:{...settings.fits,press:0}}),store=memory({'ps.settings':raw});
  assert.equal(api.readProfiles(store,printers).last.fits.press,.1);assert.equal(store.getItem('ps.settings'),raw);
});
test('import adds copies with collision-safe names and fresh ids; does not apply or overwrite',()=>{
  const existing={version:1,activeId:'keep',profiles:[{id:'keep',name:'MINI · PETG',settings}]};
  const r=api.importProfiles(file([{name:'MINI · PETG',settings},{name:'MINI · PETG',settings}]),existing,printers);
  assert.equal(r.state.activeId,'keep');assert.equal(r.state.profiles.length,3);assert.equal(r.state.profiles[1].name,'MINI · PETG (2)');assert.equal(r.state.profiles[2].name,'MINI · PETG (3)');
  assert.equal(new Set(r.state.profiles.map(p=>p.id)).size,3);assert.equal(existing.profiles.length,1);assert.equal(r.count,2);
});
test('malformed, wrong-version and incomplete import is atomic',()=>{
  const state={version:1,activeId:null,profiles:[]};
  for(const text of ['not json','null','{}',file([],2),file([]),file([{name:'',settings}]),file([{name:'ok',settings},{name:'bad',settings:{}}]),file([{name:'bad',settings:{...settings,nozzle:'NaN'}}])]) assert.throws(()=>api.importProfiles(text,state,printers));
  assert.equal(state.profiles.length,0);
});
test('finite out-of-range import reports adjustments',()=>{
  const r=api.importProfiles(file([{name:'Large',settings:{...settings,printer:'custom',bedZ:99999}}]),{version:1,activeId:null,profiles:[]},printers);
  assert.equal(r.state.profiles[0].settings.bedZ,2000);assert.ok(r.warnings.length);
});
test('bounds file size, profile count and name length',()=>{
  const state={version:1,activeId:null,profiles:[]};
  for(const text of [' '.repeat(262145),file(Array.from({length:101},()=>({name:'x',settings}))),file([{name:'x'.repeat(81),settings}])]) assert.throws(()=>api.importProfiles(text,state,printers));
});
test('exports one or all saved profiles, never current model or local identifiers',()=>{
  const state={version:1,activeId:'a',profiles:[{id:'a',name:'A',settings},{id:'b',name:'B',settings}]};
  const one=JSON.parse(api.exportProfiles(state,'a')),all=JSON.parse(api.exportProfiles(state));
  assert.deepEqual(one,{format:'splitter-profiles',version:1,profiles:[{name:'A',settings}]});assert.equal(all.profiles.length,2);
  assert.throws(()=>api.exportProfiles(state,'missing'));
});
test('names and unknown properties are inert data, not markup or prototype assignments',()=>{
  const payload=JSON.parse(file([{name:'<img src=x onerror=alert(1)>',settings}]));
  payload.profiles[0].settings=JSON.parse(JSON.stringify(settings).replace('{','{"__proto__":{"polluted":true},'));
  const r=api.importProfiles(JSON.stringify(payload),{version:1,activeId:null,profiles:[]},printers);
  assert.equal(r.state.profiles[0].name,'<img src=x onerror=alert(1)>');assert.equal({}.polluted,undefined);assert.equal(Object.hasOwn(r.state.profiles[0].settings,'__proto__'),false);
});
test('broken legacy fields cannot disable valid saved profiles or overwrite the legacy source',()=>{
  const state={version:1,activeId:'a',profiles:[{id:'a',name:'Saved',settings}]};
  for(const raw of ['not json',JSON.stringify({...settings,margin:-5,nozzle:'broken',fits:{...settings.fits,glue:null}})]) {
    const store=memory({'ps.profiles':JSON.stringify(state),'ps.settings':raw});
    const r=api.readProfiles(store,printers);
    assert.equal(r.state.profiles[0].name,'Saved');assert.equal(r.last.margin,3);assert.equal(r.last.nozzle,.4);assert.equal(r.last.fits.glue,.15);
    assert.equal(store.getItem('ps.settings'),raw);
  }
});

test('corrupt or future storage is not silently overwritten',()=>{
  const store=memory({'ps.profiles':'{"version":99,"profiles":[]}'});
  assert.throws(()=>api.readProfiles(store,printers),/version/i);assert.equal(store.getItem('ps.profiles'),'{"version":99,"profiles":[]}');
});

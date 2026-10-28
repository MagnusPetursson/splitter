// Browser contract: native controls, persistence, imports and coupon calibration.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.SPLITTER_PLAYWRIGHT||'playwright');
const axeSrc=fs.readFileSync(process.env.SPLITTER_AXE||require.resolve('axe-core/axe.min.js'),'utf8');
const [url,out='evidence/profiles']=process.argv.slice(2);
if(!url) throw Error('usage: profiles URL OUTDIR');
fs.mkdirSync(out,{recursive:true});
const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader',...(process.env.SPLITTER_HOST_RESOLVER_RULES?['--host-resolver-rules='+process.env.SPLITTER_HOST_RESOLVER_RULES]:[])]});
const report={checks:[],errors:[]};
const ok=(v,m)=>{assert.ok(v,m);report.checks.push(m);};
const saved=p=>p.evaluate(()=>JSON.parse(localStorage.getItem('ps.profiles')));
const legacy={printer:'prusa-mini',bedX:'180',bedY:'180',bedZ:'180',nozzle:'0.6',margin:'0',minPiece:'17',style:'press',upright:true,tilted:true,supportWeight:0,fits:{press:'0.11',glue:'0.21',slip:'0.26',snap:'0.31',seam:'0.22'}};
try{
for(const [device,viewport] of [['desktop',{width:1440,height:900}],['phone',{width:390,height:844}]]){
 const ctx=await b.newContext({viewport,isMobile:device==='phone',hasTouch:device==='phone',reducedMotion:'reduce',acceptDownloads:true});
 const p=await ctx.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>report.errors.push(device+': '+e.message));
 await p.goto(url);await p.waitForFunction(()=>window.__ps?.workerReady&&document.querySelector('#printer').options.length>5);
 ok(await p.locator('#profilePicker').count()===1,`${device}: profile picker exists`);
 await p.click('[data-sample="bracket_320mm.stl"]');await p.waitForFunction(()=>document.body.dataset.step==='fit'&&document.querySelector('#busy.hidden'));
 const sheet=async()=>{if(await p.locator('#sheetToggle[aria-expanded=false]').isVisible())await p.click('#sheetToggle');};await sheet();
 const shot=async n=>p.screenshot({path:path.join(out,device+'-'+n+'.png')});
 const audit=async n=>{
  await p.addScriptTag({content:axeSrc});const v=await p.evaluate(async()=>(await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa','best-practice']}})).violations.map(v=>v.id+':'+v.nodes.length));ok(!v.length,`${device}/${n}: axe zero (${v})`);
  ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${device}/${n}: no horizontal page overflow`);
 };
 const menu=async()=>{await p.click('#profileManage');await p.locator('#profileDialog').waitFor({state:'visible'});};
 const name=async(action,value)=>{await menu();await p.click(action);await p.fill('#profileName',value);await p.click('#profileNameSubmit');};
 ok(await p.locator('#profilePicker option').count()===1,`${device}: no shipped profiles`);
 await p.locator('#printerAdvanced > summary').click();await p.selectOption('#printer','prusa-mini');await p.selectOption('#nozzle','0.6');
 await name('#profileSaveAs','MINI · 0.6 · PETG');
 let state=await saved(p),id=state.activeId;ok(state.profiles.length===1&&state.profiles[0].settings.nozzle===.6,`${device}: saves manufacturer preset with separate nozzle`);
 await shot('picker');await audit('picker');
 await menu();await shot('menu');await audit('menu');await p.keyboard.press('Escape');
 ok(await p.locator('#profileManage').evaluate(e=>e===document.activeElement),`${device}: Escape returns focus to opener`);
 await p.fill('#margin','5');await p.locator('#margin').press('Tab');
 ok((await p.locator('#profileStatus').innerText()).includes('Modified'),`${device}: editing marks profile modified`);
 await p.click('#profileSave');ok((await saved(p)).profiles[0].settings.margin===5,`${device}: Save commits edits`);
 await p.fill('#margin','6');await p.locator('#margin').press('Tab');await p.reload();await p.waitForFunction(()=>window.__ps?.workerReady);
 ok(await p.inputValue('#nozzle')==='0.6'&&await p.inputValue('#margin')==='6',`${device}: reload keeps unsaved last-used values and independent nozzle`);
 ok((await saved(p)).profiles[0].settings.margin===5,`${device}: unsaved edit never overwrites profile`);
 await p.click('[data-sample="bracket_320mm.stl"]');await p.waitForFunction(()=>document.body.dataset.step==='fit'&&document.querySelector('#busy.hidden'));await sheet();
 ok((await p.locator('#profileStatus').innerText()).includes('Modified'),`${device}: modified state survives reload`);
 await p.selectOption('#profilePicker','');await p.selectOption('#profilePicker',id);ok(await p.inputValue('#margin')==='5',`${device}: selection applies saved values`);
 await name('#profileRename','PETG calibrated');ok((await saved(p)).profiles[0].name==='PETG calibrated',`${device}: rename persists`);
 await menu();await p.click('#profileExport');
 const download=p.waitForEvent('download');await p.click('#profileDownload');const dl=await download;
 ok(dl.suggestedFilename()==='splitter-profiles.json',`${device}: export filename`);const exportPath=path.join(out,device+'-export.json');await dl.saveAs(exportPath);
 const data=JSON.parse(fs.readFileSync(exportPath,'utf8'));ok(data.version===1&&data.profiles.length===1&&data.profiles[0].settings.fits.snap===.3,`${device}: exported saved profile JSON`);
 ok(!JSON.stringify(data).includes('upright')&&!JSON.stringify(data).includes('activeId'),`${device}: export excludes model state and storage identifiers`);
 await p.keyboard.press('Escape');
 const upload=async text=>{await menu();await p.click('#profileImport');await p.locator('#profileFile').setInputFiles({name:'profiles.json',mimeType:'application/json',buffer:Buffer.from(text)});};
 await upload('not JSON');ok((await p.locator('#profileImportStatus').innerText()).includes('Invalid JSON'),`${device}: malformed JSON rejected visibly`);ok((await saved(p)).profiles.length===1,`${device}: malformed import does not change profiles`);await shot('import-error');await audit('import-error');await p.keyboard.press('Escape');
 await upload(JSON.stringify({...data,profiles:[data.profiles[0],{name:'Custom test',settings:{...data.profiles[0].settings,printer:'not-a-printer',bedX:99999}}]}));
 ok((await p.locator('#profileImportStatus').innerText()).includes('Imported 2 profiles'),`${device}: import reports count`);
 ok((await p.locator('#profileImportStatus').innerText()).includes('Adjusted'),`${device}: import reports normalisation`);
 state=await saved(p);ok(state.profiles.length===3&&state.profiles[2].settings.bedX===2000&&state.profiles[2].settings.printer==='custom',`${device}: unknown printer becomes custom and out-of-range volume clamps`);
 ok(state.profiles[1].name==='PETG calibrated (2)'&&state.activeId===id,`${device}: import does not overwrite or apply`);await shot('import');await audit('import');await p.keyboard.press('Escape');
 await p.selectOption('#profilePicker',state.profiles[2].id);ok(await p.inputValue('#bedX')==='2000',`${device}: imported custom profile applies`);await p.selectOption('#profilePicker',id);
 // Real coupon generation, followed by the measured-clearance entry point.
 await p.click('#expertMode');await p.locator('.coupon > summary').click();await p.click('#couponBtn');await p.waitForSelector('#couponInfo a[download$=".zip"]',{timeout:120000});
 await p.click('#couponEnterFits');
 ok(await p.locator('.fits').getAttribute('open')!==null,`${device}: coupon opens fit clearance inputs`);
 await p.fill('[data-fit=press]','0.13');await p.fill('[data-fit=glue]','0.23');await p.locator('[data-fit=glue]').press('Tab');
 ok(await p.locator('#saveMeasuredFits').isVisible(),`${device}: measured fits offer profile save`);
 await p.click('#saveMeasuredFits');state=await saved(p);ok(state.profiles.find(x=>x.id===id).settings.fits.press===.13&&state.profiles.find(x=>x.id===id).settings.fits.glue===.23,`${device}: coupon measurements saved to current profile`);
 await shot('coupon-saved');
 // Delete must require a second, explicit confirmation; cancelling changes nothing.
 await menu();await p.click('#profileDelete');await p.click('#profileCancel');ok((await saved(p)).profiles.length===3,`${device}: delete cancellation preserves profile`);
 await menu();await p.click('#profileDelete');await p.click('#profileDeleteConfirm');ok((await saved(p)).profiles.length===2&&(await saved(p)).activeId===null,`${device}: confirmed delete removes selected profile only`);
 await p.reload();await p.waitForFunction(()=>window.__ps?.workerReady);ok((await saved(p)).profiles.length===2,`${device}: deletion persists`);
 await ctx.close();
 // Migration on an independent browser context, before any profile record exists.
 const migration=await b.newContext({viewport});await migration.addInitScript(old=>{if(!sessionStorage.getItem('seeded')){localStorage.setItem('ps.settings',JSON.stringify(old));sessionStorage.setItem('seeded','1');}},legacy);
 const q=await migration.newPage();await q.goto(url);await q.waitForFunction(()=>window.__ps?.workerReady);
 ok(await q.inputValue('#nozzle')==='0.6'&&await q.inputValue('#margin')==='0'&&await q.inputValue('[data-fit=press]')==='0.11',`${device}: legacy migration retains nozzle, zero margin and measured fits`);
 ok(await q.isChecked('#upright')&&await q.inputValue('#supportWeight')==='0',`${device}: legacy model-specific preferences kept outside profiles`);
 ok(await q.evaluate(()=>localStorage.getItem('ps.settings')===JSON.stringify({printer:'prusa-mini',bedX:'180',bedY:'180',bedZ:'180',nozzle:'0.6',margin:'0',minPiece:'17',style:'press',upright:true,tilted:true,supportWeight:0,fits:{press:'0.11',glue:'0.21',slip:'0.26',snap:'0.31',seam:'0.22'}})),`${device}: migration leaves legacy record intact`);
 await migration.close();
}
ok(!report.errors.length,'no browser errors');
}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await b.close();}
console.log(JSON.stringify(report,null,2));

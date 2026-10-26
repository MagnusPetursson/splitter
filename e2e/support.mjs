// Exercise the real WASM/UI + Manifold/export path for the support tradeoff.
// node e2e/support.mjs URL MODEL_PATH OUTDIR
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const [url,model,out='support-out']=process.argv.slice(2);
fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',...(process.env.SPLITTER_HOST_RESOLVER_RULES ? ['--host-resolver-rules='+process.env.SPLITTER_HOST_RESOLVER_RULES] : [])]});
const ctx=await browser.newContext({viewport:{width:1600,height:1000},acceptDownloads:true});
const page=await ctx.newPage();
const errors=[];
page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.error(m.text());}});
const idle=()=>page.waitForFunction(()=>document.querySelector('#busy').classList.contains('hidden'),null,{timeout:900000});
const ready=()=>page.waitForFunction(()=>document.querySelector('#printer').options.length>5,null,{timeout:60000});
const slider=async w=>{await page.locator('#supportWeight').fill(String(w));await page.locator('#supportWeight').dispatchEvent('input');};
const shot=async name=>{await page.locator('.support-control').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,name+'.png')});};
const results=[];
const ticker=setInterval(async()=>{try{console.log('progress',await page.locator('#busyText').textContent());}catch{}},30000);
try {
 await page.goto(url,{waitUntil:'networkidle'});await ready();
 assert.equal(await page.inputValue('#supportWeight'),'0.5');
 // Zero must survive storage, not be mistaken for a missing value.
 await slider(0);await page.reload({waitUntil:'networkidle'});await ready();
 assert.equal(await page.inputValue('#supportWeight'),'0');
 await page.click('#resetDefaults');assert.equal(await page.inputValue('#supportWeight'),'0.5');
 await page.setInputFiles('#fileInput',model);
 await page.waitForFunction(()=>window.__ps.model&&window.__ps.workerReady,null,{timeout:300000});await idle();
 for(const [name,weight] of [['old',0],['new',0.5]]) {
  await slider(weight);
  if(name==='new')assert.ok(await page.locator('#supportPending').isVisible());
  const seq=await page.evaluate(()=>window.__ps.planSeq);
  await page.click('#autoSplit');
  await page.waitForFunction(({seq,weight})=>window.__ps.planSeq>seq&&window.__ps.plan?.settings.supportWeight===weight&&document.querySelector('#busy').classList.contains('hidden'),{seq,weight},{timeout:900000});
  const plan=await page.evaluate(()=>window.__ps.plan);
  assert.equal(plan.settings.supportWeight,weight);assert.equal(plan.fits,true);
  fs.writeFileSync(path.join(out,name+'-plan.json'),JSON.stringify(plan,null,2));
  await shot(name+'-plan');
  await page.click('#buildBtn');await page.waitForFunction(()=>window.__ps.built,null,{timeout:900000});await idle();
  const built=await page.evaluate(()=>({parts:window.__ps.built.parts.map(p=>({id:p.id,status:p.status,triangles:p.tris})),verification:window.__ps.built.verify}));
  assert.ok(built.parts.length>0);assert.ok(built.parts.every(p=>p.status==='NoError'));
  await shot(name+'-built');
  await page.click('#exportBtn');await page.waitForFunction(()=>window.__ps.export,null,{timeout:900000});await idle();
  const ex=await page.evaluate(()=>window.__ps.export);
  const [download]=await Promise.all([page.waitForEvent('download'),page.click(`#exportInfo a[download="${ex.zip}"]`)]);
  await download.saveAs(path.join(out,name+'.zip'));
  await page.click('[data-view="plates"]');await shot(name+'-plates');
  const summary={name,weight,parts:plan.leaves.filter(l=>!l.empty).length,supportProxyCM3:plan.leaves.reduce((s,l)=>s+l.supportVolume,0)/1000,fits:plan.fits,timing:plan.timing,built,exportFiles:ex.files.length,plates:ex.plates};
  results.push(summary);console.log(JSON.stringify(summary));
 }
 assert.ok(results[1].supportProxyCM3<results[0].supportProxyCM3);
 assert.ok(results[1].parts>results[0].parts);
 await page.setViewportSize({width:412,height:915});
 await page.locator('.support-control').scrollIntoViewIfNeeded();
 const sliderBox=await page.locator('#supportWeight').boundingBox();
 assert.ok(sliderBox && sliderBox.y>=0 && sliderBox.y+sliderBox.height<=915,'slider is inside phone viewport');
 await page.mouse.click(sliderBox.x+sliderBox.width*0.75,sliderBox.y+sliderBox.height/2);
 assert.notEqual(await page.inputValue('#supportWeight'),'0.5','real phone-sized pointer changes preference');
 assert.ok(await page.locator('#supportPending').isVisible());
 await shot('phone-control');
 await slider(0.5); await page.click('[data-view="plates"]');await shot('phone');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'phone horizontal overflow');
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
 console.log('PASS support UI, persistence, WASM, build and export');
} catch(e) {await page.screenshot({path:path.join(out,'failure.png')});throw e;}
finally {clearInterval(ticker);await browser.close();}

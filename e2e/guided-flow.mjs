// Guided-flow contract. Uses the real WASM, geometry worker and download.
// SPLITTER_PLAYWRIGHT=/path/to/playwright-core node e2e/guided-flow.mjs URL OUT
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.SPLITTER_PLAYWRIGHT || 'playwright');
const [url='http://127.0.0.1:8792/',out='evidence/flow']=process.argv.slice(2);
fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader',...(process.env.SPLITTER_HOST_RESOLVER_RULES?['--host-resolver-rules='+process.env.SPLITTER_HOST_RESOLVER_RULES]:[])]});
const page=await browser.newPage({viewport:{width:1440,height:900},acceptDownloads:true});
const errors=[],report={url,errors,actions:[]};
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const ready=()=>page.waitForFunction(()=>window.__ps?.workerReady&&document.querySelector('#busy').classList.contains('hidden'),null,{timeout:300000});
const idle=()=>page.waitForFunction(()=>document.querySelector('#busy').classList.contains('hidden'),null,{timeout:600000});
// Find the target via real Tab events, never DOM focus(), click(), or scripted handlers.
async function keyActivate(selector) {
 for(let i=0;i<180;i++) {
  if(await page.locator(selector).evaluate(e=>document.activeElement===e)) {
   report.actions.push(selector);await page.keyboard.press('Enter');return;
  }
  await page.keyboard.press('Tab');
 }
 throw Error(`Keyboard cannot reach ${selector}`);
}
try {
 await page.goto(url,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>document.querySelector('#printer').options.length>5);
 assert.equal(await page.locator('#flowNav button').count(),5,'five visible workflow steps');
 assert.equal(await page.locator('#expertMode').getAttribute('aria-pressed'),'false');
 assert.ok(await page.locator('[data-step="export"]').isDisabled(),'export is gated before a plan');
 await page.screenshot({path:path.join(out,'desktop-load.png')});
 await keyActivate('[data-sample="bracket_320mm.stl"]');await ready();
 await keyActivate('#flowNext');
 assert.equal(await page.locator('body').getAttribute('data-step'),'fit');
 await keyActivate('#flowNext');
 assert.equal(await page.locator('body').getAttribute('data-step'),'split');
 await keyActivate('#autoSplit');
 await page.waitForFunction(()=>window.__ps.plan,null,{timeout:600000});await idle();
 assert.ok(await page.evaluate(()=>window.__ps.plan.fits));
 await page.screenshot({path:path.join(out,'desktop-split.png')});
 await keyActivate('#flowNext');
 assert.equal(await page.locator('body').getAttribute('data-step'),'join');
 await keyActivate('#openEditor');
 assert.equal(await page.locator('#jointDlg').getAttribute('aria-hidden'),'false');
 await page.keyboard.press('Tab');
 assert.notEqual(await page.evaluate(()=>document.activeElement.id),'jdMap','Tab must leave canvas, not trap keyboard');
 await page.keyboard.press('Escape');
 await keyActivate('#flowNext');
 await keyActivate('#buildBtn');
 await page.waitForFunction(()=>window.__ps.built,null,{timeout:600000});await idle();
 assert.ok(await page.evaluate(()=>window.__ps.built.parts.every(p=>p.status==='NoError')));
 await keyActivate('#exportBtn');
 await page.waitForFunction(()=>window.__ps.export,null,{timeout:600000});await idle();
 const ex=await page.evaluate(()=>({zip:window.__ps.export.zip,files:window.__ps.export.files,parts:window.__ps.built.parts.length}));
 const download=page.waitForEvent('download');
 await keyActivate('#exportInfo a[download$=".zip"]');
 await (await download).saveAs(path.join(out,ex.zip));
 assert.ok(fs.statSync(path.join(out,ex.zip)).size>1000);
 report.export=ex;
 await page.screenshot({path:path.join(out,'desktop-export.png')});
 await keyActivate('#expertMode');
 assert.equal(await page.locator('#expertMode').getAttribute('aria-pressed'),'true');
 assert.equal(await page.evaluate(()=>window.__ps.built.parts.length),ex.parts,'mode preserves built parts');
 await page.screenshot({path:path.join(out,'desktop-expert.png')});
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:path.join(out,'phone-expert.png')});
 assert.deepEqual(errors,[]);
 console.log('PASS keyboard Load → Fit → Split → Join → Export, download, Expert state continuity');
} catch(e) {report.failure=e.message;await page.screenshot({path:path.join(out,'failure.png')});throw e;}
finally{fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));await browser.close();}

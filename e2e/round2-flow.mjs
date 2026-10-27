// Round 2: the guided path must perform work, not add confirmations.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {chromium} from 'playwright';
const [url='http://127.0.0.1:8792/',out='evidence/round2-flow']=process.argv.slice(2);fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader',...(process.env.SPLITTER_HOST_RESOLVER_RULES?['--host-resolver-rules='+process.env.SPLITTER_HOST_RESOLVER_RULES]:[])]});
const p=await browser.newPage({viewport:{width:1440,height:900},acceptDownloads:true});const report={actions:[],errors:[]};p.on('pageerror',e=>report.errors.push(e.message));
const idle=()=>p.waitForFunction(()=>document.querySelector('#busy').classList.contains('hidden'),null,{timeout:600000});
async function activate(selector){for(let i=0;i<220;i++){if(await p.locator(selector).evaluate(e=>document.activeElement===e)){report.actions.push(selector);await p.keyboard.press('Enter');return;}await p.keyboard.press('Tab');}throw Error('Keyboard cannot reach '+selector);}
try{
 await p.goto(url,{waitUntil:'networkidle'});await p.waitForFunction(()=>document.querySelector('#printer').options.length>5);
 await activate('[data-sample="bracket_320mm.stl"]');await p.waitForFunction(()=>window.__ps.workerReady);await idle();
 assert.equal(await p.locator('body').getAttribute('data-step'),'fit','loading automatically advances to the named printer');
 assert.match(await p.locator('#flowNext').innerText(),/Plan cuts for Prusa CORE One/);
 assert.match(await p.locator('#fitVerdict').innerText(),/Width.*320.*244/s,'fit card explains the exact failed dimension');
 assert.match(await p.locator('#fitReadout').innerText(),/each side.*top/s,'usable volume explains margins');
 await activate('#flowNext');await p.waitForFunction(()=>window.__ps.plan);await idle();
 assert.equal(await p.locator('body').getAttribute('data-step'),'join','automatic split lands on the meaningful review');
 assert.match(await p.locator('#readiness').innerText(),/checked.*valid/);
 await activate('#flowNext');await p.waitForFunction(()=>window.__ps.export,null,{timeout:600000});await idle();
 assert.equal(await p.locator('body').getAttribute('data-step'),'export');
 assert.ok(await p.evaluate(()=>window.__ps.built.parts.every(x=>x.status==='NoError')));
 const download=p.waitForEvent('download');await activate('#exportInfo a[download$=".zip"]');const dl=await download;await dl.saveAs(path.join(out,dl.suggestedFilename()));assert.ok(fs.statSync(path.join(out,dl.suggestedFilename())).size>1000);
 report.simpleActivations=report.actions.length;assert.ok(report.simpleActivations<=5,'sample to actual ZIP costs no more than five activations');
 const again=p.waitForEvent('download');await p.click('#flowNext');const repeated=await again;assert.equal(repeated.suggestedFilename(),dl.suggestedFilename(),'footer downloads the same prepared package');
 await p.click('[data-step="load"]');assert.match(await p.locator('#loadHeading').innerText(),/loaded/i);assert.equal(await p.locator('#drop').isVisible(),false);assert.match(await p.locator('#modelInfo').innerText(),/triangles.*watertight/s);assert.ok(await p.locator('#replaceModel').isVisible());assert.ok(await p.locator('#removeModel').isVisible());
 await p.screenshot({path:path.join(out,'desktop-loaded.png')});await p.setViewportSize({width:390,height:844});await p.screenshot({path:path.join(out,'phone-loaded.png')});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await p.click('#expertMode');assert.equal(await p.locator('#expertMode').getAttribute('aria-pressed'),'true');assert.ok(await p.evaluate(()=>!!window.__ps.export),'expert preserves export');
 await p.click('#removeModel');assert.equal(await p.locator('body').getAttribute('data-step'),'load');assert.ok(await p.locator('#drop').isVisible());assert.ok(await p.locator('[data-step="export"]').isDisabled());assert.equal(await p.evaluate(()=>window.__viewer.groups.model.children.length),0,'remove clears the actual model, not only its info');
 assert.deepEqual(report.errors,[]);console.log('PASS round-two keyboard workflow',JSON.stringify(report));
}catch(e){report.failure=e.message;await p.screenshot({path:path.join(out,'failure.png')});throw e;}finally{fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));await browser.close();}

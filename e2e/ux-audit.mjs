// Real-browser visual and accessibility audit across the complete guided flow.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.SPLITTER_PLAYWRIGHT||'playwright');
const axe=fs.readFileSync(process.env.SPLITTER_AXE||require.resolve('axe-core/axe.min.js'),'utf8');
const [url='http://127.0.0.1:8792/',out='evidence/audit']=process.argv.slice(2);fs.mkdirSync(out,{recursive:true});
const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader',...(process.env.SPLITTER_HOST_RESOLVER_RULES?['--host-resolver-rules='+process.env.SPLITTER_HOST_RESOLVER_RULES]:[])]});
const report={states:[],errors:[]};
const idle=p=>p.waitForFunction(()=>document.querySelector('#busy').classList.contains('hidden'),null,{timeout:600000});
async function audit(p,name) {
 await p.waitForTimeout(150);await p.addScriptTag({content:axe});
 const a=await p.evaluate(async()=>await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice']}}));
 const metrics=await p.evaluate(()=>{
  const controls=[...document.querySelectorAll('button,input,select,summary,a[href]')].filter(e=>e.checkVisibility({checkVisibilityCSS:true})&&!e.closest('dialog:not([open])')&&!e.classList.contains('skip'));
  const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};};
  return {overflow:document.documentElement.scrollWidth>innerWidth,rendered:controls.length,inViewport:controls.filter(e=>{const r=rect(e);return r.y>=0&&r.y+r.h<=innerHeight&&r.x>=0&&r.x+r.w<=innerWidth}).length,smallTargets:controls.filter(e=>{const t=e.type==='checkbox'?e.closest('label'):e;const r=rect(t);return r.w<43.9||r.h<43.9;}).map(e=>({id:e.id||e.textContent.trim().slice(0,50),rect:rect(e)}))};
 });
 const row={name,...metrics,violations:a.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),incomplete:a.incomplete.map(x=>({id:x.id,nodes:x.nodes.length}))};
 report.states.push(row);await p.screenshot({path:path.join(out,name+'.png')});
 console.log(name,JSON.stringify({violations:row.violations,overflow:row.overflow,smallTargets:row.smallTargets}));
}
try {
 for(const [device,width,height] of [['desktop',1440,900],['phone',390,844]]) {
  const ctx=await b.newContext({viewport:{width,height},isMobile:device==='phone',hasTouch:device==='phone',deviceScaleFactor:1});const p=await ctx.newPage();
  p.on('pageerror',e=>report.errors.push(device+': '+e.message));p.on('console',m=>{if(m.type()==='error')report.errors.push(device+': '+m.text());});
  await p.goto(url,{waitUntil:'networkidle'});await p.waitForFunction(()=>document.querySelector('#printer').options.length>5);
  await audit(p,device+'-load');
  if(device==='desktop'){await p.click('#helpBtn');await audit(p,'desktop-help');await p.keyboard.press('Escape');}
  await p.click('#licLink');await audit(p,device+'-licenses');await p.keyboard.press('Escape');
  await p.click('[data-sample="bracket_320mm.stl"]');await p.waitForFunction(()=>window.__ps.workerReady,null,{timeout:300000});await idle(p);
  await p.click('#flowNext');await audit(p,device+'-fit');
  await p.selectOption('#printer','prusa-mini');
  await p.click('#expertMode');await audit(p,device+'-fit-expert');await p.click('#expertMode');
  await p.click('#flowNext');await p.click('#autoSplit');await p.waitForFunction(()=>window.__ps.plan,null,{timeout:600000});await idle(p);
  await audit(p,device+'-split');
  if(device==='phone'){await p.click('#expandView');await audit(p,'phone-expanded');await p.keyboard.press('Escape');}
  // Select a real cut; keyboard offset applies to the same 3D plan.
  await p.locator('[data-cut]').first().click();
  const old=await p.inputValue('#cutOffsetNum');await p.locator('#cutOffsetNum').fill(String(+old+2));
  const seq=await p.evaluate(()=>window.__ps.planSeq);await p.click('#cutApply');
  await p.waitForFunction(s=>window.__ps.planSeq>s&&document.querySelector('#busy').classList.contains('hidden'),seq,{timeout:600000});
  assert.ok(await p.evaluate(()=>window.__ps.plan.tree.nodes.some(n=>n.locked&&n.reason==='moved by you')));
  await audit(p,device+'-cut-edit');
  await p.click('#flowNext');await audit(p,device+'-join');
  await p.click('#openEditor');await audit(p,device+'-joint-editor');
  await p.focus('#jdMap');await p.keyboard.press('ArrowRight');
  assert.ok(await p.evaluate(()=>window.__ps.sel.joint!=null));
  await p.keyboard.press('Tab');assert.notEqual(await p.evaluate(()=>document.activeElement.id),'jdMap');
  await p.keyboard.press('Escape');assert.equal(await p.locator('#jointDlg').getAttribute('aria-hidden'),'true');
  await p.click('#expertMode');await audit(p,device+'-join-expert');await p.click('#expertMode');
  await p.click('#flowNext');await p.click('#buildBtn');await p.waitForFunction(()=>window.__ps.built,null,{timeout:600000});await idle(p);
  await p.click('#exportBtn');await p.waitForFunction(()=>window.__ps.export,null,{timeout:600000});await idle(p);
  await audit(p,device+'-export');
  await p.click('[data-view="plates"]');await audit(p,device+'-plates');
  // Changing a printer must not quietly export an old plan for that printer.
  await p.click('[data-step="fit"]');await p.selectOption('#printer','prusa-core-one');
  assert.ok(await p.locator('#planStale').isVisible());assert.ok(await p.locator('[data-step="export"]').isDisabled());
  await p.emulateMedia({reducedMotion:'reduce'});await p.waitForFunction(()=>window.__viewer.controls.enableDamping===false);assert.equal(await p.evaluate(()=>window.__viewer.controls.enableDamping),false);
  await ctx.close();
 }
 assert.deepEqual(report.errors,[]);
 assert.equal(report.states.filter(s=>s.overflow).length,0,'no horizontal overflow');
 assert.equal(report.states.flatMap(s=>s.violations).length,0,'axe violations');
 assert.equal(report.states.flatMap(s=>s.smallTargets).length,0,'44px controls');
 console.log('PASS all responsive states, editing, reduced motion and accessibility');
} finally {fs.writeFileSync(path.join(out,'audit.json'),JSON.stringify(report,null,2));await b.close();}

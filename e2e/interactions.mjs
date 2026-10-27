// Pointer/keyboard interaction tests, guide integrity and an optional real mesh.
// node e2e/interactions.mjs URL OUT [PRIVATE_MODEL_PATH]
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.SPLITTER_PLAYWRIGHT||'playwright');
const [url='http://127.0.0.1:8792/',out='evidence/interactions',model]=process.argv.slice(2);fs.mkdirSync(out,{recursive:true});
const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});const p=await b.newPage({viewport:{width:1440,height:900},acceptDownloads:true});
const report={errors:[]};p.on('pageerror',e=>report.errors.push(e.message));p.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
const idle=()=>p.waitForFunction(()=>document.querySelector('#busy').classList.contains('hidden'),null,{timeout:900000});
const seq=()=>p.evaluate(()=>window.__ps.planSeq);
const replanned=async n=>{await p.waitForFunction(n=>window.__ps.planSeq>n&&document.querySelector('#busy').classList.contains('hidden'),n,{timeout:900000});};
try{
 await p.goto(url,{waitUntil:'networkidle'});await p.waitForFunction(()=>document.querySelector('#printer').options.length>5);
 await p.click('[data-sample="bracket_320mm.stl"]');await p.waitForFunction(()=>window.__ps.workerReady);await idle();
 await p.click('[data-step="split"]');await p.click('#autoSplit');await p.waitForFunction(()=>window.__ps.plan);await idle();
 await p.locator('[data-cut]').first().click();await p.waitForTimeout(200);
 const handle=await p.evaluate(()=>{
   const v=window.__viewer,canvas=v.renderer.domElement,r=canvas.getBoundingClientRect(),pts=[];
   v.scene.updateMatrixWorld(true);
   v.tcHelper.traverse(o=>{if(o.type==='Mesh'&&o.name==='Z'&&o.material?.opacity>0&&o.visible){o.geometry.computeBoundingBox();const c=o.geometry.boundingBox.getCenter(v.camera.position.clone());o.localToWorld(c);c.project(v.camera);pts.push({x:r.x+(c.x+1)*r.width/2,y:r.y+(1-c.y)*r.height/2});}});
   const origin=v.tcStart.pos.clone().project(v.camera),normal=v.camera.position.clone().set(0,0,1).applyQuaternion(v.tcObj.quaternion),n=v.tcStart.pos.clone().addScaledVector(normal,25).project(v.camera);
   return {pts,dx:(n.x-origin.x)*r.width/2,dy:-(n.y-origin.y)*r.height/2,old:window.__ps.plan.tree.nodes.find(n=>n.id===window.__ps.sel.cut).cut.d};
 });
 report.drag=handle;let dragged=false;
 for(const q of handle.pts){await p.mouse.move(q.x,q.y);await p.waitForTimeout(100);if(await p.evaluate(()=>window.__viewer.tc.axis==='Z')){const n=await seq();await p.mouse.down();await p.mouse.move(q.x+handle.dx,q.y+handle.dy,{steps:12});await p.mouse.up();await replanned(n);dragged=true;break;}}
 assert.ok(dragged,'actual pointer hits and drags the cut gizmo');
 report.drag.new=await p.evaluate(()=>window.__ps.plan.tree.nodes.find(n=>n.id===window.__ps.sel.cut).cut.d);assert.ok(Math.abs(report.drag.new-handle.old)>5);
 await p.screenshot({path:path.join(out,'desktop-dragged-cut.png')});
 await p.focus('#viewport canvas');const before=await p.evaluate(()=>window.__viewer.camera.position.toArray());await p.keyboard.press('ArrowRight');await p.waitForTimeout(150);assert.notDeepEqual(await p.evaluate(()=>window.__viewer.camera.position.toArray()),before,'keyboard orbits actual camera');await p.keyboard.press('f');
 await p.click('[data-step="join"]');await p.click('#openEditor');await p.focus('#jdMap');await p.keyboard.press('ArrowRight');
 const joint=await p.evaluate(()=>({id:window.__ps.sel.joint,p:window.__ps.plan.joints.find(j=>j.id===window.__ps.sel.joint).p}));const n=await seq();await p.keyboard.press('Shift+ArrowRight');await replanned(n);const moved=await p.evaluate(()=>window.__ps.plan.joints.find(j=>j.id===window.__ps.sel.joint).p);assert.ok(Math.abs(moved[0]-joint.p[0]-.5)<.01,'joint keyboard nudge is 0.5 mm');
 await p.focus('#jdMap');await p.keyboard.press('Alt+ArrowLeft');assert.notEqual(await p.evaluate(()=>window.__jed.map.pan[0]),0,'keyboard pans map');
 await p.keyboard.press('Escape');
 await p.click('[data-step="export"]');await p.click('.coupon summary');await p.click('#couponBtn');await p.waitForFunction(()=>document.querySelector('#couponInfo a'));await idle();
 const download=p.waitForEvent('download');await p.locator('#couponInfo a').first().click();await(await download).saveAs(path.join(out,'coupon.stl'));assert.ok(fs.statSync(path.join(out,'coupon.stl')).size>100);
 // The sidebar's last content can scroll above, not under, the fixed action row.
 await p.setViewportSize({width:390,height:844});await p.click('#expandView');await p.waitForTimeout(100);assert.equal(await p.locator('#expandView').getAttribute('aria-expanded'),'true');assert.ok((await p.locator('#viewport').boundingBox()).height>600);await p.screenshot({path:path.join(out,'phone-expanded-view.png')});await p.keyboard.press('Escape');assert.equal(await p.locator('#expandView').getAttribute('aria-expanded'),'false');await p.locator('#stepExport .context-help').scrollIntoViewIfNeeded();
 const bounds=await p.evaluate(()=>({help:document.querySelector('#stepExport .context-help').getBoundingClientRect().bottom,footer:document.querySelector('.flow-footer').getBoundingClientRect().top}));assert.ok(bounds.help<=bounds.footer,'phone final content is not occluded');report.phoneFooter=bounds;
 await p.screenshot({path:path.join(out,'phone-coupon.png')});
 // Guide has eight linked chapters and real screenshots, at both sizes.
 report.guide=[];
 for(const width of [1440,390]){await p.setViewportSize({width,height:width===390?844:900});await p.goto(new URL('guide.html',url).href,{waitUntil:'networkidle'});await p.evaluate(async()=>{for(const img of document.images){img.loading='eager';await img.decode();}});assert.equal(await p.locator('main section').count(),8);assert.ok(await p.evaluate(()=>[...document.images].every(i=>i.naturalWidth>0)));assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.addScriptTag({path:process.env.SPLITTER_AXE||createRequire(import.meta.url).resolve('axe-core/axe.min.js')});const a=await p.evaluate(async()=>await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}));report.guide.push({width,violations:a.violations});assert.equal(a.violations.length,0);await p.screenshot({path:path.join(out,'guide-'+width+'.png')});}
 if(model){
  await p.setViewportSize({width:1440,height:900});await p.goto(url,{waitUntil:'networkidle'});await p.waitForFunction(()=>document.querySelector('#printer').options.length>5);
  const t=Date.now();await p.setInputFiles('#fileInput',model);await p.waitForFunction(()=>window.__ps.workerReady,null,{timeout:900000});await idle();
  const loadMs=Date.now()-t;await p.click('[data-step="fit"]');await p.selectOption('#printer','prusa-mini');await p.click('[data-step="split"]');await p.click('#autoSplit');await p.waitForFunction(()=>window.__ps.plan,null,{timeout:900000});await idle();
  const planMs=Date.now()-t-loadMs;await p.click('[data-step="export"]');await p.click('#buildBtn');await p.waitForFunction(()=>window.__ps.built,null,{timeout:900000});await idle();
  await p.click('#exportBtn');await p.waitForFunction(()=>window.__ps.export,null,{timeout:900000});await idle();
  report.realMesh=await p.evaluate(()=>({triangles:window.__ps.model.tris,parts:window.__ps.built.parts.length,manifold:window.__ps.built.parts.every(p=>p.status==='NoError'),fits:window.__ps.plan.fits,files:window.__ps.export.files.length,plates:window.__ps.export.plates}));
  Object.assign(report.realMesh,{loadMs,planMs,totalMs:Date.now()-t});assert.ok(report.realMesh.fits&&report.realMesh.manifold);console.log('Real mesh:',JSON.stringify(report.realMesh));
 }
 assert.deepEqual(report.errors,[]);console.log('PASS pointer cut drag, keyboard camera/joint nudge/pan, coupon download, phone scroll and guide');
}catch(e){report.failure=e.message;throw e;}finally{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));await b.close();}

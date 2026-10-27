// Local UI regressions: real pointer tabs/slider and actual JointMap text metrics.
// node e2e/mobile-ui.mjs http://127.0.0.1:8765/ evidence/mobile-ui-repair/green
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.SPLITTER_PLAYWRIGHT || 'playwright');
const [url='http://127.0.0.1:8765/',out='evidence/mobile-ui-repair/green']=process.argv.slice(2);
fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',...(process.env.SPLITTER_HOST_RESOLVER_RULES?['--host-resolver-rules='+process.env.SPLITTER_HOST_RESOLVER_RULES]:[])]});
const page=await browser.newPage();
const errors=[],failures=[],results={url,tabs:[],maps:[],errors,failures};
page.on('pageerror',e=>errors.push(e.message));
const check=(v,s)=>{if(!v)failures.push(s);};
try {
 await page.addInitScript(()=>{
  window.__mapText=[];
  const proto=CanvasRenderingContext2D.prototype,fill=proto.fillText,clear=proto.clearRect;
  proto.clearRect=function(...args){if(this.canvas.id==='jointMap')window.__mapText=[];return clear.apply(this,args);};
  proto.fillText=function(text,x,y,...args){if(this.canvas.id==='jointMap'){const m=this.measureText(text);window.__mapText.push({text,x,y,left:x-m.actualBoundingBoxLeft,right:x+m.actualBoundingBoxRight,top:y-m.actualBoundingBoxAscent,bottom:y+m.actualBoundingBoxDescent});}return fill.call(this,text,x,y,...args);};
 });
 await page.goto(url,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>document.querySelector('#printer').options.length>5);
 await page.click('#expertMode');await page.click('.samples summary');
 await page.click('[data-sample="bowl_shell_300mm.stl"]');
 await page.waitForFunction(()=>window.__ps.model&&document.querySelector('#busy').classList.contains('hidden'),null,{timeout:300000});
 await page.click('[data-step="fit"]');await page.selectOption('#printer','prusa-mini');await page.click('[data-step="split"]');
 await page.click('#autoSplit');
 await page.waitForFunction(()=>window.__ps.plan&&document.querySelector('#busy').classList.contains('hidden'),null,{timeout:300000});
 await page.click('[data-step="export"]');await page.click('#buildBtn');await page.waitForFunction(()=>window.__ps.built&&document.querySelector('#busy').classList.contains('hidden'),null,{timeout:600000});
 for(const width of [360,390,412,1440]) {
  await page.setViewportSize({width,height:915});
  for(const name of ['model','cuts','parts','plates']) {
   const b=page.locator(`[data-view="${name}"]`);
   const rect=await b.boundingBox();
   const hit=await b.evaluate(e=>{const r=e.getBoundingClientRect();return [2,r.width/2,r.width-2].every(dx=>document.elementFromPoint(r.x+dx,r.y+r.height/2)===e);});
   const visible=rect.x>=0&&rect.x+rect.width<=width&&rect.y>=0&&rect.y+rect.height<=915;
   check(visible&&hit,`${width}: ${name} clipped/obscured`);
   // Do not auto-scroll a clipped button into view: use viewport pointer coordinates.
   if(visible&&hit) {await page.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2);check(await b.evaluate(e=>e.classList.contains('on')),`${width}: ${name} click`);}
   results.tabs.push({width,name,rect,hit,visible});
  }
  await page.click('[data-step="join"]');if(!await page.locator('#precisionMap').evaluate(e=>e.open))await page.click('#precisionMap summary');results.actualMaps ||= [];
  for(const node of await page.locator('[data-face]').evaluateAll(es=>es.map(e=>e.dataset.face))) {
   await page.locator(`[data-face="${node}"]`).click();
   await page.locator('#jointMap').scrollIntoViewIfNeeded();
   const measured=await page.evaluate(()=>{const c=document.querySelector('#jointMap'),r=c.getBoundingClientRect();return {width:innerWidth,node:window.__ps.face,labels:window.__mapText,canvas:{x:r.x,y:r.y,width:r.width,height:r.height,backingWidth:c.width,backingHeight:c.height}};});
   const a=measured.labels;
   check(a.length>0,`${width}/${node}: actual renderer labels`);
   for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++)check(!(a[i].left<a[j].right&&a[i].right>a[j].left&&a[i].top<a[j].bottom&&a[i].bottom>a[j].top),`${width}/${node}: actual canvas collision`);
   for(const label of a.filter(l=>/^C\d+$/.test(l.text))) {
    await page.locator('#jointMap').scrollIntoViewIfNeeded();
    const r=await page.locator('#jointMap').boundingBox();
    await page.mouse.click(r.x+label.x*r.width/measured.canvas.backingWidth,r.y+(label.top+label.bottom)/2*r.height/measured.canvas.backingHeight);
    const selection=await page.evaluate(()=>({pid:window.__ps.sel.patch,heading:document.querySelector('#seamEditor h2')?.textContent,detail:document.querySelector('#seamEditor')?.textContent,p:window.__ps.plan.patches[window.__ps.sel.patch]}));
    (measured.selections ||= []).push({label:label.text,pid:selection.pid,heading:selection.heading,detail:selection.detail});
    check(selection.pid===Number(label.text.slice(1)),`${width}/${node}: ${label.text} selection`);
    check(selection.heading?.includes(`Contact ${label.text} ·`),`${width}/${node}: contact panel ID`);
    check(selection.detail?.includes('wall ≈')&&selection.detail?.includes('largest inscribed'),`${width}/${node}: wall detail preserved`);
    if(selection.p.fallback)check(selection.detail.includes(selection.p.fallback.why),`${width}/${node}: fallback why preserved`);
   }
   results.actualMaps.push(measured);
   await page.locator('#jointMap').scrollIntoViewIfNeeded();
   await page.screenshot({path:`${out}/map-${width}-face-${node}.png`});
  }
  for(const id of await page.locator('[data-contact]').evaluateAll(es=>es.map(e=>e.dataset.contact))) {
   await page.locator(`[data-contact="${id}"]`).focus();await page.keyboard.press('Enter');
   check(await page.evaluate(id=>window.__ps.sel.patch===+id,id),`${width}: keyboard contact C${id}`);
  }
  await page.locator('#jointMap').scrollIntoViewIfNeeded();
  await page.screenshot({path:`${out}/map-${width}.png`});
  await page.click('[data-step="split"]');await page.locator('#supportWeight').scrollIntoViewIfNeeded();
  const slider=page.locator('#supportWeight'),r=await slider.boundingBox(),before=await slider.inputValue();
  const seq=await page.evaluate(()=>window.__ps.planSeq);
  check(await slider.evaluate(e=>{const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e;}),`${width}: slider hit`);
  await page.mouse.click(r.x+r.width*.8,r.y+r.height/2);
  check(await slider.inputValue()!==before,`${width}: slider pointer`);
  await slider.focus();const v=await slider.inputValue();await page.keyboard.press('ArrowLeft');
  check(await slider.inputValue()!==v,`${width}: slider keyboard`);
  check(await page.locator('#supportPending').isVisible(),`${width}: pending notice`);
  check(await page.evaluate(()=>window.__ps.planSeq)===seq,`${width}: slider must not replan`);
  (results.sliders ||= []).push({width,rect:r,before,afterPointer:v,afterKeyboard:await slider.inputValue(),pending:true,planSeqUnchanged:true});
  await page.screenshot({path:`${out}/phone-${width}.png`});
  await slider.fill('0.5');await slider.dispatchEvent('input');
 }
 const plan=await page.evaluate(()=>window.__ps.plan);
 results.maps=await page.evaluate(async plan=>{
  const {JointMap}=await import('./js/jointmap.js');
  const c=document.createElement('canvas');c.style.cssText='display:block;width:250px';document.querySelector('#side').prepend(c);
  const map=new JointMap(c),ctx=c.getContext('2d'),fill=ctx.fillText.bind(ctx);let labels=[];
  ctx.fillText=(text,x,y,...rest)=>{const m=ctx.measureText(text);const offset=ctx.textAlign==='center'?m.width/2:0;labels.push({text,left:x-offset-m.actualBoundingBoxLeft+(ctx.textAlign==='center'?m.width/2:0),right:x+(ctx.textAlign==='center'?m.width/2:0)+m.actualBoundingBoxRight-(ctx.textAlign==='center'?m.width/2:0),top:y-m.actualBoundingBoxAscent,bottom:y+m.actualBoundingBoxDescent});return fill(text,x,y,...rest);};
  const rows=[];
  for(const width of [250,300,350])for(const face of plan.faces){c.style.width=width+'px';labels=[];map.set(plan,face);const overlaps=[];for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){const a=labels[i],b=labels[j];if(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top)overlaps.push([a.text,b.text]);}rows.push({width,node:face.node,patches:face.patches,labels,overlaps});}
  c.remove();return rows;
 },plan);
 for(const row of results.maps){check(row.labels.length>=row.patches.length,`map ${row.width}/${row.node}: missing labels`);check(!row.overlaps.length,`map ${row.width}/${row.node}: collisions ${JSON.stringify(row.overlaps)}`);check(row.labels.every(l=>/^[CJ]\d+$/.test(l.text)),`map ${row.width}/${row.node}: long contact text`);}
 check(!errors.length,'page errors');
 fs.writeFileSync(`${out}/bounds.json`,JSON.stringify(results,null,2));
 assert.deepEqual(failures,[]);
 console.log('PASS phone/desktop tabs, slider pointer/keyboard, MINI bowl measured labels');
} finally {fs.writeFileSync(`${out}/bounds.json`,JSON.stringify(results,null,2));await browser.close();}

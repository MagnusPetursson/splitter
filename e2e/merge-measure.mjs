// Layout measurements shared by the merge report. Works on the guided base and
// the merged app: it only uses the five-step controls both expose.
// node e2e/merge-measure.mjs URL OUTDIR [label]
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.SPLITTER_PLAYWRIGHT||'playwright');
const [url,out='evidence/measure',label='merge']=process.argv.slice(2);
fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader',...(process.env.SPLITTER_HOST_RESOLVER_RULES?['--host-resolver-rules='+process.env.SPLITTER_HOST_RESOLVER_RULES]:[])]});
const idle=p=>p.waitForFunction(()=>document.querySelector('#busy').classList.contains('hidden')&&window.__ps.workerReady,null,{timeout:600000});
// Visible native controls (buttons, inputs, selects, summaries, links), excluding
// the skip link, inert and closed-dialog content. Canvas handles are not counted.
const sample=p=>p.evaluate(()=>{
  const vis=e=>e.checkVisibility({checkOpacity:true,visibilityProperty:true})&&!e.closest('[inert],dialog:not([open])')&&!e.matches('.skip');
  const controls=[...document.querySelectorAll('button,input,select,summary,a[href]')].filter(vis);
  const inView=controls.filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth;});
  const canvas=window.__viewer.renderer.domElement.getBoundingClientRect();
  let model=null;const v=window.__viewer,m=v.modelMesh;
  if(m&&m.visible!==false){
    const pos=m.geometry.attributes.position,THREEv=v.camera.position.constructor,q=new THREEv();
    let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;const step=Math.max(1,Math.floor(pos.count/60000));
    for(let i=0;i<pos.count;i+=step){q.fromBufferAttribute(pos,i).applyMatrix4(m.matrixWorld).project(v.camera);
      const x=canvas.x+(q.x+1)*canvas.width/2,y=canvas.y+(1-q.y)*canvas.height/2;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
    const cx0=Math.max(x0,canvas.left),cx1=Math.min(x1,canvas.right),cy0=Math.max(y0,canvas.top),cy1=Math.min(y1,canvas.bottom);
    model={w:+(x1-x0).toFixed(1),h:+(y1-y0).toFixed(1),fraction:+(Math.max(0,cx1-cx0)*Math.max(0,cy1-cy0)/(innerWidth*innerHeight)).toFixed(3),clipped:x0<canvas.left-1||x1>canvas.right+1||y0<canvas.top-1||y1>canvas.bottom+1};
  }
  return {controls:controls.length,inViewport:inView.length,canvasFraction:+(canvas.width*canvas.height/(innerWidth*innerHeight)).toFixed(3),model,overflow:document.documentElement.scrollWidth>innerWidth,ids:controls.map(e=>e.id||e.textContent.trim().slice(0,32))};
});
const report={label,url,states:{}};
try{
  for(const [device,viewport] of [['desktop',{width:1440,height:900}],['phone',{width:390,height:844}]]){
    for(const expert of [false,true]){
      const ctx=await browser.newContext({viewport,acceptDownloads:true,reducedMotion:'reduce'});
      await ctx.addInitScript(e=>{try{localStorage.setItem('ps.expert',e?'1':'0');sessionStorage.setItem('ps.gestureDismissed','0');}catch{}},expert);
      const p=await ctx.newPage();
      await p.goto(url,{waitUntil:'networkidle'});await p.waitForFunction(()=>document.querySelector('#printer').options.length>5);
      const key=s=>`${device}-${expert?'expert':'simple'}-${s}`;
      const take=async s=>{await p.waitForTimeout(250);report.states[key(s)]=await sample(p);await p.screenshot({path:path.join(out,key(s)+'.png')});};
      await take('empty');
      if(process.env.MEASURE_MODEL)await p.setInputFiles('#fileInput',process.env.MEASURE_MODEL);else await p.click('[data-sample="bracket_320mm.stl"]');
      await p.waitForFunction(()=>window.__ps.model);await idle(p);await take('fit');
      if(process.env.MEASURE_FIT_ONLY){await ctx.close();continue;}
      await p.click('#flowNext');await p.waitForFunction(()=>window.__ps.plan);await idle(p);
      await p.click('#flowNav [data-step="split"]');await take('split');
      const cut=await p.evaluate(()=>window.__ps.plan.tree.nodes.find(n=>n.cut)?.id);
      if(cut!=null){const peek=await p.locator('#sheetToggle[aria-expanded=false]').isVisible().catch(()=>false);if(peek)await p.click('#sheetToggle');await p.click(`[data-cut="${cut}"]`);if(peek)await p.click('#sheetToggle');await take('cut');}
      await p.click('#flowNav [data-step="join"]');await take('join');
      await p.click('#flowNext');await p.waitForFunction(()=>window.__ps.export,null,{timeout:600000});await idle(p);await take('export');
      await ctx.close();
    }
  }
  fs.writeFileSync(path.join(out,'measure.json'),JSON.stringify(report,null,2));
  const rows=Object.entries(report.states).map(([k,s])=>`${k.padEnd(28)} controls ${String(s.controls).padStart(3)} inView ${String(s.inViewport).padStart(3)} canvas ${s.canvasFraction} model ${s.model?s.model.fraction+(s.model.clipped?' clipped':''):'-'}${s.overflow?' OVERFLOW':''}`);
  console.log(rows.join('\n'));
}finally{await browser.close();}

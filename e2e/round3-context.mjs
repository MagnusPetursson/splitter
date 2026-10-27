// Round-three semantic/visual contract. Real entry points; diagnostic state is read-only.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {chromium} from 'playwright';
const [url='http://127.0.0.1:8792/',out='evidence/round3']=process.argv.slice(2);fs.mkdirSync(out,{recursive:true});
const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader',...(process.env.SPLITTER_HOST_RESOLVER_RULES?['--host-resolver-rules='+process.env.SPLITTER_HOST_RESOLVER_RULES]:[])]});
const report={checks:[],states:[],errors:[]};const check=(name,ok)=>{report.checks.push({name,pass:!!ok});console.log(ok?'PASS':'FAIL',name);};
const idle=p=>p.waitForFunction(()=>document.querySelector('#busy').classList.contains('hidden'),null,{timeout:600000});
async function state(p,name){await p.waitForTimeout(350);const text=await p.locator('body').innerText();check(name+' text has no JS leaks',!/(\[object|undefined|NaN)/.test(text));const metrics=await p.evaluate(()=>{const c=[...document.querySelectorAll('button,input,select,summary,a[href]')].filter(e=>e.checkVisibility({checkVisibilityCSS:true})&&!e.closest('dialog:not([open])')&&!e.classList.contains('skip')),r=document.querySelector('#viewport').getBoundingClientRect();return {rendered:c.length,inViewport:c.filter(e=>{const r=e.getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}).length,viewerHeight:r.height,overflow:document.documentElement.scrollWidth>innerWidth};});report.states.push({name,...metrics});await p.screenshot({path:path.join(out,name+'.png')});}
try{for(const [device,width,height] of [['desktop',1440,900],['phone',390,844]]){
 const ctx=await b.newContext({viewport:{width,height},isMobile:device==='phone',hasTouch:device==='phone'}),p=await ctx.newPage();p.on('pageerror',e=>report.errors.push(e.message));
 await p.goto(url,{waitUntil:'networkidle'});await p.waitForFunction(()=>document.querySelector('#printer').options.length>5);await state(p,device+'-empty');
 await p.click('[data-sample="bracket_320mm.stl"]');await p.waitForFunction(()=>window.__ps.workerReady);await idle(p);await state(p,device+'-fit');
 check(device+' plan action states next consequence',/^Plan cuts for Prusa/.test(await p.locator('#flowNext').innerText()));
 check(device+' overflow in words',/76\.0 mm too wide/.test(await p.locator('#fitVerdict').innerText()));
 check(device+' labelled dimension order',/W × D × H/.test(await p.locator('#fitReadout').innerText()));
 check(device+' dimension annotation',await p.locator('#fitDimensions').isVisible());
 if(device==='phone'){check('phone compact loaded file',await p.locator('#loadedStrip').isVisible());check('phone Fit inspection height', (await p.locator('#viewport').boundingBox()).height>=260);}
 await p.click('#flowNext');await p.waitForFunction(()=>window.__ps.plan);await idle(p);await state(p,device+'-join');
 await p.click('[data-step="split"]');await p.locator('[data-cut]').first().click();await state(p,device+'-cut');
 check(device+' active plane outline and pivot',await p.evaluate(()=>{const v=window.__viewer,g=v.cutMeshes[v.sel.cut];return g.userData.rim.material.depthTest===false&&!!g.userData.pivot&&!!g.userData.normalArrow;}));
 check(device+' anchored axis readout',await p.locator('#cutReadout').isVisible()&&/Offset X/.test(await p.locator('#cutReadout').innerText()));
 await p.click('[data-step="join"]');await p.click('#viewFace');await p.click('#pinSelector summary');await p.locator('#pinList button').nth(1).click();await state(p,device+'-pin');
 check(device+' unchanged Apply disabled',await p.locator('#pinApply').isDisabled());
 check(device+' pin selection badge',await p.locator('#pinBadge').isVisible()&&/2/.test(await p.locator('#pinBadge').innerText()));
 check(device+' popover leader',await p.locator('#pinLeader').isVisible());
 check(device+' both depth sides previewed',await p.locator('#pinDepthPreview [data-side]').count()===2);
 const old=await p.inputValue('#pinDepth');await p.fill('#pinDepth',String(+old+1));check(device+' changed Apply enabled',!(await p.locator('#pinApply').isDisabled()));check(device+' pending draft explicit',/Not applied/.test(await p.locator('#pinPopover').innerText()));await state(p,device+'-draft');await p.fill('#pinDepth',old);check(device+' reverting draft restores applied state',await p.locator('#pinApply').isDisabled());await p.click('#pinClose');
 check(device+' camera agrees with face-on',await p.inputValue('#cameraView')==='face');await p.click('#frameModel');check(device+' Fit clears face state',await p.locator('#viewFace').getAttribute('aria-pressed')==='false'&&await p.inputValue('#cameraView')==='iso');
 await p.click('#precisionMap summary');await state(p,device+'-map');check(device+' open map minus indicator',await p.locator('#precisionMap summary').evaluate(e=>getComputedStyle(e,'::before').content)==='"−"');
 await p.click('#precisionMap summary');await p.click('#flowNext');await p.waitForFunction(()=>window.__ps.export,null,{timeout:600000});await idle(p);await state(p,device+'-export');await p.click('#expertMode');await state(p,device+'-expert');
 await ctx.close();
}check('no console exceptions',report.errors.length===0);assert.ok(report.checks.every(c=>c.pass),report.checks.filter(c=>!c.pass).map(c=>c.name).join('\n'));console.log('PASS round-three context');}finally{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));await b.close();}

// Visual-system contracts beyond the merge regression: guide, error recovery,
// type floor, reduced motion, icon labels, and cache-busted module imports.
// node e2e/design-system.mjs URL OUTDIR
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.SPLITTER_PLAYWRIGHT || 'playwright');
const [url='http://127.0.0.1:8797/', out='evidence/design-system'] = process.argv.slice(2);
fs.mkdirSync(out,{recursive:true});
const axe = fs.readFileSync(require.resolve('axe-core/axe.min.js'),'utf8');
const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader',...(process.env.SPLITTER_HOST_RESOLVER_RULES?['--host-resolver-rules='+process.env.SPLITTER_HOST_RESOLVER_RULES]:[])]});
const report={states:[],errors:[]};
async function audit(p,name){
  await p.addScriptTag({content:axe});
  const v=await p.evaluate(async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})));
  const tiny=await p.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.checkVisibility({visibilityProperty:true,checkOpacity:true})&&!e.matches('svg *, .sr-only, .skip')&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&parseFloat(getComputedStyle(e).fontSize)<12).map(e=>({id:e.id,tag:e.tagName,size:getComputedStyle(e).fontSize,text:e.textContent.slice(0,60)})));
  const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  report.states.push({name,violations:v,tiny,overflow});
  await p.screenshot({path:path.join(out,name+'.png')});
  assert.deepEqual(v,[],name+' axe');assert.deepEqual(tiny,[],name+' type under 12px');assert.equal(overflow,false,name+' overflow');
}
try {
  for(const [dev,vp] of [['desktop',{width:1440,height:900}],['phone',{width:390,height:844}]]){
    const ctx=await browser.newContext({viewport:vp,reducedMotion:'reduce'}),p=await ctx.newPage();
    p.on('pageerror',e=>report.errors.push(e.message));
    await p.goto(url,{waitUntil:'networkidle'});await p.waitForFunction(()=>document.querySelector('#printer').options.length>5);
    await audit(p,dev+'-empty');
    assert.equal(await p.locator('#frameModel').isVisible(),false,'no empty view controls');
    await p.setInputFiles('#fileInput',{name:'notes.stl',mimeType:'model/stl',buffer:Buffer.from('not a mesh')});
    await p.waitForSelector('#loadNote:not(.hidden)');await audit(p,dev+'-error');
    assert.match(await p.locator('#loadNote').innerText(),/notes.stl/);
    assert.match(await p.locator('#loadNote').innerText(),/Choose a file/);
    const choose=p.locator('#loadNote button').last();
    const chooser=p.waitForEvent('filechooser');await choose.click();await chooser;
    // Each icon-only control retains a DOM label, aria-label, or title.
    const bad=await p.evaluate(()=>[...document.querySelectorAll('button,a[href]')].filter(e=>e.querySelector('svg')&&!e.textContent.trim()&&!e.getAttribute('aria-label')&&!e.getAttribute('title')).map(e=>e.id||e.outerHTML.slice(0,80)));
    assert.deepEqual(bad,[],'named icon controls');
    await p.goto(new URL('guide.html',url).href,{waitUntil:'networkidle'});await audit(p,dev+'-guide');
    assert.equal(await p.locator('nav a[aria-current=true]').count(),1,'initial chapter current');
    await p.locator('#printing').scrollIntoViewIfNeeded();await p.waitForTimeout(300);
    assert.ok(await p.locator('nav a[aria-current=true]').count(),'scroll spy retains current chapter');
    await p.locator('#faq details').first().locator('summary').click();await audit(p,dev+'-guide-faq');
    await p.locator('img').evaluateAll(es=>es.forEach(e=>e.loading='eager'));
    await p.waitForFunction(()=>[...document.images].every(e=>e.complete&&e.naturalWidth>0));
    assert.equal(await p.locator('img').evaluateAll(es=>es.every(e=>e.complete&&e.naturalWidth>0)),true,'guide screenshots load');
    await ctx.close();
  }
  assert.deepEqual(report.errors,[]);
  const r=await fetch(new URL('js/app.js',url));const js=await r.text();assert.match(js,/from '\.\/viewer.js\?v=[\w-]+'/,'module imports stamped');
  console.log('PASS design system',report.states.length,'states');
} finally {fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();}

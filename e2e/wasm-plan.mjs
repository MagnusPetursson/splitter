// Isolated regression at the real worker boundary (no UI or mocked planner).
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const [url,model]=process.argv.slice(2);
const browser=await chromium.launch({args:process.env.SPLITTER_HOST_RESOLVER_RULES?['--host-resolver-rules='+process.env.SPLITTER_HOST_RESOLVER_RULES]:[]});
const page=await browser.newPage();
page.on('console',m=>console.log(m.type(),m.text()));
page.on('pageerror',e=>console.error(e.stack));
await page.route('**/fixture.stl',route=>route.fulfill({body:fs.readFileSync(model),contentType:'application/octet-stream'}));
try {
 await page.goto(url);
 const result=await page.evaluate(async()=>{
  const worker=new Worker(new URL('js/gowork.js',location.href),{type:'module'});
  let id=0;
  const pending=new Map();
  worker.onmessage=({data:m})=>{
   if(m.type==='goprogress'){console.log('progress',m.message);return;}
   console.log('worker result',m.id,typeof m.result, typeof m.result==='string'?m.result.length:0,m.error||'');
   const p=pending.get(m.id);if(!p)return;
   pending.delete(m.id);m.error?p.reject(new Error(m.error)):p.resolve(m.result);
  };
  worker.onerror=e=>console.error('workererror',e.message);
  const call=(fn,args)=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});worker.postMessage({id,fn,args});});
  const bytes=new Uint8Array(await(await fetch(new URL('fixture.stl',location.href))).arrayBuffer());
  const loaded=await call('load',['fixture.stl',bytes]);
  console.log('load bytes',loaded.length);
  const results=[];
  for(const w of [0,0.5]) {
   const raw=await call('plan',[JSON.stringify({mode:'auto',settings:{bed:{X:250,Y:220,Z:270},supportWeight:w,jointStyle:'glued',autoJoints:true,margin:3,nozzle:0.4}})]);
   results.push({weight:w,type:typeof raw,raw});
   if(typeof raw!=='string')break;
  }
  worker.terminate();
  return results;
 });
 for(const r of result) {
  assert.equal(r.type,'string',`Go worker returned ${r.type} for support weight ${r.weight}`);
  const plan=JSON.parse(r.raw);assert.ok(plan.leaves);assert.equal(plan.fits,true);
  console.log('PLAN',r.weight,plan.leaves.length,plan.timing);
 }
 assert.equal(result.length,2);
 console.log('PASS worker returns completed JSON for long support search');
} finally {await browser.close();}

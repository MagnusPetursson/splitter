// Design round 2 captures: the Fit step with an oversized model at three
// viewports, the bottom of the Fit panel with Advanced open, the phone sheet,
// and metrics (label/viewport clearance, build-box framing, panel bottom).
// node e2e/design-r2-shots.mjs URL OUTDIR MODEL.stl [prefix]
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const {chromium} = createRequire(import.meta.url)(process.env.SPLITTER_PLAYWRIGHT || 'playwright');
const [url, out = 'evidence/design-r2', model, prefix = ''] = process.argv.slice(2);
if (!url || !model) throw Error('usage: design-r2-shots URL OUTDIR MODEL [prefix]');
fs.mkdirSync(out, {recursive: true});
const b = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(process.env.SPLITTER_HOST_RESOLVER_RULES ? ['--host-resolver-rules=' + process.env.SPLITTER_HOST_RESOLVER_RULES] : [])]});
const errors = [], metrics = {};
const shot = async (p, name, wait = 500) => { await p.waitForTimeout(wait); await p.screenshot({path: path.join(out, prefix + name + '.png')}); console.log('wrote', prefix + name); };
const measure = p => p.evaluate(() => {
  const vp = document.getElementById('viewport').getBoundingClientRect();
  const labels = [...document.querySelectorAll('#fitDimensions [data-dimension] rect')].map(e => e.getBoundingClientRect()).filter(r => r.width > 0);
  const edge = labels.length ? Math.min(...labels.map(r => Math.min(r.left - vp.left, vp.right - r.right, r.top - vp.top, vp.bottom - r.bottom))) : null;
  const side = document.getElementById('side'), foot = document.querySelector('.flow-footer');
  const last = [...document.querySelectorAll('#stepPrinter > :not([hidden])')].pop();
  const fr = foot && foot.getBoundingClientRect();
  let overlaps = 0; for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) { const a = labels[i], c = labels[j]; if (Math.min(a.right, c.right) - Math.max(a.left, c.left) > 0 && Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top) > 0) overlaps++; }
  return {labelEdgeMin: edge && Math.round(edge), labelOverlaps: overlaps, box: window.__viewer?.fitFrameMargin(), footerTop: fr && Math.round(fr.top), lastBottom: last && Math.round(last.getBoundingClientRect().bottom),
    scrollGap: side ? Math.round(side.scrollHeight - side.scrollTop - side.clientHeight) : null, more: side?.dataset.more,
    verdict: document.getElementById('fitVerdict').innerText, summary: document.getElementById('sheetSummary').innerText};
});
try {
  for (const [dev, vp, touch] of [['desktop', {width: 1440, height: 900}, false], ['laptop', {width: 1280, height: 720}, false], ['phone', {width: 390, height: 844}, true]]) {
    const ctx = await b.newContext({viewport: vp, isMobile: touch, hasTouch: touch, reducedMotion: 'reduce'});
    await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('r2')) { sessionStorage.setItem('r2', '1'); localStorage.clear(); localStorage.setItem('ps.gestureHint', '0'); } } catch {} });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(dev + ': ' + e.message));
    await p.goto(url, {waitUntil: 'networkidle'});
    await p.waitForFunction(() => document.querySelector('#printer').options.length > 5);
    await p.setInputFiles('#fileInput', model);
    await p.waitForFunction(() => window.__ps.model && document.querySelector('#busy').classList.contains('hidden'), null, {timeout: 600000});
    await p.waitForFunction(() => document.body.dataset.step === 'fit', null, {timeout: 60000});
    await shot(p, `${dev}-fit`, 1200);
    metrics[dev + '-fit'] = await measure(p);
    if (dev === 'phone') {
      if (await p.locator('#sheetToggle[aria-expanded=false]').isVisible()) await p.click('#sheetToggle');
      await shot(p, `${dev}-fit-sheet`);
    }
    await p.locator('#printerAdvanced > summary').click();
    await p.evaluate(() => { const s = document.getElementById('side'); s.scrollTop = s.scrollHeight; });
    await shot(p, `${dev}-fit-advanced-bottom`);
    metrics[dev + '-advanced-bottom'] = await measure(p);
    await ctx.close();
  }
  console.log(JSON.stringify({metrics, errors}, null, 1));
} finally { fs.writeFileSync(path.join(out, prefix + 'metrics.json'), JSON.stringify({metrics, errors}, null, 2)); await b.close(); }

// Design round 3 captures (no assertions, works on any build): Fit with a model
// that fits after a quarter turn, then the turned state, at 1440×900, 1280×720
// and 390×844, plus the phone sheet and a scene close-up.
// node e2e/design-r3-shots.mjs URL OUTDIR MODEL.stl [prefix]
// R3_PRINTER=id selects a printer; R3_BED=x,y,z sets a custom bed (mm).
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const {chromium} = createRequire(import.meta.url)(process.env.SPLITTER_PLAYWRIGHT || 'playwright');
const [url, out = 'evidence/design-r3', model, prefix = ''] = process.argv.slice(2);
if (!url || !model) throw Error('usage: design-r3-shots URL OUTDIR MODEL [prefix]');
fs.mkdirSync(out, {recursive: true});
const b = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(process.env.SPLITTER_HOST_RESOLVER_RULES ? ['--host-resolver-rules=' + process.env.SPLITTER_HOST_RESOLVER_RULES] : [])]});
const errors = [], metrics = {};
const shot = async (p, name, wait = 500) => { await p.waitForTimeout(wait); await p.screenshot({path: path.join(out, prefix + name + '.png')}); console.log('wrote', prefix + name); };
const idle = p => p.waitForFunction(() => window.__ps.model && document.querySelector('#busy').classList.contains('hidden'), null, {timeout: 600000});
const measure = p => p.evaluate(() => {
  const vis = e => e && e.checkVisibility();
  const primaries = [...document.querySelectorAll('.primary')].filter(e => vis(e) && !e.closest('dialog')).map(e => (e.id || '') + ':' + e.textContent.trim().slice(0, 40));
  const side = document.getElementById('side'), foot = document.querySelector('.flow-footer').getBoundingClientRect();
  const lines = [...document.querySelectorAll('#fitDimensions [data-dim-line] path')].map(e => e.getAttribute('d').match(/-?[\d.]+/g).map(Number));
  const svg = document.getElementById('fitDimensions').getBoundingClientRect();
  const hits = [...document.querySelectorAll('#fitDimensions [data-dimension] rect')].map(r => { const b = r.getBoundingClientRect(), R = {l: b.left - svg.left - 3, r: b.right - svg.left + 3, t: b.top - svg.top - 3, b: b.bottom - svg.top + 3};
    return lines.filter(([x0, y0, x1, y1]) => { let a = 0, c = 1; const dx = x1 - x0, dy = y1 - y0; for (const [pp, qq] of [[-dx, x0 - R.l], [dx, R.r - x0], [-dy, y0 - R.t], [dy, R.b - y0]]) { if (pp === 0) { if (qq < 0) return false; continue; } const t = qq / pp; if (pp < 0) { if (t > c) return false; if (t > a) a = t; } else { if (t < a) return false; if (t < c) c = t; } } return a <= c; }).length; });
  const cue = document.querySelector('#moreCue span'), cr = cue && cue.checkVisibility({visibilityProperty: true}) ? cue.getBoundingClientRect() : null;
  const ro = document.querySelector('#fitReadout .metrics')?.getBoundingClientRect();
  return {labelLineHits: hits, labels: [...document.querySelectorAll('#fitDimensions [data-dimension] text')].map(t => t.textContent), cueBottomToFooter: cr && Math.round(foot.top - cr.bottom), readoutTopToFooter: ro && Math.round(foot.top - ro.top), next: document.getElementById('flowNext').innerText,primaries, verdict: document.getElementById('fitVerdict').innerText, summary: document.getElementById('sheetSummary').innerText,
    size: window.__ps.model?.size?.map(v => +v.toFixed(1)), more: side?.dataset.more, frame: window.__viewer?.fitFrameMargin?.()};
});
try {
  for (const [dev, vp, touch] of [['desktop', {width: 1440, height: 900}, false], ['laptop', {width: 1280, height: 720}, false], ['phone', {width: 390, height: 844}, true]]) {
    const ctx = await b.newContext({viewport: vp, isMobile: touch, hasTouch: touch, reducedMotion: 'reduce'});
    await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('r3')) { sessionStorage.setItem('r3', '1'); localStorage.clear(); localStorage.setItem('ps.gestureHint', '0'); } } catch {} });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(dev + ': ' + e.message));
    await p.goto(url, {waitUntil: 'networkidle'});
    await p.waitForFunction(() => document.querySelector('#printer').options.length > 5);
    if (process.env.R3_PRINTER) await p.selectOption('#printer', process.env.R3_PRINTER);
    await p.setInputFiles('#fileInput', model);
    await idle(p);
    await p.waitForFunction(() => document.body.dataset.step === 'fit', null, {timeout: 60000});
    if (process.env.R3_BED) { if (touch && await p.locator('#sheetToggle[aria-expanded=false]').isVisible()) await p.click('#sheetToggle'); await p.selectOption('#printer', 'custom'); const [x, y, z] = process.env.R3_BED.split(','); for (const [id, v] of [['bedX', x], ['bedY', y], ['bedZ', z]]) await p.fill('#' + id, v); await p.waitForTimeout(400); if (touch && await p.locator('#sheetToggle[aria-expanded=true]').isVisible()) await p.click('#sheetToggle'); await idle(p); await p.evaluate(() => { document.getElementById('side').scrollTop = 0; }); }
    await shot(p, `${dev}-fit`, 1200);
    metrics[dev + '-fit'] = await measure(p);
    if (dev === 'phone' && await p.locator('#sheetToggle[aria-expanded=false]').isVisible()) { await p.click('#sheetToggle'); await shot(p, `${dev}-fit-sheet`); metrics[dev + '-fit-sheet'] = await measure(p); await p.click('#sheetToggle'); }
    const rot = p.locator('[data-fit-rotate]'), turnNext = /^(Turn 90°|Lay on side)$/.test(await p.locator('#flowNext').innerText());
    if (turnNext || await rot.count()) {
      await (turnNext ? p.locator('#flowNext') : rot.first()).evaluate(e => e.click());
      await p.waitForTimeout(300); await idle(p); await p.evaluate(() => { document.getElementById('side').scrollTop = 0; });
      await shot(p, `${dev}-turned`, 1200);
      metrics[dev + '-turned'] = await measure(p);
      if (dev === 'phone' && await p.locator('#sheetToggle[aria-expanded=false]').isVisible()) { await p.click('#sheetToggle'); await shot(p, `${dev}-turned-sheet`); metrics[dev + '-turned-sheet'] = await measure(p); }
    }
    await ctx.close();
  }
  console.log(JSON.stringify({metrics, errors}, null, 1));
} finally { fs.writeFileSync(path.join(out, prefix + 'metrics.json'), JSON.stringify({metrics, errors}, null, 2)); await b.close(); }

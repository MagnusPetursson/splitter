// Before/after captures for design round 2 on any build (no assertions):
// sample bracket Fit, Split before planning, and the Fit panel bottom with
// Advanced open, at 1440×900, 1280×720 and 390×844.
// node e2e/design-r2-pairs.mjs URL OUTDIR
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const {chromium} = createRequire(import.meta.url)(process.env.SPLITTER_PLAYWRIGHT || 'playwright');
const [url, out] = process.argv.slice(2);
if (!url || !out) throw Error('usage: design-r2-pairs URL OUTDIR');
fs.mkdirSync(out, {recursive: true});
const b = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
const idle = p => p.waitForFunction(() => document.querySelector('#busy').classList.contains('hidden'), null, {timeout: 600000});
try {
  for (const [dev, vp, touch] of [['desktop', {width: 1440, height: 900}, false], ['laptop', {width: 1280, height: 720}, false], ['phone', {width: 390, height: 844}, true]]) {
    const ctx = await b.newContext({viewport: vp, isMobile: touch, hasTouch: touch, reducedMotion: 'reduce'});
    await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('r2')) { sessionStorage.setItem('r2', '1'); localStorage.clear(); localStorage.setItem('ps.gestureHint', '0'); } } catch {} });
    const p = await ctx.newPage();
    await p.goto(url, {waitUntil: 'networkidle'});
    await p.waitForFunction(() => document.querySelector('#printer').options.length > 5);
    await p.click('[data-sample="bracket_320mm.stl"]');
    await p.waitForFunction(() => window.__ps.workerReady && document.body.dataset.step === 'fit'); await idle(p);
    await p.waitForTimeout(900);
    await p.screenshot({path: path.join(out, `${dev}-bracket-fit.png`)});
    await p.click('#flowNav [data-step="split"]'); await p.waitForTimeout(700);
    await p.screenshot({path: path.join(out, `${dev}-split-preplan.png`)});
    if (dev !== 'phone') {
      await p.click('#flowNav [data-step="fit"]'); await p.waitForTimeout(500);
      await p.locator('#printerAdvanced > summary').click();
      await p.evaluate(() => { const s = document.getElementById('side'); s.scrollTop = s.scrollHeight; }); await p.waitForTimeout(400);
      await p.screenshot({path: path.join(out, `${dev}-fit-bottom.png`)});
    }
    await ctx.close();
  }
} finally { await b.close(); }

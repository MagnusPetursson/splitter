// Browser smoke test: load a sample → auto split → build → export zip.
//   node e2e/smoke.mjs <url> [sample.stl] [printer-id] [outdir]
// Needs Playwright (npm i -D playwright; npx playwright install chromium).
// Fails on any page error, console error or failed request.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require('playwright');
const url = process.argv[2];
const sample = process.argv[3] || 'bracket_320mm.stl';
const printer = process.argv[4] || 'prusa-mini';
const out = process.argv[5] || 'smoke-out';
fs.mkdirSync(out, { recursive: true });

const errors = [];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('requestfailed', (r) => { if (!r.url().startsWith('blob:') && !/download=1/.test(r.url())) errors.push('requestfailed: ' + r.url() + ' ' + (r.failure() || {}).errorText); });
const idle = () => page.waitForFunction(() => document.getElementById('busy').classList.contains('hidden'), null, { timeout: 600000, polling: 200 });
const shot = (n) => page.screenshot({ path: path.join(out, n + '.png') });
const t0 = Date.now();
const lap = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s  ${s}`);
try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('#printer option').length > 5, null, { timeout: 60000 });
  const mode = await page.evaluate(() => document.body.dataset.mode);
  lap(`loaded, backend=${mode}`);
  await page.selectOption('#printer', printer);
  await page.click(`[data-sample="${sample}"]`);
  await page.waitForFunction(() => window.__ps.model && window.__ps.workerReady, null, { timeout: 600000 });
  await idle();
  lap(`model ${await page.evaluate(() => window.__ps.model.tris)} triangles`);
  await shot('1_model');
  await page.click('#autoSplit');
  await page.waitForFunction(() => window.__ps.plan, null, { timeout: 600000 });
  await idle();
  const pl = await page.evaluate(() => ({ parts: window.__ps.plan.leaves.filter((l) => !l.empty).length, joints: window.__ps.plan.joints.length, fits: window.__ps.plan.leaves.filter((l) => !l.empty).every((l) => l.fits) }));
  lap(`plan ${JSON.stringify(pl)}`);
  await shot('2_plan');
  await page.click('#buildBtn');
  await page.waitForFunction(() => window.__ps.built, null, { timeout: 900000 });
  await idle();
  const bad = await page.evaluate(() => window.__ps.built.parts.filter((p) => p.status !== 'NoError').length);
  lap(`built, non-manifold parts: ${bad}`);
  await shot('3_built');
  await page.click('#exportBtn');
  await page.waitForFunction(() => window.__ps.export, null, { timeout: 600000 });
  await idle();
  const ex = await page.evaluate(() => ({ zip: window.__ps.export.zip, files: window.__ps.export.files.length, plates: window.__ps.export.plates }));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`#exportInfo a[download="${ex.zip}"], #exportInfo a[href*="${ex.zip}"]`)]);
  const zf = path.join(out, ex.zip);
  await dl.saveAs(zf);
  lap(`exported ${ex.files} files on ${ex.plates} plate(s); zip ${fs.statSync(zf).size} bytes`);
  await shot('4_exported');
  if (!pl.fits || bad) errors.push('plan does not fit or parts not manifold');
} catch (e) {
  errors.push('step failed: ' + e.message);
  await shot('failure').catch(() => {});
}
await browser.close();
if (errors.length) { console.log('FAIL\n' + errors.join('\n')); process.exit(1); }
console.log('PASS');

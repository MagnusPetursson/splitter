// Regenerates the guide images from the running app (no mock-ups).
// node e2e/guide-shots.mjs URL [webdir]
import path from 'node:path';
import {createRequire} from 'node:module';
const {chromium} = createRequire(import.meta.url)(process.env.SPLITTER_PLAYWRIGHT || 'playwright');
const [url = 'http://127.0.0.1:8795/', dir = 'web/guide'] = process.argv.slice(2);
const b = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
const idle = p => p.waitForFunction(() => document.querySelector('#busy').classList.contains('hidden') && window.__ps.workerReady, null, {timeout: 600000});
const shot = async (p, name) => { await p.waitForTimeout(400); await p.screenshot({path: path.join(dir, name)}); console.log('wrote', name); };
async function fresh(expert) {
  const ctx = await b.newContext({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
  await ctx.addInitScript(e => { try { localStorage.setItem('ps.expert', e ? '1' : '0'); localStorage.setItem('ps.gestureHint', '1'); } catch {} }, expert);
  const p = await ctx.newPage(); await p.goto(url, {waitUntil: 'networkidle'}); await p.waitForFunction(() => document.querySelector('#printer').options.length > 5);
  await p.click('[data-sample="bracket_320mm.stl"]'); await idle(p);
  await p.selectOption('#printer', 'prusa-mini');
  await p.click('#flowNext'); await p.waitForFunction(() => window.__ps.plan); await idle(p);
  await p.click('#flowNav [data-step="split"]');
  return {ctx, p};
}
try {
  {
    const {ctx, p} = await fresh(false);
    await shot(p, 'split.png');
    await p.locator('[data-cut]').first().click(); await shot(p, 'cut.png');
    await p.click('#flowNav [data-step="join"]');
    if (!(await p.locator('#pinSelector').evaluate(e => e.open))) await p.click('#pinSelector summary');
    await p.locator('#pinList button').first().click(); await shot(p, 'joints.png');
    await p.click('#pinClose');
    await p.click('#flowNext'); await p.waitForFunction(() => window.__ps.export, null, {timeout: 600000}); await idle(p);
    await p.click('[data-view="plates"]'); await shot(p, 'plates.png');
    await ctx.close();
  }
  {
    const {ctx, p} = await fresh(true);
    await p.locator('[data-cut]').nth(1).click(); await shot(p, 'expert.png');
    await ctx.close();
  }
} finally { await b.close(); }

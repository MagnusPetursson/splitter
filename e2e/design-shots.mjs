// Design-audit captures for states the contract suites don't photograph:
// empty, loading, load errors, toasts, tilt mode, joint editor, guide page.
// node e2e/design-shots.mjs URL OUTDIR [private-model.stl]
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const {chromium} = createRequire(import.meta.url)(process.env.SPLITTER_PLAYWRIGHT || 'playwright');
const [url = 'http://127.0.0.1:8795/', out = 'evidence/design', big = process.env.SPLITTER_PRIVATE_MODEL] = process.argv.slice(2);
fs.mkdirSync(out, {recursive: true});
const b = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(process.env.SPLITTER_HOST_RESOLVER_RULES ? ['--host-resolver-rules=' + process.env.SPLITTER_HOST_RESOLVER_RULES] : [])]});
const idle = p => p.waitForFunction(() => document.querySelector('#busy').classList.contains('hidden') && window.__ps.workerReady, null, {timeout: 600000});
const shot = async (p, name, wait = 300) => { await p.waitForTimeout(wait); await p.screenshot({path: path.join(out, name + '.png')}); console.log('wrote', name); };
const errors = [];
// A single open triangle: parses, but is not a closed solid.
const openStl = 'solid open\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid open\n';
async function fresh(viewport, expert = false, hint = false) {
  const ctx = await b.newContext({viewport, reducedMotion: 'reduce', acceptDownloads: true});
  await ctx.addInitScript(([e, h]) => { try { if (!sessionStorage.getItem('ds')) { sessionStorage.setItem('ds', '1'); localStorage.clear(); localStorage.setItem('ps.expert', e ? '1' : '0'); if (!h) localStorage.setItem('ps.gestureHint', '1'); } } catch {} }, [expert, hint]);
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(url, {waitUntil: 'networkidle'}); await p.waitForFunction(() => document.querySelector('#printer').options.length > 5);
  return {ctx, p};
}
const openSheet = async p => { if (await p.locator('#sheetToggle[aria-expanded=false]').isVisible().catch(() => false)) await p.click('#sheetToggle'); };
const closeSheet = async p => { if (await p.locator('#sheetToggle[aria-expanded=true]').isVisible().catch(() => false)) await p.click('#sheetToggle'); };
try {
  for (const [dev, vp] of [['desktop', {width: 1440, height: 900}], ['phone', {width: 390, height: 844}]]) {
    // empty + hint, then error states
    {
      const {ctx, p} = await fresh(vp, false, true);
      await shot(p, `${dev}-empty`);
      await p.setInputFiles('#fileInput', {name: 'open-surface.stl', mimeType: 'model/stl', buffer: Buffer.from(openStl)});
      await p.waitForFunction(() => !document.querySelector('#loadNote').classList.contains('hidden') || !document.querySelector('#toast').classList.contains('hidden'), null, {timeout: 60000});
      await shot(p, `${dev}-error-open`);
      await p.setInputFiles('#fileInput', {name: 'notes.stl', mimeType: 'model/stl', buffer: Buffer.from('this is not a mesh')});
      await p.waitForFunction(() => !document.querySelector('#toast').classList.contains('hidden'), null, {timeout: 60000}).catch(() => {});
      await shot(p, `${dev}-error-garbage`);
      await ctx.close();
    }
    // loading progress (private model when available, otherwise the bunny)
    if (big && fs.existsSync(big)) {
      const {ctx, p} = await fresh(vp);
      await p.setInputFiles('#fileInput', big);
      await p.waitForFunction(() => document.querySelector('#busy.staged:not(.hidden)'), null, {timeout: 60000}).catch(() => {});
      await shot(p, `${dev}-loading`, 600);
      await idle(p); await shot(p, `${dev}-loaded-big`, 500);
      await p.click('#flowNext');
      await p.waitForFunction(() => document.querySelector('#busy.staged:not(.hidden)'), null, {timeout: 60000}).catch(() => {});
      await shot(p, `${dev}-planning`, 1500);
      await p.waitForFunction(() => window.__ps.plan, null, {timeout: 600000}); await idle(p);
      await shot(p, `${dev}-big-planned`, 500);
      await ctx.close();
    }
    // sample: tilt mode, toast, joint editor
    {
      const {ctx, p} = await fresh(vp, dev === 'desktop');
      await p.click('[data-sample="bracket_320mm.stl"]'); await idle(p);
      await p.click('#flowNext'); await p.waitForFunction(() => window.__ps.plan); await idle(p);
      await p.click('#flowNav [data-step="split"]');
      await openSheet(p); await p.locator('[data-cut]').first().click(); if (dev === 'phone') await closeSheet(p);
      await p.click('#cutTilt'); await shot(p, `${dev}-tilt`);
      await p.evaluate(() => { const t = document.getElementById('toast'); t.textContent = 'That point is not on the cut face'; t.classList.add('err'); t.classList.remove('hidden'); });
      await shot(p, `${dev}-toast-error`, 100);
      await p.click('#flowNav [data-step="join"]'); await openSheet(p);
      await p.click('#precisionMap summary'); await shot(p, `${dev}-join-map`);
      await p.click('#openEditor'); await shot(p, `${dev}-joint-editor`, 600);
      await ctx.close();
    }
    // guide
    {
      const ctx = await b.newContext({viewport: vp, reducedMotion: 'reduce'}); const p = await ctx.newPage();
      await p.goto(new URL('guide.html', url).href, {waitUntil: 'networkidle'});
      await shot(p, `${dev}-guide-top`);
      await p.screenshot({path: path.join(out, `${dev}-guide-full.png`), fullPage: true});
      await ctx.close();
    }
  }
  console.log(errors.length ? 'page errors: ' + errors.join(' | ') : 'no page errors');
} finally { await b.close(); }

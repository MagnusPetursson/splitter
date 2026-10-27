// Design round 2 contract: the Fit decision (verdict headline, quarter-turn
// fix, restore), viewport composition (whole build volume and dimension
// lines inside the view, labels inside and apart), one primary per view
// before planning, and panel bottom clearance on desktop.
// node e2e/design-r2.mjs URL [OUTDIR]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium} = createRequire(import.meta.url)(process.env.SPLITTER_PLAYWRIGHT || 'playwright');
const [url, out = 'evidence/design-r2'] = process.argv.slice(2);
if (!url) throw Error('usage: design-r2 URL [OUTDIR]');
fs.mkdirSync(out, {recursive: true});
const b = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(process.env.SPLITTER_HOST_RESOLVER_RULES ? ['--host-resolver-rules=' + process.env.SPLITTER_HOST_RESOLVER_RULES] : [])]});
const report = {checks: [], errors: []};
const ok = (c, m) => { assert.ok(c, m); report.checks.push(m); };
const idle = p => p.waitForFunction(() => document.querySelector('#busy').classList.contains('hidden'), null, {timeout: 600000});
const scene = p => p.evaluate(() => {
  const vp = document.getElementById('viewport').getBoundingClientRect();
  const r = [...document.querySelectorAll('#fitDimensions [data-dimension] rect')].map(e => e.getBoundingClientRect());
  let overlaps = 0; for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) if (Math.min(r[i].right, r[j].right) - Math.max(r[i].left, r[j].left) > 0 && Math.min(r[i].bottom, r[j].bottom) - Math.max(r[i].top, r[j].top) > 0) overlaps++;
  const edge = Math.min(...r.map(x => Math.min(x.left - vp.left, vp.right - x.right, x.top - vp.top, vp.bottom - x.bottom)));
  const primaries = [...document.querySelectorAll('.primary')].filter(e => e.checkVisibility({checkOpacity: true, visibilityProperty: true}) && !e.closest('dialog,[inert]')).map(e => e.id || e.textContent.trim());
  return {labels: r.length, overlaps, edge: Math.round(edge), frame: window.__viewer.fitFrameMargin(), primaries, over: [...document.querySelectorAll('#fitDimensions .over[data-dimension]')].map(e => e.dataset.dimension)};
});
try {
  for (const [dev, vp, touch] of [['desktop', {width: 1440, height: 900}, false], ['laptop', {width: 1280, height: 720}, false], ['phone', {width: 390, height: 844}, true]]) {
    const ctx = await b.newContext({viewport: vp, isMobile: touch, hasTouch: touch, reducedMotion: 'reduce'});
    await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('r2')) { sessionStorage.setItem('r2', '1'); localStorage.clear(); localStorage.setItem('ps.gestureHint', '0'); } } catch {} });
    const p = await ctx.newPage();
    p.on('pageerror', e => report.errors.push(dev + ': ' + e.message));
    await p.goto(url, {waitUntil: 'networkidle'});
    await p.waitForFunction(() => document.querySelector('#printer').options.length > 5);
    await p.click('[data-sample="bracket_320mm.stl"]');
    await p.waitForFunction(() => window.__ps.workerReady && document.body.dataset.step === 'fit'); await idle(p);
    await p.waitForTimeout(400);
    // 1. Too big in every orientation: verdict headline, honest next step, framed scene.
    let s = await scene(p);
    const v1 = await p.locator('#fitVerdict').innerText();
    ok(/^Doesn’t fit as placed: [\d.]+ mm too wide/.test(v1.trim()), `${dev}: verdict leads with the result`);
    ok(/No orientation fits it whole/.test(v1) && /Plan cuts proposes cuts/.test(v1), `${dev}: says Plan cuts proposes cuts when no orientation fits`);
    ok(await p.locator('[data-fit-rotate]').count() === 0, `${dev}: no rotate offer when no quarter turn fits`);
    ok(s.labels === 3 && s.overlaps === 0 && s.edge >= 12, `${dev}: three dimension labels, none overlapping, ≥ 12 px inside the view (${s.edge})`);
    ok(s.frame >= 8, `${dev}: whole build volume and dimension lines inside the view (${s.frame} px)`);
    ok(s.over.join() === 'width', `${dev}: only the failing axis is emphasised`);
    ok(s.primaries.length <= 1, `${dev}: one primary on Fit (${s.primaries})`);
    const sum = await p.locator('#sheetSummary').innerText();
    if (dev === 'phone') {
      ok(/^Doesn’t fit as placed: [\d.]+ mm too wide/.test(sum), 'phone: summary row carries the verdict headline');
      const w = await p.locator('#sheetSummary b').evaluate(e => +getComputedStyle(e).fontWeight), fs16 = await p.locator('#sheetSummary b').evaluate(e => parseFloat(getComputedStyle(e).fontSize));
      ok(w >= 600 && fs16 >= 16, `phone: headline weight ${w}, ${fs16} px`);
    }
    await p.screenshot({path: path.join(out, `${dev}-bracket-fit.png`)});
    // 2. Split before planning: one primary, pre-plan copy.
    await p.click('#flowNav [data-step="split"]'); await p.waitForTimeout(300);
    s = await scene(p);
    ok(s.primaries.length === 1, `${dev}: exactly one primary on Split before planning (${s.primaries})`);
    ok(!/suggested cuts/.test(await p.locator('#stepSplit .step-intro').innerText()), `${dev}: pre-plan intro does not describe cuts that do not exist`);
    await p.screenshot({path: path.join(out, `${dev}-split-preplan.png`)});
    await p.click('#flowNav [data-step="fit"]');
    // 3. A quarter turn fixes it: offer, apply, restore.
    if (dev === 'phone' && await p.locator('#sheetToggle[aria-expanded=false]').isVisible()) await p.click('#sheetToggle');
    await p.selectOption('#printer', 'custom');
    for (const [id, v] of [['bedX', '70'], ['bedY', '330'], ['bedZ', '230']]) await p.fill('#' + id, v);
    await p.waitForTimeout(300);
    const before = await p.evaluate(() => window.__ps.model.size.slice());
    ok(/Fits in one piece if turned 90° on the bed/.test(await p.locator('#sheetSummary').innerText()) || dev !== 'phone', `${dev}: phone summary names the quarter-turn fix`);
    await p.locator('[data-fit-rotate]').scrollIntoViewIfNeeded();
    ok(/Turn 90° on the bed/.test(await p.locator('[data-fit-rotate]').innerText()), `${dev}: offers the quarter turn`);
    await p.click('[data-fit-rotate]');
    await p.waitForFunction(() => /^Fits as turned/.test(document.querySelector('#fitVerdict').innerText.trim()), null, {timeout: 60000}); await idle(p);
    const after = await p.evaluate(() => window.__ps.model.size.slice());
    ok(Math.abs(after[0] - before[1]) < 0.01 && Math.abs(after[1] - before[0]) < 0.01 && Math.abs(after[2] - before[2]) < 0.01, `${dev}: turned model swaps width and depth (${before.map(Math.round)} → ${after.map(Math.round)})`);
    ok(await p.locator('[data-fit-restore]').isVisible(), `${dev}: restore file orientation offered`);
    await p.waitForTimeout(300);
    await p.screenshot({path: path.join(out, `${dev}-turned.png`)});
    if (dev === 'desktop') {
      await p.click('#flowNext'); await p.waitForFunction(() => window.__ps.plan, null, {timeout: 600000}); await idle(p);
      const n = await p.evaluate(() => window.__ps.plan.leaves.filter(l => !l.empty).length);
      ok(n === 1, `desktop: turned model plans as one piece (${n})`);
      ok(/No cut needed/.test(await p.locator('#stepSplit .step-intro').innerText()), 'desktop: one-piece plan says no cut is needed');
      await p.click('#flowNav [data-step="fit"]');
    }
    await p.locator('[data-fit-restore]').scrollIntoViewIfNeeded();
    await p.click('[data-fit-restore]');
    await p.waitForFunction(() => /^Doesn’t fit as placed/.test(document.querySelector('#fitVerdict').innerText.trim()), null, {timeout: 60000}); await idle(p);
    const back = await p.evaluate(() => window.__ps.model.size.slice());
    ok(back.every((v, i) => Math.abs(v - before[i]) < 0.01), `${dev}: restore returns the file orientation`);
    // 4. Desktop panel bottom: nothing ends under the sticky footer.
    if (dev !== 'phone') {
      await p.locator('#printerAdvanced > summary').click();
      await p.evaluate(() => { const s = document.getElementById('side'); s.scrollTop = s.scrollHeight; }); await p.waitForTimeout(200);
      const m = await p.evaluate(() => { const side = document.getElementById('side'), foot = document.querySelector('.flow-footer').getBoundingClientRect(), last = [...side.querySelectorAll('.step:not([hidden]) > :not([hidden]), .credits, .privacy')].filter(e => e.getClientRects().length).map(e => e.getBoundingClientRect().bottom); return {foot: foot.top, last: Math.max(...last), more: side.dataset.more}; });
      ok(m.last <= m.foot - 8, `${dev}: last panel row ends ≥ 8 px above the footer (${Math.round(m.foot - m.last)} px)`);
      ok(m.more === 'false', `${dev}: no "More below" at the end of the panel`);
      await p.evaluate(() => { document.getElementById('side').scrollTop = 0; }); await p.waitForTimeout(200);
      const more = await p.evaluate(() => document.getElementById('side').dataset.more);
      ok(more === 'true', `${dev}: "More below" shows while content continues`);
    }
    await ctx.close();
  }
  assert.deepEqual(report.errors, [], 'page errors');
  console.log('PASS design round 2', report.checks.length, 'checks');
} finally { fs.writeFileSync(path.join(out, 'design-r2.json'), JSON.stringify(report, null, 2)); await b.close(); }

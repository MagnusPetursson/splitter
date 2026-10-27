// Merge contract: every baseline capability is still present, expert mode adds
// the outliner/inspector/palette in place, the viewer-first overlays work, and
// no rendered state leaks serialisation text or fails WCAG 2.2 AA (axe).
// node e2e/merge-expert.mjs URL OUTDIR
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.SPLITTER_PLAYWRIGHT || 'playwright');
const [url = 'http://127.0.0.1:8795/', out = 'evidence/merge-expert'] = process.argv.slice(2);
fs.mkdirSync(out, {recursive: true});
const axeSource = fs.readFileSync(process.env.SPLITTER_AXE || require.resolve('axe-core/axe.min.js'), 'utf8');
const baseline = execFileSync('git', ['show', 'e404028:web/index.html'], {encoding: 'utf8'});
const baselineIds = [...new Set([...baseline.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]))];
const browser = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(process.env.SPLITTER_HOST_RESOLVER_RULES ? ['--host-resolver-rules=' + process.env.SPLITTER_HOST_RESOLVER_RULES] : [])]});
const report = {baselineIds: baselineIds.length, states: [], errors: [], checks: {}};
const idle = p => p.waitForFunction(() => document.querySelector('#busy').classList.contains('hidden') && window.__ps.workerReady, null, {timeout: 600000});
const LEAK = /\[object|\bundefined\b|\bNaN\b|\bnull\b(?! *[a-z])/;

async function audit(p, name, {axe = true} = {}) {
  await p.waitForTimeout(200);
  const data = await p.evaluate(() => {
    const vis = e => e.checkVisibility({checkOpacity: true, visibilityProperty: true}) && !e.closest('[inert]') && !e.matches('.skip,.sr-only');
    const text = [document.body.innerText, ...[...document.querySelectorAll('[aria-label],[title],[aria-description]')].map(e => [e.getAttribute('aria-label'), e.getAttribute('title'), e.getAttribute('aria-description')].join(' '))].join('\n');
    const small = [...document.querySelectorAll('button,input,select,summary,a[href],[role=option]')].filter(vis).flatMap(e => {
      const t = e.matches('input[type=checkbox]') ? e.closest('label') : e, r = t.getBoundingClientRect();
      if (e.closest('.credits,.privacy,p,li:not([role=option]),td') && e.matches('a')) return []; // inline text links (WCAG 2.5.8 exception)
      return r.width < 43.9 || r.height < 43.9 ? [{id: e.id || e.textContent.trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height)}] : [];
    });
    // Visible controls in the header and the view must not cover each other or leave the screen.
    const boxes = [...document.querySelectorAll('.top button,.top a[href],.flow-nav button,.stage button,.stage select,.stage input,#orientationTriad')].filter(vis).filter(e => !e.closest('#outliner,#pinPopover,#busy,.toast,dialog')).map(e => ({id: e.id || e.textContent.trim().slice(0, 24), r: e.getBoundingClientRect()}));
    const collide = [];
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i].r;
      if (a.left < -1 || a.right > innerWidth + 1 || a.top < -1 || a.bottom > innerHeight + 1) collide.push(`${boxes[i].id} off-screen`);
      for (let j = i + 1; j < boxes.length; j++) { const b = boxes[j].r, w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (w > 2 && h > 2) collide.push(`${boxes[i].id} × ${boxes[j].id}`); }
    }
    // One primary per view (DESIGN.md V7). An open modal dialog is its own view.
    const modal = document.querySelector('dialog[open]'), scope = modal || document;
    const primaries = [...scope.querySelectorAll('.primary')].filter(vis).filter(e => modal || !e.closest('dialog')).map(e => e.id || e.textContent.trim().slice(0, 30));
    return {primaries, collide, leaks: text.split('\n').filter(t => /\[object|\bundefined\b|\bNaN\b/.test(t)).slice(0, 5), overflow: document.documentElement.scrollWidth > innerWidth + 1, small};
  });
  let violations = [];
  if (axe) {
    if (!(await p.evaluate(() => !!window.axe))) await p.addScriptTag({content: axeSource});
    violations = (await p.evaluate(async () => (await axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']}})).violations.map(v => ({id: v.id, nodes: v.nodes.slice(0, 3).map(n => n.target.join(' '))}))));
  }
  report.states.push({name, ...data, violations});
  await p.screenshot({path: path.join(out, name + '.png')});
  assert.deepEqual(data.leaks, [], `text leak in ${name}`);
  assert.equal(data.overflow, false, `horizontal overflow in ${name}`);
  assert.deepEqual(data.small, [], `targets under 44 px in ${name}`);
  assert.deepEqual(data.collide, [], `overlapping or off-screen controls in ${name}`);
  assert.deepEqual(violations, [], `axe violations in ${name}`);
  assert.ok(data.primaries.length <= 1, `more than one primary in ${name}: ${data.primaries.join(', ')}`);
}

async function page(viewport, expert) {
  const ctx = await browser.newContext({viewport, acceptDownloads: true, reducedMotion: 'reduce'});
  await ctx.addInitScript(e => { try { if (!sessionStorage.getItem('merge-init')) { sessionStorage.setItem('merge-init', '1'); localStorage.clear(); localStorage.setItem('ps.expert', e ? '1' : '0'); } } catch {} }, expert);
  const p = await ctx.newPage();
  p.on('pageerror', e => report.errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) report.errors.push(m.text()); });
  await p.goto(url, {waitUntil: 'networkidle'});
  await p.waitForFunction(() => document.querySelector('#printer').options.length > 5);
  return {ctx, p};
}
const openSheet = async p => { if (await p.locator('#sheetToggle[aria-expanded=false]').isVisible().catch(() => false)) await p.click('#sheetToggle'); };
const closeSheet = async p => { if (await p.locator('#sheetToggle[aria-expanded=true]').isVisible().catch(() => false)) await p.click('#sheetToggle'); };

try {
  // 1. Capability gate and every state × mode × device.
  for (const [device, viewport] of [['desktop', {width: 1440, height: 900}], ['phone', {width: 390, height: 844}]]) {
    for (const expert of [false, true]) {
      const tag = `${device}-${expert ? 'expert' : 'simple'}`, {ctx, p} = await page(viewport, expert);
      assert.deepEqual(await p.evaluate(ids => ids.filter(id => !document.getElementById(id)), baselineIds), [], 'all baseline static IDs retained');
      assert.equal(await p.locator('#jointStyle option').count(), 13);
      assert.equal(await p.locator('[data-fit]').count(), 5);
      assert.equal(await p.evaluate(() => new Set([...document.querySelectorAll('[data-sample]')].map(e => e.dataset.sample)).size), 4);
      await audit(p, `${tag}-load`);
      await p.click('[data-sample="bracket_320mm.stl"]'); await idle(p);
      assert.equal(await p.evaluate(() => document.body.dataset.step), 'fit');
      if (device === 'phone') {
        assert.equal(await p.getAttribute('#sheetToggle', 'aria-expanded'), 'false', 'phone sheet starts as a peek on Fit');
        assert.equal(await p.locator('#sheetToggle').innerText(), 'Why?', 'over-size verdict is behind Why?');
        assert.match(await p.locator('#sheetSummary').innerText(), /too (wide|deep|tall)/);
        await audit(p, `${tag}-fit-peek`);
        await p.click('#sheetToggle'); assert.ok(await p.locator('#fitReadout').isVisible());
      }
      await audit(p, `${tag}-fit`);
      // Split before any plan: one "Plan cuts" primary and pre-plan copy only.
      await p.click('#flowNav [data-step="split"]');
      await audit(p, `${tag}-split-preplan`);
      const pre = await p.evaluate(() => ({intro: document.querySelector('#stepSplit .step-intro').textContent, help: document.querySelector('#stepSplit .context-help').textContent}));
      assert.doesNotMatch(pre.intro, /suggested cuts|drag the highlighted/i, 'pre-plan intro must not describe cuts that do not exist');
      assert.doesNotMatch(pre.help, /these cuts/i, 'pre-plan help link must not say "these cuts"');
      await p.click('#flowNav [data-step="fit"]');
      await p.click('#flowNext'); await p.waitForFunction(() => window.__ps.plan); await idle(p);
      await p.click('#flowNav [data-step="split"]');
      await audit(p, `${tag}-split`);
      assert.ok(await p.locator('#resultCard').isVisible() || device === 'phone', 'result card after Auto split');
      await openSheet(p);
      await p.locator('[data-cut]').first().click();
      if (device === 'phone') await closeSheet(p);
      await audit(p, `${tag}-cut`);
      if (expert && device === 'desktop') {
        assert.ok(await p.locator('#outliner').isVisible(), 'outliner open by default in desktop expert');
        assert.ok(await p.locator('#selectionInspector').isVisible());
        assert.match(await p.locator('#inspectorTitle').innerText(), /^C\d|Cut/);
      }
      await p.click('#flowNav [data-step="join"]');
      await audit(p, `${tag}-join`);
      // select a pin through the same UI the step offers
      await openSheet(p);
      if (!(await p.locator('#pinSelector').evaluate(e => e.open))) await p.click('#pinSelector summary');
      await p.locator('#pinList button').first().click();
      if (device === 'phone') await closeSheet(p);
      assert.ok(await p.locator('#pinPopover').isVisible(), 'pin popover in Join');
      await audit(p, `${tag}-pin`);
      await p.click('#pinClose');
      await openSheet(p);
      await p.click('#flowNext'); await p.waitForFunction(() => window.__ps.export, null, {timeout: 600000}); await idle(p);
      await audit(p, `${tag}-export`);
      assert.match(await p.locator('#outputState').innerText(), /Downloads match the current plan/);
      for (const dlg of ['helpDlg', 'licDlg']) { await p.evaluate(id => document.getElementById(id).showModal(), dlg); await audit(p, `${tag}-${dlg}`); await p.keyboard.press('Escape'); }
      await p.keyboard.press('Control+k'); assert.ok(await p.locator('#paletteDlg').isVisible(), 'Ctrl K opens commands in both modes');
      await audit(p, `${tag}-palette`); await p.keyboard.press('Escape');
      await ctx.close();
    }
  }

  // 2. Expert interactions on desktop: outliner keyboard, palette, inspector, output state,
  //    viewport cut fields, undo/redo, triad and gesture hint persistence.
  {
    const {ctx, p} = await page({width: 1440, height: 900}, true);
    // The viewer hint and view controls appear once there is a model to orbit.
    assert.equal(await p.locator('#gestureHint').isVisible(), false, 'no gesture hint before a model is loaded');
    await p.click('[data-sample="bracket_320mm.stl"]'); await idle(p);
    assert.ok(await p.locator('#gestureHint').isVisible());
    await p.click('#dismissGesture'); await p.reload({waitUntil: 'networkidle'}); await p.waitForFunction(() => document.querySelector('#printer').options.length > 5);
    await p.click('[data-sample="bracket_320mm.stl"]'); await idle(p);
    assert.equal(await p.locator('#gestureHint').isVisible(), false, 'dismissed gesture hint stays dismissed');
    const triad0 = await p.locator('#triadLines').innerHTML();
    await p.locator('#viewport canvas').focus(); await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(150);
    assert.notEqual(await p.locator('#triadLines').innerHTML(), triad0, 'triad follows the camera');
    // palette: unavailable commands explain why; Enter runs an available one
    await p.keyboard.press('Control+k'); await p.keyboard.type('download zip');
    assert.match(await p.locator('#paletteList [role=option]').first().innerText(), /Prepare downloads first/);
    await p.keyboard.press('Enter'); assert.ok(await p.locator('#paletteDlg').isVisible(), 'disabled command does not run');
    await p.fill('#paletteInput', 'plan cuts'); await p.keyboard.press('Enter');
    await p.waitForFunction(() => window.__ps.plan); await idle(p);
    // outliner: arrow keys and Enter select; inspector names the selection
    await p.locator('#outlinerTree button').first().focus();
    await p.keyboard.press('End'); assert.match(await p.evaluate(() => document.activeElement.textContent), /Joint|Pin/);
    await p.keyboard.press('Home'); await p.keyboard.press('ArrowDown');
    assert.match(await p.evaluate(() => document.activeElement.textContent), /C\d|Cut/);
    await p.keyboard.press('Enter');
    const cut = await p.evaluate(() => window.__ps.sel.cut); assert.ok(cut != null, 'outliner selects a cut');
    assert.equal(await p.evaluate(() => document.body.dataset.step), 'split');
    assert.ok(await p.locator('#cutFields').isVisible(), 'cut values sit in the viewport');
    // palette selects objects too
    await p.keyboard.press('Control+k'); await p.keyboard.type('select joint j'); await p.keyboard.press('Enter');
    assert.ok(await p.evaluate(() => window.__ps.sel.joint != null)); assert.equal(await p.evaluate(() => document.body.dataset.step), 'join');
    assert.match(await p.locator('#inspectorTitle').innerText(), /Joint J\d+/);
    await p.keyboard.press('Escape');
    // build, then edit -> one authoritative stale state
    await p.click('#flowNav [data-step="export"]'); await p.click('#buildBtn'); await p.waitForFunction(() => window.__ps.built); await idle(p);
    assert.match(await p.locator('#outputState').innerText(), /built from the current plan/);
    await p.click('#flowNav [data-step="split"]'); await p.locator('[data-cut]').first().click();
    const d0 = await p.evaluate(() => window.__ps.plan.tree.nodes[window.__ps.sel.cut].cut.d);
    await p.fill('#fieldOffset', String((d0 - 12).toFixed(1))); await p.press('#fieldOffset', 'Enter');
    await p.waitForFunction(d => { const n = window.__ps.plan.tree.nodes.find(n => n.cut && n.locked); return n && Math.abs(n.cut.d - (d - 12)) < 0.2; }, d0, {timeout: 120000}); await idle(p);
    report.checks.offset = {before: d0, after: await p.evaluate(() => window.__ps.plan.tree.nodes.find(n => n.cut && n.locked).cut.d)};
    assert.equal(await p.locator('#flowNav [data-step="export"] small').innerText(), 'Rebuild needed');
    await p.click('#flowNav [data-step="export"]');
    assert.match(await p.locator('#outputState').innerText(), /Changes since last build/);
    assert.match(await p.locator('#buildBtn').innerText(), /Rebuild parts/);
    assert.match(await p.locator('#flowNext').innerText(), /Rebuild & prepare downloads/);
    await audit(p, 'desktop-expert-stale');
    // tilt through the orange-ring field, then undo restores the axis-aligned cut
    await p.click('#flowNav [data-step="split"]'); await p.locator('[data-cut]').first().click();
    const n0 = await p.evaluate(() => window.__ps.plan.tree.nodes[window.__ps.sel.cut].cut.n);
    await p.fill('#fieldTiltA', '10'); await p.press('#fieldTiltA', 'Enter');
    await p.waitForFunction(n => { const c = window.__ps.plan.tree.nodes.find(x => x.cut && x.locked)?.cut; return c && Math.abs(c.n[0] - n[0]) + Math.abs(c.n[1] - n[1]) + Math.abs(c.n[2] - n[2]) > 0.05; }, n0, {timeout: 120000}); await idle(p);
    const n1 = await p.evaluate(() => window.__ps.plan.tree.nodes.find(x => x.cut && x.locked).cut.n);
    report.checks.tilt = {before: n0, after: n1, degrees: Math.acos(Math.min(1, Math.abs(n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]))) * 180 / Math.PI};
    assert.ok(Math.abs(report.checks.tilt.degrees - 10) < 0.6, 'Tilt A applies the typed angle');
    await p.locator('#viewport canvas').focus(); await p.keyboard.press('Control+z'); await idle(p);
    const n2 = await p.evaluate(() => window.__ps.plan.tree.nodes.filter(x => x.cut).map(x => x.cut.n));
    assert.ok(n2.some(n => Math.abs(Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]) - 1) < 1e-6), 'undo restores the axis-aligned cut');
    // result card Adjust selects a cut and hands focus to the viewer
    await p.keyboard.press('Control+k'); await p.keyboard.type('plan cuts'); await p.keyboard.press('Enter'); await p.waitForFunction(() => window.__ps.planWasAuto); await idle(p);
    await p.click('#flowNav [data-step="split"]'); await p.evaluate(() => document.querySelector('#outlinerClose').click());
    assert.ok(await p.locator('#resultCard').isVisible()); await p.click('#adjustPlan');
    assert.ok(await p.evaluate(() => window.__ps.sel.cut != null && document.activeElement.tagName === 'CANVAS'));
    // focus returns to the opener when the palette closes
    await p.focus('#expertMode'); await p.keyboard.press('Control+k'); await p.keyboard.press('Escape');
    assert.equal(await p.evaluate(() => document.activeElement.id), 'expertMode');
    await ctx.close();
  }
  assert.deepEqual(report.errors, []);
  console.log('PASS merge contract', JSON.stringify({states: report.states.length, baselineIds: baselineIds.length, checks: report.checks}));
} finally {
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2));
  await browser.close();
}

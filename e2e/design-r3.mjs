// Design round 3 contract: the Fit decision in both branches (a quarter turn
// fits → "Turn 90° to fit" is the only primary, then "Export as one piece";
// nothing fits → split-first), ≤ 1 primary in every view of both branches,
// dimension labels in their own slots (off every dimension line and
// arrowhead, apart, inside the view), the in-panel scroll cue, and the
// small-cue contrast checks.
// node e2e/design-r3.mjs URL [OUTDIR]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.SPLITTER_PLAYWRIGHT || 'playwright');
const axeSrc = fs.readFileSync(process.env.SPLITTER_AXE || require.resolve('axe-core/axe.min.js'), 'utf8');
const [url, out = 'evidence/design-r3'] = process.argv.slice(2);
if (!url) throw Error('usage: design-r3 URL [OUTDIR]');
fs.mkdirSync(out, {recursive: true});
const b = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(process.env.SPLITTER_HOST_RESOLVER_RULES ? ['--host-resolver-rules=' + process.env.SPLITTER_HOST_RESOLVER_RULES] : [])]});
const report = {checks: [], errors: []};
const ok = (c, m) => { assert.ok(c, m); report.checks.push(m); };
const idle = p => p.waitForFunction(() => document.querySelector('#busy').classList.contains('hidden'), null, {timeout: 600000});
const primaries = p => p.evaluate(() => [...document.querySelectorAll('.primary')].filter(e => e.checkVisibility({checkOpacity: true, visibilityProperty: true}) && !e.closest('dialog,[inert]')).map(e => e.id || e.textContent.trim()));
const onePrimary = async (p, what) => { const pr = await primaries(p); ok(pr.length <= 1, `${what}: ≤ 1 primary (${pr.join(', ') || 'none'})`); return pr; };
const labels = p => p.evaluate(() => {
  const svg = document.getElementById('fitDimensions'), sb = svg.getBoundingClientRect(), vp = document.getElementById('viewport').getBoundingClientRect();
  const lines = [...svg.querySelectorAll('[data-dim-line] path')].map(e => e.getAttribute('d').match(/-?[\d.]+/g).map(Number));
  const hit = (R, [x0, y0, x1, y1]) => { let a = 0, c = 1; const dx = x1 - x0, dy = y1 - y0; for (const [pp, qq] of [[-dx, x0 - R.l], [dx, R.r - x0], [-dy, y0 - R.t], [dy, R.b - y0]]) { if (pp === 0) { if (qq < 0) return false; continue; } const t = qq / pp; if (pp < 0) { if (t > c) return false; if (t > a) a = t; } else { if (t < a) return false; if (t < c) c = t; } } return a <= c; };
  // Each line is extended 6 px past both ends to cover its arrowheads.
  const ext = lines.map(([x0, y0, x1, y1]) => { const l = Math.hypot(x1 - x0, y1 - y0) || 1, ux = (x1 - x0) / l * 6, uy = (y1 - y0) / l * 6; return [x0 - ux, y0 - uy, x1 + ux, y1 + uy]; });
  const rects = [...svg.querySelectorAll('[data-dimension] rect')].map(e => e.getBoundingClientRect());
  const lineHits = rects.map(b => ext.filter(L => hit({l: b.left - sb.left - 3, r: b.right - sb.left + 3, t: b.top - sb.top - 3, b: b.bottom - sb.top + 3}, L)).length);
  let overlaps = 0; for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (Math.min(rects[i].right, rects[j].right) - Math.max(rects[i].left, rects[j].left) > -4 && Math.min(rects[i].bottom, rects[j].bottom) - Math.max(rects[i].top, rects[j].top) > -4) overlaps++;
  const edge = Math.min(...rects.map(x => Math.min(x.left - vp.left, vp.right - x.right, x.top - vp.top, vp.bottom - x.bottom)));
  return {n: rects.length, lineHits, overlaps, edge: Math.round(edge), text: [...svg.querySelectorAll('[data-dimension] text')].map(t => t.textContent), over: [...svg.querySelectorAll('.over[data-dimension]')].map(e => e.dataset.dimension)};
});
const panel = p => p.evaluate(() => {
  const side = document.getElementById('side'), foot = document.querySelector('.flow-footer').getBoundingClientRect(), sr = side.getBoundingClientRect();
  // Round 4 replaced the pill with a fade + scrollbar; the cue checks apply only when a pill exists.
  const cue = document.querySelector('#moreCue span'), cr = cue && cue.checkVisibility({visibilityProperty: true}) ? cue.getBoundingClientRect() : null;
  const cards = document.querySelector('#fitReadout .metrics')?.getBoundingClientRect();
  const pill = getComputedStyle(document.querySelector('.flow-footer'), '::before').content;
  const heads = [...side.querySelectorAll('.step:not([hidden]) :is(h1,.fit-head,.readout-head b)')].filter(e => e.checkVisibility() && !e.classList.contains('sr-only')).map(e => ({h1: e.tagName === 'H1', t: e.textContent, lines: Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight))}));
  return {more: side.dataset.more, foot: foot.top, side: {l: sr.left, r: sr.right, b: sr.bottom}, cue: cr && {t: cr.top, b: cr.bottom, l: cr.left, r: cr.right}, cardsBottom: cards?.bottom, pill, heads};
});
const lum = c => { const [r, g, bb] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * bb; };
const contrast = (a, c) => { const [x, y] = [lum(a), lum(c)].sort((m, n) => n - m); return (x + .05) / (y + .05); };
const axe = async (p, what) => {
  if (!await p.evaluate(() => !!window.axe)) await p.addScriptTag({content: axeSrc});
  const r = await p.evaluate(async () => (await axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']}})).violations.map(v => v.id + ':' + v.nodes.length));
  ok(r.length === 0, `${what}: axe 0 violations (${r.join(', ')})`);
};
const verdict = p => p.locator('#fitVerdict').innerText().then(t => t.trim());
const shot = (p, n) => p.screenshot({path: path.join(out, n + '.png')});
try {
  for (const [dev, vp, touch] of [['desktop', {width: 1440, height: 900}, false], ['laptop', {width: 1280, height: 720}, false], ['phone', {width: 390, height: 844}, true]]) {
    const ctx = await b.newContext({viewport: vp, isMobile: touch, hasTouch: touch, reducedMotion: 'reduce'});
    await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('r3')) { sessionStorage.setItem('r3', '1'); localStorage.clear(); localStorage.setItem('ps.gestureHint', '0'); } } catch {} });
    const p = await ctx.newPage();
    p.on('pageerror', e => report.errors.push(dev + ': ' + e.message));
    await p.goto(url, {waitUntil: 'networkidle'});
    await p.waitForFunction(() => document.querySelector('#printer').options.length > 5);
    await onePrimary(p, `${dev} load`);
    await p.click('[data-sample="bracket_320mm.stl"]');
    await p.waitForFunction(() => window.__ps.workerReady && document.body.dataset.step === 'fit'); await idle(p); await p.waitForTimeout(400);
    const openSheet = async () => { if (dev === 'phone' && await p.locator('#sheetToggle[aria-expanded=false]').isVisible()) await p.click('#sheetToggle'); };
    const closeSheet = async () => { if (dev === 'phone' && await p.locator('#sheetToggle[aria-expanded=true]').isVisible()) await p.click('#sheetToggle'); };

    // Branch B: nothing fits whole (320 mm bracket on the default printer) → split-first.
    let v = await verdict(p);
    ok(/^Doesn’t fit: [\d.]+ mm too wide/.test(v), `${dev} B: verdict leads with the failure`);
    ok(/No orientation fits it whole/.test(v), `${dev} B: says no orientation fits whole`);
    ok(/^Plan cuts$/.test((await p.locator('#flowNext').innerText()).trim()), `${dev} B: footer primary is Plan cuts`);
    ok(await p.locator('[data-fit-plan]').count() === 0, `${dev} B: no "Plan cuts anyway" when cutting is the only path`);
    let pr = await onePrimary(p, `${dev} B fit`); ok(pr[0] === 'flowNext', `${dev} B: the primary is the footer action`);
    let L = await labels(p);
    ok(L.n === 3 && L.lineHits.every(h => h === 0), `${dev} B: every label clears every dimension line and arrowhead (${L.lineHits})`);
    ok(L.overlaps === 0 && L.edge >= 12, `${dev} B: labels apart and ≥ 12 px inside the view (edge ${L.edge})`);
    const wide = L.text.find(t => /^W /.test(t));
    ok(/^W [\d.]+ mm · limit [\d.]+ mm$/.test(wide), `${dev} B: exceeded label is self-explaining (${wide})`);
    ok(L.text.filter(t => /limit/.test(t)).length === L.over.length, `${dev} B: only exceeded axes carry a limit`);
    if (dev !== 'phone') {
      const s = await panel(p);
      ok(s.pill === 'none' || s.pill === 'normal', `${dev}: no scroll pill on the footer divider`);
      if (s.more === 'true' && s.cue) ok(s.cue && s.cue.b <= s.foot - 6 && s.cue.l >= s.side.l && s.cue.r <= s.side.r, `${dev}: scroll cue sits inside the panel above the footer (${s.cue && Math.round(s.foot - s.cue.b)} px)`);
      ok(s.heads.every(h => h.lines === 1 || h.h1 && h.lines === 2), `${dev} B: headings do not wrap (verdict h1 ≤ 2 lines since round 4) (${s.heads.map(h => h.t + ':' + h.lines).join('; ')})`);
    }
    await axe(p, `${dev} B fit`);
    await shot(p, `${dev}-B-fit`);
    // Small cues: pending step circles and labels, axis letters, distinct viewport glyphs.
    const cues = await p.evaluate(() => {
      const bg = getComputedStyle(document.querySelector('.flow-nav')).backgroundColor;
      const steps = [...document.querySelectorAll('#flowNav button')].filter(x => x.dataset.state === 'upcoming' || x.dataset.state === 'blocked').map(x => { const n = x.querySelector('.step-number'), cs = getComputedStyle(n); return {num: cs.color, ring: cs.borderTopColor, dashed: cs.borderTopStyle, label: getComputedStyle(x).color}; });
      const tri = document.getElementById('orientationTriad'), tr = tri.getBoundingClientRect(), vb = tri.viewBox?.baseVal?.width || tr.width;
      const fs = Math.min(...[...tri.querySelectorAll('text')].map(t => +t.getAttribute('font-size') * tr.width / vb));
      const g = id => document.querySelector(`#${id} use`)?.getAttribute('href');
      return {bg, steps, triadPx: Math.round(fs * 10) / 10, glyphs: [g('expandView'), g('frameModel')], titles: [document.getElementById('expandView').title, document.getElementById('frameModel').title]};
    });
    ok(cues.steps.length > 0 && cues.steps.every(s => contrast(s.num, cues.bg) >= 4.5 && contrast(s.label, cues.bg) >= 4.5 && contrast(s.ring, cues.bg) >= 3 && s.dashed === 'solid'), `${dev}: pending step numerals/labels ≥ 4.5:1, rings ≥ 3:1, solid (${cues.steps.map(s => contrast(s.num, cues.bg).toFixed(1) + '/' + contrast(s.ring, cues.bg).toFixed(1)).join(' ')})`);
    ok(cues.triadPx >= 12, `${dev}: XYZ letters render ≥ 12 px (${cues.triadPx})`);
    ok(cues.glyphs[0] !== cues.glyphs[1] && cues.titles.every(Boolean), `${dev}: Enlarge and Fit view use distinct glyphs with tooltips (${cues.glyphs})`);
    await p.click('#flowNav [data-step="split"]'); await p.waitForTimeout(300); await idle(p);
    await onePrimary(p, `${dev} B split pre-plan`);
    await p.click('#flowNav [data-step="fit"]'); await p.waitForTimeout(200);

    // Branch A: a quarter turn fits (custom 70 × 330 × 230 bed).
    await openSheet();
    await p.selectOption('#printer', 'custom');
    for (const [id, val] of [['bedX', '70'], ['bedY', '330'], ['bedZ', '230']]) await p.fill('#' + id, val);
    await p.waitForTimeout(400);
    const before = await p.evaluate(() => window.__ps.model.size.slice());
    v = await verdict(p);
    ok(/^Fits in one piece after a 90° turn/.test(v), `${dev} A: headline names the one-piece outcome (${v.split('\n')[0]})`);
    ok(/Current placement is [\d.]+ mm too wide \([\d.]+ \/ [\d.]+ mm\)/.test(v), `${dev} A: sub-line gives the current overage with numbers`);
    ok(/^Turn 90° to fit$/.test((await p.locator('#flowNext').innerText()).trim()), `${dev} A: footer primary is "Turn 90° to fit"`);
    ok(await p.locator('[data-fit-plan]').isVisible() && !(await p.locator('[data-fit-plan]').evaluate(e => e.classList.contains('primary'))), `${dev} A: "Plan cuts anyway" is offered as a secondary`);
    pr = await onePrimary(p, `${dev} A fit`); ok(pr[0] === 'flowNext', `${dev} A: the only primary is the turn`);
    if (dev === 'phone') { await closeSheet(); ok(/^Fits in one piece after a 90° turn/.test(await p.locator('#sheetSummary').innerText()), 'phone A: summary row carries the turn outcome'); await onePrimary(p, 'phone A fit (peek)'); }
    if (dev !== 'phone') { const s = await panel(p); ok(!s.cue || s.cardsBottom <= s.cue.t, `${dev} A: model-vs-usable cards fully visible above the scroll cue`); ok(s.heads.every(h => h.lines === 1 || h.h1 && h.lines === 2), `${dev} A: headings do not wrap (verdict h1 ≤ 2 lines since round 4) (${s.heads.map(h => h.t + ':' + h.lines).join('; ')})`); }
    L = await labels(p);
    ok(L.lineHits.every(h => h === 0) && L.overlaps === 0 && L.edge >= 12, `${dev} A: labels in their own slots (${L.lineHits}, edge ${L.edge})`);
    await axe(p, `${dev} A fit`);
    await shot(p, `${dev}-A-fit`);
    await p.click('#flowNext');
    await p.waitForFunction(() => { const t = document.querySelector('#fitVerdict .fit-head')?.textContent; return t === 'Fits in one piece'; }, null, {timeout: 60000}); await idle(p); await p.waitForTimeout(300);
    const after = await p.evaluate(() => window.__ps.model.size.slice());
    ok(Math.abs(after[0] - before[1]) < .01 && Math.abs(after[1] - before[0]) < .01 && Math.abs(after[2] - before[2]) < .01, `${dev} A: turn swaps width and depth, same size`);
    await openSheet();
    v = await verdict(p);
    ok(/Within usable: W [\d.]+ · D [\d.]+ · H [\d.]+ mm/.test(v), `${dev} A turned: W/D/H all within usable`);
    ok(/^Export as one piece$/.test((await p.locator('#flowNext').innerText()).trim()), `${dev} A turned: primary moves on to "Export as one piece"`);
    ok(await p.locator('[data-fit-restore]').isVisible() && await p.locator('[data-fit-plan]').count() === 0, `${dev} A turned: Undo turn offered; no cut-anyway prompt`);
    pr = await onePrimary(p, `${dev} A turned`); ok(pr[0] === 'flowNext', `${dev} A turned: the primary is the footer action`);
    await closeSheet(); await p.waitForTimeout(300);
    L = await labels(p);
    ok(L.over.length === 0 && L.text.every(t => !/limit/.test(t)), `${dev} A turned: no dimension flagged`);
    ok(L.lineHits.every(h => h === 0) && L.overlaps === 0 && L.edge >= 12, `${dev} A turned: labels in their own slots (${L.lineHits}, overlaps ${L.overlaps}, edge ${L.edge})`);
    await axe(p, `${dev} A turned`);
    await shot(p, `${dev}-A-turned`);
    // Undo restores, the turn offer returns.
    await openSheet();
    await p.click('[data-fit-restore]');
    await p.waitForFunction(() => /after a 90° turn/.test(document.querySelector('#fitVerdict').innerText), null, {timeout: 60000}); await idle(p);
    ok((await p.evaluate(() => window.__ps.model.size.slice())).every((x, i) => Math.abs(x - before[i]) < .01), `${dev} A: Undo turn restores the file orientation`);
    ok(/^Turn 90° to fit$/.test((await p.locator('#flowNext').innerText()).trim()), `${dev} A: after Undo the turn is primary again`);
    if (dev === 'desktop') {
      // Plan cuts anyway → Split review, one primary.
      await p.click('[data-fit-plan]'); await p.waitForFunction(() => window.__ps.plan, null, {timeout: 600000}); await idle(p);
      ok(await p.evaluate(() => ['split', 'join'].includes(document.body.dataset.step)), 'desktop A: Plan cuts anyway opens the cut review');
      await onePrimary(p, `desktop A after Plan cuts anyway (${await p.evaluate(() => document.body.dataset.step)})`);
      await p.click('#flowNav [data-step="fit"]'); await p.waitForTimeout(200);
      // Turn → Export as one piece → one fitting part, downloads ready.
      await p.click('#flowNext'); await p.waitForFunction(() => /^Export as one piece$/.test(document.querySelector('#flowNext').innerText.trim()), null, {timeout: 60000}); await idle(p);
      await p.click('#flowNext');
      await p.waitForFunction(() => window.__ps.export && document.body.dataset.step === 'export', null, {timeout: 600000}); await idle(p);
      const parts = await p.evaluate(() => window.__ps.plan.leaves.filter(l => !l.empty).map(l => l.fits));
      ok(parts.length === 1 && parts[0], `desktop A: Export as one piece builds a single fitting part (${parts.length})`);
      ok(await p.evaluate(() => window.__ps.built.parts.every(x => x.status === 'NoError')), 'desktop A: single part builds without error');
      await onePrimary(p, 'desktop A export');
      await shot(p, 'desktop-A-export');
    }
    await ctx.close();
  }
  ok(report.errors.length === 0, `no page errors (${report.errors.join(' | ')})`);
  console.log(`PASS design-r3 (${report.checks.length} checks)`);
} finally { fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2)); await b.close(); }

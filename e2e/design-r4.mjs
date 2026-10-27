// Design round 4 contract (control review of e28b747), at 1440×900, 1280×720
// and 390×844 (phone at DPR 3), first visit so the viewer hint is showing:
//  1. the Fit verdict is the step headline (largest panel text) and the
//     printer is a compact "Printer: <name> · Change" row on the native select;
//  2. no "More below" pill; at 1440×900 and 1280×720 the verdict, the three
//     dimension cards and the margin note end ≥ 24 px above the footer;
//  3. dimension labels never touch the viewer hint, the camera/enlarge
//     controls, the legend or the corner buttons; the hint leaves after the
//     first orbit;
//  4. phone: real-density canvas, distinct named viewport icon buttons (Enlarge
//     keeps its glyph and swaps to Close), discless triad with ≥ 12 px letters;
//  5. after "Turn 90° to fit": headline, labels, primary and Undo.
// axe 0 in every captured state.
// node e2e/design-r4.mjs URL [OUTDIR]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.SPLITTER_PLAYWRIGHT || 'playwright');
const axeSrc = fs.readFileSync(process.env.SPLITTER_AXE || require.resolve('axe-core/axe.min.js'), 'utf8');
const [url, out = 'evidence/design-r4'] = process.argv.slice(2);
if (!url) throw Error('usage: design-r4 URL [OUTDIR]');
fs.mkdirSync(out, {recursive: true});
const b = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(process.env.SPLITTER_HOST_RESOLVER_RULES ? ['--host-resolver-rules=' + process.env.SPLITTER_HOST_RESOLVER_RULES] : [])]});
const report = {checks: [], errors: []};
const ok = (c, m) => { assert.ok(c, m); report.checks.push(m); };
const idle = p => p.waitForFunction(() => document.querySelector('#busy').classList.contains('hidden'), null, {timeout: 600000});
const axe = async (p, what) => {
  if (!await p.evaluate(() => !!window.axe)) await p.addScriptTag({content: axeSrc});
  const r = await p.evaluate(async () => (await axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']}})).violations.map(v => v.id + ':' + v.nodes.length));
  ok(r.length === 0, `${what}: axe 0 violations (${r.join(', ')})`);
};
const state = p => p.evaluate(() => {
  const vis = e => e && e.checkVisibility({checkOpacity: false, visibilityProperty: true}) && !e.closest('[hidden]');
  const side = document.getElementById('side'), foot = document.querySelector('.flow-footer').getBoundingClientRect();
  const h1 = document.querySelector('#stepPrinter h1');
  const texts = [...side.querySelectorAll('#stepPrinter *')].filter(e => vis(e) && e.childElementCount === 0 && e.textContent.trim() && !e.closest('.sr-only, select, option'));
  const maxOther = Math.max(...texts.filter(e => e !== h1 && !h1.contains(e)).map(e => parseFloat(getComputedStyle(e).fontSize)));
  const row = document.querySelector('.printer-row'), sel = document.getElementById('printer');
  const note = document.querySelector('#fitReadout p')?.getBoundingClientRect();
  const pill = document.querySelector('#moreCue span');
  const chrome = [...document.querySelectorAll('#gestureHint, #viewerTools > *, .view-corner > *, #fitLegend')].filter(vis).map(e => ({id: e.id || e.className, r: e.getBoundingClientRect()})).filter(c => c.r.width);
  const labs = [...document.querySelectorAll('#fitDimensions [data-dimension] rect')].map(e => e.getBoundingClientRect());
  const hits = labs.map(r => chrome.filter(({r: c}) => r.left < c.right + 2 && r.right > c.left - 2 && r.top < c.bottom + 2 && r.bottom > c.top - 2).map(c => c.id));
  const tri = document.getElementById('orientationTriad'), tr = tri.getBoundingClientRect(), vb = tri.viewBox.baseVal.width;
  const letters = [...tri.querySelectorAll('text')];
  const ic = id => { const e = document.getElementById(id); return {vis: vis(e), name: e.getAttribute('aria-label') || e.querySelector('.lbl')?.textContent.trim(), glyph: e.querySelector('use')?.getAttribute('href'), svg: !!e.querySelector('svg')}; };
  return {heading: h1.textContent, headingVisible: vis(h1) && h1.getBoundingClientRect().height > 2, headingPx: parseFloat(getComputedStyle(h1).fontSize), maxOther,
    verdictHead: document.querySelector('#fitVerdict .fit-head')?.textContent, summaryHead: document.querySelector('#sheetSummary b')?.textContent, summaryPx: parseFloat(getComputedStyle(document.querySelector('#sheetSummary b') || document.body).fontSize),
    row: row && [...row.children].filter(e => e.tagName !== 'SELECT').map(e => e.textContent + (getComputedStyle(e, '::after').content.replace(/^"|"$|^none$|^normal$/g, ''))).join(' ').replace(/\s+/g, ' ').trim(), rowH: row?.getBoundingClientRect().height, selLabel: sel.labels?.[0]?.textContent, selCovers: (() => { const a = sel.getBoundingClientRect(), c = row.getBoundingClientRect(); return Math.abs(a.width - c.width) < 3 && Math.abs(a.height - c.height) < 3; })(),
    noteGap: note && vis(document.querySelector('#fitReadout p')) ? Math.round(foot.top - note.bottom) : null, pill: !!pill && vis(pill) && pill.getBoundingClientRect().width > 0,
    hint: vis(document.getElementById('gestureHint')), chrome: chrome.map(c => c.id), hits, labels: [...document.querySelectorAll('#fitDimensions [data-dimension] text')].map(t => t.textContent),
    dpr: window.__viewer?.renderer?.getPixelRatio?.(), devDpr: devicePixelRatio, triBg: getComputedStyle(tri).backgroundColor, triBorder: getComputedStyle(tri).borderTopWidth,
    triPx: letters.length ? Math.min(...letters.map(t => +t.getAttribute('font-size') * tr.width / vb)) : 0, triLetters: letters.map(t => t.textContent).sort().join(''),
    icons: [ic('expandView'), ic('frameModel')], next: document.getElementById('flowNext').innerText.trim(),
    undo: vis(document.querySelector('[data-fit-restore]')), size: window.__ps.model.size.map(v => +v.toFixed(1))};
});
const shot = (p, n) => p.screenshot({path: path.join(out, n + '.png')});
try {
  for (const [dev, vp, touch] of [['desktop', {width: 1440, height: 900}, false], ['laptop', {width: 1280, height: 720}, false], ['phone', {width: 390, height: 844}, true]]) {
    const ctx = await b.newContext({viewport: vp, isMobile: touch, hasTouch: touch, deviceScaleFactor: touch ? 3 : 1, reducedMotion: 'reduce'});
    await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('r4')) { sessionStorage.setItem('r4', '1'); localStorage.clear(); } } catch {} });
    const p = await ctx.newPage();
    p.on('pageerror', e => report.errors.push(dev + ': ' + e.message));
    await p.goto(url, {waitUntil: 'networkidle'});
    await p.waitForFunction(() => document.querySelector('#printer').options.length > 5);
    await p.click('[data-sample="bracket_320mm.stl"]');
    await p.waitForFunction(() => window.__ps.workerReady && document.body.dataset.step === 'fit'); await idle(p); await p.waitForTimeout(500);
    const openSheet = async () => { if (dev === 'phone' && await p.locator('#sheetToggle[aria-expanded=false]').isVisible()) { await p.click('#sheetToggle'); await p.waitForTimeout(250); } };
    const closeSheet = async () => { if (dev === 'phone' && await p.locator('#sheetToggle[aria-expanded=true]').isVisible()) { await p.click('#sheetToggle'); await p.waitForTimeout(350); } };
    const viewport = async (what, hintExpected) => {
      const s = await state(p);
      if (hintExpected != null) ok(s.hint === hintExpected, `${what}: viewer hint ${hintExpected ? 'shown' : 'gone'}`);
      ok(s.labels.length === 3 && s.hits.every(h => h.length === 0), `${what}: no dimension label touches viewport chrome (${s.hits.map(h => h.join('+') || '0').join(' / ')}; chrome ${s.chrome.join(',')})`);
      return s;
    };
    const panel = async (what) => {
      await openSheet();
      const s = await state(p);
      ok(s.heading === s.verdictHead, `${what}: the step h1 is the verdict ("${s.heading}")`);
      if (dev !== 'phone') {
        ok(s.headingVisible, `${what}: the verdict headline is shown`);
        ok(s.headingPx > s.maxOther, `${what}: headline is the largest panel text (${s.headingPx} px vs ${s.maxOther} px)`);
      } else {
        // Phone: the sheet's summary row carries the verdict; the open sheet does not repeat it.
        ok(!s.headingVisible && s.summaryHead === s.heading && s.summaryPx >= s.maxOther, `${what}: sheet summary is the headline, shown once ("${s.summaryHead}" ${s.summaryPx} px ≥ ${s.maxOther} px)`);
      }
      ok(/^Printer:? .+ Change$/.test(s.row) && !/—/.test(s.row) && s.rowH <= 48, `${what}: compact printer row "${s.row}" (${Math.round(s.rowH)} px)`);
      ok(s.selLabel === 'Printer' && s.selCovers, `${what}: the row is the labelled native select`);
      ok(!s.pill, `${what}: no "More below" pill`);
      if (dev !== 'phone') ok(s.noteGap >= 24, `${what}: verdict, dimension cards and margin note end ${s.noteGap} px above the footer (≥ 24)`);
      return s;
    };

    // Branch B: nothing fits (320 mm bracket, default printer).
    let s = await panel(`${dev} B`);
    ok(/^Doesn’t fit/.test(s.heading), `${dev} B: headline leads with the failure`);
    await closeSheet();
    await viewport(`${dev} B`, dev === 'phone' ? null : true);
    await axe(p, `${dev} B fit`);

    // Branch A: a quarter turn fits (custom 70 × 330 × 230 bed).
    await openSheet();
    await p.selectOption('#printer', 'custom');
    for (const [id, val] of [['bedX', '70'], ['bedY', '330'], ['bedZ', '230']]) await p.fill('#' + id, val);
    await p.waitForTimeout(400); await idle(p);
    await p.evaluate(() => { document.getElementById('side').scrollTop = 0; });
    s = await panel(`${dev} A`);
    ok(s.heading === 'Fits in one piece after a 90° turn', `${dev} A: headline names the one-piece outcome`);
    ok(/Custom 70 × 330 × 230 mm/.test(s.row), `${dev} A: printer row follows the selection (${s.row})`);
    ok(s.next === 'Turn 90° to fit', `${dev} A: primary is the turn`);
    await axe(p, `${dev} A fit (panel)`);
    await shot(p, `${dev}-A-fit`);
    await closeSheet();
    s = await viewport(`${dev} A`, dev === 'phone' ? null : true);
    ok(s.labels.some(t => /limit/.test(t)), `${dev} A: the exceeded axis is labelled with its limit`);
    if (dev === 'phone') {
      ok(s.devDpr === 3 && s.dpr === 3, `phone: canvas renders at device density (${s.dpr} of ${s.devDpr})`);
      ok(s.icons.every(i => i.vis && i.name && i.svg) && s.icons[0].glyph !== s.icons[1].glyph && s.icons[0].name !== s.icons[1].name, `phone: two viewport icon buttons, distinct glyphs and names (${s.icons.map(i => i.name + ' ' + i.glyph).join(' | ')})`);
      ok(s.triBg === 'rgba(0, 0, 0, 0)' && s.triBorder === '0px' && s.triPx >= 12, `phone: triad without disc, letters ${s.triPx.toFixed(1)} px (${s.triLetters})`);
      await p.click('#expandView'); await p.waitForTimeout(400);
      let e = (await state(p)).icons[0];
      ok(e.svg && e.glyph === '#i-collapse' && /Close/.test(e.name), `phone: enlarged view keeps an icon and is named "${e.name}"`);
      await axe(p, 'phone enlarged view');
      await p.keyboard.press('Escape'); await p.waitForTimeout(400);
      if (await p.evaluate(() => document.querySelector('.stage').classList.contains('expanded'))) { await p.click('#expandView'); await p.waitForTimeout(400); }
      e = (await state(p)).icons[0];
      ok(e.glyph === '#i-expand' && e.name === 'Enlarge view', 'phone: closing restores the Enlarge glyph and name');
    }
    await shot(p, `${dev}-A-fit-view`);

    // After the turn.
    await p.click('#flowNext');
    await p.waitForFunction(() => document.getElementById('fitHeading').textContent === 'Fits in one piece', null, {timeout: 60000}); await idle(p); await p.waitForTimeout(500);
    s = await panel(`${dev} A turned`);
    ok(s.next === 'Export as one piece' && s.undo, `${dev} A turned: primary "Export as one piece", Undo turn offered`);
    await axe(p, `${dev} A turned (panel)`);
    await shot(p, `${dev}-A-turned`);
    await closeSheet();
    s = await viewport(`${dev} A turned`, dev === 'phone' ? null : true);
    ok(s.labels.every(t => !/limit/.test(t)), `${dev} A turned: no axis flagged`);
    await shot(p, `${dev}-A-turned-view`);

    // The hint leaves after the first orbit (desktop sizes show it).
    if (dev !== 'phone') {
      const c = await p.locator('#viewport canvas').boundingBox();
      await p.mouse.move(c.x + c.width * .6, c.y + c.height * .5); await p.mouse.down(); await p.mouse.move(c.x + c.width * .66, c.y + c.height * .52, {steps: 6}); await p.mouse.up();
      await p.waitForTimeout(900);
      ok(!(await state(p)).hint && await p.evaluate(() => localStorage.getItem('ps.gestureHint') === '0'), `${dev}: viewer hint dismissed after the first orbit and stays dismissed`);
    }
    await ctx.close();
  }
  ok(report.errors.length === 0, `no page errors (${report.errors.join(' | ')})`);
  console.log(`PASS design-r4 (${report.checks.length} checks)`);
} finally { fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2)); await b.close(); }

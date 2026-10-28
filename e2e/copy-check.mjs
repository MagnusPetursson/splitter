// Interface copy check. Drives the app through its main states at desktop
// (1440×900) and phone (390×844), captures every visible control label,
// heading and text block, saves screenshots, and fails when copy breaks the
// interface-copy rules:
//   - a button, link, summary or menu item has more than 5 words, or ends in
//     "?" or "!";
//   - a heading ends in "?", "!" or "." or reads as a slogan ("again",
//     "let's", "we'll", "make it", "start with", "find a", "from … to").
// Word counting ignores numbers, units and symbols ("Turn 90°" is 2 words;
// "&" counts as a word). Allowlisted composites are generated object names and
// data readouts, not labels; see ALLOW below and copy-audit/changes.md.
//
// node e2e/copy-check.mjs URL OUTDIR [--capture-only]
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const {chromium} = createRequire(import.meta.url)(process.env.SPLITTER_PLAYWRIGHT || 'playwright');
const [url = 'http://127.0.0.1:8795/', out = 'evidence/copy-check', flag] = process.argv.slice(2);
const captureOnly = flag === '--capture-only';
fs.mkdirSync(out, {recursive: true});

// Generated names and readouts that legitimately exceed three words. Each
// entry is a selector the control matches (or sits inside).
const ALLOW = [
  ['[data-sample]', 'sample model names: size + noun'],
  ['#flowNav [data-step]', 'step number + step name (status is screen-reader only)'],
  ['.chip, [data-leaf], [data-cut], [data-face], [data-pin], [data-contact]', 'object chips: generated name + measurement'],
  ['.fbitem', 'joint-substitution warning rendered as a selectable row'],
  ['.filelist a', 'file names in the download list'],
  ['#outlinerTree button', 'object list rows: generated name + measurement'],
  ['#licDlg a', 'licence source link'],
  ['#jdFaces button, #jdJoints button', 'joint editor object rows'],
];
// Command-search rows whose label is a verb plus a generated object name.
const ALLOW_TEXT = [
  [/^(Select|Delete) (Cut|Part|Contact|Joint|P\d|C\d)/, 'command row: verb + generated object name'],
  [/^Load (sample )?[\w ]*(\d+ ?mm|bunny|cube)/i, 'command row: verb + sample model name'],
];
const SLOGAN = /\bagain\b|\blet['’]?s\b|\bwe['’]ll\b|\bwe will\b|\bmake it\b|^start with\b|^find a\b|^from .+ to\b|\bmade printable\b|\bclear way\b/i;

const words = (t) => t.replace(/[·|→↔⟂⬇📄…]/g, ' ').split(/\s+/).filter(Boolean)
  .filter((w) => !/^[\d.,×Ø°%±−+–:()\/-]+$/.test(w) && !/^[Ø±]?\d[\d.,]*(mm|cm³|mm³|°|%|k|M|MB|GB|×)?[,.:)]?$/.test(w) && !/^(mm|cm³|mm³|MB|GB)$/.test(w));

const browser = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(process.env.SPLITTER_HOST_RESOLVER_RULES ? ['--host-resolver-rules=' + process.env.SPLITTER_HOST_RESOLVER_RULES] : [])]});
const captures = [], errors = [], failures = [];

async function capture(p, dev, state) {
  const items = await p.evaluate(() => {
    const vis = (e) => e && e.checkVisibility({visibilityProperty: true, opacityProperty: false}) && !e.closest('[hidden], [inert] .sprite');
    const clean = (e) => {
      const c = e.cloneNode(true);
      c.querySelectorAll('.sr-only, svg, kbd, small, .x, .sw').forEach((x) => x.remove());
      return c.textContent.replace(/\s+/g, ' ').trim();
    };
    const where = (e) => {
      const parts = [];
      for (let n = e; n && n !== document.body && parts.length < 3; n = n.parentElement) parts.unshift(n.id ? '#' + n.id : n.tagName.toLowerCase() + (n.classList[0] ? '.' + n.classList[0] : ''));
      return parts.join(' > ');
    };
    const out = [], seen = new Set();
    const push = (kind, e, text) => { if (!text) return; const k = kind + '|' + text; if (seen.has(k)) return; seen.add(k); out.push({kind, where: where(e), text, allow: null, el: e}); };
    for (const e of document.querySelectorAll('button, a[href], summary, [role=option], [role=tab], label.drop b')) {
      if (!vis(e)) continue;
      const kind = e.matches('[role=option]') ? 'menu-item' : e.tagName === 'A' ? 'link' : e.tagName === 'SUMMARY' ? 'disclosure' : 'button';
      const t = e.matches('[role=option]') ? (e.querySelector('span')?.textContent || '').trim() : e.tagName === 'SUMMARY' ? (e.firstChild?.textContent || '').trim() || clean(e) : clean(e);
      push(kind, e, t);
      if (e.getAttribute('aria-label')) push('aria-label', e, e.getAttribute('aria-label'));
      if (e.title) push('tooltip', e, e.title);
    }
    for (const e of document.querySelectorAll('h1, h2, h3, h4, .eyebrow, dialog[open] h2, .fit-head')) if (vis(e) || (e.closest('dialog[open]') && e.textContent.trim())) push('heading', e, e.textContent.replace(/\s+/g, ' ').trim());
    for (const e of document.querySelectorAll('p, li, label, dt, dd, th, td, output, .small, .badge, .why, .head, .reason, .step-intro, #toast, #busyText, .context-help, option:checked, [placeholder]')) {
      if (!vis(e) || e.closest('button, summary, h1, h2, h3, h4')) continue;
      if (e.matches('[placeholder]')) { push('placeholder', e, e.getAttribute('placeholder')); continue; }
      const t = e.matches('li, p, dd, td, label, .small') && e.querySelector('p, li, div') ? '' : e.textContent.replace(/\s+/g, ' ').trim();
      push('text', e, t);
    }
    return out.map(({el, ...r}) => r);
  });
  for (const it of items) {
    it.state = state; it.device = dev;
    if (['button', 'link', 'disclosure', 'menu-item'].includes(it.kind)) {
      // match against ALLOW by re-querying on the page
      it.words = words(it.text).length;
    }
    captures.push(it);
  }
  // Allow-list resolution happens in the page (selectors), per flagged control.
  const flagged = items.filter((it) => ['button', 'link', 'disclosure', 'menu-item'].includes(it.kind) && (words(it.text).length > 5 || /[?!]$/.test(it.text)));
  if (flagged.length) {
    const allowed = await p.evaluate(([texts, allow]) => texts.map((t) => {
      const els = [...document.querySelectorAll('button, a[href], summary, [role=option]')].filter((e) => e.textContent.replace(/\s+/g, ' ').includes(t.slice(0, 24)));
      for (const [sel, why] of allow) if (els.some((e) => e.matches(sel) || e.closest(sel))) return why;
      return null;
    }), [flagged.map((f) => f.text), ALLOW]);
    flagged.forEach((f, i) => {
      const c = captures.find((x) => x.state === state && x.device === dev && x.kind === f.kind && x.text === f.text);
      const byText = ALLOW_TEXT.find(([re]) => re.test(f.text));
      if (allowed[i] || byText) c.allow = allowed[i] || byText[1];
      else failures.push(`${dev}/${state}: ${f.kind} "${f.text}" (${words(f.text).length} words) at ${f.where}`);
    });
  }
  for (const h of items.filter((it) => it.kind === 'heading')) {
    if (/[?!.]$/.test(h.text) || SLOGAN.test(h.text)) failures.push(`${dev}/${state}: heading "${h.text}" reads as a tagline at ${h.where}`);
  }
  await p.screenshot({path: path.join(out, `${dev}-${state}.png`)});
}

const idle = (p) => p.waitForFunction(() => document.querySelector('#busy').classList.contains('hidden'), null, {timeout: 600000});
async function openSheet(p, touch) { if (touch && await p.locator('#sheetToggle[aria-expanded=false]').isVisible()) await p.click('#sheetToggle'); }

try {
  for (const [dev, vp, touch] of [['desktop', {width: 1440, height: 900}, false], ['phone', {width: 390, height: 844}, true]]) {
    const ctx = await browser.newContext({viewport: vp, isMobile: touch, hasTouch: touch, deviceScaleFactor: touch ? 2 : 1, reducedMotion: 'reduce', acceptDownloads: true});
    await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('cc')) { sessionStorage.setItem('cc', '1'); localStorage.clear(); } } catch {} });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(dev + ': ' + e.message));
    await p.goto(url, {waitUntil: 'networkidle'});
    await p.waitForFunction(() => document.querySelector('#printer').options.length > 5);
    await capture(p, dev, '01-load-empty');
    await p.click('#helpBtn'); await p.waitForTimeout(200); await capture(p, dev, '02-help'); await p.keyboard.press('Escape');
    // a file that is not a mesh: the load error note
    await p.setInputFiles('#fileInput', {name: 'notes.stl', mimeType: 'model/stl', buffer: Buffer.from('not a mesh')});
    await p.waitForFunction(() => !document.getElementById('loadNote').classList.contains('hidden'), null, {timeout: 60000}); await idle(p);
    await capture(p, dev, '03-load-error');
    await p.click('[data-sample="bracket_320mm.stl"]');
    await p.waitForFunction(() => window.__ps.workerReady && document.body.dataset.step === 'fit', null, {timeout: 600000}); await idle(p); await p.waitForTimeout(400);
    await capture(p, dev, '04-fit-over');
    await openSheet(p, touch); await capture(p, dev, '05-fit-over-details');
    // a quarter turn fits: custom 70 × 330 × 230 bed
    await p.selectOption('#printer', 'custom');
    for (const [id, v] of [['bedX', '70'], ['bedY', '330'], ['bedZ', '230']]) await p.fill('#' + id, v);
    await p.waitForTimeout(400); await p.evaluate(() => { document.getElementById('side').scrollTop = 0; });
    await capture(p, dev, '06-fit-turn');
    await p.click('#flowNext');
    await p.waitForFunction(() => document.getElementById('fitHeading').textContent.startsWith('Fits in one piece') && !document.querySelector('#fitVerdict.turnable'), null, {timeout: 60000}); await idle(p); await p.waitForTimeout(400);
    await capture(p, dev, '07-fit-turned');
    await p.click('[data-fit-restore]'); await p.waitForFunction(() => document.querySelector('#fitVerdict.turnable'), null, {timeout: 60000}); await idle(p);
    await p.selectOption('#printer', 'prusa-core-one'); await p.waitForTimeout(300);
    await p.evaluate(() => { document.getElementById('side').scrollTop = 0; });
    // Plan cuts → Join
    await p.click('#flowNext'); await p.waitForFunction(() => window.__ps.plan, null, {timeout: 600000}); await idle(p); await p.waitForTimeout(400);
    await capture(p, dev, '08-join');
    await p.click('#flowNav [data-step="split"]'); await p.waitForTimeout(300); await openSheet(p, touch);
    await capture(p, dev, '09-split-result');
    await p.evaluate(() => document.querySelector('#planSummary [data-cut]')?.click()); await p.waitForTimeout(300);
    await capture(p, dev, '10-split-cut-selected');
    await p.click('#expertMode'); await p.waitForTimeout(300);
    await capture(p, dev, '11-split-expert');
    if (!touch) { if (!await p.locator('#outliner').isVisible()) await p.click('#objectsBtn'); await p.waitForTimeout(200); await capture(p, dev, '12-objects'); if (await p.locator('#outlinerClose').isVisible()) await p.click('#outlinerClose'); }
    await p.keyboard.press('Escape');
    await p.evaluate(() => document.getElementById('commandBtn').click()); await p.waitForTimeout(300);
    await capture(p, dev, '13-palette'); await p.keyboard.press('Escape');
    await p.click('#expertMode'); await p.waitForTimeout(200);
    await p.click('#flowNav [data-step="join"]'); await p.waitForTimeout(300);
    await p.click('#flowNext'); await p.waitForFunction(() => window.__ps.export, null, {timeout: 600000}); await idle(p); await p.waitForTimeout(400);
    await openSheet(p, touch);
    await capture(p, dev, '14-export');
    await ctx.close();
  }
} catch (e) { failures.push('run failed: ' + e.message); }
finally { await browser.close(); }

fs.writeFileSync(path.join(out, 'rendered.json'), JSON.stringify(captures, null, 1));
const controls = captures.filter((c) => c.words != null);
const report = {states: [...new Set(captures.map((c) => c.device + '/' + c.state))], strings: captures.length, controls: controls.length,
  allowlisted: [...new Set(controls.filter((c) => c.allow).map((c) => `${c.text} — ${c.allow}`))], failures, errors};
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
console.log(`${report.states.length} states, ${report.strings} strings, ${report.controls} control labels, ${failures.length} rule failures, ${errors.length} page errors`);
for (const f of failures) console.log('FAIL ' + f);
for (const e of errors) console.log('ERROR ' + e);
if (!captureOnly && (failures.length || errors.length)) process.exit(1);
console.log(captureOnly ? 'captured (rules not enforced)' : 'PASS copy check');

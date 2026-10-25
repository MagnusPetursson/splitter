// Joint-selection smoke: default style after clearing storage, auto split,
// switch selector to Magnets (joints re-placed without re-split), fallback
// badges, restored-settings note.  node e2e/joints.mjs <url> <outdir>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pw = require('playwright');
const url = process.argv[2];
const out = process.argv[3] || 'jsmoke';
fs.mkdirSync(out, { recursive: true });
const errors = [];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('requestfailed', (r) => { if (!r.url().startsWith('blob:')) errors.push('requestfailed: ' + r.url()); });
const idle = () => page.waitForFunction(() => document.getElementById('busy').classList.contains('hidden'), null, { timeout: 600000, polling: 200 });
const ready = () => page.waitForFunction(() => document.querySelectorAll('#printer option').length > 5, null, { timeout: 60000 });
const t0 = Date.now();
const lap = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s  ${s}`);
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) errors.push('check: ' + msg); };
const summary = () => page.evaluate(() => {
  const P = window.__ps.plan;
  const kinds = {};
  for (const j of P.joints) kinds[j.kind] = (kinds[j.kind] || 0) + 1;
  return { parts: P.leaves.filter((l) => !l.empty).length, cuts: P.tree.nodes.filter((n) => n.cut).map((n) => [n.cut.n, +n.cut.d.toFixed(3)]), kinds,
    seams: P.patches.filter((p) => p.seam && p.seam.kind !== 'none').map((p) => p.seam.kind),
    fallbacks: P.patches.filter((p) => p.fallback).map((p) => `${p.fallback.want} -> ${p.fallback.got}: ${p.fallback.reason}`),
    singles: P.patches.filter((p) => p.single).length, badgeEls: document.querySelectorAll('.fbitem').length };
});
async function loadSample(name) {
  await page.click(`[data-sample="${name}"]`);
  await page.waitForFunction((n) => window.__ps.model && window.__ps.model.name === n && window.__ps.workerReady, name, { timeout: 600000 });
  await idle();
}
try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await ready();
  const st = await page.evaluate(() => ({ style: document.getElementById('jointStyle').value, label: document.getElementById('jointStyle').selectedOptions[0].textContent,
    restored: !document.getElementById('restoredNote').classList.contains('hidden'), ver: document.getElementById('buildVer').textContent }));
  lap(JSON.stringify(st));
  check(st.style === 'glued' && st.label === 'Dowel pins (glue)', 'default style is Dowel pins after clearing storage');
  check(!st.restored, 'no restored note on a clean load');
  await page.selectOption('#printer', 'prusa-mini');

  // bracket: solid part → dowels; selector → Magnets re-places without re-split
  await loadSample('bracket_320mm.stl');
  await page.click('#autoSplit'); await page.waitForFunction(() => window.__ps.plan, null, { timeout: 600000 }); await idle();
  const b1 = await summary(); lap('bracket dowels ' + JSON.stringify(b1));
  check((b1.kinds.dowel || 0) >= 2 && !b1.seams.length && !b1.fallbacks.length, 'bracket gets dowels, no seams, no fallbacks');
  let seq = await page.evaluate(() => window.__ps.planSeq);
  await page.selectOption('#jointStyle', 'magnets');
  await page.waitForFunction((s) => window.__ps.planSeq > s && window.__ps.plan.settings.jointStyle === 'magnets', seq, { timeout: 60000 }); await idle();
  const b2 = await summary(); lap('bracket magnets ' + JSON.stringify(b2));
  check(JSON.stringify(b2.cuts) === JSON.stringify(b1.cuts), 'cuts unchanged after changing the selector');
  check((b2.kinds.magnet || 0) >= 2 && !b2.kinds.dowel, 'magnets replace dowels without pressing Auto split');
  lap('note: ' + await page.evaluate(() => document.getElementById('styleNote').textContent));
  await page.click('#faceList button'); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, '1_bracket_magnets.png') });

  // bowl shell, dowels: visible fallback badges + "use dowels anyway"
  seq = await page.evaluate(() => window.__ps.planSeq);
  await page.selectOption('#jointStyle', 'glued');
  await loadSample('bowl_shell_300mm.stl');
  await page.click('#autoSplit'); await page.waitForFunction(() => window.__ps.plan && window.__ps.plan.settings.jointStyle === 'glued' && window.__ps.model.name.startsWith('bowl'), null, { timeout: 600000 }); await idle();
  const w1 = await summary(); lap('bowl dowels ' + JSON.stringify(w1));
  check(w1.badgeEls === w1.fallbacks.length + w1.singles, 'every substitution / single pin has a visible badge');
  check(!w1.seams.includes('finger') || w1.fallbacks.every((f) => /finger/.test(f)), 'no silent finger seams');
  if (w1.badgeEls) {
    await page.click('.fbitem'); await page.waitForTimeout(300);
    const btn = await page.$('#seamEditor [data-force="1"]');
    if (btn) {
      seq = await page.evaluate(() => window.__ps.planSeq);
      await btn.click();
      await page.waitForFunction((s) => window.__ps.planSeq > s, seq); await idle();
      const w3 = await summary(); lap('after "use dowels anyway" ' + JSON.stringify(w3));
      check((w3.kinds.dowel || 0) >= 1 && w3.fallbacks.length === w1.fallbacks.length - 1, 'forcing one contact puts dowels there, other badges stay');
      lap('seam editor: ' + (await page.evaluate(() => document.getElementById('seamEditor').innerText)).replace(/\n/g, ' | ').slice(0, 400));
    }
    // show a still-substituted contact
    await page.evaluate(() => document.getElementById('seamEditor').scrollIntoView({ block: 'end' }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, '3_bowl_forced_contact.png') });
    const other = await page.$('.fbitem');
    if (other) { await other.click(); await page.waitForTimeout(300); }
  }
  await page.evaluate(() => document.getElementById('planSummary').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, '2_bowl_fallbacks.png') });
  await page.evaluate(() => document.getElementById('seamEditor').scrollIntoView({ block: 'end' }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, '2b_bowl_fallback_contact.png') });
  await page.selectOption('#jointStyle', 'magnets');
  await page.waitForTimeout(200); await idle();

  // reload: restored note; reset → Dowels
  await page.reload({ waitUntil: 'networkidle' }); await ready();
  const r = await page.evaluate(() => ({ style: document.getElementById('jointStyle').value, restored: !document.getElementById('restoredNote').classList.contains('hidden') }));
  check(r.style === 'magnets' && r.restored, 'reload restores Magnets and says so');
  await page.click('#resetDefaults');
  const r2 = await page.evaluate(() => ({ style: document.getElementById('jointStyle').value, printer: document.getElementById('printer').value, saved: localStorage.getItem('ps.settings') }));
  check(r2.style === 'glued' && r2.printer === 'prusa-core-one' && !r2.saved, 'Reset to defaults → Dowel pins, Core One, storage cleared');
} catch (e) { errors.push('exception: ' + e.message); }
await browser.close();
console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'OK no errors');
process.exit(errors.length ? 1 : 0);

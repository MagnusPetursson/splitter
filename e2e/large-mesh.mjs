// Large-mesh and joint-editor end-to-end test (synthetic meshes only).
//   node e2e/large-mesh.mjs <url> [outdir]
// 1. a mesh that cannot be made watertight is refused with the reason
// 2. a 720k-triangle torus is simplified for planning, with the measured
//    deviation shown; staged progress + cancel during Auto split
// 3. the crash breadcrumb explains a tab that died mid-plan
// 4. the pop-out joint editor: open, zoom, keyboard, add a joint, Esc,
//    desktop and phone
// 5. building cuts the full-detail original
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.SPLITTER_PLAYWRIGHT || 'playwright');
const url = process.argv[2];
const out = process.argv[3] || 'large-out';
fs.mkdirSync(out, { recursive: true });

// ---------- synthetic meshes ----------
function stl(tris) {
  const b = Buffer.alloc(84 + 50 * tris.length);
  b.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => { let o = 84 + 50 * i + 12; for (const p of t) for (const x of p) { b.writeFloatLE(x, o); o += 4; } });
  return b;
}
// same vertex order and diagonals as internal/mesh Box()
function box(a, c) {
  const v = (i) => [[a[0], c[0]][i & 1], [a[1], c[1]][(i >> 1) & 1], [a[2], c[2]][(i >> 2) & 1]];
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  return quads.flatMap((q) => [[v(q[0]), v(q[1]), v(q[2])], [v(q[0]), v(q[2]), v(q[3])]]);
}
// bumpy torus, nu × nv quads: smooth enough to simplify, curved everywhere
function torus(R, r, nu, nv) {
  const P = (i, j) => {
    const u = (2 * Math.PI * (i % nu)) / nu, v = (2 * Math.PI * (j % nv)) / nv;
    const rr = r * (1 + 0.08 * Math.sin(5 * u) * Math.cos(3 * v));
    return [(R + rr * Math.cos(v)) * Math.cos(u) + R + r + 5, (R + rr * Math.cos(v)) * Math.sin(u) + R + r + 5, rr * Math.sin(v) + r + 2];
  };
  const t = [];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1); t.push([a, b, c], [a, c, d]); }
  return t;
}
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'large-e2e-'));
const broken = path.join(tmp, 'touching_boxes.stl');
fs.writeFileSync(broken, stl([...box([0, 0, 0], [10, 10, 10]), ...box([10, 10, 0], [20, 20, 10])]));
const big = path.join(tmp, 'torus_720k.stl');
fs.writeFileSync(big, stl(torus(80, 22, 900, 400)));

// ---------- harness ----------
const errors = [];
const t0 = Date.now();
const lap = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)} s  ${s}`);
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) errors.push('check: ' + msg); };
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(process.env.SPLITTER_HOST_RESOLVER_RULES ? ['--host-resolver-rules='+process.env.SPLITTER_HOST_RESOLVER_RULES] : [])] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const shot = (n) => page.screenshot({ path: path.join(out, n + '.png') });
const idle = () => page.waitForFunction(() => document.getElementById('busy').classList.contains('hidden'), null, { timeout: 900000, polling: 250 });
const busyText = () => page.evaluate(() => ({ title: document.getElementById('busyTitle').textContent, text: document.getElementById('busyText').textContent, time: document.getElementById('busyTime').textContent, stages: [...document.querySelectorAll('#busyStages li')].map((l) => `${l.textContent}:${l.className}`) }));

try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('#printer option').length > 5, null, { timeout: 60000 });


  // 1. watertight refusal
  await page.setInputFiles('#fileInput', broken);
  await page.waitForFunction(() => !document.getElementById('loadNote').classList.contains('hidden'), null, { timeout: 60000 });
  const note = await page.locator('#loadNote').textContent();
  lap(note);
  check(/not a closed solid/.test(note) && /shared by more than two faces/.test(note) && /not a memory limit/.test(note), 'watertight refusal names the defect and says it is not memory');
  check(!(await page.evaluate(() => window.__ps.model)), 'no model after a refusal');
  await shot('01-watertight-refusal');

  // 2. large mesh: staged load with simplification
  await page.setInputFiles('#fileInput', big);
  await page.waitForFunction(() => document.getElementById('busy').classList.contains('staged'), null, { timeout: 30000 });
  await page.waitForFunction(() => [...document.querySelectorAll('#busyStages li')].some((l) => l.dataset.stage === 'simplify' && l.className === 'on'), null, { timeout: 120000 });
  const lb = await busyText();
  lap(JSON.stringify(lb));
  check(lb.stages.some((s) => s === '✓ Repair:done' || s === 'Repair:done') && lb.stages.some((s) => s === 'Simplify:on'), 'load stages: repair done, simplifying now');
  check(/\d+ s/.test(lb.time) && /estimate ≈/.test(lb.time), `elapsed + estimate shown (${lb.time})`);
  await shot('02-load-simplifying');
  await page.waitForFunction(() => window.__ps.model && window.__ps.workerReady, null, { timeout: 300000 });
  await idle();
  const m = await page.evaluate(() => ({ tris: window.__ps.model.tris, simp: window.__ps.model.simplified, kept: window.__ps.model.originalKept, note: document.getElementById('meshNote').textContent }));
  lap(`model ${m.tris} tris; simplified ${JSON.stringify(m.simp)}`);
  check(m.simp && m.simp.inputTris === 720000 && m.tris <= 400000 && m.simp.closed, 'simplified 720k → ≤ 400k, closed');
  check(m.simp.maxDev < 0.1 && m.simp.samples > 50000, `measured deviation ${m.simp.maxDev.toFixed(4)} mm over ${m.simp.samples} samples`);
  check(/Simplified for planning: 720 k → /.test(m.note) && /max 0\.\d+ mm/.test(m.note) && /full-detail original/.test(m.note), 'banner states simplification, deviation and export source');
  check(await page.locator('#meshNote button', { hasText: 'Use full detail' }).isEnabled(), '"Use full detail" offered');
  await page.click('[data-step="load"]');await page.locator('#meshNote').scrollIntoViewIfNeeded();
  await shot('03-simplified-banner');

  await page.click('[data-step="fit"]');await page.selectOption('#printer','bambu-a1-mini');await page.click('[data-step="split"]');
  // staged planning progress, then cancel
  await page.click('#autoSplit');
  await page.waitForFunction(() => /^Cut \d+/.test(document.getElementById('busyText').textContent), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const pb = await busyText();
  lap(JSON.stringify(pb));
  check(/^Cut 1( of ~\d+)? · evaluating (cut planes|support check) \d+\/\d+/.test(pb.text), 'cut search shows candidates done/total');
  check(/\d+ s/.test(pb.time), 'elapsed time shown');
  check(await page.locator('#busyCancel').isVisible(), 'cancel button visible while planning');
  await shot('04-plan-progress');
  await page.click('#busyCancel');
  await page.waitForFunction(() => /Restoring/.test(document.getElementById('busyTitle').textContent) && !document.getElementById('busy').classList.contains('hidden'), null, { timeout: 30000, polling: 50 });
  check(await page.locator('#autoSplit').isDisabled(), 'Auto split disabled while restoring');
  await page.waitForFunction(() => window.__ps.model && window.__ps.workerReady && document.getElementById('busy').classList.contains('hidden'), null, { timeout: 300000 });
  check(!(await page.evaluate(() => window.__ps.plan)), 'cancelled plan leaves no plan; model restored');
  lap('cancelled and restored');

  // full run
  await page.click('#autoSplit');
  await page.waitForFunction(() => window.__ps.plan, null, { timeout: 900000 });
  await idle();
  const pl = await page.evaluate(() => ({ parts: window.__ps.plan.leaves.filter((l) => !l.empty).length, joints: window.__ps.plan.joints.length, fits: window.__ps.plan.fits, t: window.__ps.plan.timing }));
  lap(`plan ${JSON.stringify(pl)}`);
  check(pl.fits && pl.parts >= 2, 'planned and fits');

  // 3. crash breadcrumb
  await page.evaluate(() => localStorage.setItem('ps.inflight', JSON.stringify({ what: 'plan', name: 'huge.stl', tris: 1800000, full: true, t: Date.now() })));
  const p2 = await ctx.newPage();
  await p2.goto(url, { waitUntil: 'networkidle' });
  await p2.waitForFunction(() => !document.getElementById('loadNote').classList.contains('hidden'), null, { timeout: 30000 });
  const crash = await p2.locator('#loadNote').textContent();
  check(/stopped the tab/.test(crash) && /running out of memory/.test(crash) && /1\.80 M/.test(crash), 'crash note after a tab died mid-plan');
  await p2.screenshot({ path: path.join(out, '05-crash-note.png') });
  await p2.close();

  await page.click('[data-step="join"]');await page.selectOption('#jointStyle','filament');await idle();
  // 4. joint editor
  await page.locator('#mapWrap').scrollIntoViewIfNeeded();
  await shot('06-inline-preview');
  await page.click('#precisionMap summary');await page.click('#openEditor');
  await page.waitForFunction(() => !document.getElementById('jointDlg').classList.contains('hidden'), null, { timeout: 10000 });
  await page.waitForTimeout(300);
  const dlg = await page.evaluate(() => { const r = document.getElementById('jdMap').getBoundingClientRect(); return { w: r.width, h: r.height, focus: document.activeElement.id, title: document.getElementById('jdTitle').textContent, chips: document.querySelectorAll('#jdJoints [data-jdj]').length, side: !!document.querySelector('#jdSide #seamEditor') }; });
  lap(JSON.stringify(dlg));
  check(dlg.w > 700 && dlg.h > 500, `editor canvas is large (${Math.round(dlg.w)}×${Math.round(dlg.h)})`);
  check(dlg.focus === 'jdMap', 'focus moves into the editor');
  check(dlg.side, 'contact editor moved into the overlay');
  await shot('07-editor-desktop');
  // zoom with buttons and keys
  await page.click('#jdIn'); await page.keyboard.press('+');
  const z = await page.locator('#jdZoom').textContent();
  check(z === '225 %', `zoom buttons/keys (${z})`);
  await page.keyboard.press('0');
  check((await page.locator('#jdZoom').textContent()) === '100 %', 'fit resets zoom');
  // wheel zoom at a point
  const cb = await page.locator('#jdMap').boundingBox();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.wheel(0, -400);
  check((await page.evaluate(() => window.__jed.map.z)) > 1.5, 'wheel zooms');
  await page.keyboard.press('0');
  // keyboard: next joint
  if (dlg.chips) {
    await page.focus('#jdMap');
    await page.keyboard.press('ArrowRight');
    const sel = await page.evaluate(() => window.__ps.sel.joint);
    check(sel != null, `Arrow selects a joint (J${sel})`);
    check(await page.evaluate((id) => document.querySelector(`#jdJoints [data-jdj="${id}"]`).classList.contains('sel'), sel), 'joint chip shows the selection');
  }
  // add a joint where there is room: find the deepest point of the face
  const n0 = await page.evaluate(() => window.__ps.plan.joints.length);
  await page.click('#jdAdd');
  const target = await page.evaluate(() => {
    const m = window.__jed.map, r = m.face.raster;
    let best = -1, bi = 0;
    for (let k = 0; k < m.edt.length; k++) if (m.lab[k] && m.edt[k] > best) {
      // stay away from existing joints
      const i = k % r.w, j = Math.floor(k / r.w);
      const q = [r.origin[0] + (i + 0.5) * r.res, r.origin[1] + (j + 0.5) * r.res];
      if (m.joints().every((x) => Math.hypot(x.p[0] - q[0], x.p[1] - q[1]) > 8)) { best = m.edt[k]; bi = k; }
    }
    const i = bi % r.w, j = Math.floor(bi / r.w);
    const q = [r.origin[0] + (i + 0.5) * r.res, r.origin[1] + (j + 0.5) * r.res];
    const c = m.view().toC(q), b = m.c.getBoundingClientRect();
    return { x: b.left + c[0] * b.width / m.c.width, y: b.top + c[1] * b.height / m.c.height, hint: document.getElementById('jdHint').textContent };
  });
  lap(`add at ${JSON.stringify(target)}`);
  check(/green/.test(target.hint) && /filament pin/.test(target.hint), 'add mode explains the green area and offers the chosen style (filament pin)');
  await shot('08-editor-add-mode');
  await page.mouse.click(target.x, target.y);
  await page.waitForFunction((n) => window.__ps.plan.joints.length === n + 1 && document.getElementById('busy').classList.contains('hidden'), n0, { timeout: 300000 });
  check(true, 'joint added from the overlay (plan and 3D view updated)');
  check(await page.evaluate(() => !document.getElementById('jointDlg').classList.contains('hidden')), 'editor stays open after the edit');
  // beside-3D layout
  await page.click('#jdDock');
  await page.waitForTimeout(400);
  const dock = await page.evaluate(() => ({ dlg: document.getElementById('jointDlg').getBoundingClientRect().width, vp: document.getElementById('viewport').getBoundingClientRect().width }));
  check(dock.vp > 300 && dock.dlg > 600, `beside-3D shows both (${Math.round(dock.dlg)} + ${Math.round(dock.vp)} px)`);
  // the face must be fitted to the narrower canvas: its outline inside the canvas
  const inView = await page.evaluate(() => { const m = window.__jed.map, V = m.view(); return m.face.loops.flat().every((p) => { const q = V.toC(p); return q[0] >= 0 && q[1] >= 0 && q[0] <= m.c.width && q[1] <= m.c.height; }); });
  check(inView, 'beside-3D re-fits the face to the canvas');
  await shot('09-editor-beside-3d');
  await page.click('#jdDock');
  await page.keyboard.press('Escape');
  check(await page.evaluate(() => document.getElementById('jointDlg').classList.contains('hidden')), 'Esc closes the editor');
  check(await page.evaluate(() => !!document.querySelector('#mapWrap ~ * #seamEditor, #stepJoints #seamEditor') || !!document.querySelector('.side #seamEditor')), 'contact editor returns to the side panel');

  // 5. build from the full-detail original
  await page.click('[data-step="export"]');await page.click('#buildBtn');
  await page.waitForFunction(() => window.__ps.built, null, { timeout: 900000 });
  await idle();
  const bi = await page.locator('#buildInfo').textContent();
  check(/full-detail original \(720 k/.test(bi) && /All parts are closed manifolds/.test(bi), 'parts cut from the full-detail original, all manifold');
  await shot('10-built-full-detail');

  // phone
  const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ph.addInitScript(() => { try { localStorage.setItem('ps.sheet', 'open'); } catch {} });
  const pp = await ph.newPage();
  pp.on('pageerror', (e) => errors.push('phone pageerror: ' + e.message));
  await pp.goto(url, { waitUntil: 'networkidle' });
  await pp.waitForFunction(() => document.querySelectorAll('#printer option').length > 5, null, { timeout: 60000 });
  await pp.click('[data-sample]');
  await pp.waitForFunction(() => window.__ps.model && window.__ps.workerReady && document.getElementById('busy').classList.contains('hidden'), null, { timeout: 300000 });
  await pp.click('[data-step="fit"]');await pp.selectOption('#printer','bambu-a1-mini');await pp.click('[data-step="split"]');
  await pp.click('#autoSplit');
  await pp.waitForFunction(() => window.__ps.plan && document.getElementById('busy').classList.contains('hidden'), null, { timeout: 600000 });
  await pp.click('[data-step="join"]');await pp.click('#precisionMap summary');await pp.locator('#jointMap').scrollIntoViewIfNeeded();
  await pp.screenshot({ path: path.join(out, '11-phone-inline.png') });
  await pp.locator('#jointMap').tap();
  await pp.waitForFunction(() => !document.getElementById('jointDlg').classList.contains('hidden'), null, { timeout: 10000 });
  await pp.waitForTimeout(400);
  const pm = await pp.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    return { map: r('jdMap'), close: r('jdClose'), add: r('jdAdd'), zin: r('jdIn'), fit: r('jdFit'), overflow: document.getElementById('jointDlg').scrollWidth > innerWidth + 1, dock: getComputedStyle(document.getElementById('jdDock')).display };
  });
  lap(JSON.stringify(pm));
  check(pm.map.width >= 370 && pm.map.height >= 400, 'phone: editor map fills the width');
  check(pm.close.width >= 44 && pm.add.height >= 44 && pm.zin.width >= 44 && pm.fit.width >= 44, 'phone: hit targets ≥ 44 px');
  check(!pm.overflow, 'phone: no horizontal overflow');
  check(pm.dock === 'none', 'phone: no beside-3D option');
  await pp.screenshot({ path: path.join(out, '12-phone-editor.png') });
  await pp.click('#jdClose');
  check(await pp.evaluate(() => document.getElementById('jointDlg').classList.contains('hidden')), 'phone: close button');
  await ph.close();
} catch (err) {
  errors.push('exception: ' + (err.stack || err.message));
  await shot('zz-failure').catch(() => {});
}
await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
const real = errors.filter((e) => !/favicon/.test(e));
console.log(real.length ? 'FAILED\n' + real.join('\n') : 'ALL PASSED');
process.exit(real.length ? 1 : 0);

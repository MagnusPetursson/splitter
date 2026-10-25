// Geometry worker: owns the Manifold WASM instance so the UI never blocks.
import Module from '../vendor/manifold/manifold.js';
import { createBuilder } from './builder.js';

let wasm = null, B = null, M = null;

async function init() {
  if (!wasm) {
    wasm = await Module();
    wasm.setup();
    B = createBuilder(wasm);
  }
}

function post(type, data, transfer) { self.postMessage({ type, ...data }, transfer || []); }

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    await init();
    if (msg.type === 'mesh') {
      if (M) { M.delete(); M = null; }
      const t = Date.now();
      M = B.toManifold(msg.mesh);
      post('meshok', { volume: M.volume(), genus: M.genus(), ms: Date.now() - t, id: msg.id });
    } else if (msg.type === 'build') {
      if (!M) throw new Error('no model loaded in the worker');
      const plan = msg.plan;
      const res = B.build(M, plan, { onProgress: (p) => post('progress', p) });
      post('progress', { phase: 'verify', done: 0, total: 1 });
      const parts = [];
      const transfer = [];
      for (const p of res.parts) {
        const mesh = B.meshOf(p.manifold);
        transfer.push(mesh.positions.buffer, mesh.indices.buffer);
        parts.push({ leaf: p.leaf, label: p.label, volume: p.volume, status: p.status, genus: p.genus, mesh });
      }
      // unique pins
      const pins = [];
      for (const pin of res.pins) {
        const key = pin.d.toFixed(2) + '/' + pin.len.toFixed(1);
        const ex = pins.find((x) => x.key === key);
        if (ex) { ex.count++; continue; }
        const mesh = B.meshOf(pin.manifold);
        transfer.push(mesh.positions.buffer, mesh.indices.buffer);
        pins.push({ key, d: pin.d, len: pin.len, count: 1, mesh, volume: pin.manifold.volume() });
      }
      // verification: interference between mating parts
      const byLeaf = {};
      for (const p of res.parts) (byLeaf[p.leaf] = byLeaf[p.leaf] || []).push(p.manifold);
      const uni = (l) => (byLeaf[l] ? (byLeaf[l].length > 1 ? wasm.Manifold.union(byLeaf[l]) : byLeaf[l][0]) : null);
      const checks = [];
      for (const pa of plan.patches) {
        const a = uni(pa.negLeaf), b = uni(pa.posLeaf);
        if (!a || !b) continue;
        const iv = a.intersect(b).volume();
        const cut = plan.tree.nodes[pa.node].cut;
        const prot = a.trimByPlane(cut.n, cut.d + 0.05).volume() + b.trimByPlane(cut.n.map((x) => -x), -cut.d + 0.05).volume();
        checks.push({ patch: pa.id, interference: iv, engage: prot });
      }
      const all = wasm.Manifold.union(res.parts.map((p) => p.manifold));
      const voids = M.subtract(all).volume();
      const outside = all.subtract(M).volume();
      post('built', { parts, pins, checks, voids, outside, original: M.volume(), ms: res.ms }, transfer);
      B.collect();
    } else if (msg.type === 'coupon') {
      const c = B.coupon(msg.opts);
      const parts = c.parts.map((p) => ({ label: p.label, mesh: B.meshOf(p.manifold), volume: p.manifold.volume(), status: p.manifold.status() }));
      post('coupon', { parts, steps: c.steps, d: c.d }, parts.flatMap((p) => [p.mesh.positions.buffer, p.mesh.indices.buffer]));
      B.collect();
    }
  } catch (err) {
    try { B && B.collect(); } catch (_) { /* ignore */ }
    post('error', { message: String((err && err.message) || err), stage: msg.type });
  }
};

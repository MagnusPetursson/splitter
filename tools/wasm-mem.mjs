// Measure the Go/WASM planner's memory in Node (same wasm as the browser).
// node tools/wasm-mem.mjs model.stl '{"simplify":"auto"}' [plan]
// Prints the wasm linear-memory size (what the browser must allocate; it
// never shrinks) after each stage.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
globalThis.require = createRequire(import.meta.url);
globalThis.fs = fs;
globalThis.path = path;
await import(path.join(here, '../web/js/wasm_exec.js'));

const [file, optJSON = '{}', doPlan = '', printer = '180,180,180'] = process.argv.slice(2);
const t0 = Date.now();
let peak = 0, inst = null;
const memMB = () => inst.exports.mem.buffer.byteLength / 2 ** 20;
let lastStage = '';
globalThis.postMessage = (m) => {
  if (!inst) return;
  peak = Math.max(peak, memMB());
  if (m.stage && (m.stage !== lastStage || process.env.ALL)) {
    lastStage = m.stage;
    console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)} s  ${memMB().toFixed(0).padStart(5)} MB  ${m.stage} ${m.message || ''}`);
  }
};
const go = new Go();
const r = await WebAssembly.instantiate(fs.readFileSync(path.join(here, '../web/wasm/splitter.wasm')), go.importObject);
inst = r.instance;
go.run(inst);
while (!globalThis.splitter) await new Promise((res) => setTimeout(res, 10));
const data = new Uint8Array(fs.readFileSync(file));
const info = JSON.parse(globalThis.splitter.load(path.basename(file), data, optJSON));
if (info.error) { console.log('ERROR', info.kind, info.error); }
else {
  console.log(`loaded: ${info.tris} tris, mem ${memMB().toFixed(0)} MB (Go sys ${info.memMB.toFixed(0)} MB) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (info.simplified) console.log('simplified', JSON.stringify(info.simplified));
}
if (doPlan && !info.error) {
  const [X, Y, Z] = printer.split(',').map(Number);
  const t1 = Date.now();
  const pl = JSON.parse(globalThis.splitter.plan(JSON.stringify({ mode: 'auto', settings: { bed: { X, Y, Z }, margin: 3, nozzle: 0.4, jointStyle: 'filament', autoSplit: true, autoJoints: true } })));
  if (pl.error) console.log('PLAN ERROR', pl.error);
  else console.log(`planned: ${pl.leaves.length} parts, ${pl.joints.length} joints in ${((Date.now() - t1) / 1000).toFixed(1)} s; mem ${memMB().toFixed(0)} MB; timing ${JSON.stringify(pl.timing)}`);
}
console.log(`peak wasm memory ${Math.max(peak, memMB()).toFixed(0)} MB`);
process.exit(0);

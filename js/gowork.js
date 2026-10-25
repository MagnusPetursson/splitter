// Go planner worker: runs the Go code (mesh repair, cut planning, joint
// placement, export packaging) compiled to WebAssembly, so nothing leaves
// the browser. Requests: {id, fn, args}; replies: {type:'goresult', id, result}.
import './wasm_exec.js';

let ready = null;
function start() {
  if (ready) return ready;
  ready = (async () => {
    const go = new Go();
    const url = new URL('../wasm/splitter.wasm', import.meta.url);
    let inst;
    try {
      inst = (await WebAssembly.instantiateStreaming(fetch(url), go.importObject)).instance;
    } catch (_) {
      // wrong MIME type or no streaming support: fall back to a plain fetch
      const buf = await (await fetch(url)).arrayBuffer();
      inst = (await WebAssembly.instantiate(buf, go.importObject)).instance;
    }
    go.run(inst);
    for (let i = 0; !self.splitter && i < 200; i++) await new Promise((r) => setTimeout(r, 10));
    if (!self.splitter) throw new Error('planner WebAssembly did not start');
  })();
  return ready;
}

self.onmessage = async (e) => {
  const { id, fn, args } = e.data;
  try {
    await start();
    const result = self.splitter[fn](...(args || []));
    const transfer = [];
    if (result instanceof Uint8Array) transfer.push(result.buffer);
    else if (result && result.files) for (const k of Object.keys(result.files)) transfer.push(result.files[k].buffer);
    self.postMessage({ type: 'goresult', id, result }, transfer);
  } catch (err) {
    self.postMessage({ type: 'goresult', id, error: String(err && err.message || err) });
  }
};

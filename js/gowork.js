// Go planner worker: runs the Go code (mesh repair, cut planning, joint
// placement, export packaging) compiled to WebAssembly, so nothing leaves
// the browser. Requests: {id, fn, args}; replies: {type:'goresult', id, result}.
import './wasm_exec.js';

// The Go runtime prints fatal errors (e.g. "out of memory") to the console
// and then exits; keep the last lines so the page can say what happened.
const tail = [];
for (const k of ['log', 'error']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { tail.push(a.join(' ')); if (tail.length > 40) tail.shift(); orig(...a); };
}

let ready = null, go = null;
function start() {
  if (ready) return ready;
  ready = (async () => {
    go = new Go();
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

function died(err) {
  const log = tail.join('\n');
  const oom = /out of memory|Out of memory|memory access out of bounds|Cannot allocate|grow/i.test(log + ' ' + (err && err.message || ''));
  return {
    kind: oom ? 'memory' : 'crash',
    error: oom
      ? 'The planner ran out of memory (the browser gives one tab only a few GB). The file may be fine: simplify the mesh, or plan it with the command-line tool.'
      : `The planner stopped unexpectedly: ${(err && err.message) || log.split('\n').slice(-3).join(' ') || 'no message'}`,
  };
}

self.onmessage = async (e) => {
  const { id, fn, args } = e.data;
  try {
    await start();
    if (go.exited) { self.postMessage({ type: 'goresult', id, ...died(null) }); return; }
    const result = self.splitter[fn](...(args || []));
    if (go.exited) { self.postMessage({ type: 'goresult', id, ...died(null) }); return; }
    const transfer = [];
    if (result instanceof Uint8Array) transfer.push(result.buffer);
    else if (result && result.files) for (const k of Object.keys(result.files)) transfer.push(result.files[k].buffer);
    self.postMessage({ type: 'goresult', id, result }, transfer);
  } catch (err) {
    if (go && go.exited) { self.postMessage({ type: 'goresult', id, ...died(err) }); return; }
    const m = String(err && err.message || err);
    self.postMessage({ type: 'goresult', id, error: m, ...(/out of memory|RangeError.*(memory|allocation)/i.test(m) ? died(err) : {}) });
  }
};

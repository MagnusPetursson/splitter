// Backends for the planner. The same UI runs against
//  - local: the Go planner compiled to WebAssembly in a Web Worker (static
//    hosting, e.g. GitHub Pages; files never leave the browser), or
//  - server: `print-splitter serve`, the same Go code behind an HTTP API.
// The server marks index.html with <meta name="splitter-backend" content="server">.

const api = (p) => new URL(p, document.baseURI).href;

async function getJSON(url, opts) {
  const r = await fetch(api(url), opts);
  const t = await r.text();
  let j;
  try { j = JSON.parse(t); } catch (_) { throw new Error(`${r.status} ${t.slice(0, 200)}`); }
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
async function pollJob(id, onMsg) {
  for (;;) {
    const j = await getJSON(`api/jobs/${id}`);
    if (onMsg && j.message) onMsg(j.message, j);
    if (j.state === 'done') return j.result;
    if (j.state === 'error') throw new Error(j.error);
    await new Promise((r) => setTimeout(r, 220));
  }
}

const MIME = { stl: 'model/stl', '3mf': 'model/3mf', html: 'text/html', json: 'application/json', zip: 'application/zip' };

function serverBackend(printers) {
  return {
    mode: 'server',
    printers: async () => printers,
    kinds: () => getJSON('api/kinds'),
    load(file, onMsg) {
      return new Promise((resolve, reject) => {
        const fd = new FormData();
        fd.append('file', file, file.name);
        const xhr = new XMLHttpRequest();
        xhr.open('POST', api('api/models'));
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) onMsg(`Uploading ${file.name}: ${(e.loaded / 1e6).toFixed(1)} / ${(e.total / 1e6).toFixed(1)} MB`, (e.loaded / e.total) * 0.5); };
        xhr.onload = async () => {
          try {
            const r = JSON.parse(xhr.responseText);
            if (xhr.status !== 200) throw new Error(r.error || xhr.statusText);
            resolve(await pollJob(r.job, (m) => onMsg(m, null)));
          } catch (err) { reject(err); }
        };
        xhr.onerror = () => reject(new Error('Upload failed'));
        xhr.send(fd);
      });
    },
    async mesh(info) { return (await fetch(api(`api/models/${info.id}/mesh`))).arrayBuffer(); },
    scale: (info, f) => getJSON(`api/models/${info.id}/scale`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scale: f }) }),
    async plan(info, body, onMsg) {
      const r = await getJSON(`api/models/${info.id}/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return pollJob(r.job, onMsg);
    },
    async export(info, parts, blobs, planObj, bed, snapshot) {
      const fd = new FormData();
      if (planObj) fd.append('plan', JSON.stringify(planObj));
      fd.append('parts', JSON.stringify(parts));
      if (bed) fd.append('bed', JSON.stringify(bed));
      blobs.forEach((b, i) => fd.append('m' + i, b, 'm' + i + '.psm'));
      if (snapshot) fd.append('snapshot', snapshot, 'snapshot.png');
      const res = await getJSON(info ? `api/models/${info.id}/export` : 'api/coupon/export', { method: 'POST', body: fd });
      const base = `api/exports/${res.id}/`;
      res.href = (f) => api(base + f) + (f.endsWith('.html') ? '' : '?download=1');
      res.download = () => null;
      return res;
    },
  };
}

function localBackend() {
  const w = new Worker(new URL('./gowork.js', import.meta.url), { type: 'module' });
  let seq = 0, onProgress = null;
  const pending = {};
  w.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'goprogress') { if (onProgress) onProgress(m.message, null); return; }
    if (m.type !== 'goresult') return;
    const p = pending[m.id];
    delete pending[m.id];
    if (!p) return;
    if (m.error) p.reject(new Error(m.error)); else p.resolve(m.result);
  };
  w.onerror = (e) => { for (const k of Object.keys(pending)) { pending[k].reject(new Error(e.message || 'planner worker failed')); delete pending[k]; } };
  const call = (fn, args, onMsg, transfer) => new Promise((resolve, reject) => {
    const id = ++seq;
    onProgress = onMsg || null;
    pending[id] = { resolve, reject };
    w.postMessage({ id, fn, args }, transfer || []);
  });
  const parse = (s) => { const j = JSON.parse(s); if (j && j.error) throw new Error(j.error); return j; };
  let urls = [];
  return {
    mode: 'local',
    printers: async () => parse(await call('printers', [])),
    kinds: async () => parse(await call('kinds', [])),
    async load(file, onMsg) {
      onMsg(`Reading ${file.name}`, null);
      const buf = new Uint8Array(await file.arrayBuffer());
      return parse(await call('load', [file.name, buf], onMsg, [buf.buffer]));
    },
    async mesh() { const u = await call('mesh', []); return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength); },
    scale: async (info, f) => parse(await call('scale', [f])),
    plan: async (info, body, onMsg) => parse(await call('plan', [JSON.stringify(body)], onMsg)),
    async export(info, parts, blobs, planObj, bed, snapshot, onMsg) {
      const bufs = await Promise.all(blobs.map(async (b) => new Uint8Array(await b.arrayBuffer())));
      const snap = snapshot ? new Uint8Array(await snapshot.arrayBuffer()) : null;
      const r = await call('export', [info ? info.name : 'joint-coupon', planObj ? JSON.stringify(planObj) : '', JSON.stringify(parts), bed ? JSON.stringify(bed) : '', bufs, snap], onMsg, bufs.map((b) => b.buffer));
      const res = parse(r.result);
      for (const u of urls) URL.revokeObjectURL(u);
      urls = [];
      const href = {};
      for (const [f, bytes] of Object.entries(r.files)) {
        const ext = f.split('.').pop();
        href[f] = URL.createObjectURL(new Blob([bytes], { type: MIME[ext] || 'application/octet-stream' }));
        urls.push(href[f]);
      }
      res.href = (f) => href[f];
      res.download = (f) => f.endsWith('.html') ? null : f.split('/').pop();
      return res;
    },
  };
}

export async function createBackend() {
  const m = document.querySelector('meta[name="splitter-backend"]');
  if (m && m.content === 'server') return serverBackend(await getJSON('api/printers'));
  return localBackend();
}

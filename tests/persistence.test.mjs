import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ entryPoints: ['services/persistence.ts'], bundle: true, format: 'esm', platform: 'browser', write: false });
const moduleUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`;
const snapshot = { nodes: [], runs: [], messages: [], refImages: [], savedAt: 1000, nextY: 0, assetsY: 0 };
const json = (body, etag = '"empty"', status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...(etag ? { ETag: etag } : {}) } });

async function setup(t, handler) {
  const original = { fetch: globalThis.fetch, indexedDB: globalThis.indexedDB, FileReader: globalThis.FileReader };
  const records = new Map();
  globalThis.indexedDB = { open() {
    const request = {};
    queueMicrotask(() => {
      request.result = { close() {}, transaction() {
        const tx = { objectStore: () => ({
          put(value, key) { records.set(key, structuredClone(value)); queueMicrotask(() => tx.oncomplete?.()); },
          get(key) { const req = {}; queueMicrotask(() => { req.result = records.get(key); req.onsuccess?.(); }); return req; },
        }) };
        return tx;
      } };
      request.onsuccess();
    });
    return request;
  } };
  globalThis.FileReader = class { async readAsDataURL(blob) { this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`; this.onload(); } };
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).startsWith('data:')) return original.fetch(url, init);
    if (url === '/api/session') return json({ userId: 'alice', providers: {} });
    return handler(url, init);
  };
  t.after(() => Object.assign(globalThis, original));
  return { api: await import(moduleUrl + '#' + crypto.randomUUID()), records };
}

test('client serializes saves and uses the revision returned by each preceding save', async t => {
  const revisions = []; let number = 0;
  const { api } = await setup(t, async (url, init) => {
    if (!init.method) return json(null);
    revisions.push(init.headers['If-Match']);
    assert.equal(init.headers['X-Project-Account'], 'alice');
    return json({ savedAt: 1000 }, `"revision-${++number}"`);
  });
  await api.loadProject();
  await Promise.all([api.saveProject(snapshot), api.saveProject({ ...snapshot, savedAt: 2000 })]);
  assert.deepEqual(revisions, ['"empty"', '"revision-1"']);
});

test('conflict stops further cloud writes while preserving the latest local draft', async t => {
  let writes = 0;
  const { api, records } = await setup(t, async (url, init) => {
    if (!init.method) return json(null);
    writes++;
    return json({}, null, 412);
  });
  await api.loadProject();
  await assert.rejects(api.saveProject(snapshot), api.ProjectConflictError);
  const latest = { ...snapshot, savedAt: 2000 };
  await assert.rejects(api.saveProject(latest), api.ProjectConflictError);
  assert.equal(writes, 1);
  assert.deepEqual(records.get('current:alice'), latest);
});

test('failed saves can be retried without poisoning the queue or advancing the revision', async t => {
  let writes = 0;
  const { api } = await setup(t, async (url, init) => {
    if (!init.method) return json(null);
    assert.equal(init.headers['If-Match'], '"empty"');
    if (++writes === 1) throw new TypeError('Network unavailable');
    return json({}, '"saved"');
  });
  await api.loadProject();
  await assert.rejects(api.saveProject(snapshot));
  await api.saveProject(snapshot);
  assert.equal(writes, 2);
});

test('uploads deduplicate repeated images and cap concurrency at three', async t => {
  let active = 0; let peak = 0; let uploads = 0; let saved;
  const { api } = await setup(t, async (url, init) => {
    if (!init.method) return json(null);
    if (url.startsWith('/api/assets/')) {
      uploads++; active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5)); active--;
      return json({ url });
    }
    saved = JSON.parse(init.body); return json({}, '"saved"');
  });
  await api.loadProject();
  const images = Array.from({ length: 7 }, (_, i) => `data:image/png;base64,${Buffer.from([i]).toString('base64')}`);
  const value = { ...snapshot, nodes: images.map((url, i) => ({ id: String(i), url })), refImages: [{ url: images[0] }] };
  await api.saveProject(value);
  assert.equal(uploads, 7); assert.equal(peak, 3);
  assert.equal(saved.nodes[0].url, saved.refImages[0].url);
  assert.match(saved.nodes[0].url, /^\/api\/assets\/[a-f0-9]{64}$/);
  await api.saveProject(value);
  assert.equal(uploads, 7);
});

test('cloud read failure is never treated as an empty canvas or overwritten with local data', async t => {
  let writes = 0;
  const { api } = await setup(t, async (url, init) => { if (init.method) writes++; return json({}, null, 503); });
  await assert.rejects(api.loadProject());
  await assert.rejects(api.saveProject(snapshot));
  assert.equal(writes, 0);
});

test('image hydration restores shared references without duplicate requests', async t => {
  const path = '/api/assets/' + 'a'.repeat(64); let reads = 0;
  const { api } = await setup(t, async url => {
    if (url === '/api/project') return json({ ...snapshot, nodes: [{ url: path }], refImages: [{ url: path }] }, '"revision-1"');
    reads++; return new Response(new Uint8Array([1, 2]), { headers: { 'Content-Type': 'image/png' } });
  });
  const result = await api.loadProject();
  assert.equal(reads, 1);
  assert.equal(result.nodes[0].url, 'data:image/png;base64,AQI=');
  assert.equal(result.nodes[0].url, result.refImages[0].url);
});

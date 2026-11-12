import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const built = await build({ entryPoints: ['services/workflowClient.ts'], bundle: true, format: 'esm', write: false });
const { createWorkflowClient, WorkflowConflictError } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const graph = { version: 1, nodes: [], edges: [] };
const json = (body, etag = '"initial"', status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ETag: etag } });
function setup(t, handler) {
  const original = { fetch: globalThis.fetch, FileReader: globalThis.FileReader };
  globalThis.fetch = async (url, init = {}) => String(url).startsWith('data:') ? original.fetch(url, init) : handler(url, init);
  globalThis.FileReader = class { async readAsDataURL(blob) { this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`; this.onload(); } };
  t.after(() => Object.assign(globalThis, original));
  return createWorkflowClient('account-a');
}
test('workflow client serializes revisions and blocks queued saves after conflict', async t => {
  let count = 0; const etags = [];
  const client = setup(t, async (url, init) => {
    assert.equal(init.headers['X-Project-Account'], 'account-a');
    if (!init.method) return json({ id: 'flow', title: 'Flow', graph });
    etags.push(init.headers['If-Match']); count++;
    return count === 1 ? json({}, '"saved"') : json({ error: { message: 'conflict' } }, '"other"', 412);
  });
  const doc = await client.load('flow');
  const results = await Promise.allSettled([client.save(doc), client.save(doc), client.save(doc)]);
  assert.deepEqual(results.map(r => r.status), ['fulfilled', 'rejected', 'rejected']);
  assert.ok(results[1].reason instanceof WorkflowConflictError);
  assert.deepEqual(etags, ['"initial"', '"saved"']);
});
test('workflow assets are deduplicated across inputs and results and hydrate on reopen', async t => {
  let uploads = 0, reads = 0, saved; const image = 'data:image/png;base64,YQ==';
  const client = setup(t, async (url, init) => {
    if (url.startsWith('/api/assets/')) { if (init.method === 'PUT') { uploads++; return new Response('ok'); } reads++; return new Response(new Blob(['a'], { type: 'image/png' })); }
    if (init.method === 'POST') { saved = JSON.parse(init.body); return json({ id: 'flow', title: 'Flow', updatedAt: 1 }); }
    return json({ ...saved, id: 'flow' });
  });
  const g = { ...graph, nodes: [{ id: 'source', kind: 'image', label: 'Image', x: 0, y: 0, config: { image }, status: 'success', output: { kind: 'image', value: image } }] };
  await client.create('Flow', g); assert.equal(uploads, 1);
  assert.match(saved.graph.nodes[0].config.image, /^\/api\/assets\/[a-f0-9]{64}$/);
  const loaded = await createWorkflowClient('account-a').load('flow');
  assert.equal(reads, 1); assert.deepEqual(loaded.graph, g);
});
test('failed workflow read does not invent an empty document or issue writes', async t => {
  let writes = 0;
  const client = setup(t, async (_url, init) => { if (init.method) writes++; return json({}, '"fail"', 503); });
  await assert.rejects(client.load('flow')); assert.equal(writes, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ stdin: { contents: "export * from './workflow/graph'; export * from './workflow/runner'; export * from './workflow/types'; export * from './workflow/templates'; export * from './workflow/safeError';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', write: false });
const { graphShapeError, connectNodes, invalidateNodes, executionErrors, runWorkflow, newWorkflowNode, workflowTemplate, recoverInterrupted, generationErrorMessage } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const image = 'data:image/png;base64,YQ==';
const graph = kind => { const g = workflowTemplate(kind); g.nodes.find(n => n.kind === 'image').config.image = image; return g; };
const executor = { generate: async () => image, cutout: async () => image, transform: async () => image };
const options = { onChange() {} };

test('templates validate, typed ports reject incompatible and cyclic connections', () => {
  for (const id of ['scene', 'branches', 'local']) assert.equal(graphShapeError(graph(id)), null);
  const g = graph('scene'); const [input, prompt, generate, output] = g.nodes;
  assert.throws(() => connectNodes(g, input.id, generate.id, 'image'), /已有/);
  assert.throws(() => connectNodes({ ...g, edges: g.edges.filter(e => e.target !== output.id) }, prompt.id, output.id, 'text'), /相同类型/);
  const other = newWorkflowNode('generate', 0, 0);
  const linked = connectNodes({ ...g, nodes: [...g.nodes, other] }, generate.id, other.id, 'image');
  assert.throws(() => connectNodes(linked, other.id, generate.id, 'image'), /循环/);
  assert.ok(graphShapeError({ ...g, edges: [{ ...g.edges[0], id: 12 }] }));
  assert.ok(graphShapeError(g, true));
  assert.equal(executionErrors(workflowTemplate('local'))[0].message, '请上传一张图片');
  const invalid = structuredClone(g); invalid.nodes[0].config.image = 'https://attacker.example/image'; assert.ok(graphShapeError(invalid));
});

test('runner preserves successes and invalidates only edited descendants', async () => {
  let calls = 0;
  const run = input => runWorkflow(input, { ...executor, transform: async () => { calls++; return image; } }, options);
  const finished = await run(graph('local'));
  assert.ok(finished.nodes.every(n => n.status === 'success'));
  await run(finished); assert.equal(calls, 1);
  const edited = invalidateNodes(finished, [finished.nodes[1].id]);
  assert.deepEqual(edited.nodes.map(n => n.status), ['success', 'idle', 'idle']);
  await run(edited); assert.equal(calls, 2);
});

test('failed generation blocks its output and retries without rerunning independent successes', async () => {
  const g = graph('branches'); let fail = true; const calls = new Map();
  const firstId = g.nodes.find(n => n.kind === 'generate').id;
  const generate = async node => { calls.set(node.id, (calls.get(node.id) || 0) + 1); if (fail && node.id === firstId) throw new Error('test failure'); return image; };
  const failed = await runWorkflow(g, { ...executor, generate }, options);
  assert.equal(failed.nodes.filter(n => n.status === 'error').length, 1);
  assert.equal(failed.nodes.filter(n => n.status === 'blocked').length, 1);
  fail = false; const retried = await runWorkflow(failed, { ...executor, generate }, options);
  assert.ok(retried.nodes.every(n => n.status === 'success'));
  assert.deepEqual([...calls.values()].sort(), [1, 1, 2]);
});

test('branch concurrency is bounded at two and run-to-node excludes other branches', async () => {
  let active = 0, peak = 0, calls = 0;
  const generate = async () => { active++; calls++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 8)); active--; return image; };
  await runWorkflow(graph('branches'), { ...executor, generate }, options);
  assert.equal(calls, 3); assert.equal(peak, 2);
  const g = graph('branches'); calls = 0;
  const result = await runWorkflow(g, { ...executor, generate }, { ...options, target: g.nodes.find(n => n.kind === 'output').id });
  assert.equal(calls, 1); assert.equal(result.nodes.filter(n => n.status === 'success').length, 4);
});

test('stop lets the submitted step finish without starting downstream; resume uses its result', async () => {
  const stop = new AbortController(); let calls = 0;
  const generate = async () => { calls++; stop.abort(); return image; };
  const stopped = await runWorkflow(graph('scene'), { ...executor, generate }, { ...options, signal: stop.signal });
  assert.equal(stopped.nodes.find(n => n.kind === 'generate').status, 'success');
  assert.equal(stopped.nodes.find(n => n.kind === 'output').status, 'idle');
  const resumed = await runWorkflow(stopped, { ...executor, generate }, options);
  assert.ok(resumed.nodes.every(n => n.status === 'success')); assert.equal(calls, 1);
  const interrupted = structuredClone(stopped); interrupted.nodes[0].status = 'running';
  assert.equal(recoverInterrupted(interrupted).nodes[0].status, 'error');
});


test('generation errors expose safe outcomes without persisting SDK payloads or claiming an automatic retry', () => {
  const sensitive = Object.assign(new Error('{"error":{"message":"internal upstream details"}}'), { code: 'UNKNOWN' });
  assert.equal(generationErrorMessage(sensitive), '创作服务暂时不可用，请稍后重试或选择其他模型');
  assert.doesNotMatch(generationErrorMessage({ code: 'QUOTA' }), /自动/);
  assert.match(generationErrorMessage(new Error('request timeout')), /确认用量/);
  assert.match(generationErrorMessage(new Error('登录账号已改变')), /备份工作流/);
});

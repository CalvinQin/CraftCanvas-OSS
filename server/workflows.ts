import type { Env } from './worker';
import { readAuthBody } from './auth';
import { graphShapeError } from '../workflow/graph';

export async function workflowsRoute(request: Request, env: Env, url: URL, userId: string, prefix: string): Promise<Response> {
  const json = (body: unknown, status = 200, etag?: string) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', ...(etag ? { ETag: etag } : {}) } });
  const fail = (message: string, status = 400) => json({ error: { message } }, status);
  const etag = (key: string) => JSON.stringify(key.split('/').at(-1));
  if (url.pathname === '/api/workflows' && request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT id, title, updated_at AS updatedAt, node_count AS nodeCount FROM workflows WHERE user_id = ? ORDER BY updated_at DESC, id LIMIT 30').bind(userId).all();
    return json({ rows: rows.results });
  }
  const creating = url.pathname === '/api/workflows' && request.method === 'POST';
  const id = creating ? crypto.randomUUID() : url.pathname.slice('/api/workflows/'.length);
  if (!/^[a-f0-9-]{36}$/.test(id)) return fail('工作流不存在', 404);
  const row = creating ? null : await env.DB.prepare('SELECT id, title, snapshot_key, updated_at FROM workflows WHERE id = ? AND user_id = ?').bind(id, userId).first<any>();
  if (!creating && !row) return fail('工作流不存在', 404);
  if (request.method === 'GET') {
    const object = await env.BUCKET.get(row.snapshot_key);
    if (!object) return fail('工作流内容暂时无法读取，请稍后重试', 503);
    return new Response(object.body as unknown as BodyInit, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', ETag: etag(row.snapshot_key) } });
  }
  if (!creating && request.method !== 'PUT') return fail('Method Not Allowed', 405);
  if (!creating && !request.headers.has('If-Match')) return fail('请先读取工作流的最新版本', 428);
  if (!creating && request.headers.get('If-Match') !== etag(row.snapshot_key)) return fail('工作流已在其他页面更新，请导出备份后重新打开', 412);
  const body = await readAuthBody(request, 2 * 1024 * 1024);
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 80) return fail('请填写 1–80 字符的工作流名称');
  const problem = graphShapeError(body?.graph, true); if (problem) return fail(problem);
  const document = { id, title, graph: body.graph, updatedAt: Date.now() };
  const key = `${prefix}/workflows/${id}/${crypto.randomUUID()}.json`;
  await env.BUCKET.put(key, JSON.stringify(document), { httpMetadata: { contentType: 'application/json' } });
  const result = creating
    ? await env.DB.prepare('INSERT INTO workflows (id, user_id, title, snapshot_key, updated_at, node_count) SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM workflows WHERE user_id = ?) < 30').bind(id, userId, title, key, document.updatedAt, body.graph.nodes.length, userId).run()
    : await env.DB.prepare('UPDATE workflows SET title = ?, snapshot_key = ?, updated_at = ?, node_count = ? WHERE id = ? AND user_id = ? AND snapshot_key = ?').bind(title, key, document.updatedAt, body.graph.nodes.length, id, userId, row.snapshot_key).run();
  if (result.meta.changes !== 1) return fail(creating ? '最多保存 30 条工作流，可修改已有流程或导出备份' : '工作流已在其他页面更新，请导出备份后重新打开', creating ? 409 : 412);
  return json({ id, title, updatedAt: document.updatedAt, nodeCount: body.graph.nodes.length }, creating ? 201 : 200, etag(key));
}

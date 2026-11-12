import type { Env } from './worker';
import { readAuthBody } from './auth';

export const CATEGORIES = ['产品实拍', '参考灵感', '品牌素材', '生成作品'] as const;
export async function libraryRoute(request: Request, env: Env, url: URL, userId: string, prefix: string): Promise<Response> {
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
  const fail = (message: string, status = 400) => json({ error: { message } }, status);
  const id = url.pathname.slice('/api/library/'.length);
  if (url.pathname === '/api/library' && request.method === 'GET') {
    const q = (url.searchParams.get('q') || '').slice(0, 100);
    const category = url.searchParams.get('category') || '';
    if (category && !CATEGORIES.includes(category as any)) return fail('素材分类无效');
    const page = Math.max(0, Math.min(10000, Number(url.searchParams.get('page')) || 0)) | 0;
    const where = 'user_id = ? AND name LIKE ? AND (? = \'\' OR category = ?) AND (? = 0 OR favorite = 1)';
    const params = [userId, `%${q}%`, category, category, url.searchParams.get('favorite') === '1' ? 1 : 0];
    const [rows, count] = await Promise.all([
      env.DB.prepare(`SELECT * FROM library_assets WHERE ${where} ORDER BY created_at DESC, id LIMIT 24 OFFSET ?`).bind(...params, page * 24).all(),
      env.DB.prepare(`SELECT COUNT(*) AS count FROM library_assets WHERE ${where}`).bind(...params).first<{ count: number }>(),
    ]);
    return json({ rows: rows.results, total: count?.count || 0, page });
  }
  if (url.pathname === '/api/library' && request.method === 'POST') {
    const data = await readAuthBody(request);
    const name = typeof data?.name === 'string' ? data.name.trim() : '';
    if (!/^[a-f0-9]{64}$/.test(data?.hash || '') || !name || name.length > 120 || !CATEGORIES.includes(data.category)) return fail('请填写素材名称并选择分类');
    const object = await env.BUCKET.head(`${prefix}/assets/${data.hash}`);
    if (!object) return fail('请先上传素材图片');
    // 单账号最多 1000 条；INSERT 的条件用于并发安全限额。
    const result = await env.DB.prepare(`INSERT INTO library_assets (id, user_id, hash, name, category, size_bytes, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM library_assets WHERE user_id = ?) < 1000`)
      .bind(crypto.randomUUID(), userId, data.hash, name, data.category, object.size || 0, Date.now(), userId).run();
    return result.meta.changes === 1 ? json({ ok: true }, 201) : fail('素材库已达 1000 条上限', 409);
  }
  if (!/^[a-f0-9-]{36}$/.test(id)) return fail('素材不存在', 404);
  if (!await env.DB.prepare('SELECT id FROM library_assets WHERE id = ? AND user_id = ?').bind(id, userId).first()) return fail('素材不存在', 404);
  if (request.method === 'GET') return json(await env.DB.prepare('SELECT * FROM library_assets WHERE id = ? AND user_id = ?').bind(id, userId).first());
  if (request.method === 'DELETE') {
    // 只移除资料库记录；画板引用的图片保留，避免破坏历史项目。
    await env.DB.prepare('DELETE FROM library_assets WHERE id = ? AND user_id = ?').bind(id, userId).run();
    return json({ ok: true });
  }
  if (request.method === 'PATCH') {
    const data = await readAuthBody(request);
    const row = await env.DB.prepare('SELECT name, category, favorite FROM library_assets WHERE id = ? AND user_id = ?').bind(id, userId).first<any>();
    const name = data?.name === undefined ? row.name : typeof data.name === 'string' ? data.name.trim() : '';
    const category = data?.category ?? row.category;
    if (!name || name.length > 120 || !CATEGORIES.includes(category) || (data?.favorite !== undefined && typeof data.favorite !== 'boolean')) return fail('素材设置无效');
    await env.DB.prepare('UPDATE library_assets SET name = ?, category = ?, favorite = ? WHERE id = ? AND user_id = ?').bind(name, category, data?.favorite === undefined ? row.favorite : Number(data.favorite), id, userId).run();
    return json({ ok: true });
  }
  return fail('Method Not Allowed', 405);
}

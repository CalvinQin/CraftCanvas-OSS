import type { Env } from './worker';
import { costDashboard } from './costDashboard';
import { syncPrices } from './pricing';
import type { Account } from './auth';
import { beijingDay, encryptSecret, getConfig, isAdmin, SECRET_NAMES, validateConfig } from './settings';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
const error = (message: string, status = 400) => json({ error: { message } }, status);
async function input(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return null;
  const reader = request.body?.getReader(); if (!reader) return null;
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 20000) { await reader.cancel(); return null; } chunks.push(value); }
  const data = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(data)); } catch { return null; }
}
const audit = (env: Env, actor: string, action: string, target: string, details: unknown, id = crypto.randomUUID()) => env.DB.prepare('INSERT INTO admin_audit (id, actor_id, action, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, actor, action, target, JSON.stringify(details), Date.now());
const page = (url: URL) => Math.max(0, Math.min(10000, Number(url.searchParams.get('page')) || 0)) | 0;

export async function adminRoute(request: Request, env: Env, url: URL, actor: Account): Promise<Response> {
  if (!isAdmin(env, actor.id) || actor.status !== 'active') return error('此账号没有后台权限', 403);
  const path = url.pathname.slice('/api/admin'.length);
  if (path === '/costs' && request.method === 'GET') {
    const data = await costDashboard(env, url); return data ? json(data) : error('成本筛选无效');
  }
  if (path === '/pricing/sync' && request.method === 'POST') {
    const catalog = await syncPrices(env, true);
    await audit(env, actor.id, 'pricing.sync', 'site', { sources: catalog.models.map(m => ({ model: m.model, checkedAt: m.checkedAt, error: m.error })) }).run();
    return json({ ok: catalog.models.every(m => !m.error), models: catalog.models });
  }
  if (path === '/overview' && request.method === 'GET') {
    const day = beijingDay();
    const start = Date.now() - 30 * 86400000;
    const [customers, usage, revenue, trend, providers, auditRows] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS total, SUM(status = 'active') AS active, SUM(plan != 'free') AS members, COALESCE(SUM(credits), 0) AS credits FROM accounts").first(),
      env.DB.prepare(`SELECT COUNT(*) AS total, SUM(day = ?) AS today, SUM(status = 'succeeded') AS succeeded, SUM(status = 'failed') AS failed,
        SUM(status = 'pending') AS pending, COALESCE(SUM(estimated_cost_cents), 0) AS estimatedCostCents,
        COALESCE(SUM(cost_usd_micros), 0) AS costMicros, SUM(cost_status = 'priced') AS pricedRequests,
        COALESCE(SUM(CASE WHEN status = 'succeeded' THEN charged_credits ELSE 0 END), 0) AS spentCredits FROM ai_requests WHERE created_at >= ?`).bind(day, start).first(),
      env.DB.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS totalCents, COUNT(*) AS paidOrders FROM payment_orders WHERE status = 'paid' AND currency = 'CNY'").first(),
      env.DB.prepare(`SELECT day, COUNT(*) AS requests, SUM(status = 'succeeded') AS succeeded, SUM(status = 'failed') AS failed FROM ai_requests WHERE day >= ? GROUP BY day ORDER BY day DESC LIMIT 30`).bind(new Date(Date.now() + 8 * 3600000 - 29 * 86400000).toISOString().slice(0, 10)).all(),
      env.DB.prepare(`SELECT provider, model, COUNT(*) AS requests, SUM(status = 'succeeded') AS succeeded, SUM(status = 'failed') AS failed,
        COALESCE(SUM(estimated_cost_cents), 0) AS estimatedCostCents, COALESCE(SUM(cost_usd_micros), 0) AS costMicros,
        SUM(cost_status = 'priced') AS pricedRequests FROM ai_requests WHERE created_at >= ? GROUP BY provider, model`).bind(start).all(),
      env.DB.prepare('SELECT action, target_id, details, created_at FROM admin_audit ORDER BY created_at DESC LIMIT 10').all(),
    ]);
    return json({ customers, usage, revenue, trend: trend.results, providers: providers.results, audit: auditRows.results, paymentsEnabled: false });
  }
  if (path === '/customers' && request.method === 'GET') {
    const search = (url.searchParams.get('q') || '').slice(0, 100); const offset = page(url) * 25;
    const where = "a.email LIKE ? OR a.display_name LIKE ? OR a.username LIKE ?"; const query = `%${search}%`;
    const [rows, count] = await Promise.all([
      env.DB.prepare(`SELECT a.*, (SELECT COUNT(*) FROM ai_requests r WHERE r.user_id = a.id AND r.day = ?) AS usedToday,
        (SELECT COUNT(*) FROM ai_requests r WHERE r.user_id = a.id) AS totalRequests,
        (SELECT MAX(created_at) FROM ai_requests r WHERE r.user_id = a.id) AS lastRequestAt
        FROM accounts a WHERE ${where} ORDER BY a.created_at DESC, a.id LIMIT 25 OFFSET ?`).bind(beijingDay(), query, query, query, offset).all(),
      env.DB.prepare(`SELECT COUNT(*) AS count FROM accounts a WHERE ${where}`).bind(query, query, query).first<{ count: number }>(),
    ]);
    return json({ rows: rows.results, total: count?.count || 0, page: page(url) });
  }
  if (path === '/requests' && request.method === 'GET') {
    const status = url.searchParams.get('status') || ''; const user = (url.searchParams.get('user') || '').slice(0, 100);
    if (status && !['pending', 'succeeded', 'failed', 'legacy'].includes(status)) return error('状态筛选无效');
    const where = "(? = '' OR r.status = ?) AND (? = '' OR r.user_id = ?)";
    const [rows, count] = await Promise.all([
      env.DB.prepare(`SELECT r.*, a.display_name, a.email, a.username FROM ai_requests r LEFT JOIN accounts a ON a.id = r.user_id WHERE ${where} ORDER BY r.created_at DESC, r.id LIMIT 25 OFFSET ?`).bind(status, status, user, user, page(url) * 25).all(),
      env.DB.prepare(`SELECT COUNT(*) AS count FROM ai_requests r WHERE ${where}`).bind(status, status, user, user).first<{ count: number }>(),
    ]);
    return json({ rows: rows.results, total: count?.count || 0, page: page(url) });
  }
  if (path === '/finance' && request.method === 'GET') {
    const [orders, ledger, auditRows] = await Promise.all([
      env.DB.prepare('SELECT o.*, a.email, a.username FROM payment_orders o JOIN accounts a ON a.id = o.user_id ORDER BY o.created_at DESC LIMIT 50').all(),
      env.DB.prepare('SELECT l.*, a.email, a.username FROM credit_ledger l JOIN accounts a ON a.id = l.user_id ORDER BY l.created_at DESC LIMIT 50').all(),
      env.DB.prepare('SELECT action, actor_id, target_id, details, created_at FROM admin_audit ORDER BY created_at DESC LIMIT 50').all(),
    ]);
    return json({ orders: orders.results, ledger: ledger.results, audit: auditRows.results, paymentsEnabled: false });
  }
  if (path === '/settings' && request.method === 'GET') {
    const config = await getConfig(env);
    const row = await env.DB.prepare("SELECT updated_at FROM site_settings WHERE key = 'config'").first<{ updated_at: number }>();
    const stored = await env.DB.prepare("SELECT key FROM site_settings WHERE key LIKE 'secret:%'").all<{ key: string }>();
    const secrets = Object.fromEntries(SECRET_NAMES.map(name => [name, { configured: Boolean(env[name]), source: stored.results.some(row => row.key === `secret:${name}`) ? 'admin' : env[name] ? 'environment' : 'none' }]));
    return json({ config, revision: row?.updated_at || 0, secrets, encryptionReady: Boolean(env.SETTINGS_ENCRYPTION_KEY), googleCallback: `${env.SITE_ORIGIN || url.origin}/auth/google/callback` });
  }
  if (path === '/settings' && request.method === 'PUT') {
    const body = await input(request); const config = validateConfig(body?.config);
    if (!config || !Number.isSafeInteger(body?.revision) || body.revision < 0) return error('设置格式无效，请检查额度、倍率和计价');
    const secrets = body.secrets || {};
    if (typeof secrets !== 'object' || Array.isArray(secrets) || Object.keys(secrets).some(name => !SECRET_NAMES.includes(name as any))) return error('密钥字段无效');
    const mutations = [];
    const revision = Math.max(Date.now(), body.revision + 1);
    const changedKeys = [];
    const guard = `update:${crypto.randomUUID()}`;
    for (const name of SECRET_NAMES) {
      const value = secrets[name]; if (value === undefined || value === '') continue;
      if (value !== null && (typeof value !== 'string' || value.trim().length < 8 || value.length > 4096 || /[\r\n]/.test(value))) return error('密钥格式无效');
      const encrypted = value === null ? null : await encryptSecret(env, value.trim());
      if (encrypted === null) mutations.push(env.DB.prepare("DELETE FROM site_settings WHERE key = ? AND EXISTS (SELECT 1 FROM site_settings WHERE key = ?)").bind(`secret:${name}`, guard));
      else mutations.push(env.DB.prepare(`INSERT INTO site_settings (key, value, updated_at) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM site_settings WHERE key = ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(`secret:${name}`, encrypted, revision, guard));
      changedKeys.push(name);
    }
    const result = await env.DB.batch([
      env.DB.prepare(`INSERT INTO site_settings (key, value, updated_at) SELECT 'config', ?, ? WHERE COALESCE((SELECT updated_at FROM site_settings WHERE key = 'config'), 0) = ?
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE site_settings.updated_at = ?`).bind(JSON.stringify(config), revision, body.revision, body.revision),
      env.DB.prepare('INSERT INTO site_settings (key, value, updated_at) SELECT ?, ?, ? WHERE changes() = 1').bind(guard, 'guard', revision),
      ...mutations,
      env.DB.prepare(`INSERT INTO admin_audit (id, actor_id, action, target_id, details, created_at)
        SELECT ?, ?, 'settings.update', 'site', ?, ? WHERE EXISTS (SELECT 1 FROM site_settings WHERE key = ?)`).bind(crypto.randomUUID(), actor.id, JSON.stringify({ config, changedKeys }), Date.now(), guard),
      env.DB.prepare('DELETE FROM site_settings WHERE key = ?').bind(guard),
    ]);
    if (result[0].meta.changes !== 1) return error('设置已被其他操作更新，请刷新后再保存', 409);
    return json({ ok: true });
  }
  if (path === '/customer' && request.method === 'PATCH') {
    const body = await input(request);
    if (!body || typeof body.id !== 'string' || !['free', 'pro', 'studio'].includes(body.plan) || !['active', 'suspended'].includes(body.status) || !(body.dailyLimit === null || (Number.isInteger(body.dailyLimit) && body.dailyLimit >= 0 && body.dailyLimit <= 100000))) return error('客户设置无效');
    if (isAdmin(env, body.id) && body.status !== 'active') return error('不能停用后台管理员');
    const before = await env.DB.prepare('SELECT plan, status, daily_limit FROM accounts WHERE id = ?').bind(body.id).first();
    if (!before) return error('账号不存在', 404);
    await env.DB.batch([
      env.DB.prepare('UPDATE accounts SET plan = ?, status = ?, daily_limit = ? WHERE id = ?').bind(body.plan, body.status, body.dailyLimit, body.id),
      audit(env, actor.id, 'customer.update', body.id, { before, after: { plan: body.plan, status: body.status, dailyLimit: body.dailyLimit } }),
    ]);
    return json({ ok: true });
  }
  if (path === '/credits' && request.method === 'POST') {
    const body = await input(request);
    if (!body || typeof body.id !== 'string' || !Number.isInteger(body.amount) || !body.amount || Math.abs(body.amount) > 100000 || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 120 || !/^[a-f0-9-]{36}$/.test(body.operationId)) return error('积分调整无效，需填写数量与原因');
    const id = `admin:${body.operationId}`; const reason = `管理员调整 · ${body.reason.trim()}`;
    const existing = await env.DB.prepare('SELECT user_id, amount, reason FROM credit_ledger WHERE id = ?').bind(id).first<any>();
    if (existing) return existing.user_id === body.id && existing.amount === body.amount && existing.reason === reason ? json({ ok: true, replayed: true }) : error('重复的操作编号', 409);
    const now = Date.now();
    const result = await env.DB.batch([
      env.DB.prepare('UPDATE accounts SET credits = credits + ? WHERE id = ? AND credits + ? >= 0 AND credits + ? <= 100000000 AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE id = ?)').bind(body.amount, body.id, body.amount, body.amount, id),
      env.DB.prepare('INSERT INTO credit_ledger (id, user_id, amount, reason, created_at) SELECT ?, ?, ?, ?, ? WHERE changes() = 1').bind(id, body.id, body.amount, reason, now),
      env.DB.prepare("INSERT OR IGNORE INTO admin_audit (id, actor_id, action, target_id, details, created_at) SELECT ?, ?, 'credits.adjust', ?, ?, ? WHERE EXISTS (SELECT 1 FROM credit_ledger WHERE id = ?)").bind(id, actor.id, body.id, JSON.stringify({ amount: body.amount, reason: body.reason.trim() }), now, id),
    ]);
    if (result[0].meta.changes !== 1) return error('账号不存在、余额不足或操作已执行', 409);
    return json({ ok: true });
  }
  return error('后台接口不存在或请求方式不支持', 404);
}

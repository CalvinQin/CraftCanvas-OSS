import type { Env } from './worker';
import { isAdmin } from './settings';

// 临时引导凭据由部署端注入；完成创建后删除。永不重置已有账号或按用户名授予角色。
export async function provisionAdmin(request: Request, env: Env): Promise<Response> {
  const reply = (status: number) => new Response(JSON.stringify({ ok: status === 200 }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (!env.ADMIN_BOOTSTRAP_CONFIG) return reply(404);
  if (request.method !== 'POST') return reply(405);
  let config: any; try { config = JSON.parse(env.ADMIN_BOOTSTRAP_CONFIG); } catch { return reply(503); }
  if (typeof config.token !== 'string' || config.token.length < 48 || typeof config.username !== 'string' || !/^[a-zA-Z0-9_]{3,32}$/.test(config.username)
    || typeof config.id !== 'string' || !isAdmin(env, config.id) || typeof config.passwordHash !== 'string'
    || !/^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(config.passwordHash)) return reply(503);
  const provided = request.headers.get('x-craftcanvas-bootstrap') || '';
  if (provided.length !== config.token.length) return reply(403);
  let diff = 0; for (let i = 0; i < config.token.length; i++) diff |= provided.charCodeAt(i) ^ config.token.charCodeAt(i);
  if (diff) return reply(403);
  const username = config.username.toLowerCase();
  const existing = await env.DB.prepare('SELECT user_id FROM username_credentials WHERE username = ?').bind(username).first<{ user_id: string }>();
  if (existing) return reply(existing.user_id === config.id ? 200 : 409);
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO accounts (id, email, username, display_name, provider, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(config.id, '', config.username, config.username, 'username', Date.now()),
      env.DB.prepare('INSERT INTO username_credentials (username, user_id, password_hash) VALUES (?, ?, ?)').bind(username, config.id, config.passwordHash),
      env.DB.prepare('INSERT INTO admin_audit (id, actor_id, action, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), config.id, 'admin.provision', config.id, '{"provider":"username"}', Date.now()),
    ]);
    return reply(200);
  } catch { return reply(409); }
}

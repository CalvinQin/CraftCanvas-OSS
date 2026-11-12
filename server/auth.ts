import type { Env } from './worker';
import { getConfig, dailyLimit, isAdmin } from './settings';
import { hashPassword, verifyPassword } from './password';
import { provisionAdmin } from './provision';

export interface Account {
  id: string; email: string; username: string | null; display_name: string; provider: string;
  plan: string; credits: number; created_at: number; status: 'active' | 'suspended'; daily_limit: number | null;
}

export const digest = async (value: string): Promise<string> => {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer), v => v.toString(16).padStart(2, '0')).join('');
};
const nonce = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
const cookie = (request: Request, name: string) => request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1) || '';
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
});
const sessionCookie = (token: string, maxAge: number) => `craftcanvas_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const signedOutCookie = (maxAge: number) => `craftcanvas_signed_out=1; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

async function createSession(env: Env, account: Account): Promise<Response> {
  const token = nonce();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await digest(token), account.id, Date.now() + 30 * 86400_000).run();
  const result = response({ account });
  result.headers.append('Set-Cookie', sessionCookie(token, 30 * 86400));
  result.headers.append('Set-Cookie', signedOutCookie(0));
  return result;
}

export async function readAuthBody(request: Request, maxBytes = 4096): Promise<any> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  let body = ''; let size = 0;
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); return null; }
    body += decoder.decode(value, { stream: true });
  }
  try { return JSON.parse(body + decoder.decode()); } catch { return null; }
}

async function allowAuth(request: Request, env: Env, email: string): Promise<boolean> {
  const now = Date.now();
  const bucket = Math.floor(now / 900_000);
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  // IP 和邮箱只记录散列；单条 upsert 的 WHERE 保证并发请求不能绕过限额。
  for (const [scope, limit] of [['global', 100], [`ip:${await digest(ip)}`, 10], [`email:${await digest(email)}`, 5]] as const) {
    const result = await env.DB.prepare(`INSERT INTO auth_limits (key, attempts, expires_at) VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1 WHERE attempts < ?`)
      .bind(`${bucket}:${scope}`, (bucket + 1) * 900_000, limit).run();
    if (result.meta.changes !== 1) return false;
  }
  await env.DB.prepare('DELETE FROM auth_limits WHERE expires_at < ?').bind(now).run();
  return true;
}

async function upsertAccount(env: Env, id: string, email: string, name: string, provider: string): Promise<Account> {
  await env.DB.prepare(`INSERT INTO accounts (id, email, display_name, provider, created_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`).bind(id, email, name, provider, Date.now()).run();
  return (await env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first<Account>())!;
}

export async function currentAccount(request: Request, env: Env): Promise<Account | null> {
  // 本站邮箱 / Google 会话优先；保留已存在的 Sites 身份，退出后不自动登录。
  const token = cookie(request, 'craftcanvas_session');
  if (token) {
    const account = await env.DB.prepare(`SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`).bind(await digest(token), Date.now()).first<Account>();
    if (account) return account;
  }
  if (cookie(request, 'craftcanvas_signed_out') === '1') return null;
  // Only Sites' trusted ingress may supply these identity headers. Direct hosting must ignore them.
  if (env.TRUST_SITES_IDENTITY !== 'true') return null;
  const subject = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email');
  if (!subject || !email) return null;
  const existing = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(`chatgpt:${subject}`).first<Account>();
  if (existing) return existing;
  if (!(await getConfig(env)).signupEnabled) return null;
  return upsertAccount(env, `chatgpt:${subject}`, email, email.split('@')[0], 'chatgpt');
}

export async function authRoute(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/auth/provision-admin') return provisionAdmin(request, env);
  const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SITE_ORIGIN);
  if (url.pathname === '/api/auth/register' || url.pathname === '/api/auth/login') {
    if (request.method !== 'POST') return response({ error: { message: 'Method Not Allowed' } }, 405);
    const data = await readAuthBody(request);
    const registering = url.pathname === '/api/auth/register';
    const rawIdentifier = registering ? data?.email : data?.identifier ?? data?.email;
    const email = typeof rawIdentifier === 'string' ? rawIdentifier.trim().toLowerCase() : '';
    const emailValid = email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const usernameValid = !registering && /^[a-z0-9_]{3,32}$/.test(email);
    const password = data?.password;
    if ((!emailValid && !usernameValid) || typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return response({ error: { message: registering ? '请填写有效邮箱，密码需为 8–128 个字符' : '请填写邮箱或用户名，密码需为 8–128 个字符' } }, 400);
    }
    if (url.pathname === '/api/auth/register' && !(/[a-z]/.test(password) && /[A-Z]/.test(password) && /[0-9]/.test(password))) {
      return response({ error: { message: '密码至少 8 个字符，需包含大写字母、小写字母和数字' } }, 400);
    }
    if (!await allowAuth(request, env, email)) return response({ error: { message: '登录或注册尝试过于频繁，请 15 分钟后再试' } }, 429);
    const credential = await env.DB.prepare(usernameValid ? 'SELECT user_id, password_hash FROM username_credentials WHERE username = ?' : 'SELECT user_id, password_hash FROM email_credentials WHERE email = ?')
      .bind(email).first<{ user_id: string; password_hash: string }>();
    if (url.pathname === '/api/auth/register') {
      if (!(await getConfig(env)).signupEnabled) return response({ error: { message: '新账号注册暂时关闭' } }, 403);
      if (credential) return response({ error: { message: '这个邮箱已经注册，请切换到登录' } }, 409);
      const name = typeof data.displayName === 'string' ? data.displayName.trim() : '';
      if (!name || name.length > 60) return response({ error: { message: '显示名称需为 1–60 个字符' } }, 400);
      const id = `email:${crypto.randomUUID()}`;
      const hash = await hashPassword(password);
      try {
        await env.DB.batch([
          env.DB.prepare('INSERT INTO accounts (id, email, display_name, provider, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, email, name, 'email', Date.now()),
          env.DB.prepare('INSERT INTO email_credentials (email, user_id, password_hash) VALUES (?, ?, ?)').bind(email, id, hash),
        ]);
      } catch (e) {
        if (await env.DB.prepare('SELECT user_id FROM email_credentials WHERE email = ?').bind(email).first()) {
          return response({ error: { message: '这个邮箱已经注册，请切换到登录' } }, 409);
        }
        throw e;
      }
      return createSession(env, (await env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first<Account>())!);
    }
    if (!await verifyPassword(password, credential?.password_hash || null)) return response({ error: { message: '账号或密码不正确，请重新输入' } }, 401);
    const account = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(credential!.user_id).first<Account>();
    if (!account) return response({ error: { message: '账号或密码不正确，请重新输入' } }, 401);
    return createSession(env, account);
  }
  if (url.pathname === '/api/session') {
    const account = await currentAccount(request, env);
    const config = await getConfig(env);
    return response({ userId: account?.id || null, googleConfigured, isAdmin: Boolean(account && isAdmin(env, account.id)), providers: { gemini: Boolean(env.GEMINI_API_KEY) && config.serviceEnabled, openai: Boolean(env.OPENAI_API_KEY) && config.serviceEnabled }, creditBillingEnabled: config.creditBillingEnabled, markup: config.markup, rates: config.rates, supportText: config.supportText });
  }
  if (url.pathname === '/api/auth/password') {
    if (request.method !== 'POST') return response({ error: { message: 'Method Not Allowed' } }, 405);
    const account = await currentAccount(request, env);
    if (!account || account.status !== 'active') return response({ error: { message: '请先登录有效账号' } }, 401);
    if (!['email', 'username'].includes(account.provider)) return response({ error: { message: '此账号请通过原登录服务管理密码' } }, 400);
    const data = await readAuthBody(request);
    if (typeof data?.currentPassword !== 'string' || data.currentPassword.length > 128 || typeof data.newPassword !== 'string' || data.newPassword.length < 8 || data.newPassword.length > 128 || !/[a-z]/.test(data.newPassword) || !/[A-Z]/.test(data.newPassword) || !/[0-9]/.test(data.newPassword)) return response({ error: { message: '新密码至少 8 个字符，需包含大写字母、小写字母和数字' } }, 400);
    if (!await allowAuth(request, env, account.id)) return response({ error: { message: '操作过于频繁，请 15 分钟后再试' } }, 429);
    const table = account.provider === 'email' ? 'email_credentials' : 'username_credentials';
    const stored = await env.DB.prepare(`SELECT password_hash FROM ${table} WHERE user_id = ?`).bind(account.id).first<{ password_hash: string }>();
    if (!await verifyPassword(data.currentPassword, stored?.password_hash || null)) return response({ error: { message: '当前密码不正确' } }, 401);
    const hash = await hashPassword(data.newPassword);
    // CAS 避免并发修改绕过旧密码校验；仅胜出请求撤销所有旧会话。
    const token = nonce();
    const result = await env.DB.batch([
      env.DB.prepare(`UPDATE ${table} SET password_hash = ? WHERE user_id = ? AND password_hash = ?`).bind(hash, account.id, stored!.password_hash),
      env.DB.prepare(`DELETE FROM sessions WHERE user_id = ? AND EXISTS (SELECT 1 FROM ${table} WHERE user_id = ? AND password_hash = ?)`).bind(account.id, account.id, hash),
      env.DB.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM ${table} WHERE user_id = ? AND password_hash = ?)`).bind(await digest(token), account.id, Date.now() + 30 * 86400_000, account.id, hash),
    ]);
    if (result[0].meta.changes !== 1) return response({ error: { message: '密码已变化，请重新登录后再试' } }, 409);
    const reply = response({ ok: true }); reply.headers.append('Set-Cookie', sessionCookie(token, 30 * 86400)); return reply;
  }
  if (url.pathname === '/api/account') {
    const account = await currentAccount(request, env);
    const config = await getConfig(env);
    const limits = { free: config.freeDailyLimit, pro: config.proDailyLimit, studio: config.studioDailyLimit };
    if (!account) return response({ account: null, googleConfigured, paymentsEnabled: false, limits });
    if (request.method === 'PATCH') {
      const data = await request.json() as any;
      if (typeof data?.displayName !== 'string' || !data.displayName.trim() || data.displayName.trim().length > 60) {
        return response({ error: { message: '显示名称需为 1–60 个字符' } }, 400);
      }
      await env.DB.prepare('UPDATE accounts SET display_name = ? WHERE id = ?').bind(data.displayName.trim(), account.id).run();
      account.display_name = data.displayName.trim();
    } else if (request.method !== 'GET') return response({ error: { message: 'Method Not Allowed' } }, 405);
    const day = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const usage = await env.DB.prepare('SELECT COUNT(*) AS count FROM ai_requests WHERE day = ? AND user_id = ?').bind(day, account.id).first<{ count: number }>();
    const ledger = await env.DB.prepare('SELECT amount, reason, created_at FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').bind(account.id).all();
    const [activity, project, library] = await Promise.all([
      env.DB.prepare('SELECT id, provider, model, status, charged_credits, created_at FROM ai_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').bind(account.id).all(),
      env.DB.prepare('SELECT saved_at, node_count FROM projects WHERE id = ?').bind(account.id).first(),
      env.DB.prepare('SELECT COUNT(*) AS count FROM library_assets WHERE user_id = ?').bind(account.id).first<{ count: number }>(),
    ]);
    return response({ account, googleConfigured, paymentsEnabled: false, isAdmin: isAdmin(env, account.id), creditBillingEnabled: config.creditBillingEnabled, supportText: config.supportText, limits, dailyLimit: dailyLimit(config, account), usedToday: usage?.count || 0, ledger: ledger.results, activity: activity.results, project, libraryCount: library?.count || 0 });
  }
  if (url.pathname === '/api/billing/checkout') return response({ error: { message: '充值与订阅尚未开放收款，当前不会扣费或开通付费权益' } }, 503);
  if (url.pathname === '/api/auth/signout') {
    if (request.method !== 'POST') return response({ error: { message: 'Method Not Allowed' } }, 405);
    const token = cookie(request, 'craftcanvas_session');
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await digest(token)).run();
    const result = response({ signoutUrl: '/account' });
    result.headers.append('Set-Cookie', sessionCookie('', 0));
    result.headers.append('Set-Cookie', signedOutCookie(30 * 86400));
    return result;
  }
  if (url.pathname !== '/auth/google' && url.pathname !== '/auth/google/callback') return null;
  if (request.method !== 'GET') return response({ error: { message: 'Method Not Allowed' } }, 405);
  if (!googleConfigured) return Response.redirect(`${url.origin}/account?login=unconfigured`, 303);
  const origin = env.SITE_ORIGIN!;
  const redirectUri = `${origin}/auth/google/callback`;
  if (url.pathname === '/auth/google') {
    const state = nonce();
    await env.DB.prepare('INSERT INTO oauth_states (state_hash, expires_at) VALUES (?, ?)').bind(await digest(state), Date.now() + 600_000).run();
    const destination = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    destination.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' }).toString();
    return new Response(null, { status: 302, headers: { Location: destination.href, 'Cache-Control': 'no-store', 'Set-Cookie': `craftcanvas_oauth_state=${state}; Path=/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=600` } });
  }
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!state || !code || state !== cookie(request, 'craftcanvas_oauth_state')) return Response.redirect(`${origin}/account?login=failed`, 303);
  const valid = await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash = ? AND expires_at > ? RETURNING state_hash').bind(await digest(state), Date.now()).first();
  if (!valid) return Response.redirect(`${origin}/account?login=failed`, 303);
  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    });
    if (!tokenResponse.ok) throw new Error('OAuth token rejected');
    const tokens = await tokenResponse.json() as any;
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (!profileResponse.ok) throw new Error('Profile rejected');
    const profile = await profileResponse.json() as any;
    if (!profile.email_verified || typeof profile.sub !== 'string' || typeof profile.email !== 'string') throw new Error('Identity rejected');
    const existingAccount = await env.DB.prepare('SELECT id FROM accounts WHERE id = ?').bind(`google:${profile.sub}`).first();
    if (!existingAccount && !(await getConfig(env)).signupEnabled) return Response.redirect(`${origin}/account?login=signup-closed`, 303);
    const account = await upsertAccount(env, `google:${profile.sub}`, profile.email, typeof profile.name === 'string' ? profile.name.slice(0, 60) : profile.email.split('@')[0], 'google');
    const token = nonce();
    await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await digest(token), account.id, Date.now() + 30 * 86400_000).run();
    const result = new Response(null, { status: 303, headers: { Location: '/', 'Cache-Control': 'no-store' } });
    result.headers.append('Set-Cookie', sessionCookie(token, 30 * 86400));
    result.headers.append('Set-Cookie', signedOutCookie(0));
    result.headers.append('Set-Cookie', 'craftcanvas_oauth_state=; Path=/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    return result;
  } catch {
    return Response.redirect(`${origin}/account?login=failed`, 303);
  }
}

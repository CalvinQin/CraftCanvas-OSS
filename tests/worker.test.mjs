import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { build } from 'esbuild';

const output = await build({ entryPoints: ['server/worker.ts'], bundle: true, format: 'esm', platform: 'browser', write: false });
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

function environment() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync('drizzle').filter(file => file.endsWith('.sql')).sort()) sqlite.exec(readFileSync(`drizzle/${file}`, 'utf8'));
  const objects = new Map();
  const DB = { async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(statement.runSync()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  }, prepare(sql) {
    const statement = sqlite.prepare(sql);
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() { return statement.get(...args) || null; },
      runSync() { const result = statement.run(...args); return { meta: { changes: Number(result.changes) } }; },
      async run() { return this.runSync(); },
      async all() { return { results: statement.all(...args) }; },
    };
  } };
  const BUCKET = {
    async put(key, value, options) { objects.set(key, { value: typeof value === 'string' ? new TextEncoder().encode(value) : value, ...options }); },
    async head(key) { return objects.get(key) || null; },
    async get(key) { const object = objects.get(key); return object ? { body: object.value, httpMetadata: object.httpMetadata } : null; },
  };
  return { DB, BUCKET, TRUST_SITES_IDENTITY: 'true', ASSETS: { fetch: async request => new URL(request.url).pathname.startsWith('/__pages/') ? new Response('<html>public site</html>', { headers: { 'Content-Type': 'text/html' } }) : new Response('Not found', { status: 404 }) }, sqlite, objects };
}
function request(path, options = {}, user = 'alice') {
  return new Request(`https://site.example${path}`, { ...options, headers: {
    ...(user ? { 'oai-authenticated-user-id': user, 'oai-authenticated-user-email': `${user}@example.com` } : {}),
    ...options.headers,
  } });
}
const snapshot = { nodes: [{ id: 'a', url: 'image' }], runs: [], messages: [], refImages: [], nextY: 1, assetsY: 0, savedAt: 1234 };

test('project revisions reject stale pages and require a read before saving', async () => {
  const env = environment();
  const read = () => worker.fetch(request('/api/project'), env);
  const save = (etag, value = snapshot) => worker.fetch(request('/api/project', { method: 'PUT', headers: etag ? { 'If-Match': etag } : {}, body: JSON.stringify(value) }), env);
  const initial = await read();
  assert.equal(initial.headers.get('etag'), '"empty"');
  assert.equal((await save()).status, 428);
  const first = await save(initial.headers.get('etag'));
  assert.equal(first.status, 200);
  assert.equal((await save('"empty"')).status, 412);
  const next = { ...snapshot, savedAt: 2000, nodes: [] };
  const second = await save(first.headers.get('etag'), next);
  assert.equal(second.status, 200);
  assert.notEqual(second.headers.get('etag'), first.headers.get('etag'));
  assert.equal((await save(first.headers.get('etag'))).status, 412);
  assert.deepEqual(await (await read()).json(), next);
  assert.equal((await worker.fetch(request('/api/project', { headers: { 'X-Project-Account': 'chatgpt:bob' } }), env)).status, 409);
});

test('concurrent first saves and updates atomically accept exactly one writer', async () => {
  for (const existing of [false, true]) {
    const env = environment();
    let etag = '"empty"';
    const save = value => worker.fetch(request('/api/project', { method: 'PUT', headers: { 'If-Match': etag }, body: JSON.stringify(value) }), env);
    if (existing) etag = (await save(snapshot)).headers.get('etag');
    const originalPut = env.BUCKET.put;
    let release; const ready = new Promise(resolve => { release = resolve; }); let writes = 0;
    env.BUCKET.put = async (...args) => { if (++writes === 2) release(); await ready; return originalPut(...args); };
    const values = [{ ...snapshot, savedAt: 2000 }, { ...snapshot, savedAt: 3000 }];
    const results = await Promise.all(values.map(save));
    assert.deepEqual(results.map(result => result.status).sort(), [200, 412]);
    const winner = results.findIndex(result => result.status === 200);
    const read = await worker.fetch(request('/api/project'), env);
    assert.equal(read.headers.get('etag'), results[winner].headers.get('etag'));
    assert.deepEqual(await read.json(), values[winner]);
  }
});

test('failed snapshot upload keeps the existing revision and content intact', async () => {
  const env = environment();
  const save = (etag, value) => worker.fetch(request('/api/project', { method: 'PUT', headers: { 'If-Match': etag }, body: JSON.stringify(value) }), env);
  const first = await save('"empty"', snapshot);
  env.BUCKET.put = async () => { throw new Error('Storage unavailable'); };
  assert.equal((await save(first.headers.get('etag'), { ...snapshot, nodes: [] })).status, 503);
  const read = await worker.fetch(request('/api/project'), env);
  assert.equal(read.headers.get('etag'), first.headers.get('etag'));
  assert.deepEqual(await read.json(), snapshot);
});

test('anonymous visitors can view pages; private APIs require identity', async () => {
  const env = environment();
  assert.equal((await worker.fetch(request('/', {}, null), env)).status, 200);
  for (const path of ['/', '/account', '/account?login=1', '/admin', '/workspace', '/workflow', '/library', '/pricing', '/help', '/privacy', '/terms', '/docs', '/docs/workflows', '/docs/self-hosting']) {
    const page = await worker.fetch(request(path, {}, null), env);
    assert.equal(page.status, 200); assert.match(page.headers.get('content-type'), /text\/html/);
    assert.equal(page.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await worker.fetch(request('/missing.js', {}, null), env)).status, 404);
  for (const path of ['/api/project', '/api/assets/' + 'a'.repeat(64), '/api/openai-image']) {
    assert.equal((await worker.fetch(request(path, {}, null), env)).status, 401);
  }
  const info = await (await worker.fetch(request('/api/account', {}, null), env)).json();
  assert.equal(info.account, null); assert.equal(info.googleConfigured, false); assert.equal(info.paymentsEnabled, false);
});

test('email registration and login work without ChatGPT, isolate projects and revoke sessions', async () => {
  const env = environment();
  const auth = (path, body, headers = {}) => worker.fetch(request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }, null), env);
  const credentials = { email: 'Creator@Example.COM', password: 'Test-only-long-passphrase8', displayName: '创作者' };
  const registered = await auth('/api/auth/register', credentials);
  assert.equal(registered.status, 200);
  const session = registered.headers.getSetCookie().find(value => value.startsWith('craftcanvas_session='));
  assert.match(session, /HttpOnly; Secure; SameSite=Lax/);
  const account = (await registered.json()).account;
  assert.equal(account.provider, 'email'); assert.equal(account.email, 'creator@example.com');
  assert.equal(account.plan, 'free'); assert.equal(account.credits, 0); assert.equal(account.password_hash, undefined);
  const stored = env.sqlite.prepare('SELECT password_hash FROM email_credentials').get().password_hash;
  assert.match(stored, /^scrypt\$32768\$8\$3\$/); assert.ok(!stored.includes(credentials.password));
  const headers = { Cookie: session.split(';')[0] };
  assert.equal((await worker.fetch(request('/api/project', { method: 'PUT', headers: { ...headers, 'If-Match': '"empty"' }, body: JSON.stringify(snapshot) }, null), env)).status, 200);
  assert.equal(await (await worker.fetch(request('/api/project', {}, 'bob'), env)).json(), null);
  assert.equal((await auth('/api/auth/register', { ...credentials, email: 'creator@example.com' })).status, 409);
  assert.equal((await auth('/api/auth/login', { ...credentials, password: 'incorrect-passphrase' })).status, 401);
  const logout = await worker.fetch(request('/api/auth/signout', { method: 'POST', headers }, null), env);
  assert.equal((await logout.json()).signoutUrl, '/account');
  assert.equal((await worker.fetch(request('/api/project', { headers }, null), env)).status, 401);
  assert.equal((await (await worker.fetch(request('/api/account', { headers: { Cookie: 'craftcanvas_signed_out=1' } }), env)).json()).account, null);
  const login = await auth('/api/auth/login', credentials);
  assert.equal(login.status, 200);
  const loginCookie = login.headers.getSetCookie().find(value => value.startsWith('craftcanvas_session=')).split(';')[0];
  assert.deepEqual(await (await worker.fetch(request('/api/project', { headers: { Cookie: loginCookie } }, null), env)).json(), snapshot);
});

test('public auth rejects malformed bodies, cross-site registration and excessive attempts', async () => {
  const env = environment();
  const send = (body, headers = {}) => worker.fetch(request('/api/auth/login', { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...headers } }, null), env);
  assert.equal((await send('{')).status, 400);
  assert.equal((await send('x'.repeat(4097))).status, 400);
  assert.equal((await send('{}', { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await send(JSON.stringify({ email: 'a@example.com', password: 'short' }))).status, 400);
  const bucket = Math.floor(Date.now() / 900_000);
  env.sqlite.prepare('INSERT INTO auth_limits (key, attempts, expires_at) VALUES (?, ?, ?)').run(`${bucket}:global`, 100, Date.now() + 900_000);
  assert.equal((await send(JSON.stringify({ email: 'a@example.com', password: 'long-test-password' }))).status, 429);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS count FROM accounts').get().count, 0);
});

test('snapshot and asset bytes survive round trip and are isolated by account', async () => {
  const env = environment();
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const path = '/api/assets/' + hash;
  assert.equal((await worker.fetch(request(path, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'image/png' } }), env)).status, 200);
  assert.deepEqual(new Uint8Array(await (await worker.fetch(request(path), env)).arrayBuffer()), bytes);
  assert.equal((await worker.fetch(request(path, {}, 'bob'), env)).status, 404);
  assert.equal((await worker.fetch(request('/api/project', { method: 'PUT', headers: { 'If-Match': '"empty"' }, body: JSON.stringify(snapshot) }), env)).status, 200);
  assert.deepEqual(await (await worker.fetch(request('/api/project'), env)).json(), snapshot);
  assert.equal(await (await worker.fetch(request('/api/project', {}, 'bob'), env)).json(), null);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS count FROM projects').get().count, 1);
});

test('storage failure never presents an existing project as empty', async () => {
  const env = environment();
  await worker.fetch(request('/api/project', { method: 'PUT', headers: { 'If-Match': '"empty"' }, body: JSON.stringify(snapshot) }), env);
  env.BUCKET.get = async () => { throw new Error('Offline'); };
  assert.equal((await worker.fetch(request('/api/project'), env)).status, 503);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS count FROM projects').get().count, 1);
});

test('cross-site writes, bad checksums and oversized images are rejected', async () => {
  const env = environment();
  assert.equal((await worker.fetch(request('/api/project', { method: 'PUT', headers: { Origin: 'https://attacker.example' }, body: '{}' }), env)).status, 403);
  assert.equal((await worker.fetch(request('/api/assets/' + 'a'.repeat(64), { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: 'bad hash' }), env)).status, 400);
  assert.equal((await worker.fetch(request('/api/assets/' + 'a'.repeat(64), { method: 'PUT', headers: { 'Content-Type': 'image/png', 'Content-Length': String(21 * 1024 * 1024) }, body: 'x' }), env)).status, 413);
});

test('model quotas apply atomically to each user and the whole site', async () => {
  const env = environment(); env.OPENAI_API_KEY = 'test-placeholder';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"data":[{"b64_json":"AQ=="}]}', { headers: { 'Content-Type': 'application/json' } });
  const generate = user => worker.fetch(request('/api/openai-image', { method: 'POST', body: JSON.stringify({ prompt: 'test' }) }, user), env);
  try {
    const responses = await Promise.all(Array.from({ length: 21 }, () => generate('alice')));
    assert.equal(responses.filter(res => res.status === 200).length, 20);
    assert.equal(responses.filter(res => res.status === 429).length, 1);
    for (const user of ['bob', 'c', 'd', 'e']) for (let i = 0; i < 20; i++) assert.equal((await generate(user)).status, 200);
    assert.equal((await generate('f')).status, 429);
    assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS count FROM ai_requests').get().count, 100);
  } finally { globalThis.fetch = originalFetch; }
});

test('membership starts free, profile changes persist and checkout cannot grant credits', async () => {
  const env = environment();
  const info = await (await worker.fetch(request('/api/account'), env)).json();
  assert.equal(info.account.plan, 'free'); assert.equal(info.account.credits, 0);
  await worker.fetch(request('/api/account', { method: 'PATCH', body: JSON.stringify({ displayName: 'Alice 新名字' }) }), env);
  assert.equal((await (await worker.fetch(request('/api/account'), env)).json()).account.display_name, 'Alice 新名字');
  assert.equal((await worker.fetch(request('/api/billing/checkout', { method: 'POST', body: JSON.stringify({ credits: 100000 }) }), env)).status, 503);
  assert.equal(env.sqlite.prepare('SELECT credits FROM accounts').get().credits, 0);
});

test('Google OAuth consumes state, stores only hashed sessions and rejects replay', async () => {
  const env = environment(); Object.assign(env, { GOOGLE_CLIENT_ID: 'test-id', GOOGLE_CLIENT_SECRET: 'test-secret', SITE_ORIGIN: 'https://site.example' });
  const start = await worker.fetch(request('/auth/google', {}, null), env);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const callback = '/auth/google/callback?code=test-code&state=' + state;
  const headers = { Cookie: `craftcanvas_oauth_state=${state}` };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => new Response(JSON.stringify(String(url).includes('/token') ? { access_token: 'test-access' } : { sub: '123', email: 'google@example.com', email_verified: true, name: 'Google user' }));
  try {
    assert.equal((await worker.fetch(request(callback, {}, null), env)).headers.get('location'), 'https://site.example/account?login=failed');
    const result = await worker.fetch(request(callback, { headers }, null), env);
    assert.equal(result.status, 303); assert.equal(result.headers.get('location'), '/');
    const session = result.headers.getSetCookie().find(value => value.startsWith('craftcanvas_session=')).split(';')[0];
    const info = await (await worker.fetch(request('/api/account', { headers: { Cookie: session } }, null), env)).json();
    assert.equal(info.account.provider, 'google');
    const stored = env.sqlite.prepare('SELECT token_hash FROM sessions').get();
    assert.equal(stored.token_hash.length, 64); assert.ok(!session.includes(stored.token_hash));
    assert.equal((await worker.fetch(request(callback, { headers }, null), env)).headers.get('location'), 'https://site.example/account?login=failed');
    await worker.fetch(request('/api/auth/signout', { method: 'POST', headers: { Cookie: session } }, null), env);
    assert.equal((await (await worker.fetch(request('/api/account', { headers: { Cookie: session } }, null), env)).json()).account, null);
  } finally { globalThis.fetch = originalFetch; }
});

async function adminEnv() {
  const env = environment(); env.ADMIN_ACCOUNT_IDS = 'chatgpt:owner'; env.SETTINGS_ENCRYPTION_KEY = 'test-only-encryption-master-secret-32bytes';
  await worker.fetch(request('/api/account', {}, 'owner'), env);
  await worker.fetch(request('/api/account', {}, 'customer'), env);
  return env;
}
const admin = (env, path, body, method = body ? 'POST' : 'GET', who = 'owner') => worker.fetch(request(`/api/admin/${path}`, { method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) }, who), env);

test('admin APIs enforce server allowlist; customer headers and role fields cannot grant access', async () => {
  const env = await adminEnv();
  for (const path of ['overview', 'customers', 'requests', 'finance', 'settings']) {
    assert.equal((await admin(env, path, null, 'GET', null)).status, 401);
    assert.equal((await admin(env, path, null, 'GET', 'customer')).status, 403);
    assert.equal((await admin(env, path)).status, 200);
  }
  assert.equal((await worker.fetch(request('/api/admin/settings', { headers: { 'x-admin': 'true', 'x-role': 'admin' } }, 'customer'), env)).status, 403);
  await worker.fetch(request('/api/account', { method: 'PATCH', body: JSON.stringify({ displayName: 'Safe', role: 'admin', credits: 999999, plan: 'studio' }) }, 'customer'), env);
  const account = await (await worker.fetch(request('/api/account', {}, 'customer'), env)).json();
  assert.equal(account.isAdmin, false); assert.equal(account.account.credits, 0); assert.equal(account.account.plan, 'free');
  assert.equal((await admin(env, 'settings', { config: {} }, 'PUT', 'customer')).status, 403);
  assert.equal((await worker.fetch(request('/api/admin/settings', { method: 'PUT', headers: { Origin: 'https://external.example' }, body: '{}' }, 'owner'), env)).status, 403);
});

test('settings validate limits, encrypt secrets, never echo them, and reject stale writes atomically', async () => {
  const env = await adminEnv();
  const first = await (await admin(env, 'settings')).json();
  const config = { ...first.config, markup: 1.5, freeDailyLimit: 7 };
  const payload = { config, revision: first.revision, secrets: { OPENAI_API_KEY: 'private-admin-key-test-only' } };
  assert.equal((await admin(env, 'settings', payload, 'PUT')).status, 200);
  const stored = env.sqlite.prepare("SELECT value FROM site_settings WHERE key = 'secret:OPENAI_API_KEY'").get().value;
  assert.ok(!stored.includes('private-admin-key')); assert.match(stored, /^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
  const settingsResponse = await admin(env, 'settings'); const text = await settingsResponse.text(); assert.ok(!text.includes('private-admin-key'));
  const settings = JSON.parse(text); assert.equal(settings.secrets.OPENAI_API_KEY.source, 'admin'); assert.equal(settings.config.markup, 1.5);
  const account = await (await worker.fetch(request('/api/account', {}, 'customer'), env)).json(); assert.equal(account.dailyLimit, 7);
  const session = await (await worker.fetch(request('/api/session', {}, 'customer'), env)).json(); assert.equal(session.providers.openai, true); assert.ok(!JSON.stringify(session).includes('private-admin-key'));
  assert.equal((await admin(env, 'settings', { ...payload, secrets: { OPENAI_API_KEY: 'stale-key-must-not-replace' } }, 'PUT')).status, 409);
  assert.equal(env.sqlite.prepare("SELECT value FROM site_settings WHERE key = 'secret:OPENAI_API_KEY'").get().value, stored);
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) AS n FROM site_settings WHERE key LIKE 'update:%'").get().n, 0);
  assert.equal((await admin(env, 'settings', { config: { ...config, markup: -1 }, revision: settings.revision }, 'PUT')).status, 400);
  assert.equal((await admin(env, 'settings', { config, revision: settings.revision, secrets: { ADMIN_ACCOUNT_IDS: 'chatgpt:customer' } }, 'PUT')).status, 400);
  assert.equal((await admin(env, 'settings', { config, revision: settings.revision, secrets: { OPENAI_API_KEY: null } }, 'PUT')).status, 200);
  assert.equal((await (await worker.fetch(request('/api/session', {}, 'customer'), env)).json()).providers.openai, false);
  assert.ok(!JSON.stringify(env.sqlite.prepare('SELECT details FROM admin_audit').all()).includes('private-admin-key'));
});

test('manual credit adjustments are idempotent, reject overdrafts and never inflate revenue', async () => {
  const env = await adminEnv();
  const payload = { id: 'chatgpt:customer', amount: 30, reason: '测试赠送', operationId: crypto.randomUUID() };
  assert.equal((await admin(env, 'credits', payload)).status, 200);
  assert.equal((await admin(env, 'credits', payload)).status, 200);
  assert.equal(env.sqlite.prepare("SELECT credits FROM accounts WHERE id = 'chatgpt:customer'").get().credits, 30);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM credit_ledger').get().n, 1);
  assert.equal((await admin(env, 'credits', { ...payload, amount: 999 })).status, 409);
  assert.equal((await admin(env, 'credits', { ...payload, amount: -31, operationId: crypto.randomUUID() })).status, 409);
  const overview = await (await admin(env, 'overview')).json(); assert.equal(overview.revenue.totalCents, 0); assert.equal(overview.revenue.paidOrders, 0);
  assert.equal((await admin(env, 'customer', { id: 'chatgpt:customer', plan: 'pro', status: 'active', dailyLimit: 3 }, 'PATCH')).status, 200);
  assert.equal((await (await worker.fetch(request('/api/account', {}, 'customer'), env)).json()).dailyLimit, 3);
  assert.equal((await admin(env, 'customer', { id: 'chatgpt:customer', plan: 'pro', status: 'suspended', dailyLimit: null }, 'PATCH')).status, 200);
  assert.equal((await worker.fetch(request('/api/project', {}, 'customer'), env)).status, 403);
  assert.equal((await admin(env, 'customer', { id: 'chatgpt:owner', plan: 'free', status: 'suspended', dailyLimit: null }, 'PATCH')).status, 400);
});

test('customer key fallback is removed; invalid model calls consume neither quota nor credits', async () => {
  const env = await adminEnv();
  assert.equal((await worker.fetch(request('/api/openai-image', { method: 'POST', headers: { 'x-openai-key': 'visitor-test-key' }, body: JSON.stringify({ prompt: 'test' }) }, 'customer'), env)).status, 503);
  assert.equal((await worker.fetch(request('/api/gemini/v1beta/models/arbitrary:generateContent', { method: 'POST', headers: { 'x-goog-api-key': 'visitor-test-key' }, body: '{}' }, 'customer'), env)).status, 503);
  env.OPENAI_API_KEY = 'server-only-test-key'; env.GEMINI_API_KEY = 'server-only-test-key';
  const invalid = [ { prompt: 'test', quality: 'invalid' }, { prompt: 'test', mode: 'edit', images: ['not-image'] }, { prompt: 'test', size: '99999x99999' } ];
  for (const body of invalid) assert.equal((await worker.fetch(request('/api/openai-image', { method: 'POST', body: JSON.stringify(body) }, 'customer'), env)).status, 400);
  assert.equal((await worker.fetch(request('/api/gemini/v1beta/models/unknown:generateContent', { method: 'POST', body: '{}' }, 'customer'), env)).status, 400);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM ai_requests').get().n, 0);
});

test('server markup charges atomically, insufficient balance blocks concurrent requests and failures refund once', async () => {
  const env = await adminEnv(); env.OPENAI_API_KEY = 'server-only-test-key';
  const settings = await (await admin(env, 'settings')).json(); const config = { ...settings.config, creditBillingEnabled: true, markup: 1.5 };
  config.rates.openaiLow = { credits: 3, costCents: 7 };
  assert.equal((await admin(env, 'settings', { config, revision: settings.revision }, 'PUT')).status, 200);
  await admin(env, 'credits', { id: 'chatgpt:customer', amount: 10, reason: '并发额度测试', operationId: crypto.randomUUID() });
  const originalFetch = globalThis.fetch; let seenKey; let result = 'success';
  globalThis.fetch = async (_url, init) => { seenKey = init.headers.Authorization; if (result === 'network') throw new Error('Test network failure'); return result === 'success' ? Response.json({ data: [{ b64_json: 'test-image' }] }) : result === 'empty' ? Response.json({ data: [] }) : Response.json({ error: { message: 'secret-provider-error' } }, { status: 401 }); };
  const generate = () => worker.fetch(request('/api/openai-image', { method: 'POST', body: JSON.stringify({ prompt: 'test', quality: 'low', chargedCredits: 0, markup: 0 }) }, 'customer'), env);
  try {
    const responses = await Promise.all([generate(), generate(), generate()]);
    assert.equal(responses.filter(r => r.status === 200).length, 2); assert.equal(responses.filter(r => r.status === 402).length, 1);
    assert.equal(seenKey, 'Bearer server-only-test-key'); assert.equal(env.sqlite.prepare("SELECT credits FROM accounts WHERE id = 'chatgpt:customer'").get().credits, 0);
    assert.equal(env.sqlite.prepare('SELECT SUM(charged_credits) AS credits FROM ai_requests').get().credits, 10);
    await admin(env, 'credits', { id: 'chatgpt:customer', amount: 5, reason: '失败退款测试', operationId: crypto.randomUUID() });
    for (const type of ['upstream', 'empty', 'network']) { result = type; const failure = await generate(); assert.ok([422, 503].includes(failure.status)); assert.ok(!(await failure.text()).includes('secret-provider-error')); assert.equal(env.sqlite.prepare("SELECT credits FROM accounts WHERE id = 'chatgpt:customer'").get().credits, 5); }
    const failed = env.sqlite.prepare("SELECT id FROM ai_requests WHERE status = 'failed' LIMIT 1").get().id;
    const usageModule = await build({ entryPoints: ['server/usage.ts'], bundle: true, format: 'esm', platform: 'browser', write: false });
    const { finishRequest } = await import(`data:text/javascript;base64,${Buffer.from(usageModule.outputFiles[0].text).toString('base64')}`);
    await finishRequest(env, failed, false, 503, 0);
    assert.equal(env.sqlite.prepare("SELECT credits FROM accounts WHERE id = 'chatgpt:customer'").get().credits, 5);
    assert.equal(env.sqlite.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE id LIKE 'refund:%'").get().n, 3);
    const overview = await (await admin(env, 'overview')).json(); assert.equal(overview.usage.spentCredits, 10); assert.equal(overview.usage.failed, 3); assert.equal(overview.revenue.totalCents, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('simultaneous settings saves cannot apply the losing secret override', async () => {
  const env = await adminEnv(); const initial = await (await admin(env, 'settings')).json();
  const originalNow = Date.now; const frozen = originalNow(); Date.now = () => frozen;
  let responses;
  try { responses = await Promise.all(['first-server-key', 'second-server-key'].map(value => admin(env, 'settings', { config: initial.config, revision: initial.revision, secrets: { OPENAI_API_KEY: value } }, 'PUT'))); }
  finally { Date.now = originalNow; }
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const winner = responses[0].status === 200 ? 'first-server-key' : 'second-server-key';
  let actualKey; const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => { actualKey = init.headers.Authorization; return Response.json({ data: [{ b64_json: 'image' }] }); };
  try { assert.equal((await worker.fetch(request('/api/openai-image', { method: 'POST', body: JSON.stringify({ prompt: 'test' }) }, 'customer'), env)).status, 200); assert.equal(actualKey, `Bearer ${winner}`); }
  finally { globalThis.fetch = originalFetch; }
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'settings.update'").get().n, 1);
});

test('Gemini fixed models use cloud key and record meaningful success or failure', async () => {
  const env = await adminEnv(); env.GEMINI_API_KEY = 'cloud-gemini-test-only';
  let analysis = false; let sentUrl; let sentKey; const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sentUrl = url; sentKey = init.headers['x-goog-api-key']; return Response.json({ candidates: [{ content: { parts: analysis ? [{ text: 'analysis result' }] : [{ inlineData: { data: 'image', mimeType: 'image/png' } }] } }] }); };
  const generate = (model, body = { contents: [{ parts: [{ text: 'test' }] }] }) => worker.fetch(request(`/api/gemini/v1beta/models/${model}:generateContent?key=visitor-query-key`, { method: 'POST', headers: { 'x-goog-api-key': 'visitor-key' }, body: JSON.stringify(body) }, 'customer'), env);
  try {
    assert.equal((await generate('gemini-3.1-flash-image')).status, 200); assert.equal(sentKey, 'cloud-gemini-test-only'); assert.ok(!sentUrl.includes('visitor-query-key'));
    analysis = true; assert.equal((await generate('gemini-3.8-flash')).status, 200);
    assert.equal((await generate('gemini-3.1-flash-image')).status, 422);
    assert.equal((await generate('gemini-3-pro-image')).status, 400);
    assert.equal((await generate('gemini-3.6-flash')).status, 400);
    assert.equal((await generate('gemini-3.1-flash-image', { contents: 'test', tools: [{ codeExecution: {} }] })).status, 400);
    assert.equal((await generate('gemini-3.1-flash-image', { contents: 'test', generationConfig: { candidateCount: 10 } })).status, 400);
    assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM ai_requests').get().n, 3);
    const overview = await (await admin(env, 'overview')).json(); assert.equal(overview.usage.succeeded, 2); assert.equal(overview.usage.failed, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('signup switch closes new identities while existing users can still sign in', async () => {
  const env = await adminEnv(); const settings = await (await admin(env, 'settings')).json();
  assert.equal((await admin(env, 'settings', { config: { ...settings.config, signupEnabled: false }, revision: settings.revision }, 'PUT')).status, 200);
  assert.equal((await worker.fetch(request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'new@example.com', password: 'Test-only-long-password8', displayName: 'New' }) }, null), env)).status, 403);
  assert.equal((await worker.fetch(request('/api/project', {}, 'new-site-user'), env)).status, 401);
  assert.equal((await worker.fetch(request('/api/project', {}, 'customer'), env)).status, 200);
});

test('registration accepts exactly eight mixed characters, rejects missing categories and preserves legacy login', async () => {
  const env = environment();
  const register = (password, email = 'eight@example.com') => worker.fetch(request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, displayName: 'Eight' }) }, null), env);
  for (const password of ['Abcd123', 'abcdefgh', 'ABCDEFG8', 'Abcdefgh', '12345678']) assert.equal((await register(password)).status, 400);
  assert.equal((await register('Abcdef12')).status, 200);
  const login = await worker.fetch(request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'eight@example.com', password: 'Abcdef12' }) }, null), env);
  assert.equal(login.status, 200);
  const passwordModule = await build({ entryPoints: ['server/password.ts'], bundle: true, format: 'esm', platform: 'browser', write: false });
  const { hashPassword } = await import(`data:text/javascript;base64,${Buffer.from(passwordModule.outputFiles[0].text).toString('base64')}`);
  env.sqlite.prepare('INSERT INTO accounts (id, email, display_name, provider, created_at) VALUES (?, ?, ?, ?, ?)').run('email:legacy', 'legacy@example.com', 'Legacy', 'email', Date.now());
  env.sqlite.prepare('INSERT INTO email_credentials (email, user_id, password_hash) VALUES (?, ?, ?)').run('legacy@example.com', 'email:legacy', await hashPassword('old-lowercase-passphrase'));
  assert.equal((await worker.fetch(request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'legacy@example.com', password: 'old-lowercase-passphrase' }) }, null), env)).status, 200);
});

test('one-time administrator provisioning requires secret and exact allowlist, supports username login without email', async () => {
  const env = environment();
  assert.equal((await worker.fetch(request('/api/auth/provision-admin', { method: 'POST' }, null), env)).status, 404);
  const { scryptSync, randomBytes } = await import('node:crypto');
  const password = 'TestOnly482'; const salt = randomBytes(16);
  const hash = `scrypt$32768$8$3$${salt.toString('hex')}$${scryptSync(password, salt, 32, { N: 32768, r: 8, p: 3, maxmem: 40 * 1024 * 1024 }).toString('hex')}`;
  const config = { id: 'admin:test-provision', username: 'StudioOwner', token: 'a'.repeat(64), passwordHash: hash };
  env.ADMIN_BOOTSTRAP_CONFIG = JSON.stringify(config);
  const provision = token => worker.fetch(request('/api/auth/provision-admin', { method: 'POST', headers: { 'x-craftcanvas-bootstrap': token } }, null), env);
  assert.equal((await provision(config.token)).status, 503);
  env.ADMIN_ACCOUNT_IDS = config.id;
  assert.equal((await provision('b'.repeat(64))).status, 403);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM username_credentials').get().n, 0);
  assert.equal((await provision(config.token)).status, 200);
  assert.equal((await provision(config.token)).status, 200);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 1);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM admin_audit').get().n, 1);
  const login = (identifier, pw = password) => worker.fetch(request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: pw }) }, null), env);
  assert.equal((await login('StudioOwner', 'WrongPass123')).status, 401);
  const result = await login('STUDIOOWNER'); assert.equal(result.status, 200);
  const account = (await result.json()).account; assert.equal(account.username, 'StudioOwner'); assert.equal(account.email, ''); assert.equal(account.password_hash, undefined);
  const headers = { Cookie: result.headers.getSetCookie().find(v => v.startsWith('craftcanvas_session=')).split(';')[0] };
  assert.equal((await worker.fetch(request('/api/admin/overview', { headers }, null), env)).status, 200);
  env.ADMIN_ACCOUNT_IDS = 'admin:other'; assert.equal((await worker.fetch(request('/api/admin/overview', { headers }, null), env)).status, 403);
  env.ADMIN_ACCOUNT_IDS = `${config.id},admin:other`; env.ADMIN_BOOTSTRAP_CONFIG = JSON.stringify({ ...config, id: 'admin:other' });
  assert.equal((await provision(config.token)).status, 409);
  assert.equal(env.sqlite.prepare('SELECT user_id FROM username_credentials').get().user_id, config.id);
  delete env.ADMIN_BOOTSTRAP_CONFIG; assert.equal((await provision(config.token)).status, 404);
});

test('private library validates uploads, filters and isolates changes without deleting historical image references', async () => {
  const env = environment(); const image = new TextEncoder().encode('test image bytes');
  const { createHash } = await import('node:crypto'); const hash = createHash('sha256').update(image).digest('hex');
  const send = (path, method = 'GET', data, user = 'alice') => worker.fetch(request(path, { method, ...(data ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}) }, user), env);
  assert.equal((await send('/api/library', 'GET', undefined, null)).status, 401);
  assert.equal((await send('/api/library', 'POST', { hash, name: 'Cup', category: '产品实拍' })).status, 400);
  assert.equal((await worker.fetch(request(`/api/assets/${hash}`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: image }), env)).status, 200);
  assert.equal((await send('/api/library', 'POST', { hash, name: 'Lavender cup', category: '产品实拍' })).status, 201);
  const list = await (await send('/api/library')).json(); assert.equal(list.total, 1); const id = list.rows[0].id;
  assert.equal((await send(`/api/library/${id}`, 'PATCH', { name: 'Stolen' }, 'bob')).status, 404);
  assert.equal((await send(`/api/library/${id}`, 'GET', undefined, 'bob')).status, 404);
  assert.equal((await (await send('/api/library', 'GET', undefined, 'bob')).json()).total, 0);
  assert.equal((await send(`/api/library/${id}`, 'PATCH', { favorite: true, category: '品牌素材' })).status, 200);
  assert.equal((await (await send('/api/library?q=cup&category=品牌素材&favorite=1')).json()).total, 1);
  assert.equal((await (await send('/api/library?category=产品实拍')).json()).total, 0);
  assert.equal((await send(`/api/library/${id}`, 'PATCH', { name: '', favorite: 'yes' })).status, 400);
  assert.equal((await (await send('/api/account')).json()).libraryCount, 1);
  assert.equal((await send(`/api/library/${id}`, 'DELETE', undefined, 'bob')).status, 404);
  assert.equal((await send(`/api/library/${id}`, 'DELETE')).status, 200);
  assert.equal((await (await send('/api/library')).json()).total, 0);
  assert.equal((await worker.fetch(request(`/api/assets/${hash}`), env)).status, 200);
  assert.equal((await send('/api/library?category=not-a-category')).status, 400);
});

test('password change checks current password and complexity and revokes older sessions', async () => {
  const env = environment();
  const auth = (path, data, headers = {}) => worker.fetch(request(`/api/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) }, null), env);
  const credentials = { email: 'secure@example.com', password: 'OriginalPass123', displayName: 'Secure' };
  const registered = await auth('register', credentials); const oldCookie = registered.headers.getSetCookie().find(v => v.startsWith('craftcanvas_session=')).split(';')[0]; const headers = { Cookie: oldCookie };
  assert.equal((await auth('password', { currentPassword: credentials.password, newPassword: 'weakpass' }, headers)).status, 400);
  assert.equal((await auth('password', { currentPassword: 'WrongPass123', newPassword: 'UpdatedPass123' }, headers)).status, 401);
  const changed = await auth('password', { currentPassword: credentials.password, newPassword: 'UpdatedPass123' }, headers); assert.equal(changed.status, 200);
  assert.equal((await worker.fetch(request('/api/project', { headers }, null), env)).status, 401);
  assert.equal((await auth('login', credentials)).status, 401);
  assert.equal((await auth('login', { ...credentials, password: 'UpdatedPass123' })).status, 200);
  const newCookie = changed.headers.getSetCookie().find(v => v.startsWith('craftcanvas_session=')).split(';')[0];
  assert.equal((await worker.fetch(request('/api/project', { headers: { Cookie: newCookie } }, null), env)).status, 200);
});

test('Gemini 3.1 resolution determines server billing rate, while analysis uses 3.8', async () => {
  const env = await adminEnv(); env.GEMINI_API_KEY = 'cloud-test-only';
  const { config, revision } = await (await admin(env, 'settings')).json(); config.rates.flash.costCents = 7; config.rates.pro.costCents = 13; config.rates.analysis.costCents = 3;
  assert.equal((await admin(env, 'settings', { config, revision }, 'PUT')).status, 200);
  const originalFetch = globalThis.fetch; let model;
  globalThis.fetch = async url => { model = String(url); return Response.json({ candidates: [{ content: { parts: model.includes('3.8') ? [{ text: 'analysis' }] : [{ inlineData: { data: 'image' } }] } }] }); };
  const generate = (m, size) => worker.fetch(request(`/api/gemini/v1beta/models/${m}:generateContent`, { method: 'POST', body: JSON.stringify({ contents: 'test', generationConfig: { imageConfig: { imageSize: size } } }) }, 'customer'), env);
  try {
    for (const size of ['1K', '2K', '4K']) assert.equal((await generate('gemini-3.1-flash-image', size)).status, 200);
    assert.equal((await generate('gemini-3.8-flash', '1K')).status, 200);
    assert.equal((await generate('gemini-3.1-flash-image', '8K')).status, 400);
    assert.deepEqual(env.sqlite.prepare('SELECT estimated_cost_cents FROM ai_requests ORDER BY rowid').all().map(r => r.estimated_cost_cents), [7, 13, 13, 3]);
  } finally { globalThis.fetch = originalFetch; }
});

test('Image 2.5 models are allowlisted for generation and editing, with separate Sunburst billing', async () => {
  const env = await adminEnv(); env.OPENAI_API_KEY = 'cloud-openai-test-only';
  const settings = await (await admin(env, 'settings')).json();
  settings.config.rates.openaiLow.costCents = 4; settings.config.rates.sunburstLow.costCents = 9;
  assert.equal((await admin(env, 'settings', { config: settings.config, revision: settings.revision }, 'PUT')).status, 200);
  const originalFetch = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('data:')) return originalFetch(url, init);
    calls.push({ url: String(url), model: init.body instanceof FormData ? init.body.get('model') : JSON.parse(init.body).model });
    return Response.json({ data: [{ b64_json: 'image' }] });
  };
  const generate = body => worker.fetch(request('/api/openai-image', { method: 'POST', body: JSON.stringify({ prompt: 'test', quality: 'low', ...body }) }, 'customer'), env);
  try {
    assert.equal((await generate({})).status, 200);
    assert.equal((await generate({ model: 'gpt-image-2.5-sunburst' })).status, 200);
    assert.equal((await generate({ model: 'gpt-image-2.5-sunburst', mode: 'edit', images: ['data:image/png;base64,aW1hZ2U='] })).status, 200);
    assert.equal((await generate({ model: 'gpt-image-2' })).status, 400);
    assert.equal((await generate({ model: 'visitor-model' })).status, 400);
    assert.deepEqual(calls.map(c => c.model), ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-sunburst']);
    assert.match(calls[2].url, /images\/edits$/);
    assert.deepEqual(env.sqlite.prepare('SELECT estimated_cost_cents FROM ai_requests ORDER BY rowid').all().map(r => r.estimated_cost_cents), [4, 9, 9]);
  } finally { globalThis.fetch = originalFetch; }
});

test('existing settings gain new model defaults without changing prior quotas or rates', async () => {
  const env = await adminEnv(); const settings = await (await admin(env, 'settings')).json();
  delete settings.config.rates.sunburstLow; delete settings.config.rates.sunburstMedium; delete settings.config.rates.sunburstHigh;
  settings.config.freeDailyLimit = 37; settings.config.markup = 1.4; settings.config.rates.openaiLow.credits = 11;
  env.sqlite.prepare('INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)').run('config', JSON.stringify(settings.config), Date.now());
  const current = await (await admin(env, 'settings')).json();
  assert.equal(current.config.freeDailyLimit, 37); assert.equal(current.config.markup, 1.4); assert.equal(current.config.rates.openaiLow.credits, 11);
  assert.equal(current.config.rates.sunburstLow.credits, 3);
  assert.equal((await admin(env, 'settings', { config: current.config, revision: current.revision }, 'PUT')).status, 200);
});

test('upstream usage is persisted with immutable cost snapshot; paid failures remain costs after credit refund', async () => {
 const env=environment();env.GEMINI_API_KEY='test-cloud-key';env.ADMIN_ACCOUNT_IDS='chatgpt:alice';
 const originalFetch=globalThis.fetch; let success=true;
 globalThis.fetch=async ()=>new Response(JSON.stringify({candidates:success?[{content:{parts:[{text:'OK'}]}}]:[],usageMetadata:{promptTokenCount:100,candidatesTokenCount:success?10:0,thoughtsTokenCount:success?5:0,totalTokenCount:success?115:100}}));
 try {
  const options={method:'POST',body:JSON.stringify({contents:[{parts:[{text:'hi'}]}]})};
  assert.equal((await worker.fetch(request('/api/gemini/v1beta/models/gemini-3.8-flash:generateContent',options),env)).status,200);
  let row=env.sqlite.prepare('SELECT * FROM ai_requests').get();assert.equal(row.cost_status,'priced');assert.equal(row.cost_usd_micros,131);assert.equal(row.total_tokens,115);const snapshot=row.price_snapshot;
  success=false;assert.equal((await worker.fetch(request('/api/gemini/v1beta/models/gemini-3.8-flash:generateContent',options),env)).status,422);
  row=env.sqlite.prepare("SELECT * FROM ai_requests WHERE status='failed'").get();assert.equal(row.cost_usd_micros,75);
  env.sqlite.prepare("INSERT INTO site_settings (key,value,updated_at) VALUES ('pricing:catalog',?,?)").run(JSON.stringify({models:[]}),Date.now());
  assert.equal(env.sqlite.prepare("SELECT price_snapshot FROM ai_requests WHERE status='succeeded'").get().price_snapshot,snapshot);
 } finally {globalThis.fetch=originalFetch;}
});
test('cost dashboard restricts access, separates unknown coverage, and rejects filter tampering',async()=>{
 const env=environment();env.ADMIN_ACCOUNT_IDS='chatgpt:alice';
 const originalFetch=globalThis.fetch;globalThis.fetch=async()=>new Response('not a price page',{status:503});
 try {
  assert.equal((await worker.fetch(request('/api/admin/costs',{},'bob'),env)).status,403);
  assert.equal((await worker.fetch(request('/api/admin/costs?days=100000'),env)).status,400);
  env.sqlite.prepare("INSERT INTO ai_requests (id,user_id,day,provider,model,status,created_at,cost_status,input_tokens,output_tokens,total_tokens,cost_usd_micros) VALUES ('priced','chatgpt:alice',?,'gemini','gemini-3.8-flash','failed',?,'priced',100,10,110,113)").run(new Date(Date.now()+8*3600000).toISOString().slice(0,10),Date.now());
  env.sqlite.prepare("INSERT INTO ai_requests (id,user_id,day,provider,model,status,created_at) VALUES ('old','chatgpt:alice',?,'gemini','legacy','succeeded',?)").run(new Date(Date.now()+8*3600000).toISOString().slice(0,10),Date.now());
  const data=await(await worker.fetch(request('/api/admin/costs'),env)).json();assert.equal(data.summary.costMicros,113);assert.equal(data.summary.priced,1);assert.equal(data.summary.unpriced,1);assert.equal(data.summary.failedCostMicros,113);assert.equal(data.prices.length,4);assert.ok(data.prices.every(p=>p.error));
  assert.equal((await(await worker.fetch(request('/api/admin/costs?provider=openai'),env)).json()).summary.requests,0);
 }finally{globalThis.fetch=originalFetch;}
});

test('official pricing sync updates rates, deduplicates concurrent fetches, and retains snapshots on failure',async()=>{
 const env=environment();env.ADMIN_ACCOUNT_IDS='chatgpt:alice';const originalFetch=globalThis.fetch;let calls=0;let failure=false;
 const html='<h2>Gemini 3.8 Flash</h2><code>gemini-3.8-flash</code><h3>Standard</h3><table><tr><td>Input price</td><td>Free</td><td>$0.80</td></tr><tr><td>Output price</td><td>Free</td><td>$4.00</td></tr><tr><td>Context caching price</td><td>Free</td><td>$0.08</td></tr></table><h2>Gemini 3.1 Flash Image</h2><code>gemini-3.1-flash-image</code><h3>Standard</h3><table><tr><td>Input price</td><td>Unavailable</td><td>$0.50</td></tr><tr><td>Output price</td><td>Unavailable</td><td>$3 (text) $60 (images)</td></tr></table>';
 globalThis.fetch=async(url,opts)=>{calls++;assert.equal(opts.redirect,'manual');if(failure)return new Response('Unavailable',{status:503});return new Response(String(url).includes('ai.google.dev')?html:`<div>${String(url).split('/').at(-1)} Text tokens Input $5.00 Cached input $1.25 Image tokens Input $8.00 Cached input $2.00 Output $30.00 Text output is not billed Modalities</div>`,{headers:{'Content-Type':'text/html'}});};
 try {
  const results=await Promise.all([worker.fetch(request('/api/admin/costs'),env),worker.fetch(request('/api/admin/costs'),env)]);assert.ok(results.every(r=>r.status===200));assert.equal(calls,3);
  let saved=JSON.parse(env.sqlite.prepare("SELECT value FROM site_settings WHERE key='pricing:catalog'").get().value);assert.equal(saved.models[0].periods[0].rates.inputText,.8);assert.ok(saved.models.every(m=>!m.error));const checked=saved.models[0].checkedAt;
  saved.models.forEach(m=>m.attemptedAt=0);env.sqlite.prepare("UPDATE site_settings SET value=? WHERE key='pricing:catalog'").run(JSON.stringify(saved));failure=true;
  const response=await worker.fetch(request('/api/admin/pricing/sync',{method:'POST'}),env);assert.equal(response.status,200);assert.equal((await response.json()).ok,false);
  saved=JSON.parse(env.sqlite.prepare("SELECT value FROM site_settings WHERE key='pricing:catalog'").get().value);assert.equal(saved.models[0].periods[0].rates.inputText,.8);assert.equal(saved.models[0].checkedAt,checked);assert.ok(saved.models[0].error);
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) AS n FROM site_settings WHERE key='pricing:sync-lease'").get().n,0);
 }finally{globalThis.fetch=originalFetch;}
});

const workflowGraph = { version: 1, nodes: [{ id: 'prompt', kind: 'prompt', label: '提示词', x: 0, y: 0, config: { prompt: '产品场景' }, status: 'idle' }], edges: [] };
const createWorkflowRequest = (title = '测试工作流', graph = workflowGraph) => request('/api/workflows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, graph }) });

test('workflow documents are account scoped and saved independently from the original canvas', async () => {
  const env = environment();
  assert.equal((await worker.fetch(request('/api/workflows', {}, null), env)).status, 401);
  const created = await worker.fetch(createWorkflowRequest(), env); assert.equal(created.status, 201);
  const { id } = await created.json(); const path = `/api/workflows/${id}`;
  const read = await worker.fetch(request(path), env); assert.deepEqual((await read.json()).graph, workflowGraph);
  assert.equal((await worker.fetch(request(path, {}, 'bob'), env)).status, 404);
  assert.equal((await (await worker.fetch(request('/api/workflows', {}, 'bob'), env)).json()).rows.length, 0);
  assert.equal((await (await worker.fetch(request('/api/workflows'), env)).json()).rows.length, 1);
  assert.equal(await (await worker.fetch(request('/api/project'), env)).json(), null);
  const body = JSON.stringify({ title: '更新工作流', graph: workflowGraph });
  assert.equal((await worker.fetch(request(path, { method: 'PUT', body }), env)).status, 428);
  const saved = await worker.fetch(request(path, { method: 'PUT', body, headers: { 'Content-Type': 'application/json', 'If-Match': created.headers.get('etag') } }), env);
  assert.equal(saved.status, 200);
  assert.equal((await worker.fetch(request(path, { method: 'PUT', body, headers: { 'Content-Type': 'application/json', 'If-Match': created.headers.get('etag') } }), env)).status, 412);
  env.objects.clear(); assert.equal((await worker.fetch(request(path), env)).status, 503);
});

test('concurrent workflow saves accept exactly one revision; rejected writes cannot replace it', async () => {
  const env = environment(); const created = await worker.fetch(createWorkflowRequest(), env); const { id } = await created.json();
  const originalPut = env.BUCKET.put; let release, writes = 0; const ready = new Promise(r => { release = r; });
  env.BUCKET.put = async (...args) => { if (++writes === 2) release(); await ready; return originalPut(...args); };
  const responses = await Promise.all(['first', 'second'].map(title => worker.fetch(request(`/api/workflows/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': created.headers.get('etag') }, body: JSON.stringify({ title, graph: workflowGraph }) }), env)));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 412]);
  const winner = responses.findIndex(r => r.status === 200);
  assert.equal((await (await worker.fetch(request(`/api/workflows/${id}`), env)).json()).title, ['first', 'second'][winner]);
});

test('workflow validation, size, account, origin and count boundaries reject unsafe writes', async () => {
  const env = environment();
  const malformed = { ...workflowGraph, nodes: [{ ...workflowGraph.nodes[0], kind: 'image', config: { image: 'data:image/png;base64,YQ==' } }] };
  assert.equal((await worker.fetch(createWorkflowRequest('bad', malformed), env)).status, 400);
  assert.equal((await worker.fetch(createWorkflowRequest(''), env)).status, 400);
  assert.equal((await worker.fetch(request('/api/workflows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(2 * 1024 * 1024 + 1) }), env)).status, 400);
  assert.equal((await worker.fetch(request('/api/workflows', { method: 'POST', headers: { Origin: 'https://attacker.example' }, body: '{}' }), env)).status, 403);
  assert.equal((await worker.fetch(request('/api/workflows', { headers: { 'X-Project-Account': 'chatgpt:bob' } }), env)).status, 409);
  for (let i = 0; i < 29; i++) assert.equal((await worker.fetch(createWorkflowRequest(), env)).status, 201);
  const quotaRace = await Promise.all([worker.fetch(createWorkflowRequest(), env), worker.fetch(createWorkflowRequest(), env)]);
  assert.deepEqual(quotaRace.map(r => r.status).sort(), [201, 409]);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS count FROM workflows').get().count, 30);
});

test('model calls with a changed account are rejected before billing or upstream requests', async () => {
  const env = environment();
  for (const path of ['/api/openai-image', '/api/gemini/v1beta/models/gemini-3.1-flash-image:generateContent']) {
    assert.equal((await worker.fetch(request(path, { method: 'POST', headers: { 'X-Project-Account': 'chatgpt:bob' }, body: '{}' }), env)).status, 409);
  }
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS count FROM credit_ledger').get().count, 0);
});


test('public routes canonicalize, private pages reject indexing and unknown URLs are real 404s', async () => {
  const env = environment();
  for (const [path, target] of [['/index.html', '/'], ['/docs/', '/docs'], ['/docs/workflows/?a=1', '/docs/workflows?a=1']]) {
    const response = await worker.fetch(request(path, {}, null), env);
    assert.equal(response.status, 308); assert.equal(response.headers.get('location'), 'https://site.example' + target);
  }
  for (const path of ['/admin', '/account', '/workflow', '/workspace', '/library']) assert.match((await worker.fetch(request(path, {}, null), env)).headers.get('x-robots-tag'), /noindex/);
  assert.equal((await worker.fetch(request('/docs', {}, null), env)).headers.get('x-robots-tag'), null);
  assert.equal(await (await worker.fetch(request('/docs', { method: 'HEAD' }, null), env)).text(), '');
  for (const path of ['/does-not-exist', '/docs/does-not-exist', '/__pages/app.page']) assert.equal((await worker.fetch(request(path, {}, null), env)).status, 404);
});

test('direct self-hosting ignores forged Sites identity headers by default', async () => {
  const env = environment(); delete env.TRUST_SITES_IDENTITY;
  env.ADMIN_ACCOUNT_IDS = 'chatgpt:owner';
  assert.equal((await (await worker.fetch(request('/api/account', {}, 'owner'), env)).json()).account, null);
  assert.equal((await worker.fetch(request('/api/admin/overview', {}, 'owner'), env)).status, 401);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS count FROM accounts').get().count, 0);
});

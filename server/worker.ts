import { PUBLIC_PAGES } from '../site/content';
import { libraryRoute } from './library';
import { workflowsRoute } from './workflows';
import type { D1Database, R2Bucket, Fetcher, ExecutionContext } from '@cloudflare/workers-types';
import { authRoute, currentAccount, type Account } from './auth';
import { adminRoute } from './admin';
import { getConfig, resolveRuntimeEnv, type RateId } from './settings';
import { finishRequest, reserveRequest } from './usage';
import { getPrices, syncPrices } from './pricing';
import { calculateTokenCost, type CostRecord } from './tokenCost';

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SITE_ORIGIN?: string;
  TRUST_SITES_IDENTITY?: string;
  ADMIN_ACCOUNT_IDS?: string;
  SETTINGS_ENCRYPTION_KEY?: string;
  ADMIN_BOOTSTRAP_CONFIG?: string;
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
});
const error = (message: string, status: number) => json({ error: { message } }, status);

async function readBody(request: Request, limit: number): Promise<Uint8Array> {
  if (Number(request.headers.get('content-length')) > limit) throw new Response(null, { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Response(null, { status: 413 }); }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return body;
}

function database(env: Env): D1Database {
  if (!env.DB || !env.BUCKET) throw new Error('Storage bindings unavailable');
  return env.DB;
}

async function project(request: Request, env: Env, userId: string, prefix: string): Promise<Response> {
  const db = database(env);
  const row = await db.prepare('SELECT snapshot_key FROM projects WHERE id = ?').bind(userId).first<{ snapshot_key: string }>();
  const revision = (key?: string) => JSON.stringify(key?.split('/').at(-1) || 'empty');
  if (request.method === 'GET') {
    if (!row) { const response = json(null); response.headers.set('ETag', revision()); return response; }
    const object = await env.BUCKET.get(row.snapshot_key);
    if (!object) throw new Error('Snapshot unavailable');
    return new Response(object.body as unknown as BodyInit, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', ETag: revision(row.snapshot_key) } });
  }
  if (request.method !== 'PUT') return error('Method Not Allowed', 405);
  const expected = request.headers.get('If-Match');
  if (!expected) return error('画板保存方式已更新，请先导出本地备份，再刷新页面', 428);
  if (expected !== revision(row?.snapshot_key)) return error('云端画板已在其他页面更新，请先导出本地备份，再刷新查看最新版本', 412);
  const body = new TextDecoder().decode(await readBody(request, 2 * 1024 * 1024));
  let snapshot: any;
  try { snapshot = JSON.parse(body); } catch { return error('项目格式无效', 400); }
  if (!snapshot || !['nodes', 'runs', 'messages', 'refImages'].every(key => Array.isArray(snapshot[key])) || !Number.isFinite(snapshot.savedAt)) {
    return error('项目快照不完整', 400);
  }
  // 大文件留在 R2；D1 只保存定位信息。先写不可变快照，再更新数据库指针。
  const key = `${prefix}/projects/${crypto.randomUUID()}.json`;
  await env.BUCKET.put(key, body, { httpMetadata: { contentType: 'application/json' } });
  const saved = await db.prepare(`INSERT INTO projects (id, snapshot_key, saved_at, node_count)
    VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
    snapshot_key = excluded.snapshot_key, saved_at = excluded.saved_at, node_count = excluded.node_count
    WHERE projects.snapshot_key = ?`)
    .bind(userId, key, snapshot.savedAt, snapshot.nodes.length, row?.snapshot_key ?? null).run();
  if (saved.meta.changes !== 1) return error('云端画板已在其他页面更新，请先导出本地备份，再刷新查看最新版本', 412);
  const response = json({ savedAt: snapshot.savedAt });
  response.headers.set('ETag', revision(key));
  return response;
}

async function asset(request: Request, env: Env, hash: string, prefix: string): Promise<Response> {
  database(env);
  if (!/^[a-f0-9]{64}$/.test(hash)) return error('素材地址无效', 400);
  const key = `${prefix}/assets/${hash}`;
  if (request.method === 'GET') {
    const object = await env.BUCKET.get(key);
    if (!object) return error('素材不存在', 404);
    return new Response(object.body as unknown as BodyInit, { headers: {
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff',
    } });
  }
  if (request.method !== 'PUT') return error('Method Not Allowed', 405);
  const contentType = request.headers.get('content-type') || '';
  if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(contentType)) return error('素材类型不支持', 415);
  const body = await readBody(request, 20 * 1024 * 1024);
  const digest = await crypto.subtle.digest('SHA-256', body as BufferSource);
  const actual = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  if (actual !== hash) return error('素材校验失败', 400);
  if (!await env.BUCKET.head(key)) await env.BUCKET.put(key, body, { httpMetadata: { contentType } });
  return json({ url: `/api/assets/${hash}` });
}

async function trackedUpstream(env: Env, account: Account, provider: string, model: string, rate: RateId, send: () => Promise<Response>): Promise<Response> {
  const config = await getConfig(env);
  const catalog = await getPrices(env);
  const reservation = await reserveRequest(env, account, config, provider, model, rate);
  if (reservation instanceof Response) return reservation;
  const started = Date.now();
  let cost: CostRecord | undefined;
  let success = false; let upstreamStatus = 503;
  try {
    const upstream = await send(); upstreamStatus = upstream.status;
    const payload = new TextDecoder().decode(await readBody(new Request('https://internal/response', { method: 'POST', body: upstream.body, duplex: 'half' } as RequestInit), 80 * 1024 * 1024));
    let data: any; try { data = JSON.parse(payload); } catch { return error('创作引擎返回异常，请重试', 503); }
    cost = calculateTokenCost(provider, model, data, catalog, started);
    if (!upstream.ok) return error(upstream.status === 429 ? '创作引擎繁忙，请稍后再试' : '创作引擎暂时不可用，请稍后再试或选择其他引擎', upstream.status === 429 ? 429 : 503);
    const parts = data?.candidates?.[0]?.content?.parts;
    success = provider === 'openai' ? Boolean(data?.data?.[0]?.b64_json) : rate === 'analysis'
      ? Boolean(parts?.some((part: any) => typeof part.text === 'string' && part.text.length))
      : Boolean(parts?.some((part: any) => part.inlineData?.data));
    if (!success) return error('本次创作未返回结果，请调整描述后重试；已扣积分会退回', 422);
    return new Response(payload, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
  } catch { return error('创作连接中断，请稍后重试；已扣积分会退回', 503); }
  finally { await finishRequest(env, reservation, success, upstreamStatus, Date.now() - started, cost); }
}

async function openai(request: Request, env: Env, account: Account): Promise<Response> {
  if (request.method !== 'POST') return error('Method Not Allowed', 405);
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) return error('此创作引擎暂未开放，请选择其他引擎', 503);
  let body: any;
  try { body = JSON.parse(new TextDecoder().decode(await readBody(request, 24 * 1024 * 1024))); }
  catch (e) { if (e instanceof Response) throw e; return error('请求格式无效', 400); }
  const { model = 'gpt-image-2.5-flare', mode = 'generate', prompt, images = [], size = '1024x1024', quality = 'high' } = body || {};
  if (!['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'].includes(model) || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 32000 || !['generate', 'edit'].includes(mode)
    || !['1024x1024', '1536x1024', '1024x1536', '2048x2048', 'auto'].includes(size) || !['low', 'medium', 'high'].includes(quality)
    || !Array.isArray(images) || images.length > 16 || (mode === 'edit' && !images.length)
    || images.some((image: any) => typeof image !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(image))) return error('创作参数或参考图格式无效', 400);
  const rate: RateId = model === 'gpt-image-2.5-sunburst' ? ({ low: 'sunburstLow', medium: 'sunburstMedium', high: 'sunburstHigh' } as const)[quality as 'low' | 'medium' | 'high'] : ({ low: 'openaiLow', medium: 'openaiMedium', high: 'openaiHigh' } as const)[quality as 'low' | 'medium' | 'high'];
  return trackedUpstream(env, account, 'openai', `${model}:${quality}`, rate, async () => {
    if (mode === 'edit') {
      const form = new FormData(); form.append('model', model); form.append('prompt', prompt);
      for (const [i, image] of images.entries()) form.append('image[]', await (await fetch(image)).blob(), `ref_${i}.png`);
      form.append('size', size); form.append('quality', quality); form.append('output_format', 'png');
      return fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(175000) });
    }
    return fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size, quality, output_format: 'png', n: 1 }), signal: AbortSignal.timeout(175000) });
  });
}

async function gemini(request: Request, env: Env, url: URL, account: Account): Promise<Response> {
  if (request.method !== 'POST') return error('Method Not Allowed', 405);
  const key = env.GEMINI_API_KEY?.trim();
  if (!key) return error('此创作引擎暂未开放，请选择其他引擎', 503);
  const path = url.pathname.slice('/api/gemini/'.length);
  const match = /^v1(beta)?\/models\/(gemini-3\.1-flash-image|gemini-3\.8-flash):generateContent$/.exec(path);
  if (!match) return error('此模型或请求方式暂未开放', 400);
  const model = match[2];
  const body = await readBody(request, 24 * 1024 * 1024);
  let data: any; try { data = JSON.parse(new TextDecoder().decode(body)); } catch { return error('请求格式无效', 400); }
  if (!data?.contents || data.tools || data.cachedContent) return error('创作参数无效', 400);
  if (data.serviceTier || data.service_tier || data.generationConfig?.serviceTier) return error('当前仅支持标准处理档位', 400);
  // 仅开放固定模型与一次结果，不能用代理任意调用模型或扩大批量。
  if (data.generationConfig?.candidateCount && data.generationConfig.candidateCount !== 1) return error('单次仅支持一个结果', 400);
  const imageSize = data.generationConfig?.imageConfig?.imageSize || '1K';
  if (model === 'gemini-3.1-flash-image' && !['1K', '2K', '4K'].includes(imageSize)) return error('图片分辨率无效', 400);
  const rate: RateId = model === 'gemini-3.8-flash' ? 'analysis' : imageSize === '1K' ? 'flash' : 'pro';
  return trackedUpstream(env, account, 'gemini', model, rate, () => fetch(`https://generativelanguage.googleapis.com/${path}`, {
    method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: body as BodyInit, signal: AbortSignal.timeout(175000),
  }));
}

export default {
  async fetch(request: Request, env: Env, context?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      // 同源写入，防止外站触发项目覆盖或付费请求。
      if (!['GET', 'HEAD'].includes(request.method)) {
        const origin = request.headers.get('origin');
        if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') return error('来源不允许', 403);
      }
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) env = await resolveRuntimeEnv(env);
      const auth = await authRoute(request, env, url);
      if (auth) return auth;
      const account = url.pathname.startsWith('/api/') ? await currentAccount(request, env) : null;
      const userId = account?.id;
      if (url.pathname.startsWith('/api/') && !userId) return error('请先登录账号', 401);
      const expectedAccount = request.headers.get('X-Project-Account');
      if (url.pathname.startsWith('/api/') && expectedAccount && expectedAccount !== userId) return error('登录账号已改变，请备份内容后刷新页面', 409);
      if (url.pathname.startsWith('/api/admin/')) return await adminRoute(request, env, url, account!);
      if (account?.status === 'suspended') return error('此账号已停用，请联系网站管理员', 403);
      if (context && (url.pathname === '/api/openai-image' || url.pathname.startsWith('/api/gemini/'))) context.waitUntil(syncPrices(env).catch(() => undefined));
      if (url.pathname === '/api/health') {
        await database(env).prepare('SELECT 1').first();
        return json({ ok: true, database: 'D1', storage: 'R2' });
      }
      if (url.pathname === '/api/project' || url.pathname.startsWith('/api/assets/') || url.pathname === '/api/library' || url.pathname.startsWith('/api/library/') || url.pathname === '/api/workflows' || url.pathname.startsWith('/api/workflows/')) {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId!));
        const prefix = 'users/' + Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
        if (url.pathname === '/api/workflows' || url.pathname.startsWith('/api/workflows/')) return await workflowsRoute(request, env, url, userId!, prefix);
        if (url.pathname.startsWith('/api/library')) return await libraryRoute(request, env, url, userId!, prefix);
        if (url.pathname === '/api/project') return await project(request, env, userId!, prefix);
        return await asset(request, env, url.pathname.slice('/api/assets/'.length), prefix);
      }
      if (url.pathname === '/api/openai-image') return await openai(request, env, account!);
      if (url.pathname.startsWith('/api/gemini/')) return await gemini(request, env, url, account!);
      if (url.pathname.startsWith('/api/')) return error('接口不存在', 404);
      const pathname = url.pathname.replace(/\/$/, '') || '/';
      const isPublic = Object.hasOwn(PUBLIC_PAGES, pathname);
      const isPrivate = ['/account', '/admin', '/workspace', '/workflow', '/library'].includes(pathname);
      if (!['GET', 'HEAD'].includes(request.method)) return error('Method Not Allowed', 405);
      const canonicalPath = isPublic && pathname !== '/' ? pathname + '/' : pathname;
      if (url.pathname === '/index.html' || ((isPublic || isPrivate) && canonicalPath !== url.pathname)) {
        const target = new URL(url); target.pathname = url.pathname === '/index.html' ? '/' : canonicalPath;
        return new Response(null, { status: 308, headers: { Location: target.href } });
      }
      if (isPublic || isPrivate) {
        // Use non-HTML asset names to avoid the asset server's clean-URL redirects.
        const file = isPrivate ? 'app' : pathname === '/' ? 'home' : pathname.slice(1).replaceAll('/', '-');
        const page = await env.ASSETS.fetch(new Request(new URL(`/__pages/${file}.page`, url), { method: request.method }) as any) as unknown as Response;
        if (!page.ok) throw new Error('Built page unavailable');
        const headers = new Headers(page.headers);
        headers.set('Content-Type', 'text/html; charset=utf-8');
        headers.set('Cache-Control', 'no-store');
        if (isPrivate) headers.set('X-Robots-Tag', 'noindex, nofollow');
        return new Response(request.method === 'HEAD' ? null : page.body, { status: 200, headers });
      }
      const markdown = pathname === '/index.md' || (pathname.endsWith('.md') && Object.hasOwn(PUBLIC_PAGES, pathname.slice(0, -3)));
      if (markdown || ['/robots.txt', '/sitemap.xml', '/llms.txt'].includes(pathname) || /^\/(assets|brand|images|models)\//.test(pathname)) {
        const asset = await env.ASSETS.fetch(request as any) as unknown as Response;
        if (markdown && asset.ok) { const headers = new Headers(asset.headers); headers.set('Content-Type', 'text/markdown; charset=utf-8'); return new Response(asset.body, { status: asset.status, headers }); }
        return asset;
      }
      return new Response(request.method === 'HEAD' ? null : '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>页面不存在｜CraftCanvas</title><main><h1>页面不存在</h1><p>这个地址没有对应的内容。</p><a href="/">返回 CraftCanvas 首页</a></main></html>', { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow' } });
    } catch (e) {
      if (e instanceof Response && e.status === 413) return error('内容过大，请减少图片或项目大小', 413);
      console.error('CraftCanvas request failed', url.pathname, e instanceof Error ? e.name : 'Error');
      return error('云端服务暂时不可用，请稍后重试；本地内容已保留', 503);
    }
  },
};

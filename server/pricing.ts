import type { Env } from './worker';

export type TokenRates = { inputText: number; inputImage: number; cachedText: number | null; cachedImage: number | null; outputText: number; outputImage: number };
export type ModelPrice = { model: string; source: string; checkedAt: number; attemptedAt: number; error: string | null; periods: { from: number; rates: TokenRates }[] };
export type PriceCatalog = { models: ModelPrice[] };
export const PRICING_INTERVAL = 6 * 60 * 60 * 1000;
const verified = Date.UTC(2026, 9, 6);
const geminiSource = 'https://ai.google.dev/gemini-api/docs/pricing';
const rates = (input: number, output: number, cached: number | null, image = output): TokenRates => ({ inputText: input, inputImage: input, cachedText: cached, cachedImage: cached, outputText: output, outputImage: image });
export const INITIAL_PRICES: PriceCatalog = { models: [
  { model: 'gemini-3.8-flash', source: geminiSource, checkedAt: verified, attemptedAt: verified, error: null, periods: [{ from: 0, rates: rates(.75, 3.75, .075) }, { from: Date.UTC(2027, 0, 1), rates: rates(1.5, 7.5, .15) }] },
  { model: 'gemini-3.1-flash-image', source: geminiSource, checkedAt: verified, attemptedAt: verified, error: null, periods: [{ from: 0, rates: rates(.5, 3, null, 60) }] },
  ...['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'].map(model => ({ model, source: `https://developers.openai.com/api/docs/models/${model}`, checkedAt: verified, attemptedAt: verified, error: null, periods: [{ from: 0, rates: { inputText: 5, inputImage: 8, cachedText: 1.25, cachedImage: 2, outputText: 0, outputImage: 30 } }] })),
] };
const text = (html: string) => html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&#36;|&dollar;/g, '$').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim();
const amounts = (s: string) => [...s.matchAll(/\$\s*(\d+(?:\.\d+)?)/g)].map(m => Number(m[1]));
const validRate = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1000;

// Only parse the exact model's Standard section; partial/changed layouts never replace a good price.
export function parseOfficialPrice(html: string, model: string): ModelPrice['periods'] {
  if (model.startsWith('gemini-')) {
    const sections = html.split(/(?=<h2\b)/i);
    const section = sections.find(s => new RegExp(`<code[^>]*>\\s*${model.replaceAll('.', '\\.')}\\s*</code>`).test(s));
    const table = section?.match(/<h3[^>]*>\s*Standard\s*<\/h3>[\s\S]*?<table\b[^>]*>([\s\S]*?)<\/table>/i)?.[1];
    if (!table) throw new Error('官方价格页面结构变化');
    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => [...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c => text(c[1])));
    const row = (label: string) => rows.find(c => c[0]?.startsWith(label))?.[2] || '';
    const input = amounts(row('Input price')); const output = amounts(row('Output price'));
    if (model === 'gemini-3.1-flash-image') {
      if (input.length !== 1 || !row('Output price').includes('(images)') || output.length < 2) throw new Error('官方价格缺少图片单价');
      if ([input[0], output[0], output[1]].some(n => !validRate(n) || n === 0)) throw new Error('官方单价格式无效');
      return [{ from: 0, rates: rates(input[0], output[0], null, output[1]) }];
    }
    const cached = amounts(row('Context caching price'));
    if (!input.length || !output.length || !cached.length) throw new Error('官方价格不完整');
    const future = row('Input price').match(/\$(\d+(?:\.\d+)?) starting ([A-Za-z]+ \d{1,2}, \d{4})/);
    const periods = [{ from: 0, rates: rates(input[0], output[0], cached[0]) }];
    if (future) {
      const date = future[2]; const from = Date.parse(`${date} 00:00:00 GMT`);
      const next = (label: string) => Number(row(label).match(new RegExp(`\\$(\\d+(?:\\.\\d+)?) starting ${date.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))?.[1]);
      if (!Number.isFinite(from) || !validRate(next('Output price')) || !validRate(next('Context caching price'))) throw new Error('官方调价日期不完整');
      periods.push({ from, rates: rates(Number(future[1]), next('Output price'), next('Context caching price')) });
    } else if (input.length !== 1 || output.length !== 1) throw new Error('无法识别官方调价规则');
    if (periods.some(p => Object.values(p.rates).some(n => n !== null && !validRate(n)))) throw new Error('官方单价格式无效');
    return periods;
  }
  if (!text(html).includes(model)) throw new Error('官方模型页面不匹配');
  const t = text(html); const priceBlock = t.slice(t.indexOf('Text tokens'), t.indexOf('Modalities', t.indexOf('Text tokens')));
  const match = priceBlock.match(/Text tokens.*?Input \$(\d+(?:\.\d+)?) Cached input \$(\d+(?:\.\d+)?).*?Image tokens.*?Input \$(\d+(?:\.\d+)?) Cached input \$(\d+(?:\.\d+)?) Output \$(\d+(?:\.\d+)?)/);
  if (!match || !priceBlock.includes('Text output is not billed')) throw new Error('官方价格页面结构变化');
  const values = match.slice(1).map(Number); if (values.some(n => !validRate(n) || n === 0)) throw new Error('官方单价格式无效');
  return [{ from: 0, rates: { inputText: values[0], cachedText: values[1], inputImage: values[2], cachedImage: values[3], outputText: 0, outputImage: values[4] } }];
}

export async function getPrices(env: Env): Promise<PriceCatalog> {
  const row = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'pricing:catalog'").first<{ value: string }>();
  return row ? JSON.parse(row.value) : structuredClone(INITIAL_PRICES);
}
async function officialPage(url: string) {
  const r = await fetch(url, { headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(8000), redirect: 'manual' });
  if (!r.ok) throw new Error(`Official pricing HTTP ${r.status}`);
  if (!r.headers.get('content-type')?.includes('text/html')) throw new Error('Official pricing content type');
  const reader = r.body!.getReader(); let size = 0; let html = ''; const decoder = new TextDecoder();
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2_000_000) { await reader.cancel(); throw new Error('官方价格页面超出读取限制'); } html += decoder.decode(value, { stream: true }); }
  return html + decoder.decode();
}
export async function syncPrices(env: Env, force = false): Promise<PriceCatalog> {
  const old = await env.DB.prepare("SELECT value, updated_at FROM site_settings WHERE key = 'pricing:catalog'").first<{ value: string; updated_at: number }>();
  const catalog: PriceCatalog = old ? JSON.parse(old.value) : structuredClone(INITIAL_PRICES); const now = Date.now();
  // Failed attempts retry in six hours too. Manual sync has a one minute cooldown.
  if (catalog.models.every(m => now - m.attemptedAt < (force ? 60_000 : PRICING_INTERVAL))) return catalog;
  const lease = crypto.randomUUID();
  const acquired = await env.DB.prepare(`INSERT INTO site_settings (key, value, updated_at) VALUES ('pricing:sync-lease', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE site_settings.updated_at < ?`).bind(lease, now + 30_000, now).run();
  if (!acquired.meta.changes) return catalog;
  try {
  const pages = new Map<string, Promise<string>>();
  await Promise.all(catalog.models.map(async m => {
    if (now - m.attemptedAt < (force ? 60_000 : PRICING_INTERVAL)) return;
    if (!pages.has(m.source)) pages.set(m.source, officialPage(m.source));
    m.attemptedAt = now;
    try { m.periods = parseOfficialPrice(await pages.get(m.source)!, m.model); m.checkedAt = now; m.error = null; }
    catch (e) { console.warn('Pricing sync failed', m.model, e instanceof Error ? e.message : 'Unknown'); m.error = '官网暂不可读取或格式已变化，继续使用上次验证价格'; }
  }));
  const result = await env.DB.prepare(`INSERT INTO site_settings (key, value, updated_at) SELECT 'pricing:catalog', ?, ? WHERE COALESCE((SELECT updated_at FROM site_settings WHERE key = 'pricing:catalog'), 0) = ?
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE site_settings.updated_at = ?`)
    .bind(JSON.stringify(catalog), now, old?.updated_at || 0, old?.updated_at || 0).run();
  return result.meta.changes ? catalog : getPrices(env);
  } finally { await env.DB.prepare("DELETE FROM site_settings WHERE key = 'pricing:sync-lease' AND value = ?").bind(lease).run(); }
}
export function priceAt(catalog: PriceCatalog, model: string, at: number) {
  const found = catalog.models.find(p => p.model === model.split(':')[0]); if (!found) return null;
  const period = [...found.periods].reverse().find(p => p.from <= at); if (!period) return null;
  return { model: found.model, rates: period.rates, effectiveFrom: period.from, source: found.source, checkedAt: found.checkedAt, stale: Boolean(found.error) || at - found.checkedAt > PRICING_INTERVAL, processing: 'standard', currency: 'USD' };
}

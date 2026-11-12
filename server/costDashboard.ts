import type { Env } from './worker';
import { beijingDay } from './settings';
import { priceAt, syncPrices } from './pricing';

export async function costDashboard(env: Env, url: URL) {
  const days = Number(url.searchParams.get('days') || 30); const provider = url.searchParams.get('provider') || '';
  if (![1, 7, 30, 90].includes(days) || !['', 'gemini', 'openai'].includes(provider)) return null;
  const start = Date.parse(`${beijingDay()}T00:00:00+08:00`) - (days - 1) * 86400000;
  const where = "created_at >= ? AND (? = '' OR provider = ?)";
  const sums = `COUNT(*) AS requests, SUM(cost_status = 'priced') AS priced, SUM(status = 'pending') AS pending,
    SUM(cost_status != 'priced' AND status != 'pending') AS unpriced,
    COALESCE(SUM(input_tokens), 0) AS inputTokens, COALESCE(SUM(output_tokens), 0) AS outputTokens,
    COALESCE(SUM(cached_tokens), 0) AS cachedTokens, COALESCE(SUM(reasoning_tokens), 0) AS reasoningTokens,
    COALESCE(SUM(total_tokens), 0) AS totalTokens, COALESCE(SUM(cost_usd_micros), 0) AS costMicros,
    COALESCE(SUM(CASE WHEN status = 'failed' THEN cost_usd_micros END), 0) AS failedCostMicros`;
  const [summary, models, customers, trend, catalog] = await Promise.all([
    env.DB.prepare(`SELECT ${sums} FROM ai_requests WHERE ${where}`).bind(start, provider, provider).first(),
    env.DB.prepare(`SELECT model, provider, ${sums} FROM ai_requests WHERE ${where} GROUP BY model, provider ORDER BY costMicros DESC`).bind(start, provider, provider).all(),
    env.DB.prepare(`SELECT r.user_id, a.email, a.username, a.display_name, COUNT(*) AS requests, SUM(r.cost_status = 'priced') AS priced,
      COALESCE(SUM(r.total_tokens), 0) AS totalTokens, COALESCE(SUM(r.cost_usd_micros), 0) AS costMicros
      FROM ai_requests r LEFT JOIN accounts a ON a.id = r.user_id WHERE r.${where.replaceAll('provider', 'r.provider')}
      GROUP BY r.user_id ORDER BY costMicros DESC, requests DESC LIMIT 25`).bind(start, provider, provider).all(),
    env.DB.prepare(`SELECT day, ${sums} FROM ai_requests WHERE ${where} GROUP BY day ORDER BY day`).bind(start, provider, provider).all(),
    syncPrices(env),
  ]);
  return { summary, models: models.results, customers: customers.results, trend: trend.results, days, provider, updatedAt: Date.now(),
    prices: catalog.models.map(m => ({ ...m, current: priceAt(catalog, m.model, Date.now()) })), currency: 'USD', basis: 'standard_paid_list_price' };
}

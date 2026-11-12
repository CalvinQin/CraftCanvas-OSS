import type { Env } from './worker';
import type { Account } from './auth';
import { beijingDay, dailyLimit, type RateId, type SiteConfig } from './settings';
import type { CostRecord } from './tokenCost';

export async function reserveRequest(env: Env, account: Account, config: SiteConfig, provider: string, model: string, rateId: RateId): Promise<string | Response> {
  const reject = (message: string, status: number) => new Response(JSON.stringify({ error: { message } }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (!config.serviceEnabled) return reject('创作服务维护中，请稍后再试', 503);
  const id = crypto.randomUUID(); const day = beijingDay(); const now = Date.now();
  const charge = config.creditBillingEnabled ? Math.ceil(config.rates[rateId].credits * config.markup) : 0;
  // D1 batch 是事务：计数、余额扣除、积分流水同时成功；客户端不能指定价格。
  const result = await env.DB.batch([
    env.DB.prepare(`INSERT INTO ai_requests (id, user_id, day, provider, model, status, created_at, estimated_cost_cents, charged_credits)
      SELECT ?, ?, ?, ?, ?, 'pending', ?, ?, ? WHERE
      (SELECT COUNT(*) FROM ai_requests WHERE day = ? AND user_id = ?) < ? AND
      (SELECT COUNT(*) FROM ai_requests WHERE day = ?) < ? AND
      EXISTS (SELECT 1 FROM accounts WHERE id = ? AND status = 'active' AND credits >= ?)`)
      .bind(id, account.id, day, provider, model, now, config.rates[rateId].costCents, charge,
        day, account.id, dailyLimit(config, account), day, config.siteDailyLimit, account.id, charge),
    env.DB.prepare('UPDATE accounts SET credits = credits - ? WHERE id = ? AND EXISTS (SELECT 1 FROM ai_requests WHERE id = ?)').bind(charge, account.id, id),
    env.DB.prepare(`INSERT INTO credit_ledger (id, user_id, amount, reason, created_at)
      SELECT ?, ?, ?, ?, ? WHERE ? > 0 AND EXISTS (SELECT 1 FROM ai_requests WHERE id = ?)`).bind(`debit:${id}`, account.id, -charge, `创作请求 · ${model}`, now, charge, id),
  ]);
  if (result[0].meta.changes !== 1) {
    const fresh = await env.DB.prepare('SELECT credits FROM accounts WHERE id = ?').bind(account.id).first<{ credits: number }>();
    if ((fresh?.credits ?? 0) < charge) return reject('创作积分不足，请到会员中心查看余额', 402);
    return reject('今日创作额度已用完，或全站今日额度已满，请明天再试', 429);
  }
  return id;
}
export async function finishRequest(env: Env, id: string, success: boolean, status: number, duration: number, cost?: CostRecord) {
  const usage = cost?.usage;
  const finish = env.DB.prepare(`UPDATE ai_requests SET status = ?, http_status = ?, duration_ms = ?, input_tokens = ?, output_tokens = ?, cached_tokens = ?, reasoning_tokens = ?, total_tokens = ?, cost_usd_micros = ?, cost_status = ?, usage_snapshot = ?, price_snapshot = ?, provider_response_id = ? WHERE id = ? AND status = 'pending'`)
    .bind(success ? 'succeeded' : 'failed', status, duration, usage?.input ?? null, usage?.output ?? null, usage?.cached ?? null, usage?.reasoning ?? null, usage?.total ?? null, cost?.costMicros ?? null, cost?.costStatus || 'missing_usage', usage ? JSON.stringify(usage) : null, cost?.price ? JSON.stringify(cost.price) : null, cost?.responseId ?? null, id);
  if (success) {
    await finish.run();
    return;
  }
  // 流水 ID 唯一且状态转移在同一事务中，重复失败回调只退一次。
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO credit_ledger (id, user_id, amount, reason, created_at)
      SELECT 'refund:' || id, user_id, charged_credits, '创作失败 · 积分退回', ? FROM ai_requests WHERE id = ? AND status = 'pending' AND charged_credits > 0`).bind(Date.now(), id),
    env.DB.prepare(`UPDATE accounts SET credits = credits + (SELECT charged_credits FROM ai_requests WHERE id = ?)
      WHERE id = (SELECT user_id FROM ai_requests WHERE id = ? AND status = 'pending')`).bind(id, id),
    finish,
  ]);
}

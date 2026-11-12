import type { Env } from './worker';
import type { Account } from './auth';

export type RateId = 'analysis' | 'flash' | 'pro' | 'openaiLow' | 'openaiMedium' | 'openaiHigh' | 'sunburstLow' | 'sunburstMedium' | 'sunburstHigh';
export interface SiteConfig {
  serviceEnabled: boolean; signupEnabled: boolean; creditBillingEnabled: boolean;
  freeDailyLimit: number; proDailyLimit: number; studioDailyLimit: number; siteDailyLimit: number;
  markup: number; supportText: string;
  rates: Record<RateId, { credits: number; costCents: number }>;
}
export const DEFAULT_CONFIG: SiteConfig = {
  serviceEnabled: true, signupEnabled: true, creditBillingEnabled: false,
  freeDailyLimit: 20, proDailyLimit: 100, studioDailyLimit: 300, siteDailyLimit: 100,
  markup: 1, supportText: '如需帮助，请联系网站管理员。',
  rates: { analysis: { credits: 1, costCents: 0 }, flash: { credits: 5, costCents: 0 }, pro: { credits: 10, costCents: 0 },
    openaiLow: { credits: 2, costCents: 0 }, openaiMedium: { credits: 5, costCents: 0 }, openaiHigh: { credits: 15, costCents: 0 }, sunburstLow: { credits: 3, costCents: 0 }, sunburstMedium: { credits: 8, costCents: 0 }, sunburstHigh: { credits: 20, costCents: 0 } },
};
export function validateConfig(value: any): SiteConfig | null {
  if (!value || ['serviceEnabled', 'signupEnabled', 'creditBillingEnabled'].some(key => typeof value[key] !== 'boolean')) return null;
  if (['freeDailyLimit', 'proDailyLimit', 'studioDailyLimit', 'siteDailyLimit'].some(key => !Number.isInteger(value[key]) || value[key] < 0 || value[key] > 100000)) return null;
  if (!Number.isFinite(value.markup) || value.markup < 0.1 || value.markup > 100 || typeof value.supportText !== 'string' || value.supportText.length > 300) return null;
  const rates = {} as SiteConfig['rates'];
  for (const key of Object.keys(DEFAULT_CONFIG.rates) as RateId[]) {
    const rate = value.rates?.[key];
    if (!rate || !Number.isInteger(rate.credits) || rate.credits < 1 || rate.credits > 10000 || !Number.isInteger(rate.costCents) || rate.costCents < 0 || rate.costCents > 100000) return null;
    rates[key] = { credits: rate.credits, costCents: rate.costCents };
  }
  return { serviceEnabled: value.serviceEnabled, signupEnabled: value.signupEnabled, creditBillingEnabled: value.creditBillingEnabled,
    freeDailyLimit: value.freeDailyLimit, proDailyLimit: value.proDailyLimit, studioDailyLimit: value.studioDailyLimit,
    siteDailyLimit: value.siteDailyLimit, markup: Math.round(value.markup * 100) / 100, supportText: value.supportText.trim(), rates };
}
export async function getConfig(env: Env): Promise<SiteConfig> {
  const row = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'config'").first<{ value: string }>();
  if (!row) return structuredClone(DEFAULT_CONFIG);
  const raw = JSON.parse(row.value);
  // 新档位默认值合并，保留旧设置、倍率和历史费用；无须重写现有配置。
  const config = validateConfig({ ...raw, rates: { ...structuredClone(DEFAULT_CONFIG.rates), ...raw.rates } });
  if (!config) throw new Error('Invalid site configuration');
  return config;
}
export const isAdmin = (env: Env, id: string) => (env.ADMIN_ACCOUNT_IDS || '').split(',').map(v => v.trim()).filter(Boolean).includes(id);
export const dailyLimit = (config: SiteConfig, account: Account) => account.daily_limit ?? (account.plan === 'studio' ? config.studioDailyLimit : account.plan === 'pro' ? config.proDailyLimit : config.freeDailyLimit);
export const beijingDay = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
export const SECRET_NAMES = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const;
export type SecretName = typeof SECRET_NAMES[number];
const bytesToBase64 = (bytes: Uint8Array) => btoa(Array.from(bytes, v => String.fromCharCode(v)).join(''));
const base64ToBytes = (value: string) => Uint8Array.from(atob(value), v => v.charCodeAt(0));
async function encryptionKey(env: Env) {
  if (!env.SETTINGS_ENCRYPTION_KEY || env.SETTINGS_ENCRYPTION_KEY.length < 32) throw new Error('Settings encryption unavailable');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.SETTINGS_ENCRYPTION_KEY));
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptSecret(env: Env, value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(env), new TextEncoder().encode(value));
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(cipher))}`;
}
export async function resolveRuntimeEnv(env: Env): Promise<Env> {
  const rows = await env.DB.prepare("SELECT key, value FROM site_settings WHERE key LIKE 'secret:%'").all<{ key: string; value: string }>();
  if (!rows.results.length) return env;
  const runtime = { ...env };
  const key = await encryptionKey(env);
  for (const row of rows.results) {
    const name = row.key.slice(7) as SecretName;
    if (!SECRET_NAMES.includes(name)) continue;
    const [iv, cipher] = row.value.split('.');
    runtime[name] = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) as BufferSource }, key, base64ToBytes(cipher) as BufferSource));
  }
  return runtime;
}

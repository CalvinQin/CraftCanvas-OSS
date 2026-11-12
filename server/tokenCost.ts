import { priceAt, type PriceCatalog } from './pricing';

export type TokenUsage = { input: number; output: number; cached: number; reasoning: number; total: number; inputText: number | null; inputImage: number | null; cachedText: number | null; cachedImage: number | null; outputText: number | null; outputImage: number | null };
export type CostRecord = { usage: TokenUsage | null; costMicros: number | null; costStatus: 'missing_usage' | 'incomplete_usage' | 'unpriced' | 'priced'; price: ReturnType<typeof priceAt>; responseId: string | null };
const number = (v: unknown): number | null => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 100_000_000 ? v as number : null;
const optional = (v: unknown) => v === undefined ? 0 : number(v);
const modality = (items: any, name: string) => Array.isArray(items) ? items.filter(i => i.modality === name).reduce((sum, i) => sum + (number(i.tokenCount) ?? NaN), 0) : null;

export function calculateTokenCost(provider: string, model: string, data: any, catalog: PriceCatalog, at: number): CostRecord {
  const price = priceAt(catalog, model, at);
  const responseId = typeof data?.responseId === 'string' && /^[a-zA-Z0-9_:-]{1,160}$/.test(data.responseId) ? data.responseId : null;
  const result: CostRecord = { usage: null, costMicros: null, costStatus: 'missing_usage', price, responseId };
  const raw = provider === 'gemini' ? data?.usageMetadata : data?.usage; if (!raw) return result;
  result.costStatus = 'incomplete_usage';
  let usage: TokenUsage;
  if (provider === 'gemini') {
    const input = number(raw.promptTokenCount); const candidates = optional(raw.candidatesTokenCount); const reasoning = optional(raw.thoughtsTokenCount); const cached = optional(raw.cachedContentTokenCount);
    if (input === null || candidates === null || reasoning === null || cached === null || cached > input) return result;
    const parts = data?.candidates?.flatMap((c: any) => c.content?.parts || []) || [];
    if (parts.some((p: any) => !p.thought && (p.text || p.inlineData)) && raw.candidatesTokenCount === undefined) return result;
    let imageOutput = modality(raw.candidatesTokensDetails, 'IMAGE');
    // The total is reported by Google; response modality only classifies it, never invents token counts.
    if (imageOutput === null) imageOutput = !parts.some((p: any) => p.inlineData) ? 0 : parts.every((p: any) => p.inlineData || p.thought) ? candidates : null;
    if (imageOutput !== null && (!Number.isFinite(imageOutput) || imageOutput > candidates)) imageOutput = null;
    const output = candidates + reasoning;
    usage = { input, output, cached, reasoning, total: number(raw.totalTokenCount) ?? input + output, inputText: modality(raw.promptTokensDetails, 'TEXT'), inputImage: modality(raw.promptTokensDetails, 'IMAGE'), cachedText: modality(raw.cacheTokensDetails, 'TEXT'), cachedImage: modality(raw.cacheTokensDetails, 'IMAGE'), outputImage: imageOutput, outputText: imageOutput === null ? null : candidates - imageOutput + reasoning };
    // All supported Gemini input modalities share the same rate; cache is separately billed.
    if (cached === 0) { usage.cachedText = 0; usage.cachedImage = 0; }
  } else {
    const input = number(raw.input_tokens); const output = number(raw.output_tokens); const cached = optional(raw.input_tokens_details?.cached_tokens ?? raw.input_tokens_details?.cached_tokens_details?.total_tokens);
    if (input === null || output === null || cached === null || cached > input) return result;
    const details = raw.input_tokens_details; const cachedDetails = details?.cached_tokens_details;
    const cachedText = number(cachedDetails?.text_tokens); const cachedImage = number(cachedDetails?.image_tokens);
    const cachedSum = cachedText !== null && cachedImage !== null ? cachedText + cachedImage : cached;
    const outputImage = raw.output_tokens_details ? number(raw.output_tokens_details.image_tokens) : output;
    usage = { input, output, cached: cachedSum, reasoning: 0, total: number(raw.total_tokens) ?? input + output, inputText: number(details?.text_tokens), inputImage: number(details?.image_tokens), cachedText: cachedSum ? cachedText : 0, cachedImage: cachedSum ? cachedImage : 0, outputImage, outputText: raw.output_tokens_details ? number(raw.output_tokens_details.text_tokens) : 0 };
  }
  result.usage = usage;
  if (provider === 'gemini' && raw.serviceTier && !['STANDARD', 'SERVICE_TIER_UNSPECIFIED'].includes(String(raw.serviceTier).toUpperCase())) { result.costStatus = 'unpriced'; return result; }
  if (!price) { result.costStatus = 'unpriced'; return result; }
  const { rates } = price;
  if ([usage.outputText, usage.outputImage, ...(provider === 'openai' ? [usage.inputText, usage.inputImage, usage.cachedText, usage.cachedImage] : [])].some(v => v === null || !Number.isFinite(v))
    || usage.cached > usage.input || usage.total !== usage.input + usage.output
    || (provider === 'openai' && (usage.inputText! + usage.inputImage! !== usage.input || usage.cachedText! + usage.cachedImage! !== usage.cached || usage.cachedText! > usage.inputText! || usage.cachedImage! > usage.inputImage!))
    || usage.outputText! + usage.outputImage! !== usage.output
    || (usage.cached > 0 && (rates.cachedText === null || rates.cachedImage === null))) { result.costStatus = 'incomplete_usage'; return result; }
  const inputCost = provider === 'gemini' ? (usage.input - usage.cached) * rates.inputText + usage.cached * (rates.cachedText || 0)
    : (usage.inputText! - usage.cachedText!) * rates.inputText + (usage.inputImage! - usage.cachedImage!) * rates.inputImage + usage.cachedText! * (rates.cachedText || 0) + usage.cachedImage! * (rates.cachedImage || 0);
  // USD per million tokens multiplied by tokens gives USD millionths, not cents.
  result.costMicros = Math.round(inputCost + usage.outputText! * rates.outputText + usage.outputImage! * rates.outputImage);
  result.costStatus = 'priced'; return result;
}

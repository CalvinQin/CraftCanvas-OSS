// 客户端仅保存服务可用状态与公开计价；模型密钥由管理员在云端配置。
let supportText = '如需帮助，请联系网站管理员。';
export const getSupportText = () => supportText;
let cloudKeys = { gemini: false, openai: false };
let pricing: { enabled: boolean; markup: number; rates: Record<string, { credits: number }> } = { enabled: false, markup: 1, rates: {} };
export const setCloudKeys = (value: { gemini?: boolean; openai?: boolean }) => {
  cloudKeys = { gemini: Boolean(value?.gemini), openai: Boolean(value?.openai) };
};
export const setSessionPricing = (session: any) => { supportText = session.supportText || supportText; pricing = { enabled: Boolean(session.creditBillingEnabled), markup: session.markup || 1, rates: session.rates || {} }; };
export const hasCloudGeminiKey = () => cloudKeys.gemini;
export const hasCloudOpenAIKey = () => cloudKeys.openai;
export const creationPrice = (engine: string, quality: string) => {
  const rate = engine === 'gemini-flash' ? 'flash' : engine === 'gemini-pro' ? 'pro' : quality === 'low' ? 'openaiLow' : quality === 'medium' ? 'openaiMedium' : 'openaiHigh';
  const selected = engine === 'gpt-image-sunburst' ? quality === 'low' ? 'sunburstLow' : quality === 'medium' ? 'sunburstMedium' : 'sunburstHigh' : rate;
  return pricing.enabled ? Math.ceil((pricing.rates[selected]?.credits || 0) * pricing.markup) : 0;
};

import { GenError } from "./errors";
import { hasCloudGeminiKey } from "./keys";

// 分析与生图独立升级；1K / 2K / 4K 生图均使用 3.1。
const IMAGE_MODELS = { flash: 'gemini-3.1-flash-image', pro: 'gemini-3.1-flash-image' } as const;
const ANALYSIS_MODEL = 'gemini-3.8-flash';

export type GeminiModelTier = keyof typeof IMAGE_MODELS;

// 仅在云端开放服务时可用。
export const hasGeminiKey = (): boolean => hasCloudGeminiKey();

// 同源代理前缀：SDK 会拼成 {baseUrl}/v1beta/models/{model}:generateContent，
// 交给服务端（Sites Worker / Vite 中间件）转发到 generativelanguage.googleapis.com，
// 浏览器不直连 Google（绕 GFW 封锁 + Google 对中国 IP 的地域拒绝 400）。
const geminiProxyBase = (): string =>
  (typeof window !== 'undefined' ? window.location.origin : '') + '/api/gemini';

const getAI = async (expectedAccount?: string) => {
  const { GoogleGenAI } = await import("@google/genai");
  const apiKey = 'proxy-managed';
  return new GoogleGenAI({ apiKey, httpOptions: { baseUrl: geminiProxyBase(), ...(expectedAccount ? { headers: { 'X-Project-Account': expectedAccount } } : {}) } });
};

const toInlineData = (dataUrl: string) => {
  const [head, data] = dataUrl.split(',');
  const mimeType = head.split(':')[1].split(';')[0];
  return { inlineData: { data, mimeType } };
};

const mapGeminiError = (error: unknown): GenError => {
  if (error instanceof GenError) return error;
  const msg = String((error as any)?.message ?? error);
  if (/API key not valid|API_KEY_INVALID|PERMISSION_DENIED|\b401\b|\b403\b/i.test(msg)) {
    return new GenError('API_KEY', '创作服务暂时不可用，请重新登录或联系管理员。');
  }
  if (/RESOURCE_EXHAUSTED|\b429\b|quota/i.test(msg)) {
    return new GenError('QUOTA', msg);
  }
  if (/Requested entity was not found|NOT_FOUND/i.test(msg)) {
    return new GenError('MODEL', `模型不存在或已下线（${msg}）`);
  }
  return new GenError('UNKNOWN', msg);
};

export interface GeminiImageOptions {
  expectedAccount?: string;
  aspectRatio?: '1:1' | '3:2' | '2:3' | '4:3' | '3:4' | '16:9' | '9:16' | '21:9';
  imageSize?: '1K' | '2K' | '4K';
}

/**
 * 用 Gemini 图像模型生成/编辑一张图。
 * @param referenceImages 参考图 dataURL 列表
 * @param prompt 完整提示词
 * @param tier flash = 1K 快速档，pro = 2K 高质量档
 * @param baseImage 追问重绘时的当前图（作为最后一张输入图）
 * @param opts 覆盖默认比例/分辨率（扩图、高清放大用）
 */
export async function geminiGenerateImage(
  referenceImages: string[],
  prompt: string,
  tier: GeminiModelTier,
  baseImage?: string,
  opts?: GeminiImageOptions,
): Promise<string> {
  const ai = await getAI(opts?.expectedAccount);
  const parts: any[] = referenceImages.map(toInlineData);
  if (baseImage) parts.push(toInlineData(baseImage));
  parts.push({ text: prompt });

  try {
    const response = await ai.models.generateContent({
      model: IMAGE_MODELS[tier],
      contents: { parts },
      config: {
        imageConfig: {
          aspectRatio: opts?.aspectRatio ?? '1:1',
          imageSize: opts?.imageSize ?? (tier === 'pro' ? '2K' : '1K'),
        },
      },
    });

    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts) {
      const reason = (candidate as any)?.finishReason ?? '';
      if (/SAFETY|PROHIBITED/i.test(String(reason))) {
        throw new GenError('SAFETY', `生成被安全策略拦截（${reason}）`);
      }
      throw new GenError('EMPTY', '模型响应被拦截或为空');
    }
    for (const part of candidate.content.parts) {
      if (part.inlineData?.data) {
        return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
      }
    }
    throw new GenError('EMPTY', '未返回图像数据');
  } catch (error) {
    throw mapGeminiError(error);
  }
}

export interface IdentifiedElement {
  element: string;      // 元素英文描述（供编辑提示词使用）
  text: string | null;  // 若是文字元素，返回原文
}

/**
 * Touch Edit 前置：识别图片指定坐标处的元素（是什么 / 是否文字及原文）。
 * 无 Key 或失败返回 null，调用方降级为“未识别元素”通用面板。
 */
export async function identifyElementAt(
  imageDataUrl: string,
  xPct: number,
  yPct: number,
  focus: 'element' | 'text',
): Promise<IdentifiedElement | null> {
  if (!hasGeminiKey()) return null;
  try {
    const ai = await getAI();
    const focusHint = focus === 'text'
      ? 'The user clicked on TEXT — identify the text element and transcribe its EXACT string.'
      : 'Identify the single visual element at that point (a part, an object, a text block, or the background).';
    const response = await ai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: {
        parts: [
          toInlineData(imageDataUrl),
          { text: `Look at the location approximately ${Math.round(xPct)}% from the left and ${Math.round(yPct)}% from the top of this image. ${focusHint}
Respond with STRICT JSON only, no markdown:
{"element": "<short English description, e.g. 'red SALE headline text' or 'metal power button' or 'white background'>", "text": "<exact text string if the element is text, otherwise null>"}` },
        ],
      },
    });
    const raw = response.text ?? '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (typeof parsed.element !== 'string' || parsed.element.length === 0) return null;
    return { element: parsed.element, text: typeof parsed.text === 'string' && parsed.text.trim() ? parsed.text : null };
  } catch (e) {
    console.warn('元素识别失败', e);
    return null;
  }
}

/**
 * 视觉清点：列出参考图中的主产品与全部配件（数量+描述），供防幻觉提示词使用。
 * 无 Gemini Key 或分析失败时返回空字符串，调用方按“无清单”降级。
 */
export async function analyzeImageForComponents(referenceImages: string[]): Promise<string> {
  if (!hasGeminiKey()) return '';
  try {
    const ai = await getAI();
    const response = await ai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: {
        parts: [
          ...referenceImages.map(toInlineData),
          { text: "Analyze this product image. List the main product and EVERY single accessory/component visible in the image. You MUST count the EXACT QUANTITY of each item. Describe their color, shape, and relative size. Format as a strict inventory list: '[Quantity] x [Item Name] - [Description]'. Be extremely precise and do not hallucinate items that are not there. Output only the list." },
        ],
      },
    });
    return response.text?.trim() || '';
  } catch (e) {
    console.warn('素材清点失败，按无清单降级', e);
    return '';
  }
}

import { GenError } from "./errors";
import { hasCloudOpenAIKey } from "./keys";

// OpenAI 生图模型（gpt-image-2.5）实际由服务端代理调用（vite 中间件 / Sites Worker）；
// 前端只负责把请求发往同源代理。edits 支持最多 16 张参考图（image[] 重复字段）。
const MAX_REF_IMAGES = 16;

export type GptQuality = 'low' | 'medium' | 'high';

// 仅在云端开放服务时可用。
export const hasOpenAIKey = (): boolean => hasCloudOpenAIKey();

const parseOpenAIError = async (res: Response): Promise<GenError> => {
  let msg = res.statusText;
  try {
    const body = await res.json();
    msg = body?.error?.message || msg;
  } catch { /* 非 JSON 响应 */ }
  if (res.status === 401) return new GenError('API_KEY', '登录已过期，请重新登录。');
  if (res.status === 403 && /verif/i.test(msg)) return new GenError('VERIFICATION', msg);
  if (res.status === 403) return new GenError('API_KEY', msg);
  if (res.status === 429) return new GenError('QUOTA', msg);
  if (res.status === 404) return new GenError('MODEL', msg);
  if (res.status === 413) return new GenError('UNKNOWN', '参考图体积过大（超过服务端上限）。请减少参考图数量或换用更小的图。');
  return new GenError('UNKNOWN', msg);
};

const extractImage = (data: any): string => {
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new GenError('EMPTY', 'GPT Image 未返回图像数据');
  return `data:image/png;base64,${b64}`;
};

export interface GptImageOptions {
  expectedAccount?: string;
  model?: 'gpt-image-2.5-flare' | 'gpt-image-2.5-sunburst';
  size?: '1024x1024' | '1536x1024' | '1024x1536' | '2048x2048' | 'auto';
}

// 同域服务端代理路径。生产=Sites Worker；开发=Vite 中间件（见 vite.config）。
// 统一走同源代理，避免浏览器直连 api.openai.com 被 CORS 拦截 + 绕网络封锁 + 稳回传。
const PROXY_URL = '/api/openai-image';

// 发给代理前把参考图压到 ≤1024px JPEG：既避免 代理请求体上限（413），
// 也降低 gpt-image 的 image input token 成本。
async function shrinkForProxy(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1024;
      const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      try {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d')!.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', 0.72));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// 经同源代理请求（开发与生产统一）
async function requestViaProxy(
  mode: 'generate' | 'edit',
  prompt: string,
  images: string[],
  size: string,
  quality: GptQuality,
  model: GptImageOptions['model'] = 'gpt-image-2.5-flare',
  expectedAccount?: string,
): Promise<string> {
  const shrunk = await Promise.all(images.slice(0, MAX_REF_IMAGES).map(shrinkForProxy));
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(expectedAccount ? { 'X-Project-Account': expectedAccount } : {}) },
    body: JSON.stringify({ mode, prompt, images: shrunk, size, quality, model }),
  });
  if (!res.ok) throw await parseOpenAIError(res);
  return extractImage(await res.json());
}

/**
 * 用 GPT Image 2.5 生成/编辑一张图。
 * 有参考图 → edits（多图）；无参考图 → generations。
 * 开发与生产统一经同源 /api/openai-image 代理（绕封锁 + 无 CORS + 稳回传 + 藏密钥）。
 * @param baseImage 追问重绘时的当前图（追加为最后一张参考图）
 */
export async function gptGenerateImage(
  referenceImages: string[],
  prompt: string,
  quality: GptQuality = 'high',
  baseImage?: string,
  opts?: GptImageOptions,
): Promise<string> {
  const allRefs = baseImage ? [...referenceImages, baseImage] : referenceImages;
  const size = opts?.size ?? '1024x1024';
  const mode: 'generate' | 'edit' = allRefs.length === 0 ? 'generate' : 'edit';
  return requestViaProxy(mode, prompt, allRefs, size, quality, opts?.model, opts?.expectedAccount);
}

import { geminiGenerateImage, hasGeminiKey } from "./geminiService";
import { gptGenerateImage, hasOpenAIKey, GptQuality } from "./openaiService";
import { GenError } from "./errors";

export type EngineId = 'gemini-flash' | 'gemini-pro' | 'gpt-image' | 'gpt-image-sunburst';

export interface EngineMeta {
  label: string;
  tagline: string;
  available: () => boolean;
  setupHint: string;
}

export const ENGINES: Record<EngineId, EngineMeta> = {
  'gemini-flash': {
    label: 'Flash 极速',
    // 分析 3.8；所有分辨率生图为 3.1。
    tagline: 'Gemini 3.1 生图 · 3.8 智能清点 · 1K',
    available: hasGeminiKey,
    setupHint: '请选择已开放的创作引擎，或联系管理员',
  },
  'gemini-pro': {
    label: 'Pro 超清',
    tagline: 'Gemini 3.1 生图 · 3.8 智能清点 · 2K',
    available: hasGeminiKey,
    setupHint: '请选择已开放的创作引擎，或联系管理员',
  },
  'gpt-image': {
    label: 'Image 2.5 Flare',
    tagline: 'GPT Image 2.5 Flare · 快速创作',
    available: hasOpenAIKey,
    setupHint: '请选择已开放的创作引擎，或联系管理员',
  },
  'gpt-image-sunburst': { label: 'Image 2.5 Sunburst', tagline: 'GPT Image 2.5 Sunburst · 精细编辑', available: hasOpenAIKey, setupHint: '请选择已开放的创作引擎，或联系管理员' },
};

// 简易并发闸：全局同时最多 3 个生图请求，避免触发 RPM 限流
const MAX_CONCURRENT = 3;
let running = 0;
const queue: (() => void)[] = [];

const acquire = (): Promise<void> =>
  new Promise(resolve => {
    if (running < MAX_CONCURRENT) {
      running++;
      resolve();
    } else {
      queue.push(() => { running++; resolve(); });
    }
  });

const release = () => {
  running--;
  queue.shift()?.();
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// 单次生成硬超时：防止挂死请求永久占用并发槽（曾因 HMR 打断 in-flight 请求
// 导致 finally 未执行、running 计数泄漏，3 槽占满后所有生成静默排队死锁）
const HARD_TIMEOUT_MS = 180_000;
const withTimeout = <T,>(p: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new GenError('UNKNOWN', '生成超时，请先确认用量再重试')), HARD_TIMEOUT_MS);
  p.then(resolve, reject).finally(() => clearTimeout(timer));
});

// 引擎无关的生成选项：按需映射到各引擎的比例/分辨率参数
export interface GenerateOptions {
  wide?: boolean;    // 16:9 横幅（扩图）
  upscale?: boolean; // 高清放大（Gemini 4K / GPT 2048）
  quality?: GptQuality; // GPT Image 出图质量（low/medium/high；Gemini 忽略）
  retryOnQuota?: boolean; // 工作流自行控制失败重试，避免一次步骤重复提交模型请求
  expectedAccount?: string;
}

/**
 * 统一生图入口：并发限流 + 限流错误自动退避重试一次。
 * @param baseImage 追问重绘时的当前图
 */
export async function generateWithEngine(
  engine: EngineId,
  referenceImages: string[],
  prompt: string,
  baseImage?: string,
  opts?: GenerateOptions,
): Promise<string> {
  await acquire();
  try {
    return await withTimeout(runOnce(engine, referenceImages, prompt, baseImage, opts));
  } catch (e) {
    if (e instanceof GenError && e.code === 'QUOTA' && opts?.retryOnQuota !== false) {
      await sleep(5000);
      return await withTimeout(runOnce(engine, referenceImages, prompt, baseImage, opts));
    }
    throw e;
  } finally {
    release();
  }
}

const runOnce = (engine: EngineId, refs: string[], prompt: string, baseImage?: string, opts?: GenerateOptions): Promise<string> => {
  switch (engine) {
    case 'gemini-flash':
    case 'gemini-pro': {
      const tier = opts?.upscale ? 'pro' : (engine === 'gemini-pro' ? 'pro' : 'flash');
      return geminiGenerateImage(refs, prompt, tier, baseImage, {
        aspectRatio: opts?.wide ? '16:9' : '1:1',
        imageSize: opts?.upscale ? '4K' : undefined,
        expectedAccount: opts?.expectedAccount,
      });
    }
    case 'gpt-image':
    case 'gpt-image-sunburst':
      return gptGenerateImage(refs, prompt, opts?.upscale ? 'high' : (opts?.quality ?? 'low'), baseImage, {
        model: engine === 'gpt-image-sunburst' ? 'gpt-image-2.5-sunburst' : 'gpt-image-2.5-flare',
        size: opts?.wide ? '1536x1024' : opts?.upscale ? '2048x2048' : '1024x1024',
        expectedAccount: opts?.expectedAccount,
      });
  }
};

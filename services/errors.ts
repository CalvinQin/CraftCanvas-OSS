// 统一的生成错误类型（Gemini 与 OpenAI 引擎共用）

export type GenErrorCode =
  | 'API_KEY'        // 密钥缺失 / 无效 / 无权限
  | 'QUOTA'          // 限流或配额耗尽
  | 'MODEL'          // 模型 ID 不存在或已下线
  | 'SAFETY'         // 内容安全拦截
  | 'VERIFICATION'   // OpenAI 组织未验证
  | 'EMPTY'          // 响应为空 / 未返回图像
  | 'UNKNOWN';

export class GenError extends Error {
  constructor(public code: GenErrorCode, message: string) {
    super(message);
    this.name = 'GenError';
  }
}

export function friendlyErrorMessage(e: unknown): string {
  if (e instanceof GenError) {
    switch (e.code) {
      case 'API_KEY': return `服务权限：${e.message}`;
      case 'QUOTA': return '请求过于频繁或配额不足，已自动重试仍失败，请稍后再试。';
      case 'MODEL': return `模型不可用：${e.message}`;
      case 'SAFETY': return '内容被安全策略拦截，请调整素材或指令后重试。';
      case 'VERIFICATION': return 'OpenAI 组织未完成身份验证：请在 platform.openai.com 控制台完成 Organization Verification 后再使用 GPT Image 引擎。';
      case 'EMPTY': return '模型未返回图像数据，请重试或更换指令。';
      default: return e.message;
    }
  }
  return e instanceof Error ? e.message : String(e);
}

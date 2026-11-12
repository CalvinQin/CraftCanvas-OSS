/** Only user-facing outcomes cross into a saved workflow; never persist SDK payloads. */
export function generationErrorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === 'QUOTA') return '额度不足或引擎繁忙，请确认用量后手动重试';
  if (code === 'API_KEY') return '创作服务暂时不可用，请重新登录或检查服务配置';
  if (code === 'MODEL') return '所选模型暂时不可用，请更换模型后重试';
  if (code === 'SAFETY') return '内容未通过安全检查，请调整素材或提示词后重试';
  if (code === 'EMPTY') return '本次未返回图片，请调整提示词或更换模型';
  if (code === 'VERIFICATION') return '此创作引擎暂未开放，请选择其他模型';
  const message = error instanceof Error ? error.message : '';
  if (/超时|timeout/i.test(message)) return '生成超时，请先确认用量再手动重试';
  if (/账号已改变/.test(message)) return '登录账号已改变，请备份工作流后重新打开';
  return '创作服务暂时不可用，请稍后重试或选择其他模型';
}

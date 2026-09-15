export function formatCount(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '未知';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? new Intl.NumberFormat('zh-CN').format(parsed) : '未知';
}

export function formatAudioMinutes(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '未知';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(parsed / 60) : '未知';
}

export function formatAudioSeconds(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '未测量';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed.toFixed(parsed >= 10 ? 1 : 2)} 秒` : '未测量';
}

export function formatAudioBytes(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '未知';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '未知';
  if (parsed < 1024) return `${parsed} B`;
  if (parsed < 1024 * 1024) return `${(parsed / 1024).toFixed(1)} KB`;
  return `${(parsed / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatEstimatedCosts(costs: Record<string, number | string> | null | undefined): string {
  const entries = Object.entries(costs || {}).filter(([, value]) => Number.isFinite(Number(value)));
  if (entries.length === 0) return '未定价';
  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, value]) => `${currency} ${Number(value).toFixed(4)}`)
    .join(' / ');
}

export const AI_FEATURE_LABELS: Record<string, string> = {
  ai_match: 'AI 选岗',
  resume_optimize: '简历优化',
  resume_score: '简历评分',
  resume_translate: '简历翻译',
  resume_translate_content: '简历内容翻译',
  resume_parse: '简历解析',
  resume_profile: '简历画像',
  company_dna: '企业面试基因',
  job_description: '岗位描述生成',
  application_prefill: '网申智能预填',
  interview_chat: '面试对话',
  interview_summary: '面试总结',
  interview_asr: '面试语音识别',
  interview_asr_realtime: '实时语音识别',
  interview_tts: '面试语音合成',
  interview_tts_realtime: '实时语音合成',
};

export function formatAiFeature(feature: string): string {
  return AI_FEATURE_LABELS[feature] || feature;
}

export const APPLICATION_STATUS_LABELS: Record<string, string> = {
  pending: '待投递',
  filling: '填写中',
  submitted: '已投递',
  closed: '已关闭',
};

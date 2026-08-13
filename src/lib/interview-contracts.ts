import { z } from 'zod';
import { randomUUID } from 'node:crypto';

export const clientRequestIdSchema = z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9._:-]+$/);

// 当前模拟面试仅支持语音输入：候选人回答必须来自实时 ASR 或 HTTP ASR 回退。
// `system` 仅用于开场、轮次切换和超时收尾等服务端控制动作。
export const interviewInputSourceSchema = z.enum(['asr', 'asr_fallback', 'system']).default('system');

export const interviewSummaryRequestSchema = z.object({
  sessionId: z.number().int().positive(),
  language: z.enum(['zh', 'en']).default('zh'),
}).strict();

export const interviewFeedbackRequestSchema = z.object({
  sessionId: z.number().int().positive(),
  realismScore: z.number().int().min(1).max(10),
  feedbackText: z.string().trim().max(2000).optional(),
}).strict();

export const realtimeTicketRequestSchema = z.object({
  sessionId: z.number().int().positive(),
  capability: z.enum(['asr', 'tts']),
}).strict();

export type InterviewInputSource = z.infer<typeof interviewInputSourceSchema>;

export function createSseEvent<T extends Record<string, unknown>>(
  type: string,
  payload: T,
  context: { requestId?: string; revision?: number } = {},
) {
  return {
    type,
    eventId: randomUUID(),
    requestId: context.requestId ?? null,
    revision: context.revision ?? null,
    ...payload,
  };
}

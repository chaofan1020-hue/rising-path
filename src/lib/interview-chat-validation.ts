import { z } from 'zod';

export const interviewChatRequestSchema = z.object({
  sessionId: z.number().int().positive().nullable().optional(),
  interviewType: z.string().trim().min(1).max(100).optional(),
  jobDescription: z.string().max(20_000).optional(),
  jobId: z.number().int().positive().optional(),
  resumeId: z.number().int().positive().optional(),
  answer: z.string().max(10_000).optional(),
  language: z.enum(['zh', 'en']).default('zh'),
  mode: z.enum(['single', 'gauntlet']).default('single'),
  totalRounds: z.number().int().min(1).max(4).default(1),
  targetCompany: z.string().trim().max(255).optional(),
  timeout: z.boolean().default(false),
  practiceMode: z.enum(['fresh', 'targeted', 'review']).default('fresh'),
  switchNext: z.boolean().default(false),
}).strict();

export type InterviewChatRequest = z.infer<typeof interviewChatRequestSchema>;

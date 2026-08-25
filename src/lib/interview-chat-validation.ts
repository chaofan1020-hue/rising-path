import { z } from 'zod';
import { clientRequestIdSchema, interviewInputSourceSchema } from './interview-contracts';

export const interviewChatRequestSchema = z.object({
  sessionId: z.number().int().positive().nullable().optional(),
  clientRequestId: clientRequestIdSchema.optional(),
  revision: z.number().int().min(0).optional(),
  inputSource: interviewInputSourceSchema,
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
  endInterview: z.boolean().default(false),
  practiceMode: z.enum(['fresh', 'targeted', 'review']).default('fresh'),
  evaluationMode: z.enum(['coach', 'committee', 'dual']).default('dual'),
  switchNext: z.boolean().default(false),
  turnPlan: z.object({
    version: z.literal(1),
    action: z.enum(['probe', 'advance']),
    intentKey: z.string().trim().min(1).max(120),
    dimension: z.string().trim().min(1).max(120),
    scenarioKey: z.string().trim().min(1).max(120),
    angle: z.string().trim().min(1).max(120),
    evidenceIds: z.array(z.string().trim().min(1).max(80)).max(3),
  }).optional(),
  turnPlanToken: z.string().trim().min(20).max(160).optional(),
}).strict();

export type InterviewChatRequest = z.infer<typeof interviewChatRequestSchema>;

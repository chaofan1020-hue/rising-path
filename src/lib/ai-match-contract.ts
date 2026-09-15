import { z } from 'zod';

export const MATCH_RECOMMENDATION_TYPES = ['apply_now', 'improve_then_apply', 'low_priority'] as const;
export const MATCH_ELIGIBILITY_STATUSES = ['eligible', 'uncertain', 'blocked'] as const;
export const MATCH_FIELD_STATUSES = ['verified', 'derived', 'pending_recheck', 'missing'] as const;

const fieldStatusSchema = z.enum(MATCH_FIELD_STATUSES);

const scoreBreakdownSchema = z.object({
  ats: z.number().int().min(0).max(100),
  keywords: z.number().int().min(0).max(100),
  experience: z.number().int().min(0).max(100),
  evidence: z.number().int().min(0).max(100),
  region: z.number().int().min(0).max(100),
  profile_fit: z.number().int().min(0).max(100),
});

const baseMatchSchema = z.object({
  job_id: z.number().int().positive(),
  match_score: z.number().int().min(0).max(100),
  score_breakdown: scoreBreakdownSchema,
  match_reason: z.string().trim().min(1).max(2000),
  evidence: z.array(z.string().trim().min(1).max(500)).max(8),
  key_gaps: z.array(z.string().trim().min(1).max(500)).max(8),
  suggestions: z.string().trim().min(1).max(2000),
});

const modelMatchResponseSchema = z.array(baseMatchSchema).min(1);
const matchResultSchema = baseMatchSchema.extend({
  recommendation_type: z.enum(MATCH_RECOMMENDATION_TYPES),
  confidence: z.number().int().min(0).max(100),
  eligibility: z.object({
    status: z.enum(MATCH_ELIGIBILITY_STATUSES),
    reasons: z.array(z.string().trim().min(1).max(500)).max(8),
  }),
  field_quality: z.object({
    location: fieldStatusSchema,
    salary: fieldStatusSchema,
    experience: fieldStatusSchema,
    sponsorship: fieldStatusSchema,
    deadline: fieldStatusSchema,
  }),
});

export const MATCH_RESULT_SCHEMA = matchResultSchema;

export type Match = z.infer<typeof matchResultSchema>;
export type ModelMatch = z.infer<typeof baseMatchSchema>;

export const AI_MATCH_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    matches: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          job_id: { type: 'integer', minimum: 1 },
          match_score: { type: 'integer', minimum: 0, maximum: 100 },
          score_breakdown: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ats: { type: 'integer', minimum: 0, maximum: 100 },
              keywords: { type: 'integer', minimum: 0, maximum: 100 },
              experience: { type: 'integer', minimum: 0, maximum: 100 },
              evidence: { type: 'integer', minimum: 0, maximum: 100 },
              region: { type: 'integer', minimum: 0, maximum: 100 },
              profile_fit: { type: 'integer', minimum: 0, maximum: 100 },
            },
            required: ['ats', 'keywords', 'experience', 'evidence', 'region', 'profile_fit'],
          },
          match_reason: { type: 'string', minLength: 1 },
          evidence: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1 } },
          key_gaps: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1 } },
          suggestions: { type: 'string', minLength: 1 },
        },
        required: [
          'job_id',
          'match_score',
          'score_breakdown',
          'match_reason',
          'evidence',
          'key_gaps',
          'suggestions',
        ],
      },
    },
  },
  required: ['matches'],
};

export function parseModelMatches(raw: string): ModelMatch[] {
  const normalized = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const parsed: unknown = JSON.parse(normalized);
  if (Array.isArray(parsed)) return modelMatchResponseSchema.parse(parsed);
  if (typeof parsed === 'object' && parsed !== null && 'matches' in parsed) {
    return modelMatchResponseSchema.parse(parsed.matches);
  }
  return modelMatchResponseSchema.parse(parsed);
}

export function validateMatchSet(matches: ModelMatch[], jobIds: Iterable<number>): void {
  const expectedJobIds = new Set(jobIds);
  const returnedJobIds = new Set<number>();

  for (const match of matches) {
    if (!expectedJobIds.has(match.job_id) || returnedJobIds.has(match.job_id)) {
      throw new Error('AI returned an invalid or duplicate job result');
    }
    returnedJobIds.add(match.job_id);
  }

  if (returnedJobIds.size !== expectedJobIds.size) {
    throw new Error('AI did not return every candidate job');
  }
}

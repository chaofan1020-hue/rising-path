import { z } from 'zod';

const scoreBreakdownSchema = z.object({
  ats: z.number().int().min(0).max(100),
  keywords: z.number().int().min(0).max(100),
  experience: z.number().int().min(0).max(100),
  evidence: z.number().int().min(0).max(100),
  region: z.number().int().min(0).max(100),
  profile_fit: z.number().int().min(0).max(100),
}).strict();

const evaluationSchema = z.object({
  match_score: z.number().int().min(0).max(100),
  score_breakdown: scoreBreakdownSchema,
}).strict();

export const optimizationScoreComparisonSchema = z.object({
  original: evaluationSchema,
  optimized: evaluationSchema,
  summary: z.string().trim().min(1).max(2000),
  key_changes: z.array(z.string().trim().min(1).max(500)).max(8),
}).strict();

export type OptimizationScoreComparison = z.infer<typeof optimizationScoreComparisonSchema>;

const scoreBreakdownProperties = {
  ats: { type: 'integer', minimum: 0, maximum: 100 },
  keywords: { type: 'integer', minimum: 0, maximum: 100 },
  experience: { type: 'integer', minimum: 0, maximum: 100 },
  evidence: { type: 'integer', minimum: 0, maximum: 100 },
  region: { type: 'integer', minimum: 0, maximum: 100 },
  profile_fit: { type: 'integer', minimum: 0, maximum: 100 },
};

const evaluationSchemaDefinition = {
  type: 'object',
  additionalProperties: false,
  properties: {
    match_score: { type: 'integer', minimum: 0, maximum: 100 },
    score_breakdown: {
      type: 'object',
      additionalProperties: false,
      properties: scoreBreakdownProperties,
      required: Object.keys(scoreBreakdownProperties),
    },
  },
  required: ['match_score', 'score_breakdown'],
};

export const OPTIMIZATION_SCORE_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    original: evaluationSchemaDefinition,
    optimized: evaluationSchemaDefinition,
    summary: { type: 'string', minLength: 1 },
    key_changes: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1 } },
  },
  required: ['original', 'optimized', 'summary', 'key_changes'],
};

export function parseOptimizationScoreComparison(raw: string): OptimizationScoreComparison {
  const normalized = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    return optimizationScoreComparisonSchema.parse(JSON.parse(normalized));
  } catch (firstError) {
    const start = normalized.indexOf('{');
    const end = normalized.lastIndexOf('}');
    if (start < 0 || end <= start) throw firstError;
    return optimizationScoreComparisonSchema.parse(JSON.parse(normalized.slice(start, end + 1)));
  }
}

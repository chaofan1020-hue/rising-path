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
    return parseCandidate(JSON.parse(normalized));
  } catch (firstError) {
    const start = normalized.indexOf('{');
    const end = normalized.lastIndexOf('}');
    if (start < 0 || end <= start) throw firstError;
    return parseCandidate(JSON.parse(normalized.slice(start, end + 1)));
  }
}

function parseCandidate(parsed: unknown): OptimizationScoreComparison {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AI 评分对比返回的不是 JSON 对象');
  }
  const record = parsed as Record<string, unknown>;
  const originalResume = isRecord(record.original_resume) ? record.original_resume : undefined;
  const optimizedResume = isRecord(record.optimized_resume) ? record.optimized_resume : undefined;
  const summary = String(
    record.summary
    ?? record.summary_text
    ?? record.analysis
    ?? optimizedResume?.summary
    ?? originalResume?.summary
    ?? 'AI 已完成评分'
  ).trim() || 'AI 已完成评分';
  const keyChanges = Array.isArray(record.key_changes)
    ? record.key_changes
    : Array.isArray(optimizedResume?.key_changes)
      ? optimizedResume.key_changes
      : Array.isArray(originalResume?.key_changes)
        ? originalResume.key_changes
        : [];
  const candidate = {
    original: normalizeEvaluation(record.original ?? originalResume),
    optimized: normalizeEvaluation(record.optimized ?? optimizedResume),
    summary,
    key_changes: keyChanges.map((item) => String(item).trim()).filter(Boolean).slice(0, 8),
  };
  return optimizationScoreComparisonSchema.parse(candidate);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toScore(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(100, Math.max(0, parsed)) : undefined;
}

function normalizeEvaluation(value: unknown): { match_score: number; score_breakdown: Record<string, number> } | undefined {
  if (!isRecord(value)) return undefined;
  const score_breakdown = {
    ats: toScore(value.ats) ?? 0,
    keywords: toScore(value.keywords) ?? 0,
    experience: toScore(value.experience) ?? 0,
    evidence: toScore(value.evidence) ?? 0,
    region: toScore(value.region) ?? 0,
    profile_fit: toScore(value.profile_fit) ?? 0,
  };
  const total = toScore(value.total)
    ?? toScore(value.match_score)
    ?? Math.round(Object.values(score_breakdown).reduce((a, b) => a + b, 0) / 6);
  return { match_score: total, score_breakdown };
}

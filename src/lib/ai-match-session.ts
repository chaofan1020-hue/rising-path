import type { MatchJobType, SponsorshipFilter } from '@/lib/ai-match-filters';
import type { MatchExclusionCounts } from '@/lib/ai-match-candidate-ranking';
import { emptyMatchExclusionCounts } from '@/lib/ai-match-candidate-ranking';
import type { SupabaseClient } from '@supabase/supabase-js';

export type MatchEmptyReason = 'no_retrieval' | 'no_suitable' | null;

export interface MatchRunFilters {
  regions: string[];
  directions: string[];
  job_types: MatchJobType[];
  sponsorship: SponsorshipFilter;
}

export interface MatchQualityMetrics {
  direct_count: number;
  adjacent_count: number;
  apply_now_count: number;
  improve_then_apply_count: number;
  low_priority_count: number;
  sponsorship_yes_count: number;
  mean_score: number;
}

export interface MatchRunSummary {
  match_run_id?: string | null;
  retrieved_count: number;
  suitable_count: number;
  selected_count: number;
  explained_count: number;
  empty_reason: MatchEmptyReason;
  filters: MatchRunFilters;
  exclusions: MatchExclusionCounts;
  quality: MatchQualityMetrics;
  job_ids?: number[];
  created_at?: string | null;
}

export interface MatchQualityInput {
  role_fit?: 'direct' | 'adjacent' | null;
  recommendation_type?: 'apply_now' | 'improve_then_apply' | 'low_priority' | null;
  sponsorship?: 'yes' | 'no' | 'unknown' | null;
  match_score?: number | null;
}

export function emptyMatchQualityMetrics(): MatchQualityMetrics {
  return {
    direct_count: 0,
    adjacent_count: 0,
    apply_now_count: 0,
    improve_then_apply_count: 0,
    low_priority_count: 0,
    sponsorship_yes_count: 0,
    mean_score: 0,
  };
}

export function buildMatchQualityMetrics(matches: MatchQualityInput[]): MatchQualityMetrics {
  const quality = emptyMatchQualityMetrics();
  if (matches.length === 0) return quality;
  let scoreTotal = 0;
  for (const match of matches) {
    if (match.role_fit === 'direct') quality.direct_count += 1;
    else quality.adjacent_count += 1;
    if (match.recommendation_type === 'improve_then_apply') quality.improve_then_apply_count += 1;
    else if (match.recommendation_type === 'low_priority') quality.low_priority_count += 1;
    else quality.apply_now_count += 1;
    if (match.sponsorship === 'yes') quality.sponsorship_yes_count += 1;
    scoreTotal += Number(match.match_score || 0);
  }
  quality.mean_score = Math.round(scoreTotal / matches.length);
  return quality;
}

export function buildMatchRunSummary(input: {
  matchRunId?: string | null;
  retrievedCount: number;
  suitableCount: number;
  selectedCount: number;
  explainedCount?: number;
  filters: MatchRunFilters;
  exclusions?: MatchExclusionCounts;
  quality?: MatchQualityMetrics;
  jobIds?: number[];
  createdAt?: string | null;
}): MatchRunSummary {
  const selectedCount = Math.max(0, input.selectedCount);
  const retrievedCount = Math.max(0, input.retrievedCount);
  const suitableCount = Math.max(0, input.suitableCount);
  const jobIds = (input.jobIds || []).filter((id) => Number.isInteger(id) && id > 0);
  return {
    match_run_id: input.matchRunId || null,
    retrieved_count: retrievedCount,
    suitable_count: suitableCount,
    selected_count: selectedCount,
    explained_count: Math.max(0, input.explainedCount || 0),
    empty_reason: retrievedCount === 0 ? 'no_retrieval' : selectedCount === 0 ? 'no_suitable' : null,
    filters: input.filters,
    exclusions: input.exclusions || emptyMatchExclusionCounts(),
    quality: input.quality || emptyMatchQualityMetrics(),
    job_ids: jobIds,
    created_at: input.createdAt || null,
  };
}

export async function persistMatchRun(
  client: SupabaseClient,
  row: {
    userId: string;
    resumeId: number;
    profileVersion: number;
    locale: string;
    requestId: string;
    summary: MatchRunSummary;
  },
): Promise<string | null> {
  const payload = {
    user_id: row.userId,
    resume_id: row.resumeId,
    resume_profile_version: row.profileVersion,
    preview: false,
    locale: row.locale,
    filters: row.summary.filters,
    retrieved_count: row.summary.retrieved_count,
    suitable_count: row.summary.suitable_count,
    selected_count: row.summary.selected_count,
    explained_count: row.summary.explained_count,
    exclusion_counts: row.summary.exclusions,
    quality: row.summary.quality,
    request_id: row.requestId,
    job_ids: row.summary.job_ids || [],
  };
  try {
    const first = await client.from('ai_match_runs').insert(payload).select('id').maybeSingle();
    if (!first.error) {
      return typeof first.data?.id === 'string' ? first.data.id : null;
    }
    if (!/job_ids/i.test(first.error.message)) {
      console.warn('[AI match run persist skipped]', first.error.message);
      return null;
    }
    const { job_ids: _jobIds, ...legacyPayload } = payload;
    const retry = await client.from('ai_match_runs').insert(legacyPayload).select('id').maybeSingle();
    if (retry.error) {
      console.warn('[AI match run persist skipped]', retry.error.message);
      return null;
    }
    return typeof retry.data?.id === 'string' ? retry.data.id : null;
  } catch (error) {
    console.warn('[AI match run persist skipped]', error);
    return null;
  }
}

export function matchSummaryFromRunRow(row: {
  id?: string | null;
  retrieved_count?: number | null;
  suitable_count?: number | null;
  selected_count?: number | null;
  explained_count?: number | null;
  exclusion_counts?: MatchExclusionCounts | null;
  quality?: MatchQualityMetrics | null;
  filters?: MatchRunFilters | null;
  job_ids?: unknown;
  created_at?: string | null;
}): MatchRunSummary {
  const jobIds = Array.isArray(row.job_ids)
    ? row.job_ids.map((item) => Number(item)).filter((id) => Number.isInteger(id) && id > 0)
    : [];
  return buildMatchRunSummary({
    matchRunId: row.id || null,
    retrievedCount: Number(row.retrieved_count || 0),
    suitableCount: Number(row.suitable_count || 0),
    selectedCount: Number(row.selected_count || 0),
    explainedCount: Number(row.explained_count || 0),
    filters: row.filters || { regions: [], directions: [], job_types: [], sponsorship: 'any' },
    exclusions: row.exclusion_counts || emptyMatchExclusionCounts(),
    quality: row.quality || emptyMatchQualityMetrics(),
    jobIds,
    createdAt: row.created_at || null,
  });
}

import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { consumeAuthRateLimit } from '@/lib/auth-security';
import { createTextProviderClient } from '@/lib/ai/text-provider';
import { configuredRegionScopeKeys, targetRegionScopeKeys } from '@/lib/job-region-scope';
import { consumeTrackedTextBatch } from '@/lib/ai-usage';
import { betaEntitlementResponse } from '@/lib/beta-entitlements';
import {
  MATCH_REPORT_LIMIT,
  MATCH_RESTORE_WINDOW_MS,
  buildMatchTeaser,
  emptyMatchTeaser,
  isWithinRestoreWindow,
  jobIdsFromRunRow,
  parseCsvList,
  sanitizeMatchTeaser,
  sameMatchRunFilters,
} from '@/lib/ai-match-teaser';
import {
  AI_MATCH_EXPLANATION_SCHEMA,
  parseMatchExplanations,
  type Match,
  type MatchExplanation,
} from '@/lib/ai-match-contract';
import { creditResponse } from '@/lib/credits';
import { buildScoredMatch, isReportableMatch } from '@/lib/ai-match-scoring';
import type { MatchLocale } from '@/lib/ai-match-scoring';
import { requireConfirmedResume } from '@/lib/resume-access';
import { untrustedBusinessDataBlock, untrustedBusinessDataPolicy } from '@/lib/prompt-safety';
import { applyMatchFeedbackPreferences, emptyMatchExclusionCounts, roleFit, selectMatchCandidates } from '@/lib/ai-match-candidate-ranking';
import type { CandidateRankProfile, MatchExclusionCounts, MatchFeedbackSignal } from '@/lib/ai-match-candidate-ranking';
import { buildMatchExplainContext } from '@/lib/ai-match-explain-context';
import {
  buildMatchRetrievalTerms,
  collectTargetCompanies,
  collectTargetRoles,
  profileExperienceYears,
  scoreMatchFeatures,
} from '@/lib/ai-match-features';
import { userNeedsSponsorship, type MatchJobType, type SponsorshipFilter } from '@/lib/ai-match-filters';
import {
  buildMatchQualityMetrics,
  buildMatchRunSummary,
  matchSummaryFromRunRow,
  persistMatchRun,
  type MatchRunFilters,
  type MatchRunSummary,
} from '@/lib/ai-match-session';
import type { CareerStage, ResumeProfile, UserSegmentation } from '@/lib/resume-types';

export const runtime = 'nodejs';
export const maxDuration = 120;

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : [];
}

function positiveInteger(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function compactPromptText(value: unknown, maximumLength: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length <= maximumLength) return text;
  return `${text.slice(0, maximumLength)}\n[内容已截断]`;
}

function requestLocale(value: unknown): MatchLocale {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  if (normalized === 'zh-tw' || normalized === 'zh-hant') return 'zh-TW';
  return 'zh-CN';
}

function languageInstruction(locale: MatchLocale): string {
  if (locale === 'en') return 'Write match_reason, evidence, key_gaps, and suggestions in English.';
  if (locale === 'zh-TW') return '請使用繁體中文輸出 match_reason、evidence、key_gaps 和 suggestions。';
  return '请使用简体中文输出 match_reason、evidence、key_gaps 和 suggestions。';
}

const MATCH_CANDIDATE_LIMIT = 24;
const MATCH_EXPLAIN_LIMIT = MATCH_REPORT_LIMIT;
const MATCH_RUN_SELECT_WITH_IDS = 'id, retrieved_count, suitable_count, selected_count, explained_count, exclusion_counts, quality, filters, job_ids, created_at';
const MATCH_RUN_SELECT = 'id, retrieved_count, suitable_count, selected_count, explained_count, exclusion_counts, quality, filters, created_at';
const MATCH_BATCH_SIZE = 4;
const MATCH_BATCH_CONCURRENCY = 2;
const MATCH_RETRIEVAL_LIMIT = 240;
const MATCH_RETRIEVAL_TERM_LIMIT = 8;
const MATCH_RESUME_CONTEXT_MAX_CHARS = 5_000;
const MATCH_PROFILE_CONTEXT_MAX_CHARS = 1_800;
const MATCH_JOB_REQUIREMENTS_MAX_CHARS = 600;

type CandidateJob = {
  id: number;
  title: string;
  company: string;
  region: string | null;
  direction: string;
  audience?: string | null;
  job_type?: string | null;
  employment_category?: string | null;
  description: string | null;
  requirements: string | null;
  lexical_score: number | null;
  created_at: string;
  job_url?: string | null;
  workplace_type?: string | null;
  salary_range?: string | null;
  sponsorship?: 'yes' | 'no' | 'unknown' | null;
  valid_through?: string | null;
  role_fit?: 'direct' | 'adjacent';
  feedback_priority?: number | null;
  feature_score?: number | null;
  feature_notes?: string[];
  deadline_source?: string | null;
  salary_source?: string | null;
  location_source?: string | null;
  experience_min_years?: number | null;
  experience_max_years?: number | null;
  experience_text?: string | null;
  field_evidence?: Record<string, unknown> | null;
};

type EnrichedMatch = Match & {
  job_title: string;
  company: string;
  role_fit: 'direct' | 'adjacent';
  resume_profile_version: number;
  analysis_source?: 'features' | 'model';
  region?: string | null;
  direction?: string | null;
  job_url?: string | null;
  salary_range?: string | null;
  sponsorship?: 'yes' | 'no' | 'unknown' | null;
  workplace_type?: string | null;
  valid_through?: string | null;
};

type MatchEvent =
  | { type: 'stage'; stage: 'retrieval' | 'ranking' | 'explaining' | 'complete'; current?: number; total?: number }
  | { type: 'ranked'; matches: EnrichedMatch[] }
  | { type: 'explanation'; match: EnrichedMatch }
  | { type: 'done'; payload: Record<string, unknown> }
  | { type: 'error'; error: string };

const JOB_MATCH_FIELDS = 'id, title, company, region, direction, audience, job_type, employment_category, description, requirements, salary_range, sponsorship, valid_through, deadline_source, salary_source, location_source, experience_min_years, experience_max_years, experience_text, workplace_type, field_evidence, job_url, created_at';
const JOB_MATCH_METADATA_FIELDS = 'id, title, company, region, direction, audience, job_type, employment_category, salary_range, sponsorship, valid_through, deadline_source, salary_source, location_source, experience_min_years, experience_max_years, experience_text, workplace_type, field_evidence, job_url, created_at';

function parseJobTypes(value: unknown): MatchJobType[] {
  return stringArray(value).filter((item): item is MatchJobType => item === '实习' || item === '校招' || item === '社招');
}

function parseSponsorshipFilter(value: unknown, needsSponsorship: boolean): SponsorshipFilter {
  if (value === 'any' || value === 'exclude_no' || value === 'require_yes') return value;
  return needsSponsorship ? 'exclude_no' : 'any';
}

async function loadMatchFeedbackSignals(
  client: SupabaseClient,
  userId: string,
  resumeId: number,
  profileVersion: number,
): Promise<MatchFeedbackSignal[]> {
  try {
    const { data: feedbackRows, error: feedbackError } = await client
      .from('ai_match_feedback')
      .select('job_id, feedback')
      .eq('user_id', userId)
      .eq('resume_id', resumeId)
      .eq('resume_profile_version', profileVersion);
    if (feedbackError || !feedbackRows?.length) return [];
    const jobIds = feedbackRows
      .map((row) => Number(row.job_id))
      .filter((jobId) => Number.isInteger(jobId) && jobId > 0);
    if (jobIds.length === 0) return [];
    const { data: feedbackJobs, error: jobsError } = await client
      .from('jobs')
      .select('id, company, direction')
      .in('id', jobIds);
    if (jobsError) return [];
    const jobsById = new Map((feedbackJobs || []).map((job) => [Number(job.id), job]));
    return feedbackRows.flatMap((row) => {
      const feedback = row.feedback;
      if (feedback !== 'interested' && feedback !== 'not_interested' && feedback !== 'inaccurate') return [];
      const job = jobsById.get(Number(row.job_id));
      return [{
        jobId: Number(row.job_id),
        feedback,
        company: job?.company || null,
        direction: job?.direction || null,
      }];
    });
  } catch (error) {
    console.warn('[AI match feedback] preference read skipped:', error);
    return [];
  }
}

function chunkJobs<T>(jobs: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < jobs.length; index += size) chunks.push(jobs.slice(index, index + size));
  return chunks;
}

function enrichMatch(
  match: Match,
  job: CandidateJob | undefined,
  targetRoles: string[],
  profileVersion: number,
  analysisSource: 'features' | 'model',
): EnrichedMatch {
  return {
    ...match,
    job_title: job?.title || '未知岗位',
    company: job?.company || '未知公司',
    role_fit: job ? roleFit(job, targetRoles) : 'adjacent',
    region: job?.region || null,
    direction: job?.direction || null,
    job_url: job?.job_url || null,
    salary_range: job?.salary_range || null,
    sponsorship: job?.sponsorship || 'unknown',
    workplace_type: job?.workplace_type || null,
    valid_through: job?.valid_through || null,
    resume_profile_version: profileVersion,
    analysis_source: analysisSource,
  };
}

function matchFiltersFromRequest(input: {
  regions: string[];
  directions: string[];
  jobTypes: MatchJobType[];
  sponsorship: SponsorshipFilter;
}): MatchRunFilters {
  return {
    regions: input.regions,
    directions: input.directions,
    job_types: input.jobTypes,
    sponsorship: input.sponsorship,
  };
}

function restoreSinceIso(now = Date.now()): string {
  return new Date(now - MATCH_RESTORE_WINDOW_MS).toISOString();
}

async function loadRecentPaidRuns(
  client: SupabaseClient,
  input: { userId: string; resumeId: number; profileVersion: number },
) {
  const base = client
    .from('ai_match_runs')
    .select(MATCH_RUN_SELECT_WITH_IDS)
    .eq('user_id', input.userId)
    .eq('resume_id', input.resumeId)
    .eq('resume_profile_version', input.profileVersion)
    .eq('preview', false)
    .gte('created_at', restoreSinceIso())
    .order('created_at', { ascending: false })
    .limit(12);
  const first = await base;
  if (!first.error) return first.data || [];
  if (!/job_ids/i.test(first.error.message || '')) throw first.error;
  const retry = await client
    .from('ai_match_runs')
    .select(MATCH_RUN_SELECT)
    .eq('user_id', input.userId)
    .eq('resume_id', input.resumeId)
    .eq('resume_profile_version', input.profileVersion)
    .eq('preview', false)
    .gte('created_at', restoreSinceIso())
    .order('created_at', { ascending: false })
    .limit(12);
  if (retry.error) throw retry.error;
  return retry.data || [];
}

function persistRows(matches: EnrichedMatch[], resumeId: number, userId: string, profileVersion: number) {
  return matches.map((match) => ({
    resume_id: resumeId,
    job_id: match.job_id,
    match_score: match.match_score,
    match_reason: match.match_reason,
    suggestions: match.suggestions,
    user_id: userId,
    resume_profile_version: profileVersion,
    score_breakdown: match.score_breakdown,
    evidence: match.evidence,
    key_gaps: match.key_gaps,
    recommendation_type: match.recommendation_type,
    confidence: match.confidence,
    eligibility: match.eligibility,
    field_quality: match.field_quality,
  }));
}

function buildExplainPrompt(
  resumeContent: string,
  profileContext: string,
  jobs: CandidateJob[],
  locale: MatchLocale,
  explainContext: { regionBlock: string; segmentBlock: string },
  recommendations?: Map<number, Match['recommendation_type']>,
): string {
  const jobsList = jobs.map((job) => ({
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.region,
    audience: job.audience || null,
    job_type: job.job_type || null,
    sponsorship: job.sponsorship || 'unknown',
    recommendation_type: recommendations?.get(job.id) || null,
    experience: {
      min_years: job.experience_min_years ?? null,
      text: job.experience_text || null,
    },
    deadline: job.valid_through || null,
    requirements: compactPromptText(job.requirements, MATCH_JOB_REQUIREMENTS_MAX_CHARS),
    feature_notes: [
      ...(job.feature_score == null ? [] : [`feature_score=${job.feature_score}`]),
      ...(job.feature_notes || []),
    ],
  }));
  const regionBlock = explainContext.regionBlock
    ? `\nRegion hiring DNA is trusted product knowledge. Use it to explain resume style, visa signals, and ATS habits for the job region. Never invent job facts from it.\n${explainContext.regionBlock}\n`
    : '';
  const segmentBlock = explainContext.segmentBlock
    ? `\n${untrustedBusinessDataBlock('candidate_segmentation', explainContext.segmentBlock, 2_000)}\n`
    : '';

  return `You are a career advisor for international students. These jobs have already been shortlisted as reachable for this resume. Explain why each job was selected and the next action. ${languageInstruction(locale)}

Never say the student should not consider the role, should not apply, or that the job is not worth it. Hard experience and seniority bars have already been removed.

If recommendation_type is apply_now, tell them how to apply well.
If recommendation_type is improve_then_apply, tell them what to strengthen before applying. That still means the job is worth pursuing after a focused resume or experience boost. Do not contradict that with rejection language.

Do not invent salary, deadline, sponsorship, location, or experience requirements. Do not score the jobs; the server already scored them. Return evidence-based reasons only. If region hiring DNA or candidate segmentation is provided, use it only to calibrate the explanation and next action.

${untrustedBusinessDataPolicy(locale === 'en' ? 'en' : 'zh')}
${regionBlock}
${untrustedBusinessDataBlock('resume_content', resumeContent)}

${untrustedBusinessDataBlock('confirmed_candidate_profile', profileContext)}
${segmentBlock}
${untrustedBusinessDataBlock('job_list', jobsList)}

Return strict JSON using {"matches":[...]} format. Include every listed job exactly once.
{
  "matches": [
    {
      "job_id": 1,
      "match_reason": "brief evidence-based reason",
      "evidence": ["up to 2 concrete resume/job facts"],
      "key_gaps": ["up to 2 important gaps"],
      "suggestions": "brief next action that can include optimize resume, apply, or interview practice"
    }
  ]
}

Only return the JSON object.`;
}

async function hydrateJobs(client: SupabaseClient, jobs: CandidateJob[], fields: string): Promise<CandidateJob[]> {
  if (jobs.length === 0) return jobs;
  const { data, error } = await client
    .from('jobs')
    .select(fields)
    .in('id', jobs.map((job) => job.id));
  if (error) throw new Error(`读取岗位字段失败: ${error.message}`);
  const byId = new Map((data || []).map((job) => {
    const record = job as unknown as CandidateJob;
    return [Number(record.id), record] as const;
  }));
  return jobs.map((job) => ({ ...job, ...(byId.get(job.id) || {}) }));
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();

    const jobId = positiveInteger(request.nextUrl.searchParams.get('jobId'));
    const resumeId = positiveInteger(request.nextUrl.searchParams.get('resumeId'));
    if (resumeId === null) {
      return NextResponse.json({ error: '简历 ID 必须有效' }, { status: 400 });
    }

    const resumeAccess = await requireConfirmedResume(auth.client, resumeId, auth.user.id);
    if (!resumeAccess.ok) {
      return NextResponse.json({ error: resumeAccess.error }, { status: resumeAccess.status });
    }

    const profileVersion = Number(resumeAccess.resume.profile_version);
    const profile = (resumeAccess.resume.profile || null) as ResumeProfile | null;
    const segmentation = (resumeAccess.resume.segmentation || null) as UserSegmentation | null;
    const targetRoles = collectTargetRoles(profile, segmentation);

    const hydrateMatchRows = async (rows: Array<Record<string, unknown>>) => {
      if (rows.length === 0) return [] as EnrichedMatch[];
      const jobs = await hydrateJobs(
        auth.client,
        rows.map((row) => ({ id: Number(row.job_id) }) as CandidateJob),
        JOB_MATCH_METADATA_FIELDS,
      );
      const jobsById = new Map(jobs.map((job) => [job.id, job]));
      return rows.map((row) => {
        const job = jobsById.get(Number(row.job_id));
        const snapshot = {
          job_id: Number(row.job_id),
          match_score: Number(row.match_score) || 0,
          score_breakdown: (row.score_breakdown || {}) as Match['score_breakdown'],
          match_reason: String(row.match_reason || ''),
          evidence: Array.isArray(row.evidence) ? row.evidence as string[] : [],
          key_gaps: Array.isArray(row.key_gaps) ? row.key_gaps as string[] : [],
          suggestions: String(row.suggestions || ''),
          recommendation_type: row.recommendation_type as Match['recommendation_type'],
          confidence: Number(row.confidence) || 0,
          eligibility: row.eligibility as Match['eligibility'],
          field_quality: row.field_quality as Match['field_quality'],
        };
        return enrichMatch(snapshot, job, targetRoles, profileVersion, 'model');
      });
    };

    if (jobId !== null) {
      const { data, error } = await auth.client
        .from('ai_matches')
        .select('id, resume_id, job_id, match_score, match_reason, suggestions, score_breakdown, evidence, key_gaps, recommendation_type, confidence, eligibility, field_quality, resume_profile_version, created_at')
        .eq('user_id', auth.user.id)
        .eq('resume_id', resumeId)
        .eq('resume_profile_version', profileVersion)
        .eq('job_id', jobId)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw new Error(`读取岗位评分失败: ${error.message}`);
      const matches = await hydrateMatchRows(data || []);
      return NextResponse.json({
        match: matches[0] || null,
        resume_profile_version: profileVersion,
      });
    }

    const requestedFilters: MatchRunFilters = {
      regions: parseCsvList(request.nextUrl.searchParams.get('regions')),
      directions: parseCsvList(request.nextUrl.searchParams.get('directions')),
      job_types: parseJobTypes(parseCsvList(request.nextUrl.searchParams.get('jobTypes'))),
      sponsorship: parseSponsorshipFilter(request.nextUrl.searchParams.get('sponsorship'), false),
    };
    const hasFilterQuery = Boolean(
      request.nextUrl.searchParams.get('regions')
      || request.nextUrl.searchParams.get('directions')
      || request.nextUrl.searchParams.get('jobTypes')
      || request.nextUrl.searchParams.get('sponsorship'),
    );

    let matchSummary: MatchRunSummary | null = null;
    let restoreJobIds: number[] = [];
    try {
      const runs = await loadRecentPaidRuns(auth.client, {
        userId: auth.user.id,
        resumeId,
        profileVersion,
      });
      const matchedRun = runs.find((row) => {
        const summary = matchSummaryFromRunRow(row);
        if (!isWithinRestoreWindow(summary.created_at)) return false;
        if (!hasFilterQuery) return true;
        return sameMatchRunFilters(summary.filters, requestedFilters);
      });
      if (matchedRun) {
        matchSummary = matchSummaryFromRunRow(matchedRun);
        restoreJobIds = jobIdsFromRunRow(matchedRun, MATCH_EXPLAIN_LIMIT);
      }
    } catch (error) {
      console.warn('[AI match run restore skipped]', error);
    }

    if (!matchSummary) {
      return NextResponse.json({
        match: null,
        matches: [],
        restored: false,
        resume_profile_version: profileVersion,
        match_summary: null,
      });
    }

    let query = auth.client
      .from('ai_matches')
      .select('id, resume_id, job_id, match_score, match_reason, suggestions, score_breakdown, evidence, key_gaps, recommendation_type, confidence, eligibility, field_quality, resume_profile_version, created_at')
      .eq('user_id', auth.user.id)
      .eq('resume_id', resumeId)
      .eq('resume_profile_version', profileVersion)
      .order('created_at', { ascending: false });
    if (restoreJobIds.length > 0) query = query.in('job_id', restoreJobIds);
    else query = query.limit(MATCH_EXPLAIN_LIMIT);

    const { data, error } = await query;
    if (error) throw new Error(`读取岗位评分失败: ${error.message}`);
    const rows = data || [];
    const matches = (await hydrateMatchRows(rows))
      .sort((left, right) => {
        if (restoreJobIds.length > 0) {
          const leftIndex = restoreJobIds.indexOf(left.job_id);
          const rightIndex = restoreJobIds.indexOf(right.job_id);
          if (leftIndex !== -1 || rightIndex !== -1) return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
        }
        return right.match_score - left.match_score;
      })
      .slice(0, MATCH_EXPLAIN_LIMIT);

    return NextResponse.json({
      match: null,
      matches,
      restored: matches.length > 0,
      resume_profile_version: profileVersion,
      match_summary: matchSummary,
    });
  } catch (error) {
    console.error('Error fetching AI job match:', error);
    return NextResponse.json({ error: '读取岗位评分失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();
  let stage = 'auth';
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const body = await request.json();
    const resumeId = body?.resumeId;
    const regions = stringArray(body?.regions);
    const directions = stringArray(body?.directions);
    const jobTypes = parseJobTypes(body?.jobTypes ?? body?.job_types);
    const targetJobId = positiveInteger(body?.jobId);
    const locale = requestLocale(body?.locale || request.headers.get('accept-language')?.split(',')[0]?.trim());
    const refresh = body?.refresh === true;
    const preview = body?.preview === true;
    const requestedJobIds: number[] = [];
    const stream = body?.stream === true && !preview && targetJobId === null;
    if (preview) {
      const rateLimit = await consumeAuthRateLimit(`ai-match-preview:${auth.user.id}`, 20, 60, 120);
      if (!rateLimit.allowed) {
        return NextResponse.json(
          { error: locale === 'en' ? 'Preview is being requested too often. Please wait a moment.' : locale === 'zh-TW' ? '櫥窗請求過於頻繁，請稍後再試。' : '橱窗请求过于频繁，请稍后再试。' },
          { status: 429, headers: { 'Retry-After': String(Math.max(rateLimit.retryAfterSeconds, 30)) } },
        );
      }
    }
    if (body?.jobId !== undefined && targetJobId === null) {
      return NextResponse.json({ error: '目标岗位 ID 无效' }, { status: 400 });
    }

    stage = 'resume';
    const resumeAccess = await requireConfirmedResume(client, resumeId, auth.user.id);
    if (!resumeAccess.ok) {
      return NextResponse.json({ error: resumeAccess.error }, { status: resumeAccess.status });
    }
    const resume = resumeAccess.resume;
    const confirmedResumeId = resume.id;
    const profileVersion = Number(resume.profile_version);
    const profile = (resume.profile || null) as ResumeProfile | null;
    const segmentation = (resume.segmentation || null) as UserSegmentation | null;
    const targetRoles = collectTargetRoles(profile, segmentation);
    const targetCompanies = collectTargetCompanies(profile);
    const experienceYears = profileExperienceYears(profile);
    const regionKeysForVisa = regions.length > 0 ? regions : (segmentation?.regions || []);
    const needsSponsorship = userNeedsSponsorship(profile, regionKeysForVisa);
    const sponsorshipFilter = parseSponsorshipFilter(body?.sponsorship, needsSponsorship);
    const matchContext = { profile, segmentation, locale };
    const candidateProfile: CandidateRankProfile = {
      experienceYears,
      careerStage: typeof segmentation?.careerStage === 'string' ? segmentation.careerStage as CareerStage : null,
      targetRoles,
      targetCompanies,
      needsSponsorship,
      sponsorshipFilter,
      jobTypes: targetJobId === null ? jobTypes : [],
    };
    const runFilters = matchFiltersFromRequest({
      regions,
      directions,
      jobTypes,
      sponsorship: sponsorshipFilter,
    });

    const run = async (emit?: (event: MatchEvent) => void) => {
      if (!preview && !refresh && targetJobId === null) {
        try {
          const runs = await loadRecentPaidRuns(client, {
            userId: auth.user.id,
            resumeId: confirmedResumeId,
            profileVersion,
          });
          const matchedRun = runs.find((row) => {
            const summary = matchSummaryFromRunRow(row);
            return isWithinRestoreWindow(summary.created_at) && sameMatchRunFilters(summary.filters, runFilters);
          });
          if (matchedRun) {
            const summary = matchSummaryFromRunRow(matchedRun);
            const restoreJobIds = jobIdsFromRunRow(matchedRun, MATCH_EXPLAIN_LIMIT);
            if (restoreJobIds.length > 0) {
              const { data: cachedRows, error: cachedError } = await client
                .from('ai_matches')
                .select('id, resume_id, job_id, match_score, match_reason, suggestions, score_breakdown, evidence, key_gaps, recommendation_type, confidence, eligibility, field_quality, resume_profile_version, created_at')
                .eq('user_id', auth.user.id)
                .eq('resume_id', confirmedResumeId)
                .eq('resume_profile_version', profileVersion)
                .in('job_id', restoreJobIds);
              if (!cachedError && cachedRows?.length) {
                const jobs = await hydrateJobs(
                  client,
                  cachedRows.map((row) => ({ id: Number(row.job_id) }) as CandidateJob),
                  JOB_MATCH_METADATA_FIELDS,
                );
                const jobsById = new Map(jobs.map((job) => [job.id, job]));
                const restoredMatches = restoreJobIds.flatMap((id) => {
                  const row = cachedRows.find((item) => Number(item.job_id) === id);
                  const job = jobsById.get(id);
                  if (!row || !job || !row.match_reason) return [];
                  const snapshot = {
                    job_id: id,
                    match_score: Number(row.match_score) || 0,
                    score_breakdown: (row.score_breakdown || {}) as Match['score_breakdown'],
                    match_reason: String(row.match_reason || ''),
                    evidence: Array.isArray(row.evidence) ? row.evidence as string[] : [],
                    key_gaps: Array.isArray(row.key_gaps) ? row.key_gaps as string[] : [],
                    suggestions: String(row.suggestions || ''),
                    recommendation_type: row.recommendation_type as Match['recommendation_type'],
                    confidence: Number(row.confidence) || 0,
                    eligibility: row.eligibility as Match['eligibility'],
                    field_quality: row.field_quality as Match['field_quality'],
                  };
                  return [enrichMatch(snapshot, job, targetRoles, profileVersion, 'model')];
                });
                if (restoredMatches.length > 0) {
                  emit?.({ type: 'stage', stage: 'complete' });
                  emit?.({ type: 'ranked', matches: restoredMatches });
                  const payload = {
                    matches: restoredMatches,
                    resume_profile_version: profileVersion,
                    target_job_id: targetJobId,
                    candidate_count: restoredMatches.length,
                    excluded_candidate_count: 0,
                    feedback_excluded_count: 0,
                    explained_count: restoredMatches.length,
                    cached: true,
                    restored: true,
                    request_id: requestId,
                    match_summary: summary,
                  };
                  emit?.({ type: 'done', payload });
                  return payload;
                }
              }
            }
          }
        } catch (error) {
          console.warn('[AI match restore short-circuit skipped]', error);
        }
      }

      const retrievalTerms = buildMatchRetrievalTerms(profile, segmentation, jobTypes, MATCH_RETRIEVAL_TERM_LIMIT);
      let retrieved: CandidateJob[];
      if (targetJobId !== null) {
        emit?.({ type: 'stage', stage: 'retrieval' });
        stage = 'target_job';
        const { data, error } = await client
          .from('jobs')
          .select(JOB_MATCH_FIELDS)
          .eq('id', targetJobId)
          .eq('is_active', true)
          .maybeSingle();
        if (error) throw new Error(`查询岗位失败: ${error.message}`);
        retrieved = data ? [{ ...data, lexical_score: null } as CandidateJob] : [];
      } else if (requestedJobIds.length > 0) {
        emit?.({ type: 'stage', stage: 'ranking' });
        stage = 'shortlist';
        const shortlistStartedAt = performance.now();
        const { data, error } = await client
          .from('jobs')
          .select(JOB_MATCH_FIELDS)
          .eq('is_active', true)
          .in('id', requestedJobIds);
        if (error) throw new Error(`查询岗位失败: ${error.message}`);
        const byId = new Map((data || []).map((job) => {
          const record = job as unknown as CandidateJob;
          return [Number(record.id), { ...record, lexical_score: record.lexical_score ?? null }] as const;
        }));
        retrieved = requestedJobIds
          .map((id) => byId.get(id))
          .filter((job): job is CandidateJob => Boolean(job));
        console.info('[AI match shortlist loaded]', {
          requestId,
          resumeId: confirmedResumeId,
          requestedCount: requestedJobIds.length,
          candidateCount: retrieved.length,
          durationMs: Math.round(performance.now() - shortlistStartedAt),
        });
      } else {
        emit?.({ type: 'stage', stage: 'retrieval' });
        const regionScopes = regions.length > 0
          ? configuredRegionScopeKeys(regions)
          : targetRegionScopeKeys();
        stage = 'retrieval';
        const retrievalStartedAt = performance.now();
        const { data, error } = await client.rpc('search_ai_match_candidates_v7', {
          p_terms: retrievalTerms,
          p_directions: directions,
          p_region_scopes: regionScopes,
          p_limit: MATCH_RETRIEVAL_LIMIT,
        });
        if (error) {
          console.error('[AI match retrieval failed]', {
            requestId,
            resumeId: confirmedResumeId,
            profileVersion,
            regionCount: regionScopes.length,
            directionCount: directions.length,
            termCount: retrievalTerms.length,
            durationMs: Math.round(performance.now() - retrievalStartedAt),
            code: error.code,
            details: error.details,
            hint: error.hint,
            message: error.message,
          });
          const { data: scopedIds, error: scopeError } = await client
            .from('job_ai_match_scopes')
            .select('job_id')
            .in('scope', regionScopes)
            .limit(MATCH_RETRIEVAL_LIMIT);
          if (!scopeError && scopedIds?.length) {
            const ids = scopedIds.map((row) => Number(row.job_id)).filter((id) => Number.isInteger(id) && id > 0);
            const { data: fallbackJobs, error: fallbackError } = await client
              .from('jobs')
              .select(JOB_MATCH_FIELDS)
              .eq('is_active', true)
              .in('id', ids)
              .order('created_at', { ascending: false })
              .limit(MATCH_RETRIEVAL_LIMIT);
            if (!fallbackError && fallbackJobs?.length) {
              retrieved = fallbackJobs as CandidateJob[];
              console.warn('[AI match retrieval fallback]', {
                requestId,
                candidateCount: retrieved.length,
                durationMs: Math.round(performance.now() - retrievalStartedAt),
              });
            } else {
              throw new Error(`查询岗位失败: ${error.message}`);
            }
          } else {
            throw new Error(`查询岗位失败: ${error.message}`);
          }
        } else {
          retrieved = (data || []) as CandidateJob[];
          console.info('[AI match retrieval complete]', {
            requestId,
            resumeId: confirmedResumeId,
            regionCount: regionScopes.length,
            directionCount: directions.length,
            termCount: retrievalTerms.length,
            candidateCount: retrieved.length,
            durationMs: Math.round(performance.now() - retrievalStartedAt),
          });
        }
      }

      const shouldPersistRun = targetJobId === null && !preview;
      const attachRun = async (payload: Record<string, unknown>, summary: MatchRunSummary) => {
        let next = summary;
        if (shouldPersistRun) {
          const matchRunId = await persistMatchRun(client, {
            userId: auth.user.id,
            resumeId: confirmedResumeId,
            profileVersion,
            locale,
            requestId,
            summary,
          });
          next = { ...summary, match_run_id: matchRunId };
          console.info('[AI match quality]', {
            requestId,
            resumeId: confirmedResumeId,
            matchRunId,
            emptyReason: next.empty_reason,
            retrieved: next.retrieved_count,
            suitable: next.suitable_count,
            selected: next.selected_count,
            explained: next.explained_count,
            quality: next.quality,
            exclusions: next.exclusions,
          });
        }
        const result = { ...payload, match_summary: next };
        emit?.({ type: 'done', payload: result });
        return result;
      };

      if (!retrieved || retrieved.length === 0) {
        const empty = {
          matches: [],
          preview_jobs: [],
          teaser: emptyMatchTeaser(),
          resume_profile_version: profileVersion,
          target_job_id: targetJobId,
          candidate_count: 0,
          excluded_candidate_count: 0,
          feedback_excluded_count: 0,
          no_suitable_candidates: targetJobId === null,
          request_id: requestId,
        };
        return attachRun(empty, buildMatchRunSummary({
          retrievedCount: 0,
          suitableCount: 0,
          selectedCount: 0,
          filters: runFilters,
        }));
      }

      emit?.({ type: 'stage', stage: 'ranking' });
      let jobs = retrieved;
      let feedbackExcludedCount = 0;
      let excludedCount = 0;
      let exclusionCounts: MatchExclusionCounts = emptyMatchExclusionCounts();
      let suitableCount = retrieved.length;
      if (targetJobId === null) {
        if (requestedJobIds.length === 0) {
          jobs = await hydrateJobs(client, jobs, JOB_MATCH_METADATA_FIELDS);
        }
        jobs = jobs.map((job) => {
          const features = scoreMatchFeatures(job, { profile, segmentation, locale });
          return {
            ...job,
            feature_score: features.score,
            feature_notes: features.notes,
          };
        });
        const feedbackSignals = await loadMatchFeedbackSignals(client, auth.user.id, confirmedResumeId, profileVersion);
        const feedbackPreferences = applyMatchFeedbackPreferences(jobs, feedbackSignals);
        jobs = feedbackPreferences.jobs;
        feedbackExcludedCount = feedbackPreferences.excludedCount;
        if (jobs.length === 0) {
          const exclusions = { ...emptyMatchExclusionCounts(), feedback: feedbackExcludedCount };
          return attachRun({
            matches: [],
            preview_jobs: [],
            teaser: emptyMatchTeaser(),
            resume_profile_version: profileVersion,
            target_job_id: targetJobId,
            candidate_count: retrieved.length,
            excluded_candidate_count: 0,
            feedback_excluded_count: feedbackExcludedCount,
            no_suitable_candidates: true,
            request_id: requestId,
          }, buildMatchRunSummary({
            retrievedCount: retrieved.length,
            suitableCount: 0,
            selectedCount: 0,
            filters: runFilters,
            exclusions,
          }));
        }
        const candidateSelection = selectMatchCandidates(jobs, candidateProfile, MATCH_CANDIDATE_LIMIT);
        jobs = candidateSelection.jobs;
        excludedCount = candidateSelection.excludedCount;
        exclusionCounts = { ...candidateSelection.exclusionCounts, feedback: feedbackExcludedCount };
        suitableCount = candidateSelection.suitableCount;
        if (jobs.length === 0) {
          return attachRun({
            matches: [],
            preview_jobs: [],
            teaser: emptyMatchTeaser(),
            resume_profile_version: profileVersion,
            target_job_id: targetJobId,
            candidate_count: retrieved.length,
            excluded_candidate_count: excludedCount,
            feedback_excluded_count: feedbackExcludedCount,
            no_suitable_candidates: true,
            request_id: requestId,
          }, buildMatchRunSummary({
            retrievedCount: retrieved.length,
            suitableCount: 0,
            selectedCount: 0,
            filters: runFilters,
            exclusions: exclusionCounts,
          }));
        }
      } else {
        jobs = jobs.slice(0, 1);
      }

      if (!preview && targetJobId === null && jobs.length > 0 && requestedJobIds.length === 0) {
        jobs = await hydrateJobs(client, jobs, JOB_MATCH_FIELDS);
      }

      let scoredMatches: EnrichedMatch[] = jobs.map((job) => {
        const features = scoreMatchFeatures(job, { profile, segmentation, locale });
        return enrichMatch(buildScoredMatch(job, matchContext, undefined, features), job, targetRoles, profileVersion, 'features');
      }).sort((left, right) => right.match_score - left.match_score);
      if (targetJobId === null) {
        scoredMatches = scoredMatches.filter(isReportableMatch).slice(0, MATCH_EXPLAIN_LIMIT);
        const reportableIds = new Set(scoredMatches.map((match) => match.job_id));
        jobs = jobs.filter((job) => reportableIds.has(job.id));
      }

      if (targetJobId === null && scoredMatches.length === 0) {
        return attachRun({
          matches: [],
          preview_jobs: [],
          teaser: emptyMatchTeaser(),
          resume_profile_version: profileVersion,
          target_job_id: targetJobId,
          candidate_count: retrieved.length,
          excluded_candidate_count: excludedCount,
          feedback_excluded_count: feedbackExcludedCount,
          no_suitable_candidates: true,
          request_id: requestId,
        }, buildMatchRunSummary({
          retrievedCount: retrieved.length,
          suitableCount: 0,
          selectedCount: 0,
          filters: runFilters,
          exclusions: exclusionCounts,
        }));
      }

      if (preview) {
        const teaser = sanitizeMatchTeaser(buildMatchTeaser({
          jobs: scoredMatches.map((match) => ({
            company: match.company,
            title: match.job_title,
            region: match.region,
            direction: match.direction,
          })),
          retrievedCount: retrieved.length,
          suitableCount,
          reportLimit: MATCH_EXPLAIN_LIMIT,
        }));
        return attachRun({
          teaser,
          preview_jobs: [],
          matches: [],
          resume_profile_version: profileVersion,
          target_job_id: targetJobId,
          candidate_count: jobs.length,
          excluded_candidate_count: excludedCount,
          feedback_excluded_count: feedbackExcludedCount,
          request_id: requestId,
        }, buildMatchRunSummary({
          retrievedCount: retrieved.length,
          suitableCount,
          selectedCount: jobs.length,
          filters: runFilters,
          exclusions: exclusionCounts,
          quality: buildMatchQualityMetrics(scoredMatches),
          jobIds: [],
        }));
      }

      emit?.({ type: 'ranked', matches: scoredMatches });
      const selectedCandidateCount = jobs.length;
      const jobsById = new Map(jobs.map((job) => [job.id, job]));
      let explained = scoredMatches;
      const explainJobs = jobs.slice(0, targetJobId === null ? MATCH_EXPLAIN_LIMIT : 1);
      const abortSignal = request.signal;

      if (!refresh) {
        const { data: cached, error: cacheError } = await client
          .from('ai_matches')
          .select('id, resume_id, job_id, match_score, match_reason, suggestions, score_breakdown, evidence, key_gaps, recommendation_type, confidence, eligibility, field_quality, resume_profile_version, created_at')
          .eq('user_id', auth.user.id)
          .eq('resume_id', confirmedResumeId)
          .eq('resume_profile_version', profileVersion)
          .in('job_id', explainJobs.map((job) => job.id));
        if (cacheError) throw new Error(`读取匹配缓存失败: ${cacheError.message}`);
        const cachedByJob = new Map((cached || []).map((row) => [Number(row.job_id), row]));
        explained = scoredMatches.map((match) => {
          const cachedMatch = cachedByJob.get(match.job_id);
          const job = jobsById.get(match.job_id);
          if (!cachedMatch || !job || !cachedMatch.match_reason) return match;
          return enrichMatch(buildScoredMatch(job, matchContext, {
            match_reason: cachedMatch.match_reason,
            evidence: Array.isArray(cachedMatch.evidence) ? cachedMatch.evidence as string[] : [],
            key_gaps: Array.isArray(cachedMatch.key_gaps) ? cachedMatch.key_gaps as string[] : [],
            suggestions: cachedMatch.suggestions,
          }), job, targetRoles, profileVersion, 'model');
        });
      }

      const pendingExplain = explainJobs.filter((job) => explained.find((match) => match.job_id === job.id)?.analysis_source !== 'model');
      let failedBatchCount = 0;
      let batchCount = 0;
      if (pendingExplain.length > 0 && !abortSignal.aborted) {
        emit?.({ type: 'stage', stage: 'explaining', current: 0, total: pendingExplain.length });
        const llmClient = createTextProviderClient({ requestHeaders: request.headers });
        const resumeContent = compactPromptText(
          resume.parsed_content || JSON.stringify(resume.user_info),
          MATCH_RESUME_CONTEXT_MAX_CHARS,
        );
        const profileContext = compactPromptText(
          JSON.stringify({ version: profileVersion, profile: resume.profile, segmentation: resume.segmentation }),
          MATCH_PROFILE_CONTEXT_MAX_CHARS,
        );
        stage = 'model';
        const modelStartedAt = performance.now();
        const jobBatches = chunkJobs(pendingExplain, MATCH_BATCH_SIZE);
        batchCount = jobBatches.length;
        const generatedBatches = await consumeTrackedTextBatch(
          llmClient,
          jobBatches.map((batch, batchIndex) => ({
            messages: [
              { role: 'system' as const, content: `You are a professional career advisor. These jobs are already shortlisted as reachable. Keep explanations in the requested locale. Never tell the student not to consider a listed job. ${untrustedBusinessDataPolicy(locale === 'en' ? 'en' : 'zh')}` },
              { role: 'user' as const, content: buildExplainPrompt(
                resumeContent,
                profileContext,
                batch,
                locale,
                buildMatchExplainContext({ segmentation, jobs: batch, locale }),
                new Map(scoredMatches.map((match) => [match.job_id, match.recommendation_type])),
              ) },
            ],
            options: {
              temperature: 0.2,
              thinking: 'disabled' as const,
              responseFormat: {
                name: 'job_match_explanations',
                schema: AI_MATCH_EXPLANATION_SCHEMA,
              },
            },
            context: {
              userId: auth.user.id,
              feature: 'ai_match',
              resumeId: confirmedResumeId,
              jobId: targetJobId,
              phase: 'explain',
              metadata: {
                retrieval_scope: requestedJobIds.length > 0 ? 'shortlist' : 'full_library',
                retrieval_candidate_count: retrieved.length,
                retrieval_term_count: retrievalTerms.length,
                batch_index: batchIndex,
                batch_count: jobBatches.length,
                job_count: batch.length,
                job_ids: batch.map((job) => job.id),
                locale,
                refresh,
              },
            },
          })),
          MATCH_BATCH_CONCURRENCY,
        );
        console.info('[AI match model complete]', {
          requestId,
          resumeId: confirmedResumeId,
          jobCount: pendingExplain.length,
          batchCount: jobBatches.length,
          durationMs: Math.round(performance.now() - modelStartedAt),
        });

        const explanations = new Map<number, MatchExplanation>();
        for (const [batchIndex, generated] of generatedBatches.entries()) {
          if (!generated.ok) {
            failedBatchCount += 1;
            continue;
          }
          try {
            const parsed = parseMatchExplanations(generated.result.content);
            const batchJobIds = new Set(jobBatches[batchIndex]?.map((job) => job.id) || []);
            for (const item of parsed) {
              if (batchJobIds.has(item.job_id)) explanations.set(item.job_id, item);
            }
          } catch (error) {
            failedBatchCount += 1;
            console.error('Invalid AI match explanation batch:', error);
          }
        }

        explained = explained.map((match) => {
          const explanation = explanations.get(match.job_id);
          const job = jobsById.get(match.job_id);
          if (!explanation || !job) return match;
          const next = enrichMatch(buildScoredMatch(job, matchContext, explanation), job, targetRoles, profileVersion, 'model');
          emit?.({ type: 'explanation', match: next });
          return next;
        });
      }

      explained = [...explained].sort((left, right) => right.match_score - left.match_score);
      stage = 'persistence';
      const { error: insertError } = await client.from('ai_matches').upsert(persistRows(explained, confirmedResumeId, auth.user.id, profileVersion), {
        onConflict: 'user_id,resume_id,job_id,resume_profile_version',
      });
      if (insertError) {
        console.error('保存匹配结果失败:', insertError.message);
      }

      emit?.({ type: 'stage', stage: 'complete' });
      const reportMatches = targetJobId === null ? explained.slice(0, MATCH_EXPLAIN_LIMIT) : explained;
      return attachRun({
        matches: reportMatches,
        resume_profile_version: profileVersion,
        target_job_id: targetJobId,
        candidate_count: selectedCandidateCount,
        excluded_candidate_count: excludedCount,
        feedback_excluded_count: feedbackExcludedCount,
        explained_count: reportMatches.filter((match) => match.analysis_source === 'model').length,
        cached: pendingExplain.length === 0,
        partial: failedBatchCount > 0,
        batch_count: batchCount,
        completed_batch_count: batchCount - failedBatchCount,
        failed_batch_count: failedBatchCount,
        persistence_warning: insertError
          ? locale === 'en'
            ? 'The result was generated but could not be saved to match history.'
            : locale === 'zh-TW'
              ? '本次結果已生成，但暫未保存到匹配歷史。'
              : '本次结果已生成，但暂未保存到匹配历史。'
          : null,
        request_id: requestId,
      }, buildMatchRunSummary({
        retrievedCount: retrieved.length,
        suitableCount,
        selectedCount: reportMatches.length,
        explainedCount: reportMatches.filter((match) => match.analysis_source === 'model').length,
        filters: runFilters,
        exclusions: exclusionCounts,
        quality: buildMatchQualityMetrics(reportMatches),
        jobIds: reportMatches.map((match) => match.job_id),
      }));
    };

    if (!stream) {
      const payload = await run();
      return NextResponse.json(payload);
    }

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      start(controller) {
        const emit = (event: MatchEvent) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };
        void run(emit)
          .catch((error) => {
            console.error('[AI match stream failed]', {
              requestId,
              stage,
              durationMs: Math.round(performance.now() - startedAt),
              error: error instanceof Error ? error.message : String(error),
            });
            emit({
              type: 'error',
              error: error instanceof Error && error.message ? error.message : 'AI匹配失败',
            });
          })
          .finally(() => controller.close());
      },
    });
    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[AI match failed]', {
      requestId,
      stage,
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    });
    const betaResponse = betaEntitlementResponse(error);
    if (betaResponse) return betaResponse;
    const credits = creditResponse(error);
    if (credits) return credits;
    const message = error instanceof Error ? error.message : '';
    if (message.includes('timed out') || message.includes('statement timeout')) {
      return NextResponse.json({ error: 'AI匹配超时，请稍后重试或缩小筛选范围' }, { status: 504 });
    }
    if (message.includes('未配置') || message.includes('配置无效')) {
      return NextResponse.json({ error: message }, { status: 503 });
    }
    return NextResponse.json({ error: 'AI匹配失败' }, { status: 500 });
  }
}

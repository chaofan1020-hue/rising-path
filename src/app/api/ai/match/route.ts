import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { createTextProviderClient } from '@/lib/ai/text-provider';
import { configuredRegionScopeKeys, targetRegionScopeKeys } from '@/lib/job-region-scope';
import { consumeTrackedTextBatch } from '@/lib/ai-usage';
import { betaEntitlementResponse } from '@/lib/beta-entitlements';
import {
  AI_MATCH_RESPONSE_SCHEMA,
  parseModelMatches,
  type Match,
  type ModelMatch,
} from '@/lib/ai-match-contract';
import { creditResponse } from '@/lib/credits';
import { finalizeMatch } from '@/lib/ai-match-scoring';
import type { MatchLocale } from '@/lib/ai-match-scoring';
import { requireConfirmedResume } from '@/lib/resume-access';
import { untrustedBusinessDataBlock, untrustedBusinessDataPolicy } from '@/lib/prompt-safety';
import { applyMatchFeedbackPreferences, roleFit, selectMatchCandidates } from '@/lib/ai-match-candidate-ranking';
import type { MatchFeedbackSignal } from '@/lib/ai-match-candidate-ranking';
import type { CareerStage } from '@/lib/resume-types';

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

// The database retrieval pool is intentionally wider than the AI shortlist.
// Deterministic experience filtering happens before the model call so adding
// more active jobs does not make the prompt grow without bound.
const MATCH_CANDIDATE_LIMIT = 24;
const MATCH_PREVIEW_LIMIT = 24;
const MATCH_BATCH_SIZE = 6;
const MATCH_BATCH_CONCURRENCY = 2;
// Keep the database pool broad enough for deterministic diversity selection,
// but bounded so preview requests stay below the hosted statement timeout.
const MATCH_RETRIEVAL_LIMIT = 240;
// Only the highest-signal roles, skills and technical terms should drive
// lexical retrieval. The database can rank a wider pool, while the route
// keeps the AI prompt bounded to the best suitable roles.
const MATCH_RETRIEVAL_TERM_LIMIT = 8;
const MATCH_RESUME_CONTEXT_MAX_CHARS = 7_000;
const MATCH_PROFILE_CONTEXT_MAX_CHARS = 2_500;
const MATCH_JOB_DESCRIPTION_MAX_CHARS = 1_200;
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
};

const JOB_MATCH_FIELDS = 'id, title, company, region, direction, audience, job_type, employment_category, description, requirements, salary_range, sponsorship, valid_through, deadline_source, salary_source, location_source, experience_min_years, experience_max_years, experience_text, workplace_type, field_evidence, job_url, created_at';
const JOB_MATCH_METADATA_FIELDS = 'id, title, company, region, direction, audience, job_type, employment_category, salary_range, sponsorship, valid_through, deadline_source, salary_source, location_source, experience_min_years, experience_max_years, experience_text, workplace_type, field_evidence, job_url, created_at';

function textTerms(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/[^\p{L}\p{N}+#./-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && term.length <= 48);
}

function collectResumeTerms(resume: Record<string, unknown>): string[] {
  const profile = resume.profile && typeof resume.profile === 'object'
    ? resume.profile as Record<string, unknown>
    : {};
  const intention = profile.intention && typeof profile.intention === 'object'
    ? profile.intention as Record<string, unknown>
    : {};
  const skills = Array.isArray(profile.skills) ? profile.skills : [];
  const roles = Array.isArray(intention.roles) ? intention.roles : [];
  const experiences = [...(Array.isArray(profile.internships) ? profile.internships : []), ...(Array.isArray(profile.workExperience) ? profile.workExperience : [])];
  const projects = Array.isArray(profile.projects) ? profile.projects : [];
  const sources = [
    ...roles,
    ...skills,
    ...projects.flatMap((item) => item && typeof item === 'object'
      ? [(item as Record<string, unknown>).techStack, (item as Record<string, unknown>).name]
      : []),
    ...experiences.flatMap((item) => item && typeof item === 'object'
      ? [(item as Record<string, unknown>).role]
      : []),
  ];
  const terms = sources.flatMap((source) => Array.isArray(source) ? source.flatMap(textTerms) : textTerms(String(source || '')));
  return [...new Set(terms)].slice(0, 60);
}

// Generic profile labels and years create enormous full-text result sets but
// add little signal to job retrieval. Keep specific technologies and role
// names so the database query remains selective under the hosted timeout.
const BROAD_RETRIEVAL_TERMS = new Set([
  'ai', 'data', 'program', 'programming', 'technology', 'tech', 'development',
  'developer', 'engineering', 'engineer', 'software', 'computer', 'science',
  '工作', '开发', '技术', '数据', '项目', '经验',
]);

function retrievalTermsForDatabase(terms: string[]): string[] {
  const specific = terms.filter((term) => {
    const normalized = term.trim().toLowerCase();
    return !/^\d{4}$/.test(normalized) && !BROAD_RETRIEVAL_TERMS.has(normalized);
  });
  return (specific.length > 0 ? specific : terms.filter((term) => !/^\d{4}$/.test(term.trim()))).slice(0, MATCH_RETRIEVAL_TERM_LIMIT);
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
    // Feedback is an enhancement. A missing migration or a transient read
    // failure must never block the core matching request.
    console.warn('[AI match feedback] preference read skipped:', error);
    return [];
  }
}

function chunkJobs<T>(jobs: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < jobs.length; index += size) chunks.push(jobs.slice(index, index + size));
  return chunks;
}

function buildMatchPrompt(
  resumeContent: string,
  profileContext: string,
  jobs: CandidateJob[],
  targetRoles: string[],
  locale: MatchLocale,
): string {
  const jobsList = jobs.map((job) => ({
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.region,
    audience: job.audience || null,
    job_type: job.job_type || null,
    employment_category: job.employment_category || null,
    salary_range: job.salary_range || null,
    sponsorship: job.sponsorship || 'unknown',
    experience: {
      min_years: job.experience_min_years ?? null,
      max_years: job.experience_max_years ?? null,
      text: job.experience_text || null,
    },
    deadline: job.valid_through || null,
    field_evidence: job.field_evidence || {},
    role_fit: roleFit(job, targetRoles),
    description: compactPromptText(job.description, MATCH_JOB_DESCRIPTION_MAX_CHARS),
    requirements: compactPromptText(job.requirements, MATCH_JOB_REQUIREMENTS_MAX_CHARS),
  }));

  return `You are a professional career advisor. Analyze the resume and job list and score every job from 0 to 100. ${languageInstruction(locale)}

Do not treat missing, pending, or rejected field evidence as a confirmed fact. Do not invent salary, deadline, sponsorship, location, or experience requirements. Return evidence-based reasons and suggestions only.

${untrustedBusinessDataPolicy(locale === 'en' ? 'en' : 'zh')}

${untrustedBusinessDataBlock('resume_content', resumeContent)}

${untrustedBusinessDataBlock('confirmed_candidate_profile', profileContext)}

${untrustedBusinessDataBlock('job_list', jobsList)}

Return strict JSON using {"matches":[...]} format. Include every listed job exactly once. Do not add fields. The server will calculate the final score with fixed weights; use score_breakdown for semantic assessments. Format:
{
  "matches": [
    {
      "job_id": 1,
      "match_score": 0,
      "score_breakdown": {
        "ats": 0,
        "keywords": 0,
        "experience": 0,
        "evidence": 0,
        "region": 0,
        "profile_fit": 0
      },
      "match_reason": "brief evidence-based reason",
      "evidence": ["up to 2 concrete resume/job facts"],
      "key_gaps": ["up to 2 important gaps"],
      "suggestions": "brief next action"
    }
  ]
}

Only return the JSON object.`;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();

    const jobId = positiveInteger(request.nextUrl.searchParams.get('jobId'));
    const resumeId = positiveInteger(request.nextUrl.searchParams.get('resumeId'));
    if (jobId === null || resumeId === null) {
      return NextResponse.json({ error: '岗位 ID 和简历 ID 必须有效' }, { status: 400 });
    }

    const resumeAccess = await requireConfirmedResume(auth.client, resumeId, auth.user.id);
    if (!resumeAccess.ok) {
      return NextResponse.json({ error: resumeAccess.error }, { status: resumeAccess.status });
    }

    const profileVersion = Number(resumeAccess.resume.profile_version);
    const { data, error } = await auth.client
      .from('ai_matches')
      .select('id, resume_id, job_id, match_score, match_reason, suggestions, score_breakdown, evidence, key_gaps, recommendation_type, confidence, eligibility, field_quality, resume_profile_version, created_at')
      .eq('user_id', auth.user.id)
      .eq('resume_id', resumeId)
      .eq('job_id', jobId)
      .eq('resume_profile_version', profileVersion)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`读取岗位评分失败: ${error.message}`);

    return NextResponse.json({
      match: data || null,
      resume_profile_version: profileVersion,
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
    const targetJobId = positiveInteger(body?.jobId);
    const locale = requestLocale(body?.locale || request.headers.get('accept-language')?.split(',')[0]?.trim());
    const refresh = body?.refresh === true;
    const preview = body?.preview === true;
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

    const terms = collectResumeTerms(resume);
    const retrievalTerms = retrievalTermsForDatabase(terms);
    let retrieved: CandidateJob[];
    if (targetJobId !== null) {
      stage = 'target_job';
      const { data, error } = await client
        .from('jobs')
        .select(JOB_MATCH_FIELDS)
        .eq('id', targetJobId)
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw new Error(`查询岗位失败: ${error.message}`);
      retrieved = data ? [{ ...data, lexical_score: null } as CandidateJob] : [];
    } else {
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
        // A broad or malformed profile term must not make the whole preview
        // unavailable. Fall back to the indexed geographic pool, which is
        // bounded and still gives the deterministic suitability ranker useful
        // candidates while the full-text path is investigated.
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
    if (!retrieved || retrieved.length === 0) {
      return NextResponse.json({
        matches: [],
        resume_profile_version: profileVersion,
        target_job_id: targetJobId,
        candidate_count: 0,
      });
    }

    const profile = resume.profile && typeof resume.profile === 'object' ? resume.profile as Record<string, unknown> : {};
    const intention = profile.intention && typeof profile.intention === 'object' ? profile.intention as Record<string, unknown> : {};
    const targetRoles = Array.isArray(intention.roles)
      ? intention.roles.filter((item): item is string => typeof item === 'string')
      : [];
    const experiences = [...(Array.isArray(profile.internships) ? profile.internships : []), ...(Array.isArray(profile.workExperience) ? profile.workExperience : [])];
    const experienceYears = experiences.reduce((months, item) => months + (item && typeof item === 'object' ? Number((item as Record<string, unknown>).months) || 0 : 0), 0) / 12;
    const segmentation = resume.segmentation && typeof resume.segmentation === 'object' ? resume.segmentation as Record<string, unknown> : {};
    const candidateProfile = {
      experienceYears,
      careerStage: typeof segmentation.careerStage === 'string' ? segmentation.careerStage as CareerStage : null,
      targetRoles,
    };

    let jobs = retrieved;
    let feedbackExcludedCount = 0;
    if (targetJobId === null && jobs.length > 0) {
      const { data: hydrated, error: hydrationError } = await client
        .from('jobs')
        .select(JOB_MATCH_METADATA_FIELDS)
        .in('id', jobs.map((job) => job.id));
      if (hydrationError) throw new Error(`读取岗位字段失败: ${hydrationError.message}`);
      const byId = new Map((hydrated || []).map((job) => [Number(job.id), job as CandidateJob]));
      for (let index = 0; index < jobs.length; index += 1) {
        jobs[index] = { ...jobs[index], ...(byId.get(jobs[index].id) || {}) };
      }
      const feedbackSignals = await loadMatchFeedbackSignals(client, auth.user.id, confirmedResumeId, profileVersion);
      const feedbackPreferences = applyMatchFeedbackPreferences(jobs, feedbackSignals);
      jobs = feedbackPreferences.jobs;
      feedbackExcludedCount = feedbackPreferences.excludedCount;
      if (jobs.length === 0) {
        return NextResponse.json({
          matches: [],
          preview_jobs: [],
          resume_profile_version: profileVersion,
          target_job_id: targetJobId,
          candidate_count: retrieved.length,
          excluded_candidate_count: 0,
          feedback_excluded_count: feedbackExcludedCount,
          no_suitable_candidates: true,
          request_id: requestId,
        });
      }
      const candidateSelection = selectMatchCandidates(jobs, candidateProfile, preview ? MATCH_PREVIEW_LIMIT : MATCH_CANDIDATE_LIMIT);
      jobs = candidateSelection.jobs;
      if (jobs.length === 0) {
        return NextResponse.json({
          matches: [],
          preview_jobs: [],
          resume_profile_version: profileVersion,
          target_job_id: targetJobId,
          candidate_count: retrieved.length,
          excluded_candidate_count: candidateSelection.excludedCount,
          feedback_excluded_count: feedbackExcludedCount,
          no_suitable_candidates: true,
          request_id: requestId,
        });
      }
    } else {
      jobs = jobs.slice(0, targetJobId === null ? MATCH_CANDIDATE_LIMIT : 1);
    }

    if (!preview && targetJobId === null && jobs.length > 0) {
      const { data: detailed, error: detailError } = await client
        .from('jobs')
        .select(JOB_MATCH_FIELDS)
        .in('id', jobs.map((job) => job.id));
      if (detailError) throw new Error(`读取入选岗位详情失败: ${detailError.message}`);
      const byId = new Map((detailed || []).map((job) => [Number(job.id), job as CandidateJob]));
      jobs = jobs.map((job) => ({ ...job, ...(byId.get(job.id) || {}) }));
    }

    if (preview) {
      return NextResponse.json({
        preview_jobs: jobs.map((job) => ({
          job_id: job.id,
          job_title: job.title,
          company: job.company,
          region: job.region,
          direction: job.direction,
          role_fit: roleFit(job, targetRoles),
          job_url: job.job_url || null,
          salary_range: job.salary_range || null,
          sponsorship: job.sponsorship || 'unknown',
          workplace_type: job.workplace_type || null,
          experience_min_years: job.experience_min_years ?? null,
          experience_max_years: job.experience_max_years ?? null,
          experience_text: job.experience_text || null,
          valid_through: job.valid_through || null,
        })),
        resume_profile_version: profileVersion,
        target_job_id: targetJobId,
        candidate_count: jobs.length,
        feedback_excluded_count: feedbackExcludedCount,
        request_id: requestId,
      });
    }

    const selectedCandidateCount = jobs.length;
    let cachedMatchesForResponse: EnrichedMatch[] = [];
    if (!refresh) {
      const { data: cached, error: cacheError } = await client
        .from('ai_matches')
        .select('id, resume_id, job_id, match_score, match_reason, suggestions, score_breakdown, evidence, key_gaps, recommendation_type, confidence, eligibility, field_quality, resume_profile_version, created_at')
        .eq('user_id', auth.user.id)
        .eq('resume_id', confirmedResumeId)
        .eq('resume_profile_version', profileVersion)
        .in('job_id', jobs.map((job) => job.id));
      if (cacheError) throw new Error(`读取匹配缓存失败: ${cacheError.message}`);
      const completeCached = (cached || []).filter((match) => (
        typeof match.recommendation_type === 'string'
        && typeof match.confidence === 'number'
        && match.eligibility && typeof match.eligibility === 'object'
        && match.field_quality && typeof match.field_quality === 'object'
      ));
      const cachedByJob = new Map(completeCached.map((match) => [Number(match.job_id), match]));
      cachedMatchesForResponse = jobs
          .map((job) => {
            const cachedMatch = cachedByJob.get(job.id);
            return cachedMatch ? {
              ...cachedMatch,
              job_title: job.title,
              company: job.company,
              role_fit: roleFit(job, targetRoles),
              region: job.region,
              direction: job.direction,
              job_url: job.job_url || null,
              salary_range: job.salary_range || null,
              sponsorship: job.sponsorship || 'unknown',
              workplace_type: job.workplace_type || null,
              valid_through: job.valid_through || null,
            } as EnrichedMatch : null;
          })
          .filter((match): match is EnrichedMatch => match !== null);
      if (cachedMatchesForResponse.length === jobs.length) {
        cachedMatchesForResponse.sort((a, b) => b.match_score - a.match_score);
        return NextResponse.json({
          matches: cachedMatchesForResponse,
          resume_profile_version: profileVersion,
          target_job_id: targetJobId,
          candidate_count: selectedCandidateCount,
          cached: true,
          request_id: requestId,
        });
      }
      const cachedJobIds = new Set(cachedMatchesForResponse.map((match) => match.job_id));
      jobs = jobs.filter((job) => !cachedJobIds.has(job.id));
    }

    // AI matching runs in bounded batches. The reservation is shared across
    // child model calls, while each child remains independently observable.
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
    const jobBatches = chunkJobs(jobs, MATCH_BATCH_SIZE);
    const generatedBatches = await consumeTrackedTextBatch(
      llmClient,
      jobBatches.map((batch, batchIndex) => ({
        messages: [
          { role: 'system' as const, content: `You are a professional career advisor. Keep all explanations in the requested locale. ${untrustedBusinessDataPolicy(locale === 'en' ? 'en' : 'zh')}` },
          { role: 'user' as const, content: buildMatchPrompt(resumeContent, profileContext, batch, targetRoles, locale) },
        ],
        options: {
          temperature: 0.2,
          thinking: 'disabled' as const,
          responseFormat: {
            name: 'job_match_results',
            schema: AI_MATCH_RESPONSE_SCHEMA,
          },
        },
        context: {
          userId: auth.user.id,
          feature: 'ai_match',
          resumeId: confirmedResumeId,
          jobId: targetJobId,
          phase: 'batch',
          metadata: {
            retrieval_scope: 'full_library',
            retrieval_candidate_count: retrieved.length,
            retrieval_term_count: Math.min(terms.length, MATCH_RETRIEVAL_TERM_LIMIT),
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
      jobCount: jobs.length,
      batchCount: jobBatches.length,
      durationMs: Math.round(performance.now() - modelStartedAt),
    });
    const validMatches: ModelMatch[] = [];
    const returnedJobIds = new Set<number>();
    let failedBatchCount = 0;
    let firstBatchError: unknown = null;
    for (const [batchIndex, generated] of generatedBatches.entries()) {
      if (!generated.ok) {
        failedBatchCount += 1;
        firstBatchError ||= generated.error;
        continue;
      }
      try {
        const matches = parseModelMatches(generated.result.content);
        const batchJobIds = new Set(jobBatches[batchIndex]?.map((job) => job.id) || []);
        const batchReturnedIds = new Set<number>();
        for (const match of matches) {
          if (batchJobIds.has(match.job_id) && !returnedJobIds.has(match.job_id)) {
            returnedJobIds.add(match.job_id);
            batchReturnedIds.add(match.job_id);
            validMatches.push(match);
          }
        }
        if (batchReturnedIds.size !== batchJobIds.size) failedBatchCount += 1;
      } catch (error) {
        failedBatchCount += 1;
        firstBatchError ||= error;
        console.error('Invalid AI match batch response:', error);
      }
    }
    if (validMatches.length === 0) {
      console.error('All AI match batches failed:', firstBatchError);
      return NextResponse.json({ error: 'AI未返回可用的岗位结果，请重试' }, { status: 502 });
    }
    const isPartial = validMatches.length !== jobs.length || failedBatchCount > 0;
    if (isPartial) {
      console.warn('AI match returned a partial result set', {
        expected: jobs.length,
        returned: validMatches.length,
        failedBatches: failedBatchCount,
      });
    }

    // Add job details to matches
    const enrichedMatches: EnrichedMatch[] = validMatches.map((match) => {
      const job = jobs.find((j) => j.id === match.job_id);
      const finalized = finalizeMatch(match, job || { region: null }, {
        profile: (resume.profile || null) as import('@/lib/resume-types').ResumeProfile | null,
        segmentation: (resume.segmentation || null) as Record<string, unknown> | null,
        locale,
      });
      return {
        ...finalized,
        job_title: job?.title || '未知岗位',
        company: job?.company || '未知公司',
        role_fit: roleFit(job || { id: match.job_id, title: '', company: null, direction: null }, targetRoles),
        region: job?.region || null,
        direction: job?.direction || null,
        job_url: job?.job_url || null,
        salary_range: job?.salary_range || null,
        sponsorship: job?.sponsorship || 'unknown',
        workplace_type: job?.workplace_type || null,
        valid_through: job?.valid_through || null,
        resume_profile_version: profileVersion,
      };
    });

    // Sort by score
    const allMatches = [...cachedMatchesForResponse, ...enrichedMatches]
      .sort((a, b) => b.match_score - a.match_score);

    // Save matches to database
    stage = 'persistence';
    const { error: insertError } = await client.from('ai_matches').upsert(enrichedMatches.map((match) => ({
        resume_id: confirmedResumeId,
        job_id: match.job_id,
        match_score: match.match_score,
        match_reason: match.match_reason,
        suggestions: match.suggestions,
        user_id: auth.user.id,
        resume_profile_version: profileVersion,
        score_breakdown: match.score_breakdown,
        evidence: match.evidence,
        key_gaps: match.key_gaps,
        recommendation_type: match.recommendation_type,
        confidence: match.confidence,
        eligibility: match.eligibility,
        field_quality: match.field_quality,
      })), {
        onConflict: 'user_id,resume_id,job_id,resume_profile_version',
      });
    if (insertError) {
      // The recommendation is already complete. A history-write failure must
      // not discard a successful and billable AI result for the user.
      console.error('保存匹配结果失败:', insertError.message);
    }

    return NextResponse.json({
      matches: allMatches,
      resume_profile_version: profileVersion,
      target_job_id: targetJobId,
      candidate_count: selectedCandidateCount,
      feedback_excluded_count: feedbackExcludedCount,
      partial: allMatches.length !== selectedCandidateCount || isPartial,
      batch_count: jobBatches.length,
      completed_batch_count: jobBatches.length - failedBatchCount,
      failed_batch_count: failedBatchCount,
      persistence_warning: insertError
        ? locale === 'en'
          ? 'The result was generated but could not be saved to match history.'
          : locale === 'zh-TW'
            ? '本次結果已生成，但暫未保存到匹配歷史。'
            : '本次结果已生成，但暂未保存到匹配历史。'
        : null,
      request_id: requestId,
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
    return NextResponse.json(
      { error: 'AI匹配失败' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { createTextProviderClient } from '@/lib/ai/text-provider';
import { configuredRegionScopeKeys, targetRegionScopeKeys } from '@/lib/job-region-scope';
import { consumeTrackedTextStream } from '@/lib/ai-usage';
import {
  AI_MATCH_RESPONSE_SCHEMA,
  parseModelMatches,
  type Match,
} from '@/lib/ai-match-contract';
import { requireConfirmedResume } from '@/lib/resume-access';
import { untrustedBusinessDataBlock, untrustedBusinessDataPolicy } from '@/lib/prompt-safety';

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

// Five detailed recommendations give the user a useful shortlist while
// keeping the model prompt bounded. Retrieval still scans the full active
// library and ranks up to 80 candidates before this precision pass.
const MATCH_CANDIDATE_LIMIT = 5;
const MATCH_RETRIEVAL_LIMIT = 80;
// Only the highest-signal skills, target roles and technical terms should
// drive lexical retrieval. Broad profile text can match thousands of jobs and
// make PostgreSQL rank a large result set before returning the top 80.
const MATCH_RETRIEVAL_TERM_LIMIT = 8;
const MATCH_RESUME_CONTEXT_MAX_CHARS = 7_000;
const MATCH_PROFILE_CONTEXT_MAX_CHARS = 2_500;
const MATCH_JOB_DESCRIPTION_MAX_CHARS = 1_200;
const MATCH_JOB_REQUIREMENTS_MAX_CHARS = 600;

type CandidateJob = {
  id: number;
  title: string;
  company: string;
  region: string;
  direction: string;
  description: string | null;
  requirements: string | null;
  lexical_score: number | null;
  created_at: string;
};

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
    ...skills,
    ...roles,
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
      .select('id, resume_id, job_id, match_score, match_reason, suggestions, score_breakdown, evidence, key_gaps, resume_profile_version, created_at')
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
    const retrievalTerms = terms.slice(0, MATCH_RETRIEVAL_TERM_LIMIT);
    let retrieved: CandidateJob[];
    if (targetJobId !== null) {
      stage = 'target_job';
      const { data, error } = await client
        .from('jobs')
        .select('id, title, company, region, direction, description, requirements, created_at')
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
        throw new Error(`查询岗位失败: ${error.message}`);
      }
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
    const jobs = retrieved.slice(0, targetJobId === null ? MATCH_CANDIDATE_LIMIT : 1);

    if (!jobs || jobs.length === 0) {
      return NextResponse.json({
        matches: [],
        resume_profile_version: profileVersion,
        target_job_id: targetJobId,
      });
    }

    // AI matching
    const llmClient = createTextProviderClient({ requestHeaders: request.headers });
    
    const resumeContent = compactPromptText(
      resume.parsed_content || JSON.stringify(resume.user_info),
      MATCH_RESUME_CONTEXT_MAX_CHARS,
    );
    const profileContext = compactPromptText(
      JSON.stringify({ version: profileVersion, profile: resume.profile, segmentation: resume.segmentation }),
      MATCH_PROFILE_CONTEXT_MAX_CHARS,
    );
    const jobsList = jobs.map((j) => ({
      id: j.id,
      title: j.title,
      company: j.company,
      description: compactPromptText(j.description, MATCH_JOB_DESCRIPTION_MAX_CHARS),
      requirements: compactPromptText(j.requirements, MATCH_JOB_REQUIREMENTS_MAX_CHARS),
    }));

    const prompt = `你是一个专业的职业顾问。请分析给定简历和岗位列表，为每个岗位计算匹配分数（0-100），并说明匹配原因和优化建议。

${untrustedBusinessDataPolicy('zh')}

${untrustedBusinessDataBlock('resume_content', resumeContent)}

${untrustedBusinessDataBlock('confirmed_candidate_profile', profileContext)}

${untrustedBusinessDataBlock('job_list', jobsList)}

请严格返回 JSON。使用 {"matches":[...]} 格式。每个岗位一个结果，不能遗漏、重复或新增岗位。不得返回任何未列出的字段，例如 match_score_note。格式如下：
{
  "matches": [
    {
      "job_id": 岗位ID,
      "match_score": 匹配分数(0-100),
      "score_breakdown": {
        "ats": 0,
        "keywords": 0,
        "experience": 0,
        "evidence": 0,
        "region": 0,
        "profile_fit": 0
      },
      "match_reason": "不超过180字的匹配原因",
      "evidence": ["最多2条具体证据"],
      "key_gaps": ["最多2条关键差距"],
      "suggestions": "不超过180字的下一步建议"
    }
  ]
}

只返回 JSON 对象，不要其他说明文字。`;

    stage = 'model';
    const modelStartedAt = performance.now();
    const generated = await consumeTrackedTextStream(llmClient, [
      { role: 'system', content: `你是一个专业的职业顾问，擅长分析简历与岗位的匹配度。${untrustedBusinessDataPolicy('zh')}` },
      { role: 'user', content: prompt },
    ], {
      temperature: 0.2,
      thinking: 'disabled',
      responseFormat: {
        name: 'job_match_results',
        schema: AI_MATCH_RESPONSE_SCHEMA,
      },
    }, {
      userId: auth.user.id,
      feature: 'ai_match',
      resumeId: confirmedResumeId,
      jobId: targetJobId,
      metadata: {
        retrieval_scope: 'full_library',
        retrieval_candidate_count: retrieved.length,
        retrieval_term_count: Math.min(terms.length, MATCH_RETRIEVAL_TERM_LIMIT),
        job_count: jobs.length,
        job_ids: jobs.map((job) => job.id),
      },
    }, () => undefined);
    console.info('[AI match model complete]', {
      requestId,
      resumeId: confirmedResumeId,
      jobCount: jobs.length,
      durationMs: Math.round(performance.now() - modelStartedAt),
    });
    const result = generated.content;

    let matches: Match[];
    try {
      matches = parseModelMatches(result);
    } catch (error) {
      console.error('Invalid AI match response:', error);
      return NextResponse.json(
        { error: 'AI返回的匹配结果格式无效，请重试' },
        { status: 502 },
      );
    }

    const expectedJobIds = new Set(jobs.map((job) => job.id));
    const returnedJobIds = new Set<number>();
    const validMatches = matches.filter((match) => {
      if (!expectedJobIds.has(match.job_id) || returnedJobIds.has(match.job_id)) return false;
      returnedJobIds.add(match.job_id);
      return true;
    });
    if (validMatches.length === 0) {
      return NextResponse.json({ error: 'AI未返回可用的岗位结果，请重试' }, { status: 502 });
    }
    const isPartial = validMatches.length !== jobs.length;
    if (isPartial) {
      console.warn('AI match returned a partial result set', {
        expected: jobs.length,
        returned: validMatches.length,
      });
    }

    // Add job details to matches
    const enrichedMatches = validMatches.map((match) => {
      const job = jobs.find((j) => j.id === match.job_id);
      return {
        ...match,
        job_title: job?.title || '未知岗位',
        company: job?.company || '未知公司',
        resume_profile_version: profileVersion,
      };
    });

    // Sort by score
    enrichedMatches.sort((a: { match_score: number }, b: { match_score: number }) => b.match_score - a.match_score);

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
      })), {
        onConflict: 'user_id,resume_id,job_id,resume_profile_version',
      });
    if (insertError) {
      // The recommendation is already complete. A history-write failure must
      // not discard a successful and billable AI result for the user.
      console.error('保存匹配结果失败:', insertError.message);
    }

    return NextResponse.json({
      matches: enrichedMatches,
      resume_profile_version: profileVersion,
      target_job_id: targetJobId,
      candidate_count: jobs.length,
      partial: isPartial,
      persistence_warning: insertError ? '本次结果已生成，但暂未保存到匹配历史。' : null,
      request_id: requestId,
    });
  } catch (error) {
    console.error('[AI match failed]', {
      requestId,
      stage,
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    });
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

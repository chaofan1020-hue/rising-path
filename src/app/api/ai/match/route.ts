import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { createTextProviderClient } from '@/lib/ai/text-provider';
import {
  AI_MATCH_RESPONSE_SCHEMA,
  parseModelMatches,
  validateMatchSet,
  type Match,
} from '@/lib/ai-match-contract';
import { requireConfirmedResume } from '@/lib/resume-access';

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

    const resumeAccess = await requireConfirmedResume(client, resumeId, auth.user.id);
    if (!resumeAccess.ok) {
      return NextResponse.json({ error: resumeAccess.error }, { status: resumeAccess.status });
    }
    const resume = resumeAccess.resume;
    const confirmedResumeId = resume.id;
    const profileVersion = Number(resume.profile_version);

    // Build jobs query with filters
    let jobsQuery = client.from('jobs').select('*');
    
    // Apply region filter
    if (regions && regions.length > 0) {
      jobsQuery = jobsQuery.in('region', regions);
    }
    
    // Apply direction filter
    if (directions && directions.length > 0) {
      jobsQuery = jobsQuery.in('direction', directions);
    }
    if (targetJobId !== null) {
      jobsQuery = jobsQuery.eq('id', targetJobId);
    }
    
    const { data: jobs, error: jobsError } = await jobsQuery.limit(20);

    if (jobsError) {
      throw new Error(`查询岗位失败: ${jobsError.message}`);
    }

    if (!jobs || jobs.length === 0) {
      return NextResponse.json({
        matches: [],
        resume_profile_version: profileVersion,
        target_job_id: targetJobId,
      });
    }

    // AI matching
    const llmClient = createTextProviderClient({ requestHeaders: request.headers });
    
    const resumeContent = resume.parsed_content || JSON.stringify(resume.user_info);
    const jobsList = jobs.map((j: { id: number; title: string; company: string; description: string; requirements: string }) => ({
      id: j.id,
      title: j.title,
      company: j.company,
      description: j.description,
      requirements: j.requirements,
    }));

    const prompt = `你是一个专业的职业顾问。请分析以下简历和岗位列表，为每个岗位计算匹配分数（0-100），并说明匹配原因和优化建议。

简历内容：
${resumeContent}

已确认求职画像（版本 ${profileVersion}）：
${JSON.stringify({ profile: resume.profile, segmentation: resume.segmentation }, null, 2)}

岗位列表：
${JSON.stringify(jobsList, null, 2)}

请严格返回 JSON。通常使用数组格式；如果系统要求对象格式，则使用 {"matches":[...]}。每个岗位一个结果，不能遗漏、重复或新增岗位。格式如下：
[
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
    "match_reason": "匹配原因分析",
    "evidence": ["简历或岗位要求中的证据"],
    "key_gaps": ["最关键的差距"],
    "suggestions": "简历优化建议"
  }
]

只返回JSON数组，不要其他说明文字。`;

    const stream = llmClient.stream([
      { role: 'system', content: '你是一个专业的职业顾问，擅长分析简历与岗位的匹配度。' },
      { role: 'user', content: prompt },
    ], {
      temperature: 0.7,
      responseFormat: {
        name: 'job_match_results',
        schema: AI_MATCH_RESPONSE_SCHEMA,
      },
    });

    let result = '';
    for await (const chunk of stream) {
      if (chunk.content) {
        result += chunk.content.toString();
      }
    }

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

    try {
      validateMatchSet(matches, jobs.map((job: { id: number }) => job.id));
    } catch (error) {
      console.error('Invalid AI match job set:', error);
      return NextResponse.json(
        { error: 'AI返回的岗位结果不完整，请重试' },
        { status: 502 },
      );
    }

    // Add job details to matches
    const enrichedMatches = matches.map((match) => {
      const job = jobs.find((j: { id: number }) => j.id === match.job_id);
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
    const { error: insertError } = await client.from('ai_matches').insert(enrichedMatches.map((match) => ({
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
      })));
    if (insertError) {
      throw new Error(`保存匹配结果失败: ${insertError.message}`);
    }

    return NextResponse.json({
      matches: enrichedMatches,
      resume_profile_version: profileVersion,
      target_job_id: targetJobId,
    });
  } catch (error) {
    console.error('AI match error:', error);
    return NextResponse.json(
      { error: 'AI匹配失败' },
      { status: 500 }
    );
  }
}

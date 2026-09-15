import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';

const FEEDBACK_VALUES = new Set(['interested', 'not_interested', 'inaccurate']);

function positiveInteger(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function requestLocale(value: unknown): 'zh-CN' | 'zh-TW' | 'en' {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  if (normalized === 'zh-tw' || normalized === 'zh-hant') return 'zh-TW';
  return 'zh-CN';
}

function isSupportedLocale(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'en' || normalized.startsWith('en-') || normalized === 'zh-cn' || normalized === 'zh-hans' || normalized === 'zh-tw' || normalized === 'zh-hant';
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();

    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
    }
    const payload = body as Record<string, unknown>;
    const resumeId = positiveInteger(payload.resumeId ?? payload.resume_id);
    const jobId = positiveInteger(payload.jobId ?? payload.job_id);
    const feedback = typeof payload.feedback === 'string' ? payload.feedback : '';
    if (!resumeId || !jobId || !FEEDBACK_VALUES.has(feedback)) {
      return NextResponse.json({ error: '反馈参数无效' }, { status: 400 });
    }

    const { data: resume, error: resumeError } = await auth.client
      .from('resumes')
      .select('id, profile_version')
      .eq('id', resumeId)
      .eq('user_id', auth.user.id)
      .maybeSingle();
    if (resumeError) throw new Error(`验证简历归属失败: ${resumeError.message}`);
    if (!resume) return NextResponse.json({ error: '简历不存在或无权使用' }, { status: 404 });

    const { data: job, error: jobError } = await auth.client
      .from('jobs')
      .select('id')
      .eq('id', jobId)
      .maybeSingle();
    if (jobError) throw new Error(`验证岗位失败: ${jobError.message}`);
    if (!job) return NextResponse.json({ error: '岗位不存在' }, { status: 404 });

    const profileVersion = positiveInteger(resume.profile_version);
    if (!profileVersion) {
      return NextResponse.json({ error: '简历画像版本尚未准备好' }, { status: 409 });
    }
    const locale = requestLocale(payload.locale);
    if (payload.locale !== undefined && !isSupportedLocale(payload.locale)) {
      return NextResponse.json({ error: '语言参数无效' }, { status: 400 });
    }

    const { data, error } = await auth.client
      .from('ai_match_feedback')
      .upsert({
        user_id: auth.user.id,
        resume_id: resumeId,
        job_id: jobId,
        resume_profile_version: profileVersion,
        feedback,
        locale,
      }, { onConflict: 'user_id,resume_id,job_id,resume_profile_version' })
      .select('id, resume_id, job_id, resume_profile_version, feedback, locale, created_at')
      .single();
    if (error || !data) throw new Error(`保存匹配反馈失败: ${error?.message || '未返回反馈记录'}`);

    return NextResponse.json({ feedback: data });
  } catch (error) {
    console.error('[AI match feedback] failed:', error);
    return NextResponse.json({ error: '保存反馈失败' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const resumeId = positiveInteger(request.nextUrl.searchParams.get('resumeId'));
    if (!resumeId) return NextResponse.json({ error: '简历 ID 无效' }, { status: 400 });

    const { data: resume, error: resumeError } = await auth.client
      .from('resumes')
      .select('id, profile_version')
      .eq('id', resumeId)
      .eq('user_id', auth.user.id)
      .maybeSingle();
    if (resumeError) throw new Error(`验证简历归属失败: ${resumeError.message}`);
    if (!resume) return NextResponse.json({ error: '简历不存在或无权使用' }, { status: 404 });
    const profileVersion = positiveInteger(resume.profile_version);
    if (!profileVersion) return NextResponse.json({ feedback: [] });

    const { data, error } = await auth.client
      .from('ai_match_feedback')
      .select('job_id, feedback, locale, created_at')
      .eq('user_id', auth.user.id)
      .eq('resume_id', resumeId)
      .eq('resume_profile_version', profileVersion)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`读取匹配反馈失败: ${error.message}`);
    return NextResponse.json({ feedback: data || [], resume_profile_version: profileVersion });
  } catch (error) {
    console.error('[AI match feedback] read failed:', error);
    return NextResponse.json({ error: '读取反馈失败' }, { status: 500 });
  }
}

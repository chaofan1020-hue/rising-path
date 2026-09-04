import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { betaEntitlementResponse } from '@/lib/beta-entitlements';

function serializeJob(row: Record<string, unknown> | null) {
  if (!row) return null;
  return {
    id: Number(row.id),
    resumeId: Number(row.resume_id),
    status: row.status,
    error: row.last_error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const requestedId = Number(request.nextUrl.searchParams.get('jobId'));
    let query = auth.client
      .from('application_profile_jobs')
      .select('id, resume_id, status, last_error, created_at, updated_at, completed_at')
      .eq('user_id', auth.user.id);
    if (Number.isInteger(requestedId) && requestedId > 0) {
      query = query.eq('id', requestedId);
    } else {
      query = query.order('created_at', { ascending: false }).limit(1);
    }
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(`读取 AI 档案任务失败: ${error.message}`);
    return NextResponse.json({ job: serializeJob(data as Record<string, unknown> | null) });
  } catch (error) {
    console.error('Error reading application profile AI job:', error);
    return NextResponse.json({ error: '读取档案更新状态失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const body = await request.json() as { resumeId?: unknown };
    const resumeId = Number(body.resumeId);
    if (!Number.isInteger(resumeId) || resumeId <= 0) {
      return NextResponse.json({ error: '无效的简历 ID' }, { status: 400 });
    }

    const { data: resume, error: resumeError } = await auth.client
      .from('resumes')
      .select('id')
      .eq('id', resumeId)
      .eq('user_id', auth.user.id)
      .single();
    if (resumeError || !resume) {
      return NextResponse.json({ error: '简历不存在或无权访问' }, { status: 404 });
    }

    const { data: activeJob, error: activeJobError } = await auth.client
      .from('application_profile_jobs')
      .select('id, resume_id, status, last_error, created_at, updated_at, completed_at')
      .eq('user_id', auth.user.id)
      .in('status', ['pending', 'running'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (activeJobError) throw new Error(`读取 AI 档案任务失败: ${activeJobError.message}`);
    if (activeJob) {
      return NextResponse.json({ job: serializeJob(activeJob as Record<string, unknown>) }, { status: 202 });
    }

    const { data: job, error: createJobError } = await auth.client
      .from('application_profile_jobs')
      .insert({ user_id: auth.user.id, resume_id: resumeId })
      .select('id, resume_id, status, last_error, created_at, updated_at, completed_at')
      .single();
    if (createJobError?.code === '23505') {
      const { data: racedJob } = await auth.client
        .from('application_profile_jobs')
        .select('id, resume_id, status, last_error, created_at, updated_at, completed_at')
        .eq('user_id', auth.user.id)
        .in('status', ['pending', 'running'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (racedJob) {
        return NextResponse.json({ job: serializeJob(racedJob as Record<string, unknown>) }, { status: 202 });
      }
    }
    if (createJobError || !job) throw new Error(`创建 AI 档案任务失败: ${createJobError?.message || '任务为空'}`);
    return NextResponse.json({ job: serializeJob(job as Record<string, unknown>) }, { status: 202 });
  } catch (error) {
    console.error('Error filling application profile with AI:', error);
    const betaResponse = betaEntitlementResponse(error);
    if (betaResponse) return betaResponse;
    return NextResponse.json({ error: 'AI 填写求职档案失败' }, { status: 500 });
  }
}

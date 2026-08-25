import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { hasValidAdminSession } from '@/lib/admin-auth';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { isApplicationStatus } from '@/lib/application-status';

export async function GET(request: NextRequest) {
  try {
    const isAdmin = hasValidAdminSession(request);
    if (isAdmin) {
      return NextResponse.json({ error: '管理员请使用 /api/admin/applications 获取脱敏分页数据' }, { status: 403 });
    }
    const auth = isAdmin ? null : await getAuthContext(request);
    if (!isAdmin && !auth) return unauthorizedResponse();
    const client = isAdmin ? getSupabaseClient() : auth!.client;
    
    let query = client.from('applications').select(`
      *,
      jobs (title, company, region, direction),
      resumes (file_name)
    `);
    
    if (auth) query = query.eq('user_id', auth.user.id);
    
    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      throw new Error(`查询网申记录失败: ${error.message}`);
    }

    return NextResponse.json({ applications: data });
  } catch (error) {
    console.error('Error fetching applications:', error);
    return NextResponse.json(
      { error: '获取网申记录失败' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
    }
    const payload = body as Record<string, unknown>;
    if (payload.status !== undefined && !isApplicationStatus(payload.status)) {
      return NextResponse.json({ error: '无效的网申状态' }, { status: 400 });
    }
    if (payload.status !== undefined && payload.status !== 'pending') {
      return NextResponse.json({ error: '新建网申只能从待投递状态开始' }, { status: 400 });
    }
    const writableFields = ['job_id', 'resume_id', 'status', 'notes', 'submitted_at'] as const;
    const applicationData = Object.fromEntries(
      writableFields
        .filter((field) => payload[field] !== undefined)
        .map((field) => [field, payload[field]])
    );

    const jobId = applicationData.job_id;
    if (typeof jobId !== 'number' || !Number.isInteger(jobId) || jobId <= 0) {
      return NextResponse.json({ error: '岗位 ID 为必填项且必须有效' }, { status: 400 });
    }
    const { data: job, error: jobError } = await client
      .from('jobs')
      .select('id, is_active, is_closed')
      .eq('id', jobId)
      .maybeSingle();
    if (jobError) throw new Error(`验证岗位失败: ${jobError.message}`);
    if (!job || job.is_active === false || job.is_closed === true) {
      return NextResponse.json({ error: '岗位不存在或已关闭' }, { status: 404 });
    }

    const resumeId = applicationData.resume_id;
    if (resumeId !== undefined && resumeId !== null) {
      if (typeof resumeId !== 'number' || !Number.isInteger(resumeId) || resumeId <= 0) {
        return NextResponse.json({ error: '无效的简历 ID' }, { status: 400 });
      }
      const { data: resume, error: resumeError } = await client
        .from('resumes')
        .select('id')
        .eq('id', resumeId)
        .eq('user_id', auth.user.id)
        .maybeSingle();
      if (resumeError) throw new Error(`验证简历归属失败: ${resumeError.message}`);
      if (!resume) return NextResponse.json({ error: '简历不存在或无权使用' }, { status: 404 });
    }

    if (applicationData.notes !== undefined && (
      typeof applicationData.notes !== 'string' || applicationData.notes.length > 5_000
    )) {
      return NextResponse.json({ error: '备注必须为不超过 5000 字的文本' }, { status: 400 });
    }
    if (applicationData.submitted_at !== undefined && applicationData.submitted_at !== null && (
      typeof applicationData.submitted_at !== 'string'
      || Number.isNaN(Date.parse(applicationData.submitted_at))
    )) {
      return NextResponse.json({ error: '无效的提交时间' }, { status: 400 });
    }
    if (applicationData.submitted_at !== undefined) {
      return NextResponse.json({ error: '新建网申不能直接设置投递时间' }, { status: 400 });
    }

    const { data: existingApplication, error: existingError } = await client
      .from('applications')
      .select('*')
      .eq('user_id', auth.user.id)
      .eq('job_id', jobId)
      .maybeSingle();
    if (existingError) throw new Error(`检查重复网申失败: ${existingError.message}`);
    if (existingApplication) {
      return NextResponse.json({ application: existingApplication, duplicate: true });
    }

    const { data, error } = await client
      .from('applications')
      .insert({
        ...applicationData,
        status: 'pending',
        user_id: auth.user.id,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        const { data: raced } = await client
          .from('applications')
          .select('*')
          .eq('user_id', auth.user.id)
          .eq('job_id', jobId)
          .maybeSingle();
        if (raced) return NextResponse.json({ application: raced, duplicate: true });
      }
      throw new Error(`创建网申记录失败: ${error.message}`);
    }

    return NextResponse.json({ application: data });
  } catch (error) {
    console.error('Error creating application:', error);
    return NextResponse.json(
      { error: '创建网申记录失败' },
      { status: 500 }
    );
  }
}

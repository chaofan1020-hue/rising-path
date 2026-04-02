import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

interface JobInput {
  title: string;
  company: string;
  region: string;
  direction: string;
  audience: string;
  description?: string;
  requirements?: string;
  salary_range?: string;
  job_url?: string;
  logo_url?: string;
}

interface BatchJobInput {
  jobs: JobInput[];
}

interface BatchDeleteInput {
  ids: number[];
}

export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const body: BatchJobInput = await request.json();

    if (!body.jobs || !Array.isArray(body.jobs) || body.jobs.length === 0) {
      return NextResponse.json(
        { error: '请提供有效的岗位数据' },
        { status: 400 }
      );
    }

    // 验证必填字段
    const validJobs: JobInput[] = [];
    const invalidJobs: { index: number; reason: string; data: JobInput }[] = [];

    body.jobs.forEach((job, index) => {
      if (!job.title || !job.company || !job.region || !job.direction || !job.audience) {
        invalidJobs.push({
          index: index + 1,
          reason: '缺少必填字段（岗位名称、公司、地区、方向、受众）',
          data: job
        });
      } else {
        validJobs.push({
          title: job.title.trim(),
          company: job.company.trim(),
          region: job.region.trim(),
          direction: job.direction.trim(),
          audience: job.audience.trim(),
          description: job.description?.trim() || '',
          requirements: job.requirements?.trim() || '',
          salary_range: job.salary_range?.trim() || '',
          job_url: job.job_url?.trim() || '',
          logo_url: job.logo_url?.trim() || ''
        });
      }
    });

    if (validJobs.length === 0) {
      return NextResponse.json(
        { error: '没有有效的岗位数据', invalidJobs },
        { status: 400 }
      );
    }

    // 批量插入
    const { data, error } = await client
      .from('jobs')
      .insert(validJobs)
      .select();

    if (error) {
      throw new Error(`批量创建岗位失败: ${error.message}`);
    }

    return NextResponse.json({
      success: true,
      created: data.length,
      total: body.jobs.length,
      invalidCount: invalidJobs.length,
      invalidJobs: invalidJobs.length > 0 ? invalidJobs : undefined
    });
  } catch (error) {
    console.error('Error batch creating jobs:', error);
    return NextResponse.json(
      { error: '批量创建岗位失败' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    
    // 安全解析请求体
    let body: BatchDeleteInput;
    try {
      const text = await request.text();
      console.log('Request body text:', text);
      body = JSON.parse(text || '{}');
    } catch (parseError) {
      console.error('Failed to parse request body:', parseError);
      return NextResponse.json(
        { error: '请求体格式错误' },
        { status: 400 }
      );
    }

    console.log('Parsed body:', body);

    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return NextResponse.json(
        { error: '请提供要删除的岗位ID' },
        { status: 400 }
      );
    }

    console.log('Deleting jobs with ids:', body.ids);

    // 先删除关联的 ai_matches 记录
    await client
      .from('ai_matches')
      .delete()
      .in('job_id', body.ids);

    // 先删除关联的 applications 记录
    await client
      .from('applications')
      .delete()
      .in('job_id', body.ids);

    // 先删除关联的 application_fields 记录
    await client
      .from('application_fields')
      .delete()
      .in('job_id', body.ids);

    // 最后批量删除岗位
    const { error } = await client
      .from('jobs')
      .delete()
      .in('id', body.ids);

    if (error) {
      console.error('Database delete error:', error);
      throw new Error(`批量删除岗位失败: ${error.message}`);
    }

    console.log('Successfully deleted', body.ids.length, 'jobs');

    return NextResponse.json({
      success: true,
      deleted: body.ids.length
    });
  } catch (error) {
    console.error('Error batch deleting jobs:', error);
    return NextResponse.json(
      { error: '批量删除岗位失败' },
      { status: 500 }
    );
  }
}

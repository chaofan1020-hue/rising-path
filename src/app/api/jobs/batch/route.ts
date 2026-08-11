import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { hasValidAdminSession } from '@/lib/admin-auth';

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

function chunks<T>(values: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

export async function POST(request: NextRequest) {
  try {
    if (!hasValidAdminSession(request)) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 401 });
    }
    const client = getSupabaseClient();
    const body: BatchJobInput = await request.json();

    if (!body.jobs || !Array.isArray(body.jobs) || body.jobs.length === 0) {
      return NextResponse.json(
        { error: '请提供有效的岗位数据' },
        { status: 400 }
      );
    }
    if (body.jobs.length > 5000) {
      return NextResponse.json({ error: '单次最多导入 5000 条岗位，请拆分文件后重试' }, { status: 400 });
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

    // 只按本次导入涉及的标题分块查重，避免岗位库变大后把整张表读入内存。
    const existingSet = new Set<string>();
    const titles = [...new Set(validJobs.map((job) => job.title))];
    for (const titleBatch of chunks(titles, 500)) {
      const { data: existingJobs, error: existingError } = await client
        .from('jobs')
        .select('title, company')
        .in('title', titleBatch);
      if (existingError) throw new Error(`查询重复岗位失败: ${existingError.message}`);
      for (const job of existingJobs || []) {
        existingSet.add(`${job.title.toLowerCase()}|${job.company.toLowerCase()}`);
      }
    }

    // 过滤重复岗位
    const newJobs: JobInput[] = [];
    const duplicateJobs: { index: number; reason: string; data: JobInput }[] = [];

    validJobs.forEach((job, index) => {
      const key = `${job.title.toLowerCase()}|${job.company.toLowerCase()}`;
      if (existingSet.has(key)) {
        duplicateJobs.push({
          index: index + 1,
          reason: `与现有岗位重复（${job.company} - ${job.title}）`,
          data: job
        });
      } else {
        newJobs.push(job);
        existingSet.add(key);
      }
    });

    // 批量插入
    let created = 0;
    if (newJobs.length > 0) {
      const { data, error } = await client
        .from('jobs')
        .insert(newJobs)
        .select();

      if (error) {
        throw new Error(`批量创建岗位失败: ${error.message}`);
      }
      created = data.length;
    }

    return NextResponse.json({
      success: true,
      created,
      skipped: duplicateJobs.length,
      total: body.jobs.length,
      invalidCount: invalidJobs.length + duplicateJobs.length,
      invalidJobs: [...duplicateJobs, ...invalidJobs]
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
  return handleBatchDelete(request);
}

export async function PUT(request: NextRequest) {
  return handleBatchDelete(request);
}

async function handleBatchDelete(request: NextRequest) {
  try {
    if (!hasValidAdminSession(request)) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 401 });
    }
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
    if (body.ids.length > 500 || body.ids.some((id) => !Number.isInteger(id) || id <= 0)) {
      return NextResponse.json({ error: '岗位 ID 无效或单次最多删除 500 条' }, { status: 400 });
    }

    // 先删除关联的 ai_matches 记录
    const aiMatchesDelete = await client
      .from('ai_matches')
      .delete()
      .in('job_id', body.ids);
    if (aiMatchesDelete.error) throw new Error(`删除 AI 匹配记录失败: ${aiMatchesDelete.error.message}`);

    // 先删除关联的 applications 记录
    const applicationsDelete = await client
      .from('applications')
      .delete()
      .in('job_id', body.ids);
    if (applicationsDelete.error) throw new Error(`删除网申记录失败: ${applicationsDelete.error.message}`);

    // 先删除关联的 application_fields 记录
    const fieldsDelete = await client
      .from('application_fields')
      .delete()
      .in('job_id', body.ids);
    if (fieldsDelete.error) throw new Error(`删除网申字段失败: ${fieldsDelete.error.message}`);

    // 最后批量删除岗位
    const { error } = await client
      .from('jobs')
      .delete()
      .in('id', body.ids);

    if (error) {
      console.error('Database delete error:', error);
      throw new Error(`批量删除岗位失败: ${error.message}`);
    }

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

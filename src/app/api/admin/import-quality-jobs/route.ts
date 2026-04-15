import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { HIGH_QUALITY_JOBS } from '@/lib/high-quality-jobs';

// 从高质量列表添加岗位
export async function POST(request: NextRequest) {
  try {
    // 验证管理员密码
    const authHeader = request.headers.get('x-admin-password');
    if (!authHeader) {
      return NextResponse.json({ error: '需要管理员密码' }, { status: 401 });
    }
    
    const { verifyAdminPassword } = await import('@/lib/admin-auth');
    const isValid = await verifyAdminPassword(authHeader);
    if (!isValid) {
      return NextResponse.json({ error: '管理员密码错误' }, { status: 401 });
    }

    const supabase = getSupabaseClient();

    const results = {
      success: 0,
      skipped: 0,
      failed: 0,
      total: 0,
      details: [] as string[],
    };

    // 获取现有岗位 URL
    const seenUrls = new Set<string>();
    const { data: existingJobs } = await supabase
      .from('jobs')
      .select('job_url');
    if (existingJobs) {
      for (const job of existingJobs) {
        if (job.job_url) seenUrls.add(job.job_url);
      }
    }

    // 从高质量列表添加
    for (const [company, url, title] of HIGH_QUALITY_JOBS) {
      results.total++;
      
      if (seenUrls.has(url)) {
        results.skipped++;
        continue;
      }
      
      seenUrls.add(url);
      
      // 根据公司分类方向
      let direction = 'SDE';
      const text = (title + ' ' + company).toLowerCase();
      
      if (/quant|trader|trading/.test(text)) {
        direction = 'Quant';
      } else if (/data analyst|data scientist|analytics/.test(text)) {
        direction = 'Data';
      } else if (/machine learning|ml|mle/.test(text)) {
        direction = 'ML/AI';
      } else if (/product manager|pm/.test(text)) {
        direction = 'PM';
      }
      
      // 插入数据库
      const { error: insertError } = await supabase
        .from('jobs')
        .insert({
          title: `${title} at ${company}`,
          company,
          region: 'United States',
          direction,
          job_url: url,
          description: `Visit ${url} for more details about this ${title} position at ${company}.`,
          audience: '留学生',
          is_active: true,
        });

      if (!insertError) {
        results.success++;
        results.details.push(`[${company}] ${title}`);
      } else {
        results.failed++;
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return NextResponse.json({
      message: '高质量岗位列表添加完成',
      ...results,
    });
  } catch (error) {
    console.error('Import error:', error);
    return NextResponse.json(
      { error: '添加失败', details: String(error) },
      { status: 500 }
    );
  }
}

// 获取高质量岗位列表
export async function GET() {
  return NextResponse.json({
    total: HIGH_QUALITY_JOBS.length,
    jobs: HIGH_QUALITY_JOBS.map(([company, url, title]) => ({
      company,
      url,
      title,
    })),
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { hasValidAdminSession } from '@/lib/admin-auth';

export async function POST(request: NextRequest) {
  try {
    if (!hasValidAdminSession(request)) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 401 });
    }

    const supabase = getSupabaseClient();

    // 获取所有 Greenhouse 公司的岗位
    const { data: jobs, error } = await supabase
      .from('jobs')
      .select('id, title, company, job_url')
      .not('job_url', 'is', null)
      .like('job_url', '%greenhouse%');

    if (error) {
      return NextResponse.json({ error: '获取岗位失败' }, { status: 500 });
    }

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const job of jobs || []) {
      // 从 URL 中提取 company token 和 job ID
      const url = job.job_url;
      const match = url.match(/boards-api\.greenhouse\.io\/v1\/boards\/([^/]+)\/jobs\/(\d+)/);
      
      if (!match) {
        skipped++;
        continue;
      }

      const [, companyToken, jobId] = match;

      try {
        // 获取完整描述
        const response = await fetch(
          `https://boards-api.greenhouse.io/v1/boards/${companyToken}/jobs?content=true`
        );
        
        if (!response.ok) {
          failed++;
          continue;
        }

        const data = await response.json();
        const fullJob = data.jobs?.find((j: { id: number }) => j.id === parseInt(jobId));
        
        if (!fullJob || !fullJob.content) {
          failed++;
          continue;
        }

        // 清理 HTML，保留基本格式
        const description = fullJob.content
          .replace(/<h1[^>]*>.*?<\/h1>/gi, '')
          .replace(/<h2[^>]*>/gi, '\n\n## ')
          .replace(/<h3[^>]*>/gi, '\n\n### ')
          .replace(/<p[^>]*>/gi, '')
          .replace(/<\/p>/gi, '\n')
          .replace(/<li[^>]*>/gi, '\n• ')
          .replace(/<\/li>/gi, '')
          .replace(/<ul[^>]*>/gi, '')
          .replace(/<\/ul>/gi, '')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
          .substring(0, 10000); // 限制长度

        // 更新描述
        await supabase
          .from('jobs')
          .update({ description })
          .eq('id', job.id);

        updated++;
      } catch (e) {
        console.error(`Error updating job ${job.id}:`, e);
        failed++;
      }

      // 添加延迟避免 API 限流
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return NextResponse.json({
      success: true,
      total: jobs?.length || 0,
      updated,
      skipped,
      failed,
    });
  } catch (error) {
    console.error('Error fetching job descriptions:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

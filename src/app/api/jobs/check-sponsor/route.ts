import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { detectSponsorship } from '@/lib/utils';
import { hasValidAdminSession } from '@/lib/admin-auth';

export async function POST(request: NextRequest) {
  try {
    if (!hasValidAdminSession(request)) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 401 });
    }

    const supabase = getSupabaseClient();

    // 获取所有岗位（包含公司名）
    const { data: jobs, error } = await supabase
      .from('jobs')
      .select('id, title, company, description, requirements, sponsorship');

    if (error) {
      return NextResponse.json({ error: '获取岗位失败' }, { status: 500 });
    }

    let withSponsor = 0;
    let noSponsor = 0;
    let unknown = 0;
    let updated = 0;

    // 批量更新
    for (const job of jobs || []) {
      const fullText = (job.description || '') + ' ' + (job.requirements || '');
      // 传入公司名以便做推断
      const newSponsorship = detectSponsorship(fullText, job.company);
      
      // 只更新有变化的
      if (job.sponsorship !== newSponsorship) {
        await supabase
          .from('jobs')
          .update({ sponsorship: newSponsorship })
          .eq('id', job.id);
        updated++;
      }
      
      if (newSponsorship === 'yes') withSponsor++;
      else if (newSponsorship === 'no') noSponsor++;
      else unknown++;
    }

    return NextResponse.json({
      success: true,
      total: jobs?.length || 0,
      with_sponsor: withSponsor,
      no_sponsor: noSponsor,
      unknown: unknown,
      updated,
    });
  } catch (error) {
    console.error('Error checking sponsor:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

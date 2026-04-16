import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { detectSponsorship } from '@/lib/utils';

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

    // 获取所有有描述的岗位
    const { data: jobs, error } = await supabase
      .from('jobs')
      .select('id, title, description, requirements, sponsorship')
      .not('description', 'is', null);

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
      const newSponsorship = detectSponsorship(fullText);
      
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

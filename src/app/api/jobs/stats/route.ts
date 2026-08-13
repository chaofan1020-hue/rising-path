import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { targetRegionPostgrestClauses } from '@/lib/job-region-scope';

// GET /api/jobs/stats - 获取岗位统计数据
export async function GET() {
  try {
    const client = getSupabaseClient();
    
    // 获取今天的日期
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];
    
    // 获取本周开始日期
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - weekStart.getDay());
    const weekStartStr = weekStart.toISOString().split('T')[0];
    
    // 获取本月开始日期
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthStartStr = monthStart.toISOString().split('T')[0];
    
    // 统计今日更新且可投递的岗位数量
    const { count: todayCount, error: todayError } = await client
      .from('jobs')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
      .or(targetRegionPostgrestClauses().join(','))
      .gte('created_at', todayStr);
    
    if (todayError) {
      throw new Error(`查询今日岗位失败: ${todayError.message}`);
    }
    
    // 统计本周新增岗位数量
    const { count: weekCount, error: weekError } = await client
      .from('jobs')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
      .or(targetRegionPostgrestClauses().join(','))
      .gte('created_at', weekStartStr);
    
    if (weekError) {
      throw new Error(`查询本周岗位失败: ${weekError.message}`);
    }
    
    // 统计本月新增岗位数量
    const { count: monthCount, error: monthError } = await client
      .from('jobs')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
      .or(targetRegionPostgrestClauses().join(','))
      .gte('created_at', monthStartStr);
    
    if (monthError) {
      throw new Error(`查询本月岗位失败: ${monthError.message}`);
    }
    
    // 统计总可投递岗位数量
    const { count: totalCount, error: totalError } = await client
      .from('jobs')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
      .or(targetRegionPostgrestClauses().join(','));
    
    if (totalError) {
      throw new Error(`查询总岗位失败: ${totalError.message}`);
    }
    
    // 按地区统计今日更新
    const { data: regionStats } = await client
      .from('jobs')
      .select('region')
      .eq('is_active', true)
      .or(targetRegionPostgrestClauses().join(','))
      .gte('created_at', todayStr);
    
    const regionCount: Record<string, number> = {};
    regionStats?.forEach(job => {
      if (job.region) {
        regionCount[job.region] = (regionCount[job.region] || 0) + 1;
      }
    });
    
    return NextResponse.json({
      today: todayCount || 0,
      thisWeek: weekCount || 0,
      thisMonth: monthCount || 0,
      total: totalCount || 0,
      regionBreakdown: regionCount,
      date: todayStr,
    });
  } catch (error) {
    console.error('Error fetching job stats:', error);
    return NextResponse.json(
      { error: '获取岗位统计数据失败', today: 0, thisWeek: 0, thisMonth: 0, total: 0 },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// GET /api/analytics - 获取分析数据
export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range') || '7d'; // 7d, 30d, 90d, all

    // 计算日期范围
    const now = new Date();
    let startDate = new Date();
    switch (range) {
      case '7d':
        startDate.setDate(now.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(now.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(now.getDate() - 90);
        break;
      case 'all':
        startDate = new Date('2020-01-01');
        break;
    }

    // 1. 访问码统计
    const { data: accessCodes } = await client
      .from('access_codes')
      .select('*');

    const totalAccessCodes = accessCodes?.length || 0;
    const activeAccessCodes = accessCodes?.filter(c => c.is_active && (!c.expires_at || new Date(c.expires_at) > now)).length || 0;
    const expiredAccessCodes = accessCodes?.filter(c => c.expires_at && new Date(c.expires_at) <= now).length || 0;

    // 2. 简历统计
    const { data: resumes } = await client
      .from('resumes')
      .select('created_at, access_code_id');

    const totalResumes = resumes?.length || 0;
    const recentResumes = resumes?.filter(r => new Date(r.created_at) >= startDate).length || 0;

    // 3. 岗位统计
    const { data: jobs } = await client
      .from('jobs')
      .select('created_at, region, direction');

    const totalJobs = jobs?.length || 0;
    const recentJobs = jobs?.filter(j => new Date(j.created_at) >= startDate).length || 0;

    // 按地区统计
    const jobsByRegion: Record<string, number> = {};
    jobs?.forEach(j => {
      if (j.region) {
        jobsByRegion[j.region] = (jobsByRegion[j.region] || 0) + 1;
      }
    });

    // 按方向统计
    const jobsByDirection: Record<string, number> = {};
    jobs?.forEach(j => {
      if (j.direction) {
        jobsByDirection[j.direction] = (jobsByDirection[j.direction] || 0) + 1;
      }
    });

    // 4. 网申统计
    const { data: applications } = await client
      .from('applications')
      .select('created_at, status');

    const totalApplications = applications?.length || 0;
    const recentApplications = applications?.filter(a => new Date(a.created_at) >= startDate).length || 0;

    // 按状态统计
    const applicationsByStatus: Record<string, number> = {};
    applications?.forEach(a => {
      applicationsByStatus[a.status] = (applicationsByStatus[a.status] || 0) + 1;
    });

    // 5. AI 匹配统计
    const { data: aiMatches } = await client
      .from('ai_matches')
      .select('created_at');

    const totalAiMatches = aiMatches?.length || 0;
    const recentAiMatches = aiMatches?.filter(a => new Date(a.created_at) >= startDate).length || 0;

    // 6. 每日活跃趋势（最近7天）
    const dailyStats: { date: string; resumes: number; applications: number; aiMatches: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const dayResumes = resumes?.filter(r => r.created_at?.startsWith(dateStr)).length || 0;
      const dayApps = applications?.filter(a => a.created_at?.startsWith(dateStr)).length || 0;
      const dayMatches = aiMatches?.filter(m => m.created_at?.startsWith(dateStr)).length || 0;
      
      dailyStats.push({ date: dateStr, resumes: dayResumes, applications: dayApps, aiMatches: dayMatches });
    }

    // 7. 用户活跃度（按 access_code_id 分组）
    const userActivity: Record<number, { resumes: number; applications: number; aiMatches: number }> = {};
    
    resumes?.forEach(r => {
      if (r.access_code_id) {
        if (!userActivity[r.access_code_id]) {
          userActivity[r.access_code_id] = { resumes: 0, applications: 0, aiMatches: 0 };
        }
        userActivity[r.access_code_id].resumes++;
      }
    });

    // 获取关联的 access code 信息
    const accessCodeMap: Record<number, string> = {};
    accessCodes?.forEach(c => {
      accessCodeMap[c.id] = c.name || c.code;
    });

    return NextResponse.json({
      overview: {
        totalAccessCodes,
        activeAccessCodes,
        expiredAccessCodes,
        totalResumes,
        recentResumes,
        totalJobs,
        recentJobs,
        totalApplications,
        recentApplications,
        totalAiMatches,
        recentAiMatches,
      },
      charts: {
        jobsByRegion,
        jobsByDirection,
        applicationsByStatus,
        dailyStats,
      },
      userActivity: Object.entries(userActivity).map(([id, stats]) => ({
        accessCodeId: parseInt(id),
        accessCodeName: accessCodeMap[parseInt(id)] || `用户${id}`,
        ...stats,
      })).sort((a, b) => (b.resumes + b.applications + b.aiMatches) - (a.resumes + a.applications + a.aiMatches)),
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    return NextResponse.json(
      { error: '获取分析数据失败' },
      { status: 500 }
    );
  }
}

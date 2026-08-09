import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { hasValidAdminSession } from '@/lib/admin-auth';

// GET /api/analytics - 获取分析数据
export async function GET(request: NextRequest) {
  try {
    if (!hasValidAdminSession(request)) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 401 });
    }

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

    // 1. 用户统计
    const { data: profiles } = await client
      .from('profiles')
      .select('id, display_name');
    const totalUsers = profiles?.length || 0;

    // 2. 简历统计（包含用户画像数据）
    const { data: resumes } = await client
      .from('resumes')
      .select('created_at, user_id, user_info');

    const totalResumes = resumes?.length || 0;
    const recentResumes = resumes?.filter(r => new Date(r.created_at) >= startDate).length || 0;

    // 简历用户画像统计
    const resumesByRegion: Record<string, number> = {};
    const resumesBySchool: Record<string, number> = {};
    const resumesByDegree: Record<string, number> = {};

    resumes?.forEach(r => {
      const userInfo = r.user_info as Record<string, unknown> | null;
      if (userInfo) {
        // 统计地区
        if (userInfo.region && typeof userInfo.region === 'string') {
          resumesByRegion[userInfo.region] = (resumesByRegion[userInfo.region] || 0) + 1;
        }
        // 统计学校
        if (userInfo.school && typeof userInfo.school === 'string') {
          resumesBySchool[userInfo.school] = (resumesBySchool[userInfo.school] || 0) + 1;
        }
        // 统计学历
        if (userInfo.degree && typeof userInfo.degree === 'string') {
          resumesByDegree[userInfo.degree] = (resumesByDegree[userInfo.degree] || 0) + 1;
        }
        // 如果有结构化的教育经历，也统计其中的信息
        if (Array.isArray(userInfo.universities)) {
          userInfo.universities.forEach((uni: { school?: string; degree?: string; region?: string }) => {
            if (uni.region) {
              resumesByRegion[uni.region] = (resumesByRegion[uni.region] || 0) + 1;
            }
            if (uni.school) {
              resumesBySchool[uni.school] = (resumesBySchool[uni.school] || 0) + 1;
            }
            if (uni.degree) {
              resumesByDegree[uni.degree] = (resumesByDegree[uni.degree] || 0) + 1;
            }
          });
        }
      }
    });

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
      .select('created_at, status, user_id');

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
      .select('created_at, user_id');

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

    // 7. 用户活跃度（按 Auth user_id 分组）
    const userActivity: Record<string, { resumes: number; applications: number; aiMatches: number }> = {};
    const ensureActivity = (userId: string | null | undefined) => {
      if (!userId) return null;
      if (!userActivity[userId]) userActivity[userId] = { resumes: 0, applications: 0, aiMatches: 0 };
      return userActivity[userId];
    };
    
    resumes?.forEach(r => {
      const activity = ensureActivity(r.user_id);
      if (activity) activity.resumes++;
    });
    applications?.forEach(a => {
      const activity = ensureActivity(a.user_id);
      if (activity) activity.applications++;
    });
    aiMatches?.forEach(m => {
      const activity = ensureActivity(m.user_id);
      if (activity) activity.aiMatches++;
    });
    const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile.display_name || '未命名用户']));

    return NextResponse.json({
      overview: {
        totalUsers,
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
        // 新增：简历用户画像统计
        resumesByRegion,
        resumesBySchool,
        resumesByDegree,
      },
      userActivity: Object.entries(userActivity).map(([id, stats]) => ({
        userId: id,
        userName: profileMap.get(id) || '未命名用户',
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

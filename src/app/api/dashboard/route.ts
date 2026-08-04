import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;


export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const accessCodeId = searchParams.get('access_code_id');

    if (!accessCodeId) {
      return NextResponse.json({ error: '缺少访问码' }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    // 1. 简历
    const { data: resumes, error: resumesError } = await supabase
      .from('resumes')
      .select('id, created_at, updated_at, file_name')
      .eq('access_code_id', accessCodeId)
      .order('created_at', { ascending: false });

    if (resumesError) throw resumesError;

    const resumeCount = resumes?.length ?? 0;
    const latestResumeId = resumes?.[0]?.id ?? null;

    // 2. AI 匹配分数
    const { data: aiMatches, error: aiMatchesError } = await supabase
      .from('ai_matches')
      .select('match_score')
      .eq('access_code_id', accessCodeId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (aiMatchesError) throw aiMatchesError;

    const avgMatchScore = aiMatches?.length
      ? Math.round(
          aiMatches.reduce((sum, m) => sum + (m.match_score || 0), 0) /
            aiMatches.length
        )
      : 0;

    // 3. 模拟面试
    const { data: interviews, error: interviewsError } = await supabase
      .from('interview_sessions')
      .select('id, status, current_round, total_rounds, updated_at, created_at')
      .eq('access_code_id', accessCodeId)
      .order('created_at', { ascending: false });

    if (interviewsError) throw interviewsError;

    const interviewCount = interviews?.length ?? 0;
    const latestInterview = interviews?.[0] ?? null;

    // 4. 网申投递
    const { data: applications, error: applicationsError } = await supabase
      .from('applications')
      .select('id, status, created_at, updated_at')
      .eq('access_code_id', accessCodeId);

    if (applicationsError) throw applicationsError;

    const applicationCount = applications?.length ?? 0;

    // 本周投递行动力：以自然周（周一 00:00 起）为周期
    const nowDate = new Date();
    const dayOfWeek = nowDate.getDay(); // 0(周日) ~ 6(周六)
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekStart = new Date(nowDate);
    weekStart.setDate(nowDate.getDate() - daysSinceMonday);
    weekStart.setHours(0, 0, 0, 0);
    const weekStartMs = weekStart.getTime();

    const weeklyApplications =
      applications?.filter((a) => new Date(a.created_at).getTime() >= weekStartMs).length ?? 0;

    // 5. 收藏岗位与最近更新
    const { data: favorites, error: favoritesError } = await supabase
      .from('favorites')
      .select('id, job_id, created_at, jobs:job_id (updated_at)')
      .eq('access_code_id', accessCodeId);

    if (favoritesError) throw favoritesError;

    const favoriteCount = favorites?.length ?? 0;
    const now = Date.now();
    const recentlyUpdatedFavorites =
      favorites?.filter((f: any) => {
        const jobUpdated = new Date(
          Array.isArray(f.jobs) ? f.jobs[0]?.updated_at : f.jobs?.updated_at
        );
        return now - jobUpdated.getTime() < ONE_WEEK_MS;
      }).length ?? 0;

    // 6. 访问码最后登录时间
    const { data: accessCode, error: accessCodeError } = await supabase
      .from('access_codes')
      .select('last_used_at, created_at')
      .eq('id', accessCodeId)
      .single();

    if (accessCodeError) throw accessCodeError;

    const daysSinceLogin = accessCode?.last_used_at
      ? Math.floor((now - new Date(accessCode.last_used_at).getTime()) / ONE_DAY_MS)
      : Math.floor((now - new Date(accessCode?.created_at || now).getTime()) / ONE_DAY_MS);

    // 阶段判断
    let phase = 'preparation';
    let phaseTitle = '准备期';
    let phaseDescription = '';

    // 周目标：投递期 10 家/周，其余阶段重点不在投递
    const weeklyGoal = applicationCount >= 3 ? 10 : 0;

    const latestInterviewUpdatedAt = latestInterview?.updated_at
      ? new Date(latestInterview.updated_at).getTime()
      : 0;
    const isInterviewActive =
      latestInterview &&
      ['active', 'ongoing'].includes(latestInterview.status) &&
      now - latestInterviewUpdatedAt < ONE_WEEK_MS;
    const isInterviewRecentCompleted =
      latestInterview &&
      ['completed', 'ended', 'finished'].includes(latestInterview.status) &&
      now - latestInterviewUpdatedAt < ONE_WEEK_MS;

    if (resumeCount === 0) {
      phase = 'positioning';
      phaseTitle = '定位期';
      phaseDescription =
        '你目前在定位期。建议先完成：上传简历 → AI 智能选岗 → 查看 3 个匹配岗位。';
    } else if (isInterviewActive) {
      phase = 'interview';
      phaseTitle = '面试期';
      phaseDescription =
        '你有一场面试正在进行中。建议今晚完成 1 次针对性模拟，并查看岗位面试重点。';
    } else if (isInterviewRecentCompleted) {
      phase = 'review';
      phaseTitle = '复盘期';
      phaseDescription =
        '你刚完成一场面试。趁记忆还热，花 5 分钟记录面试官的问题与反思，这比任何面经都值钱。';
    } else if (applicationCount >= 3) {
      phase = 'applying';
      phaseTitle = '投递期';
      phaseDescription = `你目前在投递期。本周已投递 ${weeklyApplications} 家，周目标 ${weeklyGoal} 家。保持节奏，广撒网再精选。`;
    } else {
      phase = 'preparation';
      phaseTitle = '准备期';
      phaseDescription = `你的简历匹配度 ${avgMatchScore}%，建议继续优化关键词；模拟面试已完成 ${interviewCount} 次。`;
    }

    const applicationHealth =
      weeklyGoal > 0 ? Math.round((weeklyApplications / weeklyGoal) * 100) : 0;

    // 行动建议
    const actions: {
      title: string;
      href: string;
      priority: 'high' | 'medium' | 'low';
    }[] = [];

    if (resumeCount === 0) {
      actions.push({ title: '上传第一份简历', href: '/resume', priority: 'high' });
      actions.push({ title: '去岗位库看看', href: '/jobs', priority: 'medium' });
    } else {
      actions.push({
        title: '优化简历关键词',
        href: '/optimize',
        priority: avgMatchScore < 75 ? 'high' : 'medium',
      });
      actions.push({
        title: '完成一次模拟面试',
        href: '/mock-interview',
        priority: interviewCount < 3 ? 'high' : 'medium',
      });
      actions.push({ title: '查看匹配岗位', href: '/ai-match', priority: 'medium' });
    }

    if (phase === 'applying') {
      actions.push({
        title: '继续批量投递',
        href: '/jobs',
        priority: weeklyApplications < weeklyGoal ? 'high' : 'medium',
      });
    } else if (applicationCount < 3) {
      actions.push({ title: '开始批量投递', href: '/jobs', priority: 'low' });
    }

    // 智能提醒
    const reminders: {
      type: string;
      title: string;
      description: string;
    }[] = [];

    if (daysSinceLogin >= 7) {
      reminders.push({
        type: 'stale_login',
        title: '该行动了',
        description: `你已经 ${daysSinceLogin} 天没登录了，目标岗位可能有新增，建议今晚花 10 分钟看一眼。`,
      });
    }

    if (recentlyUpdatedFavorites > 0) {
      reminders.push({
        type: 'favorite_update',
        title: '收藏岗位有变化',
        description: `你收藏的 ${recentlyUpdatedFavorites} 个岗位最近更新了 JD，建议检查是否需要补充简历关键词。`,
      });
    }

    if (latestInterview && isInterviewRecentCompleted) {
      const hoursSinceInterview = Math.floor(
        (now - latestInterviewUpdatedAt) / (60 * 60 * 1000)
      );
      if (hoursSinceInterview >= 24 && hoursSinceInterview <= 72) {
        reminders.push({
          type: 'post_interview_review',
          title: '该复盘了',
          description:
            '你昨天完成了一场面试，距离最佳复盘时间已过 24 小时。趁记忆还热，记录下面试官问过的问题。',
        });
      }
    }

    // 成长故事线
    const story = {
      resumeGrowth:
        resumeCount > 0
          ? `你已上传 ${resumeCount} 份简历，最新匹配度 ${avgMatchScore}%。`
          : '先上传简历，开启你的求职驾驶舱。',
      interviewGrowth:
        interviewCount > 0
          ? `你已完成 ${interviewCount} 次模拟面试。`
          : '还没有模拟面试记录，建议从一次练习开始。',
      mindsetGrowth:
        weeklyGoal > 0
          ? `本周已投递 ${weeklyApplications} / ${weeklyGoal} 家，${weeklyApplications >= weeklyGoal ? '节奏很好，继续保持。' : '再加把劲，完成周目标。'}`
          : applicationCount > 0
            ? `你已累计投递 ${applicationCount} 家，进入投递期后系统会为你设定周目标。`
            : '勇敢投递是第一步，建议先锁定 3 个目标岗位。',
    };

    return NextResponse.json({
      phase,
      phaseTitle,
      phaseDescription,
      metrics: {
        resumeImpact: avgMatchScore,
        interviewStrength: interviewCount,
        applicationHealth,
      },
      weeklyApplications,
      weeklyGoal,
      actions,
      reminders,
      story,
      counts: {
        resumes: resumeCount,
        matches: aiMatches?.length ?? 0,
        interviews: interviewCount,
        applications: applicationCount,
        favorites: favoriteCount,
      },
    });
  } catch (error: any) {
    console.error('Dashboard API error:', error);
    return NextResponse.json(
      { error: error?.message || '驾驶舱数据加载失败' },
      { status: 500 }
    );
  }
}

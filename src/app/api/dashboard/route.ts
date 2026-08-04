import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { resolveRegionKey, type RegionKey } from '@/lib/region-dna';

type Timeframe = 'now' | 'week' | 'month';

interface PlanItem {
  timeframe: Timeframe;
  title: string;
  description: string;
  href?: string;
}

interface PlanContext {
  region: string;
  stage: string;
  role: string;
}

const translations: Record<string, Record<string, string>> = {
  'zh-CN': {
    region_us: '北美',
    region_uk: '英国',
    region_sg: '新加坡',
    region_cn_t1: '国内一线',
    region_cn_t2: '国内二三线',
    stage_junior: '低年级实习预备',
    stage_senior: '高年级校招',
    stage_experienced: '社招跳槽',
    stage_returning_intern: '转正实习',
    role_product: '产品经理',
    role_tech: '技术',
    role_data: '数据',
    role_finance: '金融',
    role_consulting: '咨询',
    role_marketing: '市场',
    role_operations: '运营',
    role_other: '目标岗位',
    context: '基于 {{region}} · {{stage}} · {{role}}',
    now_complete_resume: '完善简历基础信息',
    now_complete_resume_desc: '确保教育、实习、项目经历完整，并补充量化结果。',
    now_target_region: '明确目标地区',
    now_target_region_desc: '根据 {{region}} 的招聘逻辑调整简历写法与面试策略。',
    now_visa: '确认签证与身份状态',
    now_visa_desc: '在简历或求职信中清晰标注当前签证/OPT/PSW/EP 状态。',
    now_keywords: '优化 ATS 关键词',
    now_keywords_desc: '针对 {{role}} 岗位 JD，补充高频技能关键词。',
    now_mock: '完成一次模拟面试',
    now_mock_desc: '用真实岗位 JD 开启模拟面试，先暴露问题再改进。',
    week_apply: '投递 {{count}} 家目标岗位',
    week_apply_desc: '保持每周 {{count}} 家的高质量投递，优先匹配 {{role}} 岗位。',
    week_behavior: '针对性练习行为面',
    week_behavior_desc: '准备 3-5 个 STAR 案例，覆盖团队合作、冲突解决与数据驱动决策。',
    week_projects: '补充量化项目经历',
    week_projects_desc: '用具体数字重写项目成果：提升了多少、服务了多少用户、节省了多少钱。',
    week_referral: '发起 3 次内推或人脉触达',
    week_referral_desc: '在 LinkedIn/校友群找到目标公司员工，争取一次 coffee chat 或内推。',
    month_interview: '拿到 {{count}} 个面试邀约',
    month_interview_desc: '持续优化简历与投递策略，目标 {{count}} 个岗位进入面试轮次。',
    month_rhythm: '建立稳定的投递节奏',
    month_rhythm_desc: '每周复盘投递漏斗，根据回应率调整目标公司与岗位方向。',
    month_mock_count: '完成 {{count}} 次模拟面试',
    month_mock_count_desc: '从通用面到岗位专项面逐步升级，记录追问层数与卡壳点。',
    month_review: '建立面试复盘档案',
    month_review_desc: '每次面试后 24 小时内记录问题、表现与改进点，形成个人面经库。',
  },
  en: {
    region_us: 'North America',
    region_uk: 'UK',
    region_sg: 'Singapore',
    region_cn_t1: 'Tier-1 China',
    region_cn_t2: 'Tier-2/3 China',
    stage_junior: 'Early-stage internship prep',
    stage_senior: 'New graduate recruiting',
    stage_experienced: 'Experienced hire',
    stage_returning_intern: 'Intern conversion',
    role_product: 'Product Manager',
    role_tech: 'Engineering',
    role_data: 'Data',
    role_finance: 'Finance',
    role_consulting: 'Consulting',
    role_marketing: 'Marketing',
    role_operations: 'Operations',
    role_other: 'Target role',
    context: 'Based on {{region}} · {{stage}} · {{role}}',
    now_complete_resume: 'Complete your resume basics',
    now_complete_resume_desc: 'Make sure education, internships, and projects are complete with quantified results.',
    now_target_region: 'Lock in your target region',
    now_target_region_desc: 'Adapt resume format and interview strategy to {{region}} hiring logic.',
    now_visa: 'Confirm visa & status',
    now_visa_desc: 'Clearly state your current visa / OPT / PSW / EP status on your resume or cover letter.',
    now_keywords: 'Optimize ATS keywords',
    now_keywords_desc: 'Add high-frequency skill keywords based on {{role}} job descriptions.',
    now_mock: 'Do one mock interview',
    now_mock_desc: 'Start a mock interview with a real JD to surface weak spots before they matter.',
    week_apply: 'Apply to {{count}} target companies',
    week_apply_desc: 'Maintain {{count}} high-quality applications per week, prioritizing {{role}} roles.',
    week_behavior: 'Practice behavioral questions',
    week_behavior_desc: 'Prepare 3-5 STAR stories covering teamwork, conflict resolution, and data-driven decisions.',
    week_projects: 'Add quantified project results',
    week_projects_desc: 'Rewrite project outcomes with numbers: improved by how much, served how many users, saved how much.',
    week_referral: 'Reach out for 3 referrals',
    week_referral_desc: 'Find employees at target companies on LinkedIn or alumni networks and ask for a coffee chat or referral.',
    month_interview: 'Get {{count}} interview invitations',
    month_interview_desc: 'Keep refining your resume and targeting until {{count}} roles move to interview rounds.',
    month_rhythm: 'Build a steady application rhythm',
    month_rhythm_desc: 'Review your application funnel weekly and adjust target companies by response rate.',
    month_mock_count: 'Complete {{count}} mock interviews',
    month_mock_count_desc: 'Progress from general to role-specific mocks; track follow-up depth and sticking points.',
    month_review: 'Build an interview review library',
    month_review_desc: 'Within 24 hours of every interview, log questions, performance, and improvement points.',
  },
};

function getText(lang: string, key: string, params?: Record<string, string | number>): string {
  const dict = translations[lang] || translations['zh-CN'];
  let text = dict[key] || translations['zh-CN'][key] || key;
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      text = text.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
    });
  }
  return text;
}

function detectRoleCategory(targetRole?: string | null): string {
  if (!targetRole) return 'role_other';
  const lower = targetRole.toLowerCase();
  if (/产品|product|pm/i.test(lower)) return 'role_product';
  if (/数据|data|商业分析|数据分析|bi/i.test(lower)) return 'role_data';
  if (/金融|finance|投行|投资|ib/i.test(lower)) return 'role_finance';
  if (/咨询|consulting|strategy/i.test(lower)) return 'role_consulting';
  if (/市场|marketing|品牌|brand/i.test(lower)) return 'role_marketing';
  if (/运营|operations|supply chain|供应链/i.test(lower)) return 'role_operations';
  if (/开发|工程|算法|前端|后端|sde|software|engineer|dev/i.test(lower)) return 'role_tech';
  return 'role_other';
}

function buildPlan(
  lang: string,
  segmentation: any,
  profile: any,
  resumeCount: number,
  avgMatchScore: number,
  interviewCount: number
): { context: PlanContext; items: PlanItem[] } | null {
  if (resumeCount === 0) return null;

  const seg = segmentation || {};
  const prof = profile || {};

  const rawRegion: RegionKey | string =
    (prof.intention?.region as RegionKey) ||
    (seg.regions && seg.regions[0]) ||
    'cn_t1';
  const regionKey = resolveRegionKey(rawRegion) || 'cn_t1';
  const regionLabelKey = `region_${regionKey}`;
  const stage = seg.careerStage || 'senior';
  const stageLabelKey = `stage_${stage}`;
  const roleCategory = detectRoleCategory(prof.targetRole || seg.targetRole);

  const context: PlanContext = {
    region: getText(lang, regionLabelKey),
    stage: getText(lang, stageLabelKey),
    role: getText(lang, roleCategory),
  };

  const items: PlanItem[] = [];

  // Now
  if (avgMatchScore < 60) {
    items.push({
      timeframe: 'now',
      title: getText(lang, 'now_keywords', { role: context.role }),
      description: getText(lang, 'now_keywords_desc', { role: context.role }),
      href: '/optimize',
    });
  } else {
    items.push({
      timeframe: 'now',
      title: getText(lang, 'now_complete_resume'),
      description: getText(lang, 'now_complete_resume_desc'),
      href: '/resume',
    });
  }

  items.push({
    timeframe: 'now',
    title: getText(lang, 'now_target_region', { region: context.region }),
    description: getText(lang, 'now_target_region_desc', { region: context.region }),
    href: '/resume',
  });

  if (['us', 'uk', 'sg'].includes(regionKey)) {
    items.push({
      timeframe: 'now',
      title: getText(lang, 'now_visa'),
      description: getText(lang, 'now_visa_desc'),
      href: '/optimize',
    });
  }

  if (interviewCount === 0) {
    items.push({
      timeframe: 'now',
      title: getText(lang, 'now_mock'),
      description: getText(lang, 'now_mock_desc'),
      href: '/mock-interview',
    });
  }

  // Week
  const weeklyGoal = stage === 'experienced' ? 8 : stage === 'junior' ? 5 : 10;
  items.push({
    timeframe: 'week',
    title: getText(lang, 'week_apply', { count: weeklyGoal }),
    description: getText(lang, 'week_apply_desc', { count: weeklyGoal, role: context.role }),
    href: '/jobs',
  });

  items.push({
    timeframe: 'week',
    title: getText(lang, 'week_behavior'),
    description: getText(lang, 'week_behavior_desc'),
    href: '/mock-interview',
  });

  if (avgMatchScore < 70) {
    items.push({
      timeframe: 'week',
      title: getText(lang, 'week_projects'),
      description: getText(lang, 'week_projects_desc'),
      href: '/resume',
    });
  } else {
    items.push({
      timeframe: 'week',
      title: getText(lang, 'week_referral'),
      description: getText(lang, 'week_referral_desc'),
      href: '/jobs',
    });
  }

  // Month
  const monthInterviewGoal = stage === 'experienced' ? 3 : 2;
  items.push({
    timeframe: 'month',
    title: getText(lang, 'month_interview', { count: monthInterviewGoal }),
    description: getText(lang, 'month_interview_desc', { count: monthInterviewGoal }),
    href: '/ai-match',
  });

  items.push({
    timeframe: 'month',
    title: getText(lang, 'month_rhythm'),
    description: getText(lang, 'month_rhythm_desc'),
    href: '/dashboard',
  });

  const monthMockGoal = stage === 'junior' ? 3 : 5;
  items.push({
    timeframe: 'month',
    title: getText(lang, 'month_mock_count', { count: monthMockGoal }),
    description: getText(lang, 'month_mock_count_desc'),
    href: '/mock-interview',
  });

  items.push({
    timeframe: 'month',
    title: getText(lang, 'month_review'),
    description: getText(lang, 'month_review_desc'),
    href: '/dashboard',
  });

  return { context, items };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const accessCodeId = searchParams.get('access_code_id');
    const lang = ['zh-CN', 'zh-TW', 'en'].includes(searchParams.get('lang') || '')
      ? (searchParams.get('lang') as 'zh-CN' | 'zh-TW' | 'en')
      : 'zh-CN';

    if (!accessCodeId) {
      return NextResponse.json({ error: '缺少访问码' }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    // 最新简历（含画像与分层）
    const { data: resumes } = await supabase
      .from('resumes')
      .select('id, created_at, updated_at, file_name, profile, segmentation')
      .eq('access_code_id', accessCodeId)
      .order('created_at', { ascending: false })
      .limit(1);

    const latestResume = resumes?.[0] || null;
    const resumeCount = resumes?.length ?? 0;

    // AI 匹配平均分
    const { data: aiMatches } = await supabase
      .from('ai_matches')
      .select('match_score')
      .eq('access_code_id', accessCodeId)
      .order('created_at', { ascending: false })
      .limit(50);

    const avgMatchScore =
      aiMatches && aiMatches.length > 0
        ? Math.round(
            aiMatches.reduce((sum, m) => sum + (m.match_score || 0), 0) /
              aiMatches.length
          )
        : 0;

    // 模拟面试
    const { data: interviews } = await supabase
      .from('interview_sessions')
      .select('id, status, current_round, total_rounds, updated_at, created_at, target_company')
      .eq('access_code_id', accessCodeId)
      .order('created_at', { ascending: false })
      .limit(50);

    const interviewCount = interviews?.length ?? 0;
    const latestInterview = interviews?.[0] ?? null;

    // 投递
    const { data: applications } = await supabase
      .from('applications')
      .select('id, status, created_at, updated_at')
      .eq('access_code_id', accessCodeId)
      .limit(200);

    const applicationCount = applications?.length ?? 0;

    // 本周投递数
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(
      now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1)
    );
    monday.setHours(0, 0, 0, 0);
    const weeklyApplications =
      applications?.filter((a) => new Date(a.created_at) >= monday).length ?? 0;

    // 收藏岗位
    const { data: favorites } = await supabase
      .from('favorites')
      .select('id, job_id, created_at, jobs!inner(id, updated_at)')
      .eq('access_code_id', accessCodeId);

    const favoriteCount = favorites?.length ?? 0;
    const recentlyUpdatedFavorites =
      favorites?.filter((f: any) => {
        const jobUpdated = new Date(f.jobs?.updated_at || 0);
        return Date.now() - jobUpdated.getTime() < 7 * 24 * 60 * 60 * 1000;
      }).length ?? 0;

    // 访问码最近登录
    const { data: accessCode } = await supabase
      .from('access_codes')
      .select('last_used_at, created_at')
      .eq('id', accessCodeId)
      .single();

    const daysSinceLogin = accessCode?.last_used_at
      ? Math.floor(
          (Date.now() - new Date(accessCode.last_used_at).getTime()) /
            (24 * 60 * 60 * 1000)
        )
      : 0;

    // 阶段判断
    let phase: string;
    let phaseTitleKey: string;
    let phaseDescriptionKey: string;
    let phaseDescriptionParams: Record<string, string | number> = {};

    if (resumeCount === 0) {
      phase = 'positioning';
      phaseTitleKey = 'dashboard.phase.positioning.title';
      phaseDescriptionKey = 'dashboard.phase.positioning.description';
      phaseDescriptionParams = { count: 3 };
    } else if (
      latestInterview &&
      ['active', 'ongoing'].includes(latestInterview.status) &&
      Date.now() - new Date(latestInterview.updated_at).getTime() <
        7 * 24 * 60 * 60 * 1000
    ) {
      phase = 'interview';
      phaseTitleKey = 'dashboard.phase.interview.title';
      phaseDescriptionKey = 'dashboard.phase.interview.description';
      phaseDescriptionParams = { company: latestInterview.target_company || '' };
    } else if (
      latestInterview &&
      ['completed', 'ended', 'finished'].includes(latestInterview.status) &&
      Date.now() - new Date(latestInterview.updated_at).getTime() <
        7 * 24 * 60 * 60 * 1000
    ) {
      const hours = Math.floor(
        (Date.now() - new Date(latestInterview.updated_at).getTime()) /
          (60 * 60 * 1000)
      );
      phase = 'review';
      phaseTitleKey = 'dashboard.phase.review.title';
      phaseDescriptionKey = 'dashboard.phase.review.description';
      phaseDescriptionParams = { hours };
    } else if (applicationCount >= 3) {
      phase = 'applying';
      phaseTitleKey = 'dashboard.phase.applying.title';
      phaseDescriptionKey = 'dashboard.phase.applying.description';
      phaseDescriptionParams = { count: applicationCount };
    } else {
      phase = 'preparation';
      phaseTitleKey = 'dashboard.phase.preparation.title';
      phaseDescriptionKey = 'dashboard.phase.preparation.description';
      phaseDescriptionParams = { score: avgMatchScore, count: interviewCount };
    }

    // 周目标
    const weeklyGoal = phase === 'applying' ? 10 : 0;
    const applicationHealth =
      weeklyGoal > 0
        ? Math.min(100, Math.round((weeklyApplications / weeklyGoal) * 100))
        : 0;

    // 行动建议
    const actions: {
      titleKey: string;
      titleParams?: Record<string, string | number>;
      href: string;
      priority: 'high' | 'medium' | 'low';
    }[] = [];

    if (resumeCount === 0) {
      actions.push({
        titleKey: 'dashboard.action.uploadResume',
        href: '/resume',
        priority: 'high',
      });
      actions.push({
        titleKey: 'dashboard.action.browseJobs',
        href: '/jobs',
        priority: 'medium',
      });
    } else {
      actions.push({
        titleKey: 'dashboard.action.optimizeResume',
        href: '/optimize',
        priority: avgMatchScore < 75 ? 'high' : 'medium',
      });
      actions.push({
        titleKey: 'dashboard.action.mockInterview',
        href: '/mock-interview',
        priority: interviewCount < 3 ? 'high' : 'medium',
      });
      actions.push({
        titleKey: 'dashboard.action.viewMatches',
        href: '/ai-match',
        priority: 'medium',
      });
      if (applicationCount < 3) {
        actions.push({
          titleKey: 'dashboard.action.startApplying',
          href: '/jobs',
          priority: 'low',
        });
      }
    }

    // 提醒
    const reminders: {
      type: string;
      titleKey: string;
      titleParams?: Record<string, string | number>;
      descriptionKey: string;
      descriptionParams?: Record<string, string | number>;
    }[] = [];

    if (daysSinceLogin >= 7) {
      reminders.push({
        type: 'stale_login',
        titleKey: 'dashboard.reminder.staleLogin.title',
        descriptionKey: 'dashboard.reminder.staleLogin.description',
        descriptionParams: { days: daysSinceLogin },
      });
    }

    if (recentlyUpdatedFavorites > 0) {
      reminders.push({
        type: 'favorite_update',
        titleKey: 'dashboard.reminder.favoriteUpdate.title',
        descriptionKey: 'dashboard.reminder.favoriteUpdate.description',
        descriptionParams: { count: recentlyUpdatedFavorites },
      });
    }

    if (
      latestInterview &&
      ['completed', 'ended', 'finished'].includes(latestInterview.status)
    ) {
      const hours = Math.floor(
        (Date.now() - new Date(latestInterview.updated_at).getTime()) /
          (60 * 60 * 1000)
      );
      if (hours >= 24 && hours <= 72) {
        reminders.push({
          type: 'post_interview_review',
          titleKey: 'dashboard.reminder.review.title',
          descriptionKey: 'dashboard.reminder.review.description',
          descriptionParams: { hours },
        });
      }
    }

    // 成长故事线
    const story = {
      resumeKey:
        resumeCount > 0 ? 'dashboard.story.resume' : 'dashboard.story.resumeEmpty',
      resumeParams:
        resumeCount > 0
          ? { count: resumeCount, score: avgMatchScore }
          : undefined,
      interviewKey:
        interviewCount > 0
          ? 'dashboard.story.interview'
          : 'dashboard.story.interviewEmpty',
      interviewParams: interviewCount > 0 ? { count: interviewCount } : undefined,
      mindsetKey:
        applicationCount > 0
          ? 'dashboard.story.mindset'
          : 'dashboard.story.mindsetEmpty',
      mindsetParams:
        applicationCount > 0 ? { count: applicationCount } : undefined,
    };

    // 个性化求职规划
    const plan = buildPlan(
      lang,
      latestResume?.segmentation,
      latestResume?.profile,
      resumeCount,
      avgMatchScore,
      interviewCount
    );

    return NextResponse.json({
      phase,
      phaseTitleKey,
      phaseDescriptionKey,
      phaseDescriptionParams,
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
      plan,
    });
  } catch (error) {
    console.error('Dashboard API error:', error);
    return NextResponse.json(
      { error: '获取驾驶舱数据失败' },
      { status: 500 }
    );
  }
}

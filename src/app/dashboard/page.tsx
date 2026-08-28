'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Header1 } from '@/components/header1';
import { AuthGuard } from '@/components/auth-guard';
import { apiFetch } from '@/lib/api-client';
import { REGION_DNA, type RegionKey } from '@/lib/region-dna';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { useLanguage } from '@/lib/language-context';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { getLocalizedText, type CareerRouteDiagnosis } from '@/lib/career-route-planner';
import {
  NETWORKING_STAGES,
  type NetworkingProgress,
  type NetworkingRecommendation,
} from '@/lib/networking-recommender';
import {
  ArrowRight,
  Bell,
  Briefcase,
  Calendar,
  Check,
  LineChart,
  Loader2,
  MapPin,
  MessageSquare,
  RefreshCw,
  Target,
  Zap,
} from 'lucide-react';

interface PlanItem {
  timeframe: 'now' | 'week' | 'month';
  region?: string;
  titleKey: string;
  descriptionKey: string;
  descriptionText?: string;
  params?: Record<string, string | number>;
  href?: string;
}

interface RegionOption {
  value: string;
  labelKey: string;
}

interface PlanRegionData {
  region: string;
  plan: {
    context: {
      region: string;
      stage: string;
      role: string;
    };
    items: PlanItem[];
    diagnosis?: CareerRouteDiagnosis | null;
  };
  feasibilityLabelKey: string;
}

interface PersonalityRecommendation {
  roleKey: string;
  labelKey: string;
  score: number;
  personalityFit?: number;
  resumeFit?: number;
  marketScore?: number;
  feasibilityScore?: number;
  feasibilityBlocked?: boolean;
  feasibilityLabelKey?: string;
  fit: 'strong' | 'medium' | 'explore';
  reasons: string[];
  sponsorship?: {
    level: 'high' | 'medium' | 'low' | 'unknown';
    sponsorJobCount: number;
    activeJobCount: number;
    noteKey: string;
  };
}

interface PersonalitySummary {
  hasAssessment: boolean;
  resumeId: number | null;
  dimensions: Record<string, number>;
  summaryKey: string;
  recommendations: PersonalityRecommendation[];
  updatedAt: string;
}

interface DashboardData {
  phase: string;
  phaseTitleKey: string;
  phaseTitleParams?: Record<string, string | number>;
  phaseDescriptionKey: string;
  phaseDescriptionParams?: Record<string, string | number>;
  metrics: {
    resumeImpact: number;
    interviewStrength: number;
    applicationHealth: number;
  };
  actions: {
    titleKey: string;
    titleParams?: Record<string, string | number>;
    href: string;
    priority: 'high' | 'medium' | 'low';
  }[];
  nextAction: { titleKey: string; href: string };
  reminders: {
    type: string;
    titleKey: string;
    titleParams?: Record<string, string | number>;
    descriptionKey: string;
    descriptionParams?: Record<string, string | number>;
  }[];
  story: {
    resumeKey: string;
    resumeParams?: Record<string, string | number>;
    interviewKey: string;
    interviewParams?: Record<string, string | number>;
    mindsetKey: string;
    mindsetParams?: Record<string, string | number>;
  };
  counts: {
    resumes: number;
    matches: number;
    interviews: number;
    applications: number;
    favorites: number;
  };
  weeklyApplications: number;
  weeklyGoal: number;
  selectedRegion: string | null;
  selectedRegions: string[];
  planRegions: PlanRegionData[];
  regionOptions: RegionOption[];
  latestResumeId: number | null;
  profileReady?: boolean;
  missingSteps?: string[];
  plan: {
    context: {
      region: string;
      stage: string;
      role: string;
    };
    items: PlanItem[];
  } | null;
  diagnosis?: CareerRouteDiagnosis | null;
  personality?: PersonalitySummary | null;
  interviewEvaluations?: Array<{
    id: number;
    targetCompany: string;
    interviewType: string;
    overallScore: number | null;
    reportGrade: string | null;
    completedAt: string;
    report?: { radar?: Array<{ dimension: string; score: number; grade: string; diagnosis: string }> } | null;
  }>;
}

interface DashboardActivity {
  recentlyUpdatedFavorites: number;
  interviewEvaluations: NonNullable<DashboardData['interviewEvaluations']>;
}

interface DashboardInterviewMessage {
  role?: 'interviewer' | 'candidate' | string;
  content?: string;
  interviewerName?: string;
  round?: number;
  ts?: number;
}

interface DashboardInterviewReport {
  verdict?: {
    pass?: boolean;
    grade?: string;
    hireLevel?: string;
    headline?: string;
    vote?: string;
  };
  committee?: Array<{
    name?: string;
    company?: string;
    round?: number;
    roleLabel?: string;
    grade?: string;
    attitude?: string;
    comment?: string;
    tags?: string[];
    keyMoment?: { question?: string; answer?: string; note?: string };
  }>;
  radar?: Array<{ dimension?: string; score?: number; grade?: string; diagnosis?: string }>;
  highlights?: {
    mistakes?: Array<{ title?: string; scene?: string; consequence?: string; coach?: string }>;
    best?: { title?: string; scene?: string; effect?: string; coach?: string };
  };
  actionPlan?: { immediate?: string[]; practice?: string[]; reading?: string[] };
}

interface DashboardInterviewDetail {
  id: number;
  target_company?: string | null;
  interview_type?: string | null;
  mode?: string | null;
  total_rounds?: number | null;
  current_round?: number | null;
  messages?: DashboardInterviewMessage[] | null;
  report?: DashboardInterviewReport | null;
  report_grade?: string | null;
  overall_score?: number | null;
  summary?: string | null;
  status: string;
  created_at: string;
  updated_at?: string | null;
}

const DASHBOARD_CACHE_TTL_MS = 10 * 60 * 1000;

function dashboardCacheKey(userId: string, locale: string) {
  return `liorvix.dashboard.${userId}.${locale}.v1`;
}

function readDashboardCache(userId: string, locale: string): DashboardData | null {
  try {
    const raw = window.sessionStorage.getItem(dashboardCacheKey(userId, locale));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: number; data?: DashboardData };
    if (!parsed.savedAt || !parsed.data || Date.now() - parsed.savedAt > DASHBOARD_CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeDashboardCache(userId: string, locale: string, data: DashboardData) {
  try {
    window.sessionStorage.setItem(
      dashboardCacheKey(userId, locale),
      JSON.stringify({ savedAt: Date.now(), data }),
    );
  } catch {
    // Cache failures must never block the live dashboard response.
  }
}

export default function DashboardPage() {
  const { locale, localeReady, t } = useLanguage();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dashboardLoadVersion, setDashboardLoadVersion] = useState(0);
  const dashboardCacheOwnerRef = useRef<string | null>(null);
  const [networking, setNetworking] = useState<NetworkingRecommendation | null>(null);
  const [networkingByStage, setNetworkingByStage] = useState<Record<string, NetworkingRecommendation>>({});
  const [activeNetworkingStage, setActiveNetworkingStage] = useState(1);
  const [networkingLoading, setNetworkingLoading] = useState(false);
  const [networkingError, setNetworkingError] = useState<string | null>(null);
  const [networkingProgress, setNetworkingProgress] = useState<NetworkingProgress>({
    stage: 1,
    completedMilestones: [],
    recommendations: {},
    updatedAt: '',
  });
  const [selectedInterview, setSelectedInterview] = useState<DashboardInterviewDetail | null>(null);
  const [interviewDetailLoading, setInterviewDetailLoading] = useState(false);
  const [interviewDetailError, setInterviewDetailError] = useState<string | null>(null);

  const fetchDashboard = useCallback((keepVisible = false) => {
    if (!keepVisible) setLoading(true);
    setError(null);
    apiFetch(`/api/dashboard?lang=${locale}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || t('dashboard.loadError') || '加载失败');
        return json;
      })
      .then((json) => {
        if (json.error) {
          setError(json.error);
        } else {
          const nextData = json as DashboardData;
          setData(nextData);
          if (dashboardCacheOwnerRef.current) {
            writeDashboardCache(dashboardCacheOwnerRef.current, locale, nextData);
          }
          setDashboardLoadVersion((version) => version + 1);
        }
      })
      .catch((err) => setError(err?.message || t('dashboard.loadError') || '加载失败'))
      .finally(() => setLoading(false));
  }, [locale, t]);

  useEffect(() => {
    if (!localeReady) return;
    let cancelled = false;
    getSupabaseBrowserClient()
      .then((client) => client.auth.getSession())
      .then(({ data: { session } }) => {
        if (cancelled) return;
        const userId = session?.user.id ?? null;
        const cachedData = userId ? readDashboardCache(userId, locale) : null;
        dashboardCacheOwnerRef.current = userId;
        if (cachedData) {
          setData(cachedData);
          setLoading(false);
        }
        fetchDashboard(Boolean(cachedData));
      })
      .catch(() => fetchDashboard());
    return () => {
      cancelled = true;
    };
  }, [fetchDashboard, localeReady]);

  useEffect(() => {
    if (dashboardLoadVersion === 0) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      apiFetch('/api/dashboard/activity', { cache: 'no-store' })
        .then(async (res) => {
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || 'Dashboard activity unavailable');
          return json as DashboardActivity;
        })
        .then((activity) => {
          if (cancelled) return;
          setData((current) => {
            if (!current) return current;
            const withoutFavoriteReminder = current.reminders.filter((item) => item.type !== 'favorite_update');
            const reminders = activity.recentlyUpdatedFavorites > 0
              ? [...withoutFavoriteReminder, {
                type: 'favorite_update',
                titleKey: 'dashboard.reminder.favoriteUpdate.title',
                descriptionKey: 'dashboard.reminder.favoriteUpdate.description',
                descriptionParams: { count: activity.recentlyUpdatedFavorites },
              }]
              : withoutFavoriteReminder;
            return { ...current, reminders, interviewEvaluations: activity.interviewEvaluations };
          });
        })
        .catch(() => {
          // Deferred cards are non-critical; the dashboard remains fully usable.
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [dashboardLoadVersion]);

  const loadNetworking = useCallback(async () => {
    setNetworkingLoading(true);
    setNetworkingError(null);
    try {
      const res = await apiFetch('/api/networking/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: locale }),
      });
      const json = await res.json();
      if (!res.ok || !json.recommendation) {
        const creditMessage = json.code === 'CREDIT_INSUFFICIENT'
          ? t('dashboard.networking.creditInsufficient')
          : json.code === 'CREDIT_METRIC_NOT_CONFIGURED'
            ? t('dashboard.networking.creditNotConfigured')
            : json.code?.startsWith('CREDIT_')
              ? t('dashboard.networking.creditUnavailable')
              : null;
        throw new Error(creditMessage || json.error || 'Networking 推荐生成失败');
      }
      setNetworking(json.recommendation);
      setNetworkingByStage(json.recommendations || {});
      setActiveNetworkingStage(json.progress?.stage || 1);
      setNetworkingProgress((prev) => json.progress || prev);
    } catch (err) {
      setNetworkingError(err instanceof Error ? err.message : 'Networking 推荐生成失败');
    } finally {
      setNetworkingLoading(false);
    }
  }, [locale, t]);

  const loadInterviewDetail = useCallback(async (interviewId: number) => {
    setSelectedInterview(null);
    setInterviewDetailError(null);
    setInterviewDetailLoading(true);
    try {
      const res = await apiFetch(`/api/dashboard/interviews/${interviewId}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.interview) throw new Error(json.error || t('dashboard.evaluation.loadError'));
      setSelectedInterview(json.interview as DashboardInterviewDetail);
    } catch (err) {
      setInterviewDetailError(err instanceof Error ? err.message : t('dashboard.evaluation.loadError'));
    } finally {
      setInterviewDetailLoading(false);
    }
  }, [t]);

  const formatInterviewDate = useCallback((value: string) => new Date(value).toLocaleDateString(
    locale === 'zh-CN' ? 'zh-CN' : locale === 'zh-TW' ? 'zh-TW' : 'en-US',
    { year: 'numeric', month: 'short', day: 'numeric' },
  ), [locale]);

  useEffect(() => {
    if (data?.diagnosis?.window !== 'preparation') return;
    let cancelled = false;
    apiFetch('/api/networking/progress')
      .then((res) => (res.ok ? res.json() : { progress: null }))
      .then((json) => {
        if (cancelled) return;
        const progress = json.progress as NetworkingProgress | null;
        if (!progress) {
          setNetworking(null);
          setNetworkingByStage({});
          return;
        }
        setNetworkingProgress(progress);
        const cachedMap = progress.recommendations || {};
        const cachedRecommendation = cachedMap[String(progress.stage)] || cachedMap['1'];
        if (cachedRecommendation) {
          setNetworkingByStage(cachedMap);
          setActiveNetworkingStage(progress.stage);
          setNetworking(cachedRecommendation);
        } else {
          // AI 生成成本高，不阻塞驾驶舱首屏；用户点击按钮后再按需生成。
          setNetworking(null);
          setNetworkingByStage({});
        }
      })
      .catch(() => setNetworkingError('Networking 推荐加载失败'));
    return () => {
      cancelled = true;
    };
  }, [data?.diagnosis?.window, data?.selectedRegion, locale]);

  const handleToggleNetworkingMilestone = useCallback(async (milestone: string) => {
    if (!networkingProgress) return;
    const completed = networkingProgress.completedMilestones.includes(milestone)
      ? networkingProgress.completedMilestones.filter((item) => item !== milestone)
      : [...networkingProgress.completedMilestones, milestone];
    const stageMilestones = NETWORKING_STAGES[networkingProgress.stage - 1]?.milestones || [];
    const allDone = stageMilestones.length > 0
      && stageMilestones.every((item) => completed.includes(item));
    const nextStage = allDone
      ? Math.min(NETWORKING_STAGES.length, networkingProgress.stage + 1)
      : networkingProgress.stage;
    try {
      const res = await apiFetch('/api/networking/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: nextStage, completedMilestones: completed }),
      });
      const json = await res.json();
      if (!res.ok || !json.progress) throw new Error(json.error || '进度更新失败');
      setNetworkingProgress(json.progress);
      if (nextStage !== networkingProgress.stage) {
        setActiveNetworkingStage(nextStage);
        const nextRec = networkingByStage[String(nextStage)];
        if (nextRec) setNetworking(nextRec);
        else void loadNetworking();
      }
    } catch (err) {
      setNetworkingError(err instanceof Error ? err.message : 'Networking 进度更新失败');
    }
  }, [loadNetworking, networkingByStage, networkingProgress]);

  const switchNetworkingStage = useCallback((stage: number) => {
    setActiveNetworkingStage(stage);
    const rec = networkingByStage[String(stage)];
    if (rec) setNetworking(rec);
  }, [networkingByStage]);

  const planGroups = useMemo(() => {
    if (!data?.planRegions?.length) return null;
    const flatten = (timeframe: 'now' | 'week' | 'month') => (
      data.planRegions.flatMap((regionPlan) => (
        regionPlan.plan.items
          .filter((item) => item.timeframe === timeframe)
          .map((item) => ({ ...item, region: data.planRegions.length > 1 ? regionPlan.region : undefined }))
      ))
    );
    return {
      now: flatten('now'),
      week: flatten('week'),
      month: flatten('month'),
    };
  }, [data]);

  return (
    <AuthGuard showAccountBar={false}>
      <div className="min-h-screen bg-white dark:bg-zinc-950">
        <Header1 />
        <main className="container mx-auto max-w-6xl px-4 pb-16 pt-20 md:pt-24">
        <div className="mb-7 md:mb-8">
          <p className="mb-2 text-xs font-medium text-zinc-400 dark:text-zinc-500">
            {t('dashboard.eyebrow')}
          </p>
          <h1 className="mb-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 md:text-3xl">
            {t('dashboard.title')}
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400 md:text-base">
            {t('dashboard.subtitle')}
          </p>
        </div>

        {loading && !data && <DashboardSkeleton />}

        {!loading && error && !data && (
          <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800">
            <CardContent className="p-6 text-center text-zinc-500">
              {error}
            </CardContent>
          </Card>
        )}

        {!loading && !error && data && (
          <div className="flex flex-col gap-8 md:gap-10">
            <section className="order-1">
                  <div className="grid border-y border-zinc-200 lg:grid-cols-[minmax(0,1fr)_20rem] dark:border-zinc-800">
                    <div className="py-6 pr-0 md:py-8 lg:pr-10">
                      <div className="mb-3 inline-flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        <Target className="h-3.5 w-3.5" />
                        {t('dashboard.phaseLabel')}
                      </div>
                      <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 md:text-3xl">
                        {t(data.phaseTitleKey, data.phaseTitleParams)}
                      </h2>
                      <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400 md:text-base">
                        {t(data.phaseDescriptionKey, data.phaseDescriptionParams)}
                      </p>
                      <Button
                        asChild
                        className="mt-5 rounded-md bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                      >
                        <Link href={data.nextAction?.href || data.actions[0]?.href || '/resume'}>
                          {t(data.nextAction?.titleKey || 'dashboard.nextAction')}
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 border-t border-zinc-200 bg-zinc-50/60 sm:grid-cols-3 lg:grid-cols-1 lg:border-l lg:border-t-0 dark:border-zinc-800 dark:bg-zinc-900/20">
                      <OverviewMetric
                        label={t('dashboard.metricResume')}
                        value={`${data.metrics.resumeImpact}%`}
                        hint={t('dashboard.metricResumeHint')}
                      />
                      <OverviewMetric
                        label={t('dashboard.metricInterview')}
                        value={`${data.metrics.interviewStrength}`}
                        hint={t('dashboard.metricInterviewHint')}
                      />
                      <OverviewMetric
                        label={t('dashboard.metricHealth')}
                        value={data.weeklyGoal > 0 ? `${data.weeklyApplications}/${data.weeklyGoal}` : '—'}
                        hint={data.weeklyGoal > 0 ? `${data.metrics.applicationHealth}% ${t('dashboard.metricHealthDone')}` : t('dashboard.metricHealthNoGoal')}
                        last
                      />
                    </div>
                  </div>
            </section>
            {data.profileReady === false && (
              <section className="order-2 rounded-lg border border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/20">
                <div className="flex flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {t('dashboard.onboardingRequired')}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      {(data.missingSteps || []).map((step) => t(`dashboard.onboardingStep.${step}`)).join(' / ')}
                    </p>
                  </div>
                  <Button asChild size="sm" className="bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">
                    <Link href="/resume">
                      {t('dashboard.action.onboarding')}
                      <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              </section>
            )}
            {data.diagnosis && (
              <details id="diagnosis" className="order-4 group rounded-lg border border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/20">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3.5 marker:hidden md:px-5">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
                      <Target className="h-3.5 w-3.5" />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('dashboard.diagnosis.title')}</p>
                      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{t(data.diagnosis.mainRouteLabelKey)}</p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-zinc-400 transition-transform group-open:rotate-90" />
                </summary>
                <section className="border-t border-zinc-200 p-4 dark:border-zinc-800 md:p-5">
                {data.selectedRegion && (data.planRegions?.length ?? 0) <= 1 && REGION_DNA[data.selectedRegion as RegionKey] && (
                  <div className="mb-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {t('dashboard.diagnosis.regionLogic')}
                      </p>
                      <Badge variant="outline" className="text-[10px]">
                        {t(`region.${data.selectedRegion}`)}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {[
                        { labelKey: 'dashboard.diagnosis.atsPrefs', items: REGION_DNA[data.selectedRegion as RegionKey].atsPreferences },
                        { labelKey: 'dashboard.diagnosis.resumeStyle', items: REGION_DNA[data.selectedRegion as RegionKey].resumeStyle },
                        { labelKey: 'dashboard.diagnosis.interviewRhythm', items: REGION_DNA[data.selectedRegion as RegionKey].interviewRhythm },
                        { labelKey: 'dashboard.diagnosis.keySignals', items: REGION_DNA[data.selectedRegion as RegionKey].keySignals },
                      ].map((section) => (
                        <div key={section.labelKey}>
                          <p className="mb-2 text-xs font-medium text-zinc-500">{t(section.labelKey)}</p>
                          <ul className="space-y-1.5">
                            {section.items.map((item) => (
                              <li key={item} className="text-xs leading-5 text-zinc-700 dark:text-zinc-300">
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {data.planRegions && data.planRegions.length > 1 && (
                  <div className="mb-4 space-y-4">
                    {data.planRegions.map((regionPlan) => {
                      const diagnosis = regionPlan.plan.diagnosis;
                      if (!diagnosis) return null;
                      return (
                        <div key={regionPlan.region} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                {t(`region.${regionPlan.region}`)}
                              </span>
                              <Badge variant="outline" className="text-[10px]">
                                {t(regionPlan.feasibilityLabelKey)}
                              </Badge>
                            </div>
                            <span className="text-xs text-zinc-500">
                              {t(diagnosis.windowLabelKey)} · {t(diagnosis.mainRouteLabelKey)}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-zinc-500">{t('dashboard.diagnosis.mainRoute')}</p>
                              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                {t(diagnosis.mainRouteLabelKey)}
                              </p>
                              {diagnosis.backupRoute && (
                                <>
                                  <p className="text-xs font-medium text-zinc-500">{t('dashboard.diagnosis.backupRoute')}</p>
                                  <p className="text-sm text-zinc-700 dark:text-zinc-300">
                                    {t(diagnosis.backupRoute.labelKey)}
                                  </p>
                                </>
                              )}
                              {diagnosis.mainSeason && (
                                <>
                                  <p className="text-xs font-medium text-zinc-500">{t('dashboard.diagnosis.mainSeason')}</p>
                                  <p className="text-sm text-zinc-700 dark:text-zinc-300">
                                    {t(diagnosis.mainSeason.labelKey)}
                                  </p>
                                </>
                              )}
                            </div>
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-zinc-500">{t('dashboard.diagnosis.visaStatus')}</p>
                              <p className="text-sm text-zinc-900 dark:text-zinc-100">
                                {t(diagnosis.visaStatusLabelKey || `dashboard.visaStatus.${diagnosis.visaStatus}`)}
                              </p>
                              <p className="text-xs font-medium text-zinc-500">{t('dashboard.diagnosis.risks')}</p>
                              {diagnosis.risks.length > 0 ? (
                                <ul className="space-y-1">
                                  {diagnosis.risks.map((risk) => (
                                    <li key={risk.key} className="flex items-start gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                                      <span className={`mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${riskLevelColor[risk.level]}`} />
                                      {t(risk.labelKey)}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-xs text-zinc-500">{t('dashboard.diagnosis.noRisks')}</p>
                              )}
                              {diagnosis.visaTimeline && diagnosis.visaTimeline.entries.length > 0 && (
                                <div>
                                  <p className="text-xs font-medium text-zinc-500">{t('dashboard.diagnosis.visaTimeline')}</p>
                                  <div className="mt-1 space-y-1">
                                    {diagnosis.visaTimeline.entries.map((entry) => (
                                      <div key={entry.key} className="flex items-start gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                                        <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-zinc-400 flex-shrink-0" />
                                        <div>
                                          <p>{t(entry.labelKey)}</p>
                                          {entry.actionKey && <p className="text-zinc-500">{t(entry.actionKey)}</p>}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="mt-4 grid grid-cols-1 gap-3 border-t border-zinc-200 pt-4 sm:grid-cols-2 lg:grid-cols-4 dark:border-zinc-800">
                            {[
                              { labelKey: 'dashboard.diagnosis.atsPrefs', items: REGION_DNA[regionPlan.region as RegionKey].atsPreferences },
                              { labelKey: 'dashboard.diagnosis.resumeStyle', items: REGION_DNA[regionPlan.region as RegionKey].resumeStyle },
                              { labelKey: 'dashboard.diagnosis.interviewRhythm', items: REGION_DNA[regionPlan.region as RegionKey].interviewRhythm },
                              { labelKey: 'dashboard.diagnosis.keySignals', items: REGION_DNA[regionPlan.region as RegionKey].keySignals },
                            ].map((section) => (
                              <div key={section.labelKey}>
                                <p className="mb-2 text-xs font-medium text-zinc-500">{t(section.labelKey)}</p>
                                <ul className="space-y-1.5">
                                  {section.items.map((item) => (
                                    <li key={item} className="text-xs leading-5 text-zinc-700 dark:text-zinc-300">
                                      {item}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800">
                    <CardContent className="p-5 space-y-3">
                      <div>
                        <p className="text-xs font-medium text-zinc-500 mb-1">
                          {t('dashboard.diagnosis.window')}
                        </p>
                        <p className="text-base font-semibold text-zinc-900 dark:text-zinc-900">
                          {t(data.diagnosis.windowLabelKey)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-zinc-500 mb-1">
                          {t('dashboard.diagnosis.mainRoute')}
                        </p>
                        <p className="text-base font-semibold text-zinc-900 dark:text-zinc-900">
                          {t(data.diagnosis.mainRouteLabelKey)}
                        </p>
                      </div>
                      {data.diagnosis.backupRoute && (
                        <div>
                          <p className="text-xs font-medium text-zinc-500 mb-1">
                            {t('dashboard.diagnosis.backupRoute')}
                          </p>
                          <p className="text-sm font-medium text-zinc-700">
                            {t(data.diagnosis.backupRoute.labelKey)}
                          </p>
                          {getLocalizedText(data.diagnosis.llmBackupRoute, locale) && (
                            <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
                              {getLocalizedText(data.diagnosis.llmBackupRoute, locale)}
                            </p>
                          )}
                          {data.diagnosis.backupRoute?.visaViable && (
                            <p className="mt-1 text-xs font-medium text-zinc-500 leading-relaxed">
                              {t(`dashboard.backupVisa.${data.diagnosis.backupRoute.visaViable}`)}
                            </p>
                          )}
                        </div>
                      )}
                      {data.diagnosis.mainSeason && (
                        <div>
                          <p className="text-xs font-medium text-zinc-500 mb-1">
                            {t('dashboard.diagnosis.mainSeason')}
                          </p>
                          <p className="text-sm font-medium text-zinc-700">
                            {t(data.diagnosis.mainSeason.labelKey)}
                          </p>
                          {data.diagnosis.mainSeason.noteKey && (
                            <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
                              {t(data.diagnosis.mainSeason.noteKey)}
                            </p>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                  <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800 lg:col-span-2">
                    <CardContent className="p-5">
                      {data.diagnosis.lowGradeFocus ? (
                        <div className="mb-4 rounded-lg border border-zinc-200 p-3">
                          <p className="text-xs text-zinc-500 leading-relaxed">
                            {t('dashboard.diagnosis.futureVisaPrep')}
                          </p>
                        </div>
                      ) : (
                      <div className="mb-4 rounded-lg border border-zinc-200 p-3">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          <p className="text-xs text-zinc-500">
                            {t('dashboard.diagnosis.visaStatus')}
                            <span className="ml-2 font-medium text-zinc-900 dark:text-zinc-900">
                              {t(data.diagnosis.visaStatusLabelKey || `dashboard.visaStatus.${data.diagnosis.visaStatus}`)}
                            </span>
                          </p>
                          <p className="text-xs text-zinc-500">
                            {t('dashboard.diagnosis.visaFeasibility')}
                            <span className="ml-2 font-medium text-zinc-900 dark:text-zinc-900">
                              {t(`dashboard.visaFeasibility.${data.diagnosis.visaFeasibility}`)}
                            </span>
                          </p>
                        </div>
                        {getLocalizedText(data.diagnosis.visaNote, locale) && (
                          <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
                            {getLocalizedText(data.diagnosis.visaNote, locale)}
                          </p>
                        )}
                        {data.diagnosis.visaTimeline && data.diagnosis.visaTimeline.entries.length > 0 && (
                          <div className="mt-3 space-y-1.5">
                            {data.diagnosis.visaTimeline.entries.map((entry) => (
                              <div key={entry.key} className="flex items-start gap-2 text-xs">
                                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-zinc-400 flex-shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-zinc-700">
                                    {t(entry.labelKey)}
                                    {entry.estimatedDate && (
                                      <span className="ml-1 text-zinc-500">
                                        {entry.estimatedDate}
                                      </span>
                                    )}
                                  </p>
                                  {entry.actionKey && (
                                    <p className="text-zinc-500">
                                      {t(entry.actionKey)}
                                    </p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {data.diagnosis.visaStatus === 'unknown' && (
                          <Link
                            href="/resume"
                            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-zinc-900 dark:text-zinc-900 hover:underline"
                          >
                            {t('dashboard.diagnosis.confirmVisa')}
                            <ArrowRight className="h-3 w-3" />
                          </Link>
                        )}
                      </div>
                      )}
                      <p className="text-xs font-medium text-zinc-500 mb-3">
                        {t('dashboard.diagnosis.risks')}
                      </p>
                      {data.diagnosis.risks.length === 0 ? (
                        <p className="text-sm text-zinc-500">
                          {t('dashboard.diagnosis.noRisks')}
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {data.diagnosis.risks.map((risk) => (
                            <div
                              key={risk.key}
                              className="flex items-start gap-2 rounded-lg border border-zinc-200 px-3 py-2"
                            >
                              <span className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${riskLevelColor[risk.level]}`} />
                              <span className="text-sm text-zinc-700">
                                {t(risk.labelKey)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {getLocalizedText(data.diagnosis.llmNarrative, locale) && (
                        <p className="mt-4 text-sm text-zinc-700 leading-relaxed">
                          {getLocalizedText(data.diagnosis.llmNarrative, locale)}
                        </p>
                      )}
                      {getLocalizedText(data.diagnosis.verificationNote, locale) && (
                        <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
                          {getLocalizedText(data.diagnosis.verificationNote, locale)}
                        </p>
                      )}
                      {data.personality?.hasAssessment ? (
                        <div className="mt-4 rounded-lg border border-zinc-200 p-3">
                          <p className="text-xs font-medium text-zinc-500 mb-3">
                            {t('dashboard.personalityTitle')}
                          </p>
                          {(() => {
                            const core = (data.personality?.recommendations || []).slice(0, 3);
                            const alternatives = (data.personality?.recommendations || []).slice(3, 5);
                            const isHk = data.selectedRegion === 'hk';
                            const allBlocked = (data.personality?.recommendations || []).length > 0
                              && data.personality.recommendations.every((item) => item.feasibilityBlocked);
                            const renderCard = (recommendation: typeof core[number]) => (
                              <div key={recommendation.roleKey} className="rounded-lg border border-zinc-200 p-3">
                                <div className="flex items-start justify-between gap-2 mb-1">
                                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-900">
                                    {t(recommendation.labelKey)}
                                  </p>
                                  <Badge variant="secondary" className="text-[10px]">
                                    {t(`personality.fit.${recommendation.fit}`)}
                                  </Badge>
                                </div>
                                <p className="text-xs text-zinc-500 mb-2">{recommendation.score}%</p>
                                {recommendation.feasibilityBlocked && (
                                  <Badge className="mb-2 bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200">
                                    {t('personality.feasibilityBlocked')}
                                  </Badge>
                                )}
                                <div className="mb-3 space-y-1">
                                  {[
                                    { labelKey: 'personality.scorePersonality', value: recommendation.personalityFit ?? 0 },
                                    { labelKey: 'personality.scoreResume', value: recommendation.resumeFit ?? 0 },
                                    { labelKey: 'personality.scoreMarket', value: recommendation.marketScore ?? 0 },
                                    { labelKey: 'personality.scoreFeasibility', value: recommendation.feasibilityScore ?? 0 },
                                  ].map((dimension) => (
                                    <div key={dimension.labelKey} className="flex items-center gap-2">
                                      <span className="w-16 text-[10px] text-zinc-400">{t(dimension.labelKey)}</span>
                                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                                        <div
                                          className="h-full rounded-full bg-zinc-900 dark:bg-white"
                                          style={{ width: `${dimension.value}%` }}
                                        />
                                      </div>
                                      <span className="w-6 text-right text-[10px] text-zinc-500">{dimension.value}</span>
                                    </div>
                                  ))}
                                </div>
                                <ul className="space-y-1">
                                  {recommendation.reasons.map((reason) => (
                                    <li key={reason} className="text-xs text-zinc-500 leading-relaxed">
                                      {t(reason)}
                                    </li>
                                  ))}
                                </ul>
                                {recommendation.sponsorship && (
                                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                    <Badge variant="outline" className="text-[10px]">
                                      {t(isHk ? `personality.sponsor.hk_${recommendation.sponsorship.level}` : `personality.sponsor.${recommendation.sponsorship.level}`)}
                                    </Badge>
                                    {recommendation.sponsorship.activeJobCount > 0 && (
                                      <span className="text-[10px] text-zinc-500">
                                        {isHk
                                          ? t('personality.jobCount', { count: recommendation.sponsorship.activeJobCount })
                                          : `${recommendation.sponsorship.sponsorJobCount} / ${recommendation.sponsorship.activeJobCount}`}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                            return (
                              <>
                                {allBlocked ? (
                                  <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
                                    {t('personality.identityFirst')}
                                  </div>
                                ) : (
                                  <>
                                    <p className="text-xs font-medium text-zinc-500 mb-2">
                                      {t('personality.recommendationsCore')}
                                    </p>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                      {core.map(renderCard)}
                                    </div>
                                  </>
                                )}
                                {alternatives.length > 0 && (
                                  <>
                                    <p className="mt-3 text-xs font-medium text-zinc-500 mb-2">
                                      {t('personality.recommendationsAlternatives')}
                                    </p>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                      {alternatives.map(renderCard)}
                                    </div>
                                  </>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      ) : data.diagnosis.risks.some((risk) => risk.key === 'missing_direction') ? (
                        <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-zinc-200 p-3">
                          <div>
                            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-900">
                              {t('dashboard.personalityCtaTitle')}
                            </p>
                            <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
                              {t('dashboard.personalityCtaDesc')}
                            </p>
                          </div>
                          <Button size="sm" asChild>
                            <Link href="/resume?quiz=1">{t('dashboard.personalityStart')}</Link>
                          </Button>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                </div>
                </section>
              </details>
            )}
            {/* legacy networking block
              <section>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-zinc-900 text-white">
                      <Briefcase className="h-3.5 w-3.5" />
                    </span>
                    <h3 className="text-sm font-medium text-zinc-400 dark:text-zinc-500 tracking-widest uppercase">
                      {t('dashboard.networking.title')}
                    </h3>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => loadNetworking(networkingProgress?.stage || 1)} disabled={networkingLoading}>
                    {networkingLoading ? (
                      <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />{t('dashboard.networking.loading')}</>
                    ) : (
                      <><RefreshCw className="h-3.5 w-3.5 mr-1" />{t('dashboard.networking.regenerate')}</>
                    )}
                  </Button>
                </div>
                {networkingProgress && (
                  <div className="mb-4">
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      {NETWORKING_STAGES.map((stage, index) => (
                        <button
                          key={stage.key}
                          type="button"
                          onClick={() => loadNetworking(index + 1)}
                          className={`shrink-0 rounded-full px-3 py-1 text-xs border transition-colors ${
                            networkingProgress.stage === index + 1
                              ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-white dark:text-zinc-900 dark:border-white'
                              : 'border-zinc-200 text-zinc-700'
                          }`}
                        >
                          {index + 1}. {t(stage.titleKey)}
                        </button>
                      ))}
                    </div>
                    {(() => {
                      const currentStage = NETWORKING_STAGES[networkingProgress.stage - 1];
                      if (!currentStage) return null;
                      return (
                        <div className="rounded-lg border border-zinc-200 p-3">
                          <p className="text-xs font-medium text-zinc-900 dark:text-zinc-900 mb-2">
                            {t('dashboard.networking.currentStage')}：{t(currentStage.titleKey)}
                          </p>
                          <div className="space-y-1.5">
                            {currentStage.milestones.map((milestone) => {
                              const checked = networkingProgress.completedMilestones.includes(milestone);
                              return (
                                <label key={milestone} className="flex items-center gap-2 text-xs text-zinc-700">
                                  <input
                                    type="checkbox"
                                    className="accent-zinc-900"
                                    checked={checked}
                                    onChange={() => handleToggleNetworkingMilestone(milestone)}
                                  />
                                  {t(milestone)}
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
                {networkingLoading && !networking ? (
                  <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800">
                    <CardContent className="p-6 text-center text-sm text-zinc-500">
                      {t('dashboard.networking.loading')}
                    </CardContent>
                  </Card>
                ) : networkingError ? (
                  <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800">
                    <CardContent className="p-6 text-center text-sm text-red-500">
                      {networkingError}
                    </CardContent>
                  </Card>
                ) : networking ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800">
                      <CardContent className="p-5">
                        <p className="text-xs font-medium text-zinc-500 mb-3">
                          {t('dashboard.networking.peopleTypes')}
                        </p>
                        <div className="space-y-3">
                          {networking.peopleTypes.map((item) => (
                            <div key={item.title} className="rounded-lg border border-zinc-200 p-3">
                              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-900">{item.title}</p>
                              <p className="mt-1 text-xs text-zinc-500 leading-relaxed">{item.why}</p>
                              <p className="mt-1 text-xs text-zinc-500">{item.keywords.join(' / ')}</p>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                    <div className="space-y-4">
                      <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800">
                        <CardContent className="p-5">
                          <p className="text-xs font-medium text-zinc-500 mb-3">
                            {t('dashboard.networking.keywords')}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {networking.searchKeywords.map((keyword) => (
                              <Badge key={keyword} variant="outline" className="text-xs">
                                {keyword}
                              </Badge>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                      <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800">
                        <CardContent className="p-5">
                          <p className="text-xs font-medium text-zinc-500 mb-3">
                            {t('dashboard.networking.outreach')}
                          </p>
                          <div className="space-y-3">
                            {networking.outreach.map((item) => (
                              <div key={item.scenario}>
                                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-900">{item.scenario}</p>
                                <p className="mt-1 text-xs text-zinc-500 leading-relaxed">{item.script}</p>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                      <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800">
                        <CardContent className="p-5">
                          <p className="text-xs font-medium text-zinc-500 mb-3">
                            {t('dashboard.networking.sequence')}
                          </p>
                          <div className="space-y-2">
                            {networking.sequence.map((item) => (
                              <div key={item.step} className="flex items-start gap-2 text-xs">
                                <span className="mt-0.5 font-medium text-zinc-700">{item.step}</span>
                                <span className="text-zinc-500">{item.action}</span>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                      <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800">
                        <CardContent className="p-5">
                          <p className="text-xs font-medium text-zinc-500 mb-3">
                            {t('dashboard.networking.stageTips')}
                          </p>
                          <ul className="space-y-1.5 text-xs text-zinc-700">
                            {networking.stageTips.map((tip) => <li key={tip}>- {tip}</li>)}
                          </ul>
                        </CardContent>
                      </Card>
                      <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800">
                        <CardContent className="p-5">
                          <p className="text-xs font-medium text-zinc-500 mb-3">
                            {t('dashboard.networking.conversationQuestions')}
                          </p>
                          <ul className="space-y-1.5 text-xs text-zinc-700">
                            {networking.conversationQuestions.map((question) => <li key={question}>- {question}</li>)}
                          </ul>
                        </CardContent>
                      </Card>
                      <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800">
                        <CardContent className="p-5">
                          <p className="text-xs font-medium text-zinc-500 mb-3">
                            {t('dashboard.networking.maintenanceContent')}
                          </p>
                          <div className="space-y-3">
                            {networking.maintenanceContent.map((item) => (
                              <div key={item.title}>
                                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-900">
                                  {item.title} <span className="text-xs text-zinc-500">({item.channel})</span>
                                </p>
                                <p className="mt-1 text-xs text-zinc-500 leading-relaxed">{item.content}</p>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                ) : null}
              </section>
            */}
            {/* 个性化求职规划 */}
            {data.plan && planGroups && (
              <section id="plan" className="order-3 scroll-mt-24">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
                  <div>
                    <h3 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                      {t('dashboard.planTitle')}
                    </h3>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                    {data.latestResumeId ? (
                      <div className="flex items-center gap-2">
                        <MapPin className="h-3.5 w-3.5 text-zinc-500" />
                        <span className="text-xs text-zinc-500">
                          {t('dashboard.regionLabel')}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {(data.selectedRegions || []).map((region) => (
                            <Badge key={region} variant="outline" className="text-[10px]">
                              {t(`region.${region}`)}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-500">
                        {t('dashboard.regionHint')}
                      </span>
                    )}
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <span className="hidden sm:inline text-zinc-700 dark:text-zinc-700">
                        |
                      </span>
                      <span>
                        {t('dashboard.planContext', {
                          region: t(data.plan.context.region),
                          stage: t(data.plan.context.stage),
                          role: t(data.plan.context.role),
                        })}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 divide-y divide-zinc-200 border-y border-zinc-200 md:grid-cols-3 md:divide-x md:divide-y-0 dark:divide-zinc-800 dark:border-zinc-800">
                  <PlanColumn
                    icon={<Zap className="h-4 w-4" />}
                    label={t('dashboard.planNow')}
                    items={planGroups.now}
                    translate={t}
                  />
                  <PlanColumn
                    icon={<Calendar className="h-4 w-4" />}
                    label={t('dashboard.planWeek')}
                    items={planGroups.week}
                    translate={t}
                  />
                  <PlanColumn
                    icon={<LineChart className="h-4 w-4" />}
                    label={t('dashboard.planMonth')}
                    items={planGroups.month}
                    translate={t}
                  />
                </div>
              </section>
            )}

            {!data.plan && (
              <section className="order-3">
                <h3 className="text-sm font-medium text-zinc-400 dark:text-zinc-500 tracking-widest uppercase mb-4">
                  {t('dashboard.planTitle')}
                </h3>
                <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800 border-dashed">
                  <CardContent className="p-6 text-center">
                    <p className="text-sm text-zinc-500 max-w-md mx-auto leading-relaxed">
                      {t('dashboard.planEmpty')}
                    </p>
                    <Button
                      asChild
                      className="mt-4 rounded-full bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                    >
                      <Link href="/resume">{t('dashboard.action.uploadResume')}</Link>
                    </Button>
                  </CardContent>
                </Card>
              </section>
            )}

            <div id="execution" className="order-2 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
              {/* 行动建议 */}
              <section>
                <div className="mb-4">
                  <h3 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                    {t('dashboard.actionsTitle')}
                  </h3>
                </div>
                <div className="border-y border-zinc-200 dark:border-zinc-800">
                    {data.actions.map((action, idx) => (
                      <Link
                        key={`${action.titleKey}-${idx}`}
                        href={action.href}
                        className="group flex items-center justify-between border-b border-zinc-200 p-4 transition-colors last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/50 md:p-5"
                      >
                        <div className="flex items-center gap-4">
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${priorityBadge[action.priority].className}`}
                          >
                            {t(`dashboard.priority.${action.priority}`)}
                          </span>
                          <span className="text-sm md:text-base font-medium text-zinc-900 dark:text-zinc-900">
                            {t(action.titleKey, action.titleParams)}
                          </span>
                        </div>
                        <ArrowRight className="h-4 w-4 text-zinc-700 group-hover:text-zinc-900 dark:text-zinc-600 dark:group-hover:text-zinc-900 transition-colors" />
                      </Link>
                    ))}
                </div>
              </section>

              {/* 智能提醒 */}
              <section id="reminders">
                <div className="mb-4">
                  <h3 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                    {t('dashboard.remindersTitle')}
                  </h3>
                </div>
                <div>
                  {data.reminders.length === 0 && (
                    <div className="border-y border-dashed border-zinc-200 py-5 text-center text-sm text-zinc-500 dark:border-zinc-800">
                      {t('dashboard.noReminders')}
                    </div>
                  )}
                  {data.reminders.map((reminder) => (
                    <div
                      key={reminder.type}
                      className="border-b border-zinc-200 py-4 last:border-b-0 dark:border-zinc-800"
                    >
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5">
                            <Bell className="h-4 w-4 text-zinc-500" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-900 mb-1">
                              {t(reminder.titleKey, reminder.titleParams)}
                            </p>
                            <p className="text-xs text-zinc-500 leading-relaxed">
                              {t(reminder.descriptionKey, reminder.descriptionParams)}
                            </p>
                          </div>
                        </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Interview evaluations - compact list */}
              {data.interviewEvaluations && data.interviewEvaluations.length > 0 && (
                <section>
                  <h3 className="text-sm font-medium text-zinc-400 dark:text-zinc-500 tracking-widest uppercase mb-4">
                    {t('dashboard.evaluationsTitle')}
                  </h3>
                  <div className="rounded-lg border border-zinc-200 overflow-hidden divide-y divide-white/10">
                    {data.interviewEvaluations.slice(0, 10).map((ev) => {
                      const scoreColor =
                        ev.overallScore != null
                          ? ev.overallScore >= 7
                            ? 'bg-zinc-900 text-white'
                            : ev.overallScore >= 4
                            ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-900'
                            : 'bg-zinc-100 text-zinc-500'
                          : 'bg-zinc-100 text-zinc-500';
                      return (
                          <button
                            key={ev.id}
                            type="button"
                            onClick={() => void loadInterviewDetail(ev.id)}
                            className="w-full px-4 py-3 flex items-center justify-between text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/50 focus-visible:outline-none focus-visible:bg-zinc-50 dark:focus-visible:bg-zinc-900/50"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                            <div className="w-7 h-7 rounded-lg bg-zinc-900 flex items-center justify-center flex-shrink-0">
                              <MessageSquare className="h-3.5 w-3.5 text-white" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-900 truncate">
                                {ev.targetCompany || t('dashboard.unknownCompany')}
                              </p>
                              <p className="text-xs text-zinc-500">
                                {formatInterviewDate(ev.completedAt)}
                                {ev.interviewType ? ` · ${ev.interviewType}` : ''}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {ev.overallScore != null && (
                              <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg text-xs font-bold ${scoreColor}`}>
                                {ev.overallScore}
                              </span>
                            )}
                              {ev.reportGrade && (
                              <span className="text-xs font-medium text-zinc-500">
                                {ev.reportGrade}
                              </span>
                              )}
                              <ArrowRight className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                            </div>
                          </button>
                      );
                    })}
                  </div>
                </section>
              )}

            </div>

            {data.diagnosis?.window === 'preparation' && (
              <section id="networking" className="order-5">
            {networkingError && (
              <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800 mb-4">
                <CardContent className="p-6 text-center text-sm text-red-500">
                  {networkingError}
                </CardContent>
              </Card>
            )}
            {networkingLoading && !networking && (
              <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800 mb-4">
                <CardContent className="p-6 text-center text-sm text-zinc-500">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                  {t('dashboard.networking.loading')}
                </CardContent>
              </Card>
            )}
            {!networkingLoading && !networking && !networkingError && (
              <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800 mb-4">
                <CardContent className="p-6 flex flex-col items-center gap-3 text-center">
                  <p className="text-sm text-zinc-500">{t('dashboard.networking.title')}</p>
                  <Button variant="outline" size="sm" onClick={() => loadNetworking()}>
                    <Zap className="h-3.5 w-3.5 mr-1" />
                    {t('dashboard.networking.regenerate')}
                  </Button>
                </CardContent>
              </Card>
            )}
            {networkingProgress && networking && (
              <div>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-zinc-900 text-white">
                      <Briefcase className="h-3.5 w-3.5" />
                    </span>
                    <h3 className="text-sm font-medium text-zinc-400 dark:text-zinc-500 tracking-widest uppercase">
                      {t('dashboard.networking.title')}
                    </h3>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => loadNetworking()} disabled={networkingLoading}>
                    {networkingLoading ? (
                      <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />{t('dashboard.networking.loading')}</>
                    ) : (
                      <><RefreshCw className="h-3.5 w-3.5 mr-1" />{t('dashboard.networking.regenerate')}</>
                    )}
                  </Button>
                </div>
                <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800 overflow-hidden">
                  <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr]">
                    <aside className="hidden lg:block border-r border-zinc-200 p-3 space-y-1">
                      {NETWORKING_STAGES.map((stage, index) => {
                        const stageMilestones = stage.milestones;
                        const done = stageMilestones.length > 0
                          && stageMilestones.every((item) => networkingProgress?.completedMilestones.includes(item));
                        return (
                          <button
                            key={stage.key}
                            type="button"
                            onClick={() => switchNetworkingStage(index + 1)}
                            className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                              activeNetworkingStage === index + 1
                                ? 'bg-white text-zinc-900 hover:bg-zinc-200'
                                : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-700 dark:hover:bg-zinc-800'
                            }`}
                          >
                            <span className="w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0">
                              {done ? <Check className="h-3 w-3" /> : index + 1}
                            </span>
                            <span className="truncate">{t(stage.titleKey)}</span>
                          </button>
                        );
                      })}
                    </aside>
                    <div>
                      <div className="lg:hidden flex gap-2 overflow-x-auto px-4 pt-3">
                        {NETWORKING_STAGES.map((stage, index) => (
                          <button
                            key={stage.key}
                            type="button"
                            onClick={() => switchNetworkingStage(index + 1)}
                            className={`shrink-0 rounded-full px-3 py-1 text-xs border ${
                              activeNetworkingStage === index + 1
                                ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-white dark:text-zinc-900 dark:border-white'
                                : 'border-zinc-200 text-zinc-700'
                            }`}
                          >
                            {index + 1}. {t(stage.titleKey)}
                          </button>
                        ))}
                      </div>
                      <div className="p-4 md:p-5">
                        {(() => {
                          const viewingStage = NETWORKING_STAGES[activeNetworkingStage - 1] || NETWORKING_STAGES[0];
                          const progressStage = NETWORKING_STAGES[networkingProgress?.stage - 1 || 0];
                          const total = progressStage?.milestones.length || 0;
                          const done = progressStage?.milestones.filter((item) =>
                            networkingProgress?.completedMilestones.includes(item)).length || 0;
                          const percent = total > 0 ? Math.round((done / total) * 100) : 0;
                          return (
                            <>
                              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                <div>
                                  <p className="text-xs text-zinc-500">
                                    {t('dashboard.networking.currentStage')}
                                  </p>
                                  <p className="text-base font-semibold text-zinc-900 dark:text-zinc-900">
                                    {t(viewingStage?.titleKey || 'dashboard.networking.stage.research')}
                                  </p>
                                </div>
                                <p className="text-xs text-zinc-500">
                                  {done} / {total}
                                </p>
                              </div>
                              <div className="mt-3 h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                                <div className="h-full bg-zinc-900 transition-all" style={{ width: `${percent}%` }} />
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {progressStage?.milestones.map((milestone) => {
                                  const checked = networkingProgress?.completedMilestones.includes(milestone);
                                  return (
                                    <label key={milestone} className="flex items-center gap-1.5 rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        className="accent-zinc-900"
                                        checked={Boolean(checked)}
                                        onChange={() => handleToggleNetworkingMilestone(milestone)}
                                      />
                                      {t(milestone)}
                                    </label>
                                  );
                                })}
                              </div>
                              <Tabs defaultValue="people" className="mt-5">
                                <TabsList className="w-full justify-start overflow-x-auto">
                                  <TabsTrigger value="people">{t('dashboard.networking.tabPeople')}</TabsTrigger>
                                  <TabsTrigger value="talk">{t('dashboard.networking.tabTalk')}</TabsTrigger>
                                  <TabsTrigger value="maintain">{t('dashboard.networking.tabMaintain')}</TabsTrigger>
                                  <TabsTrigger value="rhythm">{t('dashboard.networking.tabRhythm')}</TabsTrigger>
                                </TabsList>
                                <TabsContent value="people" className="pt-4 space-y-4">
                                  <div>
                                    <p className="text-xs font-medium text-zinc-500 mb-2">
                                      {t('dashboard.networking.peopleTypes')}
                                    </p>
                                    <div className="space-y-2">
                                      {networking.peopleTypes.map((item) => (
                                        <div key={item.title} className="rounded-lg border border-zinc-200 p-3">
                                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-900">{item.title}</p>
                                          <p className="mt-1 text-xs text-zinc-500 leading-relaxed">{item.why}</p>
                                          <p className="mt-1 text-xs text-zinc-500">{item.keywords.join(' / ')}</p>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                  <div>
                                    <p className="text-xs font-medium text-zinc-500 mb-2">
                                      {t('dashboard.networking.keywords')}
                                    </p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {networking.searchKeywords.map((keyword) => (
                                        <Badge key={keyword} variant="outline" className="text-xs">{keyword}</Badge>
                                      ))}
                                    </div>
                                  </div>
                                </TabsContent>
                                <TabsContent value="talk" className="pt-4 space-y-4">
                                  <div>
                                    <p className="text-xs font-medium text-zinc-500 mb-2">
                                      {t('dashboard.networking.outreach')}
                                    </p>
                                    <div className="space-y-2">
                                      {networking.outreach.map((item) => (
                                        <div key={item.scenario} className="rounded-lg border border-zinc-200 p-3">
                                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-900">{item.scenario}</p>
                                          <p className="mt-1 text-xs text-zinc-500 leading-relaxed">{item.script}</p>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                  <div>
                                    <p className="text-xs font-medium text-zinc-500 mb-2">
                                      {t('dashboard.networking.conversationQuestions')}
                                    </p>
                                    <ul className="space-y-1.5 text-xs text-zinc-700">
                                      {networking.conversationQuestions.map((question) => <li key={question}>- {question}</li>)}
                                    </ul>
                                  </div>
                                </TabsContent>
                                <TabsContent value="maintain" className="pt-4 space-y-4">
                                  <div>
                                    <p className="text-xs font-medium text-zinc-500 mb-2">
                                      {t('dashboard.networking.maintenanceContent')}
                                    </p>
                                    <div className="space-y-2">
                                      {networking.maintenanceContent.map((item) => (
                                        <div key={item.title} className="rounded-lg border border-zinc-200 p-3">
                                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-900">
                                            {item.title} <span className="text-xs text-zinc-500">({item.channel})</span>
                                          </p>
                                          <p className="mt-1 text-xs text-zinc-500 leading-relaxed">{item.content}</p>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                  <div>
                                    <p className="text-xs font-medium text-zinc-500 mb-2">
                                      {t('dashboard.networking.stageTips')}
                                    </p>
                                    <ul className="space-y-1.5 text-xs text-zinc-700">
                                      {networking.stageTips.map((tip) => <li key={tip}>- {tip}</li>)}
                                    </ul>
                                  </div>
                                </TabsContent>
                                <TabsContent value="rhythm" className="pt-4">
                                  <p className="text-xs font-medium text-zinc-500 mb-2">
                                    {t('dashboard.networking.sequence')}
                                  </p>
                                  <div className="space-y-2">
                                    {networking.sequence.map((item) => (
                                      <div key={item.step} className="flex items-start gap-2 text-xs">
                                        <span className="mt-0.5 font-medium text-zinc-700">{item.step}</span>
                                        <span className="text-zinc-500">{item.action}</span>
                                      </div>
                                    ))}
                                  </div>
                                </TabsContent>
                              </Tabs>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            )}
              </section>
            )}

            {/* 成长故事线 */}
            <details id="story" className="order-6 group rounded-lg border border-zinc-200 dark:border-zinc-800">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3.5 marker:hidden md:px-5">
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('dashboard.storyTitle')}</p>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{t(data.story.resumeKey, data.story.resumeParams)}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-zinc-400 transition-transform group-open:rotate-90" />
              </summary>
              <div className="grid grid-cols-1 gap-3 border-t border-zinc-200 p-4 dark:border-zinc-800 md:grid-cols-3 md:p-5">
                <StoryCard
                  icon={<LineChart className="h-4 w-4" />}
                  title={t('dashboard.storyResume')}
                  description={t(data.story.resumeKey, data.story.resumeParams)}
                />
                <StoryCard
                  icon={<Zap className="h-4 w-4" />}
                  title={t('dashboard.storyInterview')}
                  description={t(data.story.interviewKey, data.story.interviewParams)}
                />
                <StoryCard
                  icon={<Briefcase className="h-4 w-4" />}
                  title={t('dashboard.storyMindset')}
                  description={t(data.story.mindsetKey, data.story.mindsetParams)}
                />
              </div>
            </details>

          </div>
        )}
        </main>
        <Dialog open={interviewDetailLoading || !!selectedInterview || !!interviewDetailError} onOpenChange={(open) => {
          if (!open && !interviewDetailLoading) {
            setSelectedInterview(null);
            setInterviewDetailError(null);
          }
        }}>
          <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto p-0">
            {interviewDetailLoading ? (
              <div className="flex min-h-56 flex-col items-center justify-center gap-3 p-8 text-sm text-zinc-500">
                <Loader2 className="h-5 w-5 animate-spin" />
                {t('dashboard.evaluation.loading')}
              </div>
            ) : interviewDetailError ? (
              <div className="p-8 text-center text-sm text-red-500">{interviewDetailError}</div>
            ) : selectedInterview ? (
              <InterviewDetailPanel
                interview={selectedInterview}
                formatDate={formatInterviewDate}
                translate={t}
              />
            ) : null}
          </DialogContent>
        </Dialog>
      </div>
    </AuthGuard>
  );
}

const riskLevelColor: Record<'high' | 'medium' | 'low', string> = {
  high: 'bg-red-500',
  medium: 'bg-amber-500',
  low: 'bg-emerald-500',
};

const priorityBadge: Record<
  'high' | 'medium' | 'low',
  { className: string }
> = {
  high: {
    className:
      'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900',
  },
  medium: {
    className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200',
  },
  low: {
    className: 'bg-zinc-50 text-zinc-500',
  },
};

function OverviewMetric({
  label,
  value,
  hint,
  last = false,
}: {
  label: string;
  value: string;
  hint: string;
  last?: boolean;
}) {
  return (
    <div className={`min-w-0 px-4 py-3.5 sm:border-r sm:border-zinc-200 lg:border-r-0 lg:px-5 lg:py-4 dark:sm:border-zinc-800 ${last ? 'sm:border-r-0' : 'border-b border-zinc-200 lg:border-b dark:border-zinc-800'}`}>
      <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">{value}</p>
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{hint}</p>
    </div>
  );
}

function PlanColumn({
  icon,
  label,
  items,
  translate,
}: {
  icon: React.ReactNode;
  label: string;
  items: PlanItem[];
  translate: (key: string, params?: Record<string, string | number>) => string;
}) {
  return (
    <div className="min-w-0 px-4 py-5 md:px-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900">
            {icon}
          </span>
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 tracking-wide">
            {label}
          </span>
        </div>
        <div className="space-y-4">
          {items.map((item, idx) => (
            <div key={idx} className="group">
              {item.href ? (
                <Link href={item.href} className="block hover:opacity-80 transition-opacity">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-1 flex items-center gap-1">
                    {item.region && (
                      <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500">
                        {translate(`region.${item.region}`)} ·
                      </span>
                    )}
                    {translate(item.titleKey, item.params)}
                    <ArrowRight className="h-3 w-3 text-zinc-400 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                  </p>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    {item.descriptionText || translate(item.descriptionKey, item.params)}
                  </p>
                </Link>
              ) : (
                <>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-1">
                    {item.region && (
                      <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500">
                        {translate(`region.${item.region}`)} ·
                      </span>
                    )}
                    {translate(item.titleKey, item.params)}
                  </p>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    {item.descriptionText || translate(item.descriptionKey, item.params)}
                  </p>
                </>
              )}
            </div>
          ))}
        </div>
    </div>
  );
}

function StoryCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card className="rounded-lg border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900">
            {icon}
          </span>
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {title}
          </span>
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
          {description}
        </p>
      </CardContent>
    </Card>
  );
}

function InterviewDetailPanel({
  interview,
  formatDate,
  translate,
}: {
  interview: DashboardInterviewDetail;
  formatDate: (value: string) => string;
  translate: (key: string, params?: Record<string, string | number>) => string;
}) {
  const report = interview.report;
  const messages = Array.isArray(interview.messages) ? interview.messages : [];
  const listItems = (items?: string[]) => (
    items && items.length > 0 ? (
      <ul className="space-y-2 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
        {items.map((item, index) => <li key={`${item}-${index}`} className="flex gap-2"><span className="text-zinc-400">{index + 1}.</span><span>{item}</span></li>)}
      </ul>
    ) : <p className="text-sm text-zinc-500">{translate('dashboard.noEvaluationDetail')}</p>
  );

  return (
    <div>
      <DialogHeader className="border-b border-zinc-200 px-6 pb-5 pt-6 text-left dark:border-zinc-800">
        <DialogTitle className="pr-8 text-xl text-zinc-900 dark:text-zinc-100">
          {interview.target_company || translate('dashboard.unknownCompany')}
        </DialogTitle>
        <DialogDescription>
          {formatDate(interview.updated_at || interview.created_at)}
          {interview.interview_type ? ` · ${interview.interview_type}` : ''}
          {interview.mode ? ` · ${interview.mode}` : ''}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-6 px-6 py-6">
        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
            <p className="text-xs text-zinc-500">{translate('dashboard.evaluation.score')}</p>
            <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{interview.overall_score ?? '—'}<span className="ml-1 text-xs font-normal text-zinc-500">/ 100</span></p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
            <p className="text-xs text-zinc-500">{translate('dashboard.evaluation.grade')}</p>
            <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{interview.report_grade || report?.verdict?.grade || '—'}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
            <p className="text-xs text-zinc-500">{translate('dashboard.evaluation.rounds')}</p>
            <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{interview.total_rounds || '—'}</p>
          </div>
        </section>

        {!report ? (
          <div className="border-y border-dashed border-zinc-200 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800">
            {translate('dashboard.noEvaluationDetail')}
          </div>
        ) : (
          <>
            {(report.verdict?.headline || report.verdict?.hireLevel) && (
              <section>
                <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{translate('dashboard.evaluation.overview')}</h3>
                {report.verdict.hireLevel && <p className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">{report.verdict.hireLevel}{report.verdict.vote ? ` · ${report.verdict.vote}` : ''}</p>}
                {report.verdict.headline && <p className="border-l-2 border-[#C46A4A] pl-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{report.verdict.headline}</p>}
              </section>
            )}

            {report.committee && report.committee.length > 0 && (
              <section>
                <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{translate('dashboard.evaluation.committee')}</h3>
                <div className="space-y-3">
                  {report.committee.map((member, index) => (
                    <div key={`${member.name || 'member'}-${index}`} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{member.name || translate('dashboard.evaluation.interviewer')}</p>
                          <p className="mt-0.5 text-xs text-zinc-500">{[member.company, member.roleLabel, member.attitude].filter(Boolean).join(' · ')}</p>
                        </div>
                        {member.grade && <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{member.grade}</span>}
                      </div>
                      {member.tags && member.tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{member.tags.map((tag) => <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>)}</div>}
                      {member.comment && <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{member.comment}</p>}
                      {member.keyMoment?.question && <div className="mt-3 rounded-md bg-zinc-50 p-3 text-xs leading-5 text-zinc-600 dark:bg-zinc-900/70 dark:text-zinc-400"><p className="font-medium text-zinc-700 dark:text-zinc-300">Q: {member.keyMoment.question}</p>{member.keyMoment.answer && <p className="mt-1">{member.keyMoment.answer}</p>}{member.keyMoment.note && <p className="mt-1 text-zinc-500">{member.keyMoment.note}</p>}</div>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {report.radar && report.radar.length > 0 && (
              <section>
                <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{translate('dashboard.evaluation.radar')}</h3>
                <div className="space-y-3">
                  {report.radar.map((dimension, index) => {
                    const score = Math.max(0, Math.min(100, dimension.score ?? 0));
                    return <div key={`${dimension.dimension || 'dimension'}-${index}`}><div className="mb-1 flex items-center justify-between gap-3 text-xs"><span className="font-medium text-zinc-700 dark:text-zinc-300">{dimension.dimension || '—'}</span><span className="text-zinc-500">{dimension.grade || score}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"><div className="h-full rounded-full bg-[#C46A4A]" style={{ width: `${score}%` }} /></div>{dimension.diagnosis && <p className="mt-1 text-xs leading-5 text-zinc-500">{dimension.diagnosis}</p>}</div>;
                  })}
                </div>
              </section>
            )}

            {report.highlights && (
              <section>
                <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{translate('dashboard.evaluation.highlights')}</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {(report.highlights.mistakes || []).map((item, index) => <div key={`mistake-${index}`} className="rounded-lg border border-red-200/80 bg-red-50/40 p-4 dark:border-red-900/50 dark:bg-red-950/20"><p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.title}</p><p className="mt-2 text-xs leading-5 text-zinc-600 dark:text-zinc-400">{item.scene}</p>{item.coach && <p className="mt-2 text-xs leading-5 text-zinc-500">{item.coach}</p>}</div>)}
                  {report.highlights.best?.title && <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/40 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/20"><p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{report.highlights.best.title}</p><p className="mt-2 text-xs leading-5 text-zinc-600 dark:text-zinc-400">{report.highlights.best.scene}</p>{report.highlights.best.coach && <p className="mt-2 text-xs leading-5 text-zinc-500">{report.highlights.best.coach}</p>}</div>}
                </div>
              </section>
            )}

            {report.actionPlan && (
              <section>
                <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{translate('dashboard.evaluation.actionPlan')}</h3>
                <div className="grid gap-4 md:grid-cols-3"><div><p className="mb-2 text-xs font-medium text-zinc-500">{translate('dashboard.evaluation.immediate')}</p>{listItems(report.actionPlan.immediate)}</div><div><p className="mb-2 text-xs font-medium text-zinc-500">{translate('dashboard.evaluation.practice')}</p>{listItems(report.actionPlan.practice)}</div><div><p className="mb-2 text-xs font-medium text-zinc-500">{translate('dashboard.evaluation.reading')}</p>{listItems(report.actionPlan.reading)}</div></div>
              </section>
            )}
          </>
        )}

        <section>
          <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{translate('dashboard.evaluation.transcript')}</h3>
          {messages.length === 0 ? <p className="border-y border-dashed border-zinc-200 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800">{translate('dashboard.noEvaluationDetail')}</p> : <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">{messages.map((message, index) => <div key={`${message.ts || index}-${index}`} className={`rounded-md p-3 ${message.role === 'candidate' ? 'ml-5 bg-[#C46A4A]/5' : 'bg-zinc-50 dark:bg-zinc-900/60'}`}><p className="mb-1 text-[11px] font-medium text-zinc-400">{message.role === 'candidate' ? translate('dashboard.evaluation.you') : (message.interviewerName || translate('dashboard.evaluation.interviewer'))}</p><p className="whitespace-pre-wrap text-sm leading-6 text-zinc-700 dark:text-zinc-300">{message.content || '—'}</p></div>)}</div>}
        </section>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 md:space-y-8">
      <Skeleton className="h-40 md:h-48 rounded-lg" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Skeleton className="h-32 rounded-lg" />
        <Skeleton className="h-32 rounded-lg" />
        <Skeleton className="h-32 rounded-lg" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
        <Skeleton className="h-64 lg:col-span-2 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    </div>
  );
}

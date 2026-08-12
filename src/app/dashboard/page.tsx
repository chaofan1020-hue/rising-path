'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Header1 } from '@/components/header1';
import { AuthGuard } from '@/components/auth-guard';
import { apiFetch } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLanguage } from '@/lib/language-context';
import PageBackButton from '@/components/page-back-button';
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
  FileText,
  LineChart,
  Loader2,
  MapPin,
  MessageSquare,
  RefreshCw,
  Target,
  TrendingUp,
  Zap,
} from 'lucide-react';

interface PlanItem {
  timeframe: 'now' | 'week' | 'month';
  titleKey: string;
  descriptionKey: string;
  params?: Record<string, string | number>;
  href?: string;
}

interface RegionOption {
  value: string;
  labelKey: string;
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
  regionOptions: RegionOption[];
  latestResumeId: number | null;
  plan: {
    context: {
      region: string;
      stage: string;
      role: string;
    };
    items: PlanItem[];
  } | null;
  diagnosis?: CareerRouteDiagnosis | null;
  interviewEvaluations?: Array<{
    id: number;
    targetCompany: string;
    interviewType: string;
    overallScore: number | null;
    reportGrade: string | null;
    completedAt: string;
    report: { radar?: Array<{ dimension: string; score: number; grade: string; diagnosis: string }> } | null;
  }>;
}

export default function DashboardPage() {
  const { locale, t } = useLanguage();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingRegion, setSavingRegion] = useState(false);
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
  const networkingLocaleRef = useRef<string | null>(null);

  const fetchDashboard = useCallback(() => {
    setLoading(true);
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
          setData(json as DashboardData);
        }
      })
      .catch((err) => setError(err?.message || t('dashboard.loadError') || '加载失败'))
      .finally(() => setLoading(false));
  }, [locale, t]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

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
        throw new Error(json.error || 'Networking 推荐生成失败');
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
  }, [locale]);

  useEffect(() => {
    if (data?.diagnosis?.window !== 'preparation') return;
    let cancelled = false;
    apiFetch('/api/networking/progress')
      .then((res) => (res.ok ? res.json() : { progress: null }))
      .then(async (json) => {
        if (cancelled) return;
        const progress = json.progress as NetworkingProgress | null;
        if (!progress) return;
        setNetworkingProgress(progress);
        const cachedMap = progress.recommendations || {};
        if (Object.keys(cachedMap).length >= NETWORKING_STAGES.length && networkingLocaleRef.current === locale) {
          setNetworkingByStage(cachedMap);
          setActiveNetworkingStage(progress.stage);
          setNetworking(cachedMap[String(progress.stage)] || cachedMap['1']);
        } else {
          networkingLocaleRef.current = locale;
          await loadNetworking();
        }
      })
      .catch(() => setNetworkingError('Networking 推荐加载失败'));
    return () => {
      cancelled = true;
    };
  }, [data?.diagnosis?.window, locale, loadNetworking]);

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

  const handleRegionChange = useCallback(
    async (value: string) => {
      if (!data?.latestResumeId) return;
      setSavingRegion(true);
      try {
        const res = await apiFetch(`/api/resume/${data.latestResumeId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ overrides: { regions: [value] } }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(json.error || '保存地区失败');
        } else {
          fetchDashboard();
        }
      } catch (err) {
        setError((err as Error)?.message || '保存地区失败');
      } finally {
        setSavingRegion(false);
      }
    },
    [data?.latestResumeId, fetchDashboard]
  );

  const planGroups = useMemo(() => {
    if (!data?.plan) return null;
    return {
      now: data.plan.items.filter((i) => i.timeframe === 'now'),
      week: data.plan.items.filter((i) => i.timeframe === 'week'),
      month: data.plan.items.filter((i) => i.timeframe === 'month'),
    };
  }, [data]);

  return (
    <AuthGuard showAccountBar={false}>
      <div className="min-h-screen bg-white dark:bg-zinc-950">
        <Header1 />
        <main className="container mx-auto px-4 pt-16 md:pt-20 pb-16">
        {/* Hero */}
        <div className="mb-8 md:mb-10">
          <p className="text-sm font-medium text-zinc-400 dark:text-zinc-500 mb-3">
            {t('dashboard.eyebrow')}
          </p>
          <PageBackButton fallbackHref="/" className="mb-3" />
          <h1 className="text-2xl md:text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 mb-4">
            {t('dashboard.title')}
          </h1>
          <p className="text-zinc-500 dark:text-zinc-400 max-w-2xl md:text-lg leading-relaxed">
            {t('dashboard.subtitle')}
          </p>
        </div>

        {loading && <DashboardSkeleton />}

        {!loading && error && (
          <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800">
            <CardContent className="p-6 text-center text-zinc-500">
              {error}
            </CardContent>
          </Card>
        )}

        {!loading && !error && data && (
          <div className="space-y-6 md:space-y-8">
            {data.diagnosis && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900">
                    <Target className="h-3.5 w-3.5" />
                  </span>
                  <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 tracking-wide">
                    {t('dashboard.diagnosis.title')}
                  </h3>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800">
                    <CardContent className="p-5 space-y-3">
                      <div>
                        <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-1">
                          {t('dashboard.diagnosis.window')}
                        </p>
                        <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                          {t(data.diagnosis.windowLabelKey)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-1">
                          {t('dashboard.diagnosis.mainRoute')}
                        </p>
                        <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                          {t(data.diagnosis.mainRouteLabelKey)}
                        </p>
                      </div>
                      {data.diagnosis.backupRoute && (
                        <div>
                          <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-1">
                            {t('dashboard.diagnosis.backupRoute')}
                          </p>
                          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
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
                          <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-1">
                            {t('dashboard.diagnosis.mainSeason')}
                          </p>
                          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
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
                        <div className="mb-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
                          <p className="text-xs text-zinc-500 leading-relaxed">
                            {t('dashboard.diagnosis.futureVisaPrep')}
                          </p>
                        </div>
                      ) : (
                      <div className="mb-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          <p className="text-xs text-zinc-500">
                            {t('dashboard.diagnosis.visaStatus')}
                            <span className="ml-2 font-medium text-zinc-900 dark:text-zinc-100">
                              {t(`dashboard.visaStatus.${data.diagnosis.visaStatus}`)}
                            </span>
                          </p>
                          <p className="text-xs text-zinc-500">
                            {t('dashboard.diagnosis.visaFeasibility')}
                            <span className="ml-2 font-medium text-zinc-900 dark:text-zinc-100">
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
                                  <p className="text-zinc-600 dark:text-zinc-300">
                                    {t(entry.labelKey)}
                                    {entry.estimatedDate && (
                                      <span className="ml-1 text-zinc-400">
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
                            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-zinc-900 dark:text-zinc-100 hover:underline"
                          >
                            {t('dashboard.diagnosis.confirmVisa')}
                            <ArrowRight className="h-3 w-3" />
                          </Link>
                        )}
                      </div>
                      )}
                      <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-3">
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
                              className="flex items-start gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 px-3 py-2"
                            >
                              <span className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${riskLevelColor[risk.level]}`} />
                              <span className="text-sm text-zinc-700 dark:text-zinc-300">
                                {t(risk.labelKey)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {getLocalizedText(data.diagnosis.llmNarrative, locale) && (
                        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
                          {getLocalizedText(data.diagnosis.llmNarrative, locale)}
                        </p>
                      )}
                      {getLocalizedText(data.diagnosis.verificationNote, locale) && (
                        <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500 leading-relaxed">
                          {getLocalizedText(data.diagnosis.verificationNote, locale)}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </section>
            )}
            {data.diagnosis?.window === 'preparation' && networkingError && (
              <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800 mb-4">
                <CardContent className="p-6 text-center text-sm text-red-500">
                  {networkingError}
                </CardContent>
              </Card>
            )}
            {data.diagnosis?.window === 'preparation' && networkingLoading && !networking && (
              <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800 mb-4">
                <CardContent className="p-6 text-center text-sm text-zinc-500">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                  {t('dashboard.networking.loading')}
                </CardContent>
              </Card>
            )}
            {data.diagnosis?.window === 'preparation' && networkingProgress && networking && (
              <section>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900">
                      <Briefcase className="h-3.5 w-3.5" />
                    </span>
                    <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 tracking-wide">
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
                    <aside className="hidden lg:block border-r border-zinc-200 dark:border-zinc-800 p-3 space-y-1">
                      {NETWORKING_STAGES.map((stage, index) => {
                        const stageMilestones = stage.milestones;
                        const done = stageMilestones.length > 0
                          && stageMilestones.every((item) => networkingProgress?.completedMilestones.includes(item));
                        return (
                          <button
                            key={stage.key}
                            type="button"
                            onClick={() => switchNetworkingStage(index + 1)}
                            className={`w-full flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs transition-colors ${
                              activeNetworkingStage === index + 1
                                ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                                : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
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
                                : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
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
                                  <p className="text-xs text-zinc-400 dark:text-zinc-500">
                                    {t('dashboard.networking.currentStage')}
                                  </p>
                                  <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                                    {t(viewingStage?.titleKey || 'dashboard.networking.stage.research')}
                                  </p>
                                </div>
                                <p className="text-xs text-zinc-500">
                                  {done} / {total}
                                </p>
                              </div>
                              <div className="mt-3 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                                <div className="h-full bg-zinc-900 dark:bg-white transition-all" style={{ width: `${percent}%` }} />
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {progressStage?.milestones.map((milestone) => {
                                  const checked = networkingProgress?.completedMilestones.includes(milestone);
                                  return (
                                    <label key={milestone} className="flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-700 px-2.5 py-1 text-xs text-zinc-600 dark:text-zinc-300 cursor-pointer">
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
                                    <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-2">
                                      {t('dashboard.networking.peopleTypes')}
                                    </p>
                                    <div className="space-y-2">
                                      {networking.peopleTypes.map((item) => (
                                        <div key={item.title} className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
                                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.title}</p>
                                          <p className="mt-1 text-xs text-zinc-500 leading-relaxed">{item.why}</p>
                                          <p className="mt-1 text-xs text-zinc-400">{item.keywords.join(' / ')}</p>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                  <div>
                                    <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-2">
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
                                    <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-2">
                                      {t('dashboard.networking.outreach')}
                                    </p>
                                    <div className="space-y-2">
                                      {networking.outreach.map((item) => (
                                        <div key={item.scenario} className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
                                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.scenario}</p>
                                          <p className="mt-1 text-xs text-zinc-500 leading-relaxed">{item.script}</p>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                  <div>
                                    <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-2">
                                      {t('dashboard.networking.conversationQuestions')}
                                    </p>
                                    <ul className="space-y-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                                      {networking.conversationQuestions.map((question) => <li key={question}>- {question}</li>)}
                                    </ul>
                                  </div>
                                </TabsContent>
                                <TabsContent value="maintain" className="pt-4 space-y-4">
                                  <div>
                                    <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-2">
                                      {t('dashboard.networking.maintenanceContent')}
                                    </p>
                                    <div className="space-y-2">
                                      {networking.maintenanceContent.map((item) => (
                                        <div key={item.title} className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
                                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                            {item.title} <span className="text-xs text-zinc-400">({item.channel})</span>
                                          </p>
                                          <p className="mt-1 text-xs text-zinc-500 leading-relaxed">{item.content}</p>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                  <div>
                                    <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-2">
                                      {t('dashboard.networking.stageTips')}
                                    </p>
                                    <ul className="space-y-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                                      {networking.stageTips.map((tip) => <li key={tip}>- {tip}</li>)}
                                    </ul>
                                  </div>
                                </TabsContent>
                                <TabsContent value="rhythm" className="pt-4">
                                  <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-2">
                                    {t('dashboard.networking.sequence')}
                                  </p>
                                  <div className="space-y-2">
                                    {networking.sequence.map((item) => (
                                      <div key={item.step} className="flex items-start gap-2 text-xs">
                                        <span className="mt-0.5 font-medium text-zinc-700 dark:text-zinc-300">{item.step}</span>
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
              </section>
            )}
            {/* legacy networking block
              <section>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900">
                      <Briefcase className="h-3.5 w-3.5" />
                    </span>
                    <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 tracking-wide">
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
                              : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
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
                        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
                          <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100 mb-2">
                            {t('dashboard.networking.currentStage')}：{t(currentStage.titleKey)}
                          </p>
                          <div className="space-y-1.5">
                            {currentStage.milestones.map((milestone) => {
                              const checked = networkingProgress.completedMilestones.includes(milestone);
                              return (
                                <label key={milestone} className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
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
                        <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-3">
                          {t('dashboard.networking.peopleTypes')}
                        </p>
                        <div className="space-y-3">
                          {networking.peopleTypes.map((item) => (
                            <div key={item.title} className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
                              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.title}</p>
                              <p className="mt-1 text-xs text-zinc-500 leading-relaxed">{item.why}</p>
                              <p className="mt-1 text-xs text-zinc-400">{item.keywords.join(' / ')}</p>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                    <div className="space-y-4">
                      <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800">
                        <CardContent className="p-5">
                          <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-3">
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
                          <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-3">
                            {t('dashboard.networking.outreach')}
                          </p>
                          <div className="space-y-3">
                            {networking.outreach.map((item) => (
                              <div key={item.scenario}>
                                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.scenario}</p>
                                <p className="mt-1 text-xs text-zinc-500 leading-relaxed">{item.script}</p>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                      <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800">
                        <CardContent className="p-5">
                          <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-3">
                            {t('dashboard.networking.sequence')}
                          </p>
                          <div className="space-y-2">
                            {networking.sequence.map((item) => (
                              <div key={item.step} className="flex items-start gap-2 text-xs">
                                <span className="mt-0.5 font-medium text-zinc-700 dark:text-zinc-300">{item.step}</span>
                                <span className="text-zinc-500">{item.action}</span>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                      <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800">
                        <CardContent className="p-5">
                          <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-3">
                            {t('dashboard.networking.stageTips')}
                          </p>
                          <ul className="space-y-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                            {networking.stageTips.map((tip) => <li key={tip}>- {tip}</li>)}
                          </ul>
                        </CardContent>
                      </Card>
                      <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800">
                        <CardContent className="p-5">
                          <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-3">
                            {t('dashboard.networking.conversationQuestions')}
                          </p>
                          <ul className="space-y-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                            {networking.conversationQuestions.map((question) => <li key={question}>- {question}</li>)}
                          </ul>
                        </CardContent>
                      </Card>
                      <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800">
                        <CardContent className="p-5">
                          <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-3">
                            {t('dashboard.networking.maintenanceContent')}
                          </p>
                          <div className="space-y-3">
                            {networking.maintenanceContent.map((item) => (
                              <div key={item.title}>
                                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                  {item.title} <span className="text-xs text-zinc-400">({item.channel})</span>
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
            {/* 阶段定位 */}
            <section>
              <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800 bg-gradient-to-br from-zinc-800 via-zinc-900 to-zinc-950 dark:from-zinc-200 dark:via-white dark:to-zinc-300 text-white dark:text-zinc-900 shadow-xl shadow-zinc-900/10">
                <CardContent className="p-6 md:p-10">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                    <div className="space-y-3">
                      <div className="inline-flex items-center gap-2 text-xs font-medium tracking-widest uppercase opacity-70">
                        <Target className="h-3.5 w-3.5" />
                        {t('dashboard.phaseLabel')}
                      </div>
                      <h2 className="text-2xl md:text-3xl font-bold tracking-tight">
                        {t(data.phaseTitleKey, data.phaseTitleParams)}
                      </h2>
                      <p className="text-sm md:text-base opacity-80 max-w-2xl leading-relaxed">
                        {t(data.phaseDescriptionKey, data.phaseDescriptionParams)}
                      </p>
                    </div>
                    <Button
                      asChild
                      variant="outline"
                      className="self-start md:self-auto rounded-full border-white/30 bg-white/10 text-white hover:bg-white hover:text-zinc-900 dark:border-zinc-900/30 dark:bg-zinc-900/10 dark:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-white"
                    >
                      <Link href={data.nextAction?.href || data.actions[0]?.href || '/resume'}>
                        {t(data.nextAction?.titleKey || 'dashboard.nextAction')}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </section>

            {/* 三个核心数字 */}
            <section>
              <h3 className="text-sm font-medium text-zinc-400 dark:text-zinc-500 tracking-widest uppercase mb-4">
                {t('dashboard.metricsTitle')}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <MetricCard
                  icon={<FileText className="h-4 w-4" />}
                  label={t('dashboard.metricResume')}
                  value={`${data.metrics.resumeImpact}%`}
                  hint={t('dashboard.metricResumeHint')}
                />
                <MetricCard
                  icon={<MessageSquare className="h-4 w-4" />}
                  label={t('dashboard.metricInterview')}
                  value={`${data.metrics.interviewStrength}`}
                  hint={t('dashboard.metricInterviewHint')}
                />
                <MetricCard
                  icon={<TrendingUp className="h-4 w-4" />}
                  label={t('dashboard.metricHealth')}
                  value={
                    data.weeklyGoal > 0
                      ? `${data.weeklyApplications}/${data.weeklyGoal}`
                      : '—'
                  }
                  hint={t('dashboard.metricHealthHint')}
                  footer={
                    data.weeklyGoal > 0
                      ? `${data.metrics.applicationHealth}% ${t('dashboard.metricHealthDone')}`
                      : t('dashboard.metricHealthNoGoal')
                  }
                />
              </div>
            </section>

            {/* 个性化求职规划 */}
            {data.plan && planGroups && (
              <section>
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
                  <h3 className="text-sm font-medium text-zinc-400 dark:text-zinc-500 tracking-widest uppercase">
                    {t('dashboard.planTitle')}
                  </h3>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                    {data.latestResumeId ? (
                      <div className="flex items-center gap-2">
                        <MapPin className="h-3.5 w-3.5 text-zinc-400" />
                        <span className="text-xs text-zinc-500">
                          {t('dashboard.regionLabel')}
                        </span>
                        <Select
                          value={data.selectedRegion || undefined}
                          onValueChange={handleRegionChange}
                          disabled={savingRegion}
                        >
                          <SelectTrigger className="h-8 min-w-[10rem] rounded-full border-zinc-200 bg-white text-xs text-zinc-900 hover:border-zinc-400 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
                            <SelectValue placeholder={t('dashboard.regionPlaceholder')} />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl border-zinc-200 dark:border-zinc-800">
                            {data.regionOptions.map((option) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                                className="text-xs focus:bg-zinc-100 focus:text-zinc-900 dark:focus:bg-zinc-800 dark:focus:text-zinc-100"
                              >
                                {t(option.labelKey)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-500">
                        {t('dashboard.regionHint')}
                      </span>
                    )}
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <span className="hidden sm:inline text-zinc-300 dark:text-zinc-700">
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
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
              <section>
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

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
              {/* 行动建议 */}
              <section className="lg:col-span-2">
                <h3 className="text-sm font-medium text-zinc-400 dark:text-zinc-500 tracking-widest uppercase mb-4">
                  {t('dashboard.actionsTitle')}
                </h3>
                <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800">
                  <CardContent className="p-0">
                    {data.actions.map((action, idx) => (
                      <Link
                        key={`${action.titleKey}-${idx}`}
                        href={action.href}
                        className="group flex items-center justify-between p-4 md:p-5 border-b border-zinc-100 dark:border-zinc-800 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors"
                      >
                        <div className="flex items-center gap-4">
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${priorityBadge[action.priority].className}`}
                          >
                            {t(`dashboard.priority.${action.priority}`)}
                          </span>
                          <span className="text-sm md:text-base font-medium text-zinc-900 dark:text-zinc-100">
                            {t(action.titleKey, action.titleParams)}
                          </span>
                        </div>
                        <ArrowRight className="h-4 w-4 text-zinc-300 group-hover:text-zinc-900 dark:text-zinc-600 dark:group-hover:text-zinc-100 transition-colors" />
                      </Link>
                    ))}
                  </CardContent>
                </Card>
              </section>

              {/* 智能提醒 */}
              <section>
                <h3 className="text-sm font-medium text-zinc-400 dark:text-zinc-500 tracking-widest uppercase mb-4">
                  {t('dashboard.remindersTitle')}
                </h3>
                <div className="space-y-3">
                  {data.reminders.length === 0 && (
                    <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800 border-dashed">
                      <CardContent className="p-5 text-center text-sm text-zinc-500">
                        {t('dashboard.noReminders')}
                      </CardContent>
                    </Card>
                  )}
                  {data.reminders.map((reminder) => (
                    <Card
                      key={reminder.type}
                      className="rounded-2xl border-zinc-200 dark:border-zinc-800"
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5">
                            <Bell className="h-4 w-4 text-zinc-400" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-1">
                              {t(reminder.titleKey, reminder.titleParams)}
                            </p>
                            <p className="text-xs text-zinc-500 leading-relaxed">
                              {t(reminder.descriptionKey, reminder.descriptionParams)}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>

              {/* 面试评估记录 — 简洁列表 */}
              {data.interviewEvaluations && data.interviewEvaluations.length > 0 && (
                <section>
                  <h3 className="text-sm font-medium text-zinc-400 dark:text-zinc-500 tracking-widest uppercase mb-4">
                    {t('dashboard.evaluationsTitle')}
                  </h3>
                  <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden divide-y divide-zinc-200 dark:divide-zinc-800">
                    {data.interviewEvaluations.slice(0, 5).map((ev) => {
                      const scoreColor =
                        ev.overallScore != null
                          ? ev.overallScore >= 7
                            ? 'bg-zinc-900 text-white'
                            : ev.overallScore >= 4
                            ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400';
                      return (
                        <div key={ev.id} className="px-4 py-3 flex items-center justify-between">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-7 h-7 rounded-lg bg-zinc-900 flex items-center justify-center flex-shrink-0">
                              <MessageSquare className="h-3.5 w-3.5 text-white" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                {ev.targetCompany || t('dashboard.unknownCompany')}
                              </p>
                              <p className="text-xs text-zinc-500">
                                {new Date(ev.completedAt).toLocaleDateString(
                                  locale === 'zh-CN' ? 'zh-CN' : locale === 'zh-TW' ? 'zh-TW' : 'en-US',
                                  { month: 'short', day: 'numeric' }
                                )}
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
                              <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500">
                                {ev.reportGrade}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

            </div>

            {/* 成长故事线 */}
            <section>
              <h3 className="text-sm font-medium text-zinc-400 dark:text-zinc-500 tracking-widest uppercase mb-4">
                {t('dashboard.storyTitle')}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
            </section>

          </div>
        )}
        </main>
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
    className: 'bg-zinc-50 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400',
  },
};

function MetricCard({
  icon,
  label,
  value,
  hint,
  footer,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  footer?: string;
}) {
  return (
    <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800 hover:shadow-lg hover:shadow-zinc-900/[0.05] transition-shadow">
      <CardContent className="p-5 md:p-6">
        <div className="flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-3">
          <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900">
            {icon}
          </span>
          {label}
        </div>
        <div className="text-3xl md:text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 mb-2">
          {value}
        </div>
        <p className="text-xs text-zinc-500 leading-relaxed">{hint}</p>
        {footer && (
          <p className="mt-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {footer}
          </p>
        )}
      </CardContent>
    </Card>
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
    <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30">
      <CardContent className="p-5">
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
                <Link
                  href={item.href}
                  className="block hover:opacity-80 transition-opacity"
                >
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-1 flex items-center gap-1">
                    {translate(item.titleKey, item.params)}
                    <ArrowRight className="h-3 w-3 text-zinc-400 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                  </p>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    {translate(item.descriptionKey, item.params)}
                  </p>
                </Link>
              ) : (
                <>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-1">
                    {translate(item.titleKey, item.params)}
                  </p>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    {translate(item.descriptionKey, item.params)}
                  </p>
                </>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
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
    <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40">
      <CardContent className="p-5">
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

function DashboardSkeleton() {
  return (
    <div className="space-y-6 md:space-y-8">
      <Skeleton className="h-40 md:h-48 rounded-2xl" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
        <Skeleton className="h-64 lg:col-span-2 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    </div>
  );
}

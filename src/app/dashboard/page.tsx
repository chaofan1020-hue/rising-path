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

import { useLanguage } from '@/lib/language-context';
import PageBackButton from '@/components/page-back-button';
import { getLocalizedText, type CareerRouteDiagnosis } from '@/lib/career-route-planner';
import type { BillingSnapshot } from '@/lib/billing-types';
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

interface PersonalityRecommendation {
  roleKey: string;
  labelKey: string;
  score: number;
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
  personality?: PersonalitySummary | null;
  billing?: BillingSnapshot | null;
  segmentationConfirmed?: boolean;
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
  const { locale, localeReady, t } = useLanguage();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
    if (!localeReady) return;
    fetchDashboard();
  }, [fetchDashboard, localeReady]);

  const isPro = data?.billing?.isPro ?? false;

  const loadNetworking = useCallback(async () => {
    setNetworkingLoading(true);
    setNetworkingError(null);
    if (!isPro) {
      setNetworking(null);
      setNetworkingError(t('paywall.title'));
      setNetworkingLoading(false);
      return;
    }
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
  }, [locale, isPro, t]);

  useEffect(() => {
    if (data?.diagnosis?.window !== 'preparation' || !isPro) return;
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
  }, [data?.diagnosis?.window, isPro, locale]);

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
    if (!data?.plan) return null;
    return {
      now: data.plan.items.filter((i) => i.timeframe === 'now'),
      week: data.plan.items.filter((i) => i.timeframe === 'week'),
      month: data.plan.items.filter((i) => i.timeframe === 'month'),
    };
  }, [data]);

  const trajectory = useMemo(() => {
    const evaluations = data?.interviewEvaluations;
    if (!evaluations || evaluations.length === 0) return null;
    const scored = evaluations
      .filter((item) => item.overallScore != null)
      .map((item) => ({ ...item, score: item.overallScore as number }));
    if (scored.length === 0) return null;
    const recent = scored.slice(0, 3);
    const average = recent.length > 0
      ? Math.round((recent.reduce((sum, item) => sum + item.score, 0) / recent.length) * 10) / 10
      : null;
    const change = scored.length >= 2
      ? Math.round((scored[0].score - scored[1].score) * 10) / 10
      : null;
    const latest = scored[0];
    const radar = latest?.report?.radar;
    const weakness = radar && radar.length > 0
      ? radar.reduce((min, item) => (item.score < min.score ? item : min), radar[0]).dimension
      : null;
    return {
      chart: scored.slice(0, 8).slice().reverse(),
      average,
      change,
      weakness,
    };
  }, [data]);

  return (
    <AuthGuard showAccountBar={false}>
      <div className="min-h-screen bg-white dark:bg-zinc-950">
        <Header1 />
        <main className="container mx-auto px-4 pt-16 md:pt-20 pb-16">
        <div className="mb-8 md:mb-10">
          <p className="text-sm font-medium text-zinc-400 dark:text-zinc-500 mb-3">
            {t('dashboard.eyebrow')}
          </p>
          <PageBackButton fallbackHref="/" className="mb-3" />
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 mb-3">
            {t('dashboard.title')}
          </h1>
          <p className="text-zinc-500 dark:text-zinc-400 max-w-2xl text-sm md:text-base leading-relaxed">
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
            <section>
              <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800 bg-gradient-to-br from-zinc-800 via-zinc-900 to-zinc-950 dark:from-zinc-200 dark:via-white dark:to-zinc-300 text-white dark:text-zinc-900 shadow-xl shadow-zinc-900/10">
                <CardContent className="p-5 md:p-6">
                  <div className="space-y-2">
                    <div className="inline-flex items-center gap-2 text-xs font-medium tracking-widest uppercase opacity-70">
                      <Target className="h-3.5 w-3.5" />
                      {t('dashboard.phaseLabel')}
                    </div>
                    <h2 className="text-xl md:text-2xl font-bold tracking-tight">
                      {t(data.phaseTitleKey, data.phaseTitleParams)}
                    </h2>
                    <p className="text-sm md:text-base opacity-80 max-w-2xl leading-relaxed">
                      {t(data.phaseDescriptionKey, data.phaseDescriptionParams)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </section>
            {data.diagnosis && (
              <section id="diagnosis">
                <div className="flex items-center gap-2 mb-4">
                  <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-zinc-900 text-white">
                    <Target className="h-3.5 w-3.5" />
                  </span>
                  <h3 className="text-sm font-medium text-zinc-400 dark:text-zinc-500 tracking-widest uppercase">
                    {t('dashboard.diagnosis.title')}
                  </h3>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <Card className="self-start rounded-2xl border-zinc-200 dark:border-zinc-800">
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
                              {t(`dashboard.visaStatus.${data.diagnosis.visaStatus}`)}
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
                                      {t(`personality.sponsor.${recommendation.sponsorship.level}`)}
                                    </Badge>
                                    {recommendation.sponsorship.activeJobCount > 0 && (
                                      <span className="text-[10px] text-zinc-500">
                                        {recommendation.sponsorship.sponsorJobCount} / {recommendation.sponsorship.activeJobCount}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                            return (
                              <>
                                <p className="text-xs font-medium text-zinc-500 mb-2">
                                  {t('personality.recommendationsCore')}
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                  {core.map(renderCard)}
                                </div>
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
                <section className="mt-6">
                  {data.personality?.hasAssessment ? (
                    <div className="rounded-lg border border-zinc-200 p-3">
                      <p className="text-xs font-medium text-zinc-500 mb-3">
                        {t('dashboard.personalityTitle')}
                      </p>
                      {(() => {
                        const core = (data.personality?.recommendations || []).slice(0, 3);
                        const alternatives = (data.personality?.recommendations || []).slice(3, 5);
                        const renderCard = (recommendation: typeof core[number]) => (
                          <div key={recommendation.roleKey} className="rounded-lg border border-zinc-200 p-3">
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                {t(recommendation.labelKey)}
                              </p>
                              <Badge variant="secondary" className="text-[10px]">
                                {t(`personality.fit.${recommendation.fit}`)}
                              </Badge>
                            </div>
                            <p className="text-xs text-zinc-500 mb-2">{recommendation.score}%</p>
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
                                  {t(`personality.sponsor.${recommendation.sponsorship.level}`)}
                                </Badge>
                                {recommendation.sponsorship.activeJobCount > 0 && (
                                  <span className="text-[10px] text-zinc-500">
                                    {recommendation.sponsorship.sponsorJobCount} / {recommendation.sponsorship.activeJobCount}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        );
                        return (
                          <>
                            <p className="text-xs font-medium text-zinc-500 mb-2">
                              {t('personality.recommendationsCore')}
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              {core.map(renderCard)}
                            </div>
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
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-zinc-200 p-3">
                      <div>
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
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
                </section>
              </section>
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
                          <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100 mb-2">
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
                              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.title}</p>
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
                                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
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
            {/* 阶段定位 */}

            {/* 三个核心数字 */}
            <section id="metrics">
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
              <section id="plan">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
                  <h3 className="text-sm font-medium text-zinc-400 dark:text-zinc-500 tracking-widest uppercase">
                    {t('dashboard.planTitle')}
                  </h3>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                    {data.latestResumeId ? (
                      <div className="flex items-center gap-2">
                        <MapPin className="h-3.5 w-3.5 text-zinc-500" />
                        <span className="text-xs text-zinc-500">
                          {t('dashboard.regionLabel')}
                        </span>
                        <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                          {(() => {
                            const option = data.regionOptions.find((o) => o.value === data.selectedRegion);
                            return option ? t(option.labelKey) : t(data.plan.context.region);
                          })()}
                        </span>
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

            <div id="execution" className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
              {/* 行动建议 */}
              <section className="lg:col-span-2">
                <h3 className="text-sm font-medium text-zinc-400 dark:text-zinc-500 tracking-widest uppercase mb-4">
                  {t('dashboard.actionsTitle')}
                </h3>
                <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {data.actions.map((action, idx) => (
                    <Link
                      key={`${action.titleKey}-${idx}`}
                      href={action.href}
                      className="group flex items-center justify-between py-4 md:py-5 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors"
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
                      <ArrowRight className="h-4 w-4 text-zinc-700 group-hover:text-zinc-900 dark:text-zinc-600 dark:group-hover:text-zinc-900 transition-colors" />
                    </Link>
                  ))}
                </div>
              </section>

              {/* 智能提醒 */}
              <section id="networking">
                <h3 className="text-sm font-medium text-zinc-400 dark:text-zinc-500 tracking-widest uppercase mb-4">
                  {t('dashboard.remindersTitle')}
                </h3>
                <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {data.reminders.length === 0 && (
                    <div className="py-5 text-center text-sm text-zinc-500">
                      {t('dashboard.noReminders')}
                    </div>
                  )}
                  {data.reminders.map((reminder) => (
                    <div key={reminder.type} className="py-4 first:pt-0 last:pb-0">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5">
                          <Bell className="h-4 w-4 text-zinc-500" />
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
                    </div>
                  ))}
                </div>
              </section>

              {trajectory && (
                <section>
                  <h3 className="text-sm font-medium text-zinc-400 dark:text-zinc-500 tracking-widest uppercase mb-4">
                    {t('dashboard.progressTrajectory.title')}
                  </h3>
                  <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800">
                    <CardContent className="p-5">
                      {trajectory.chart.length < 2 ? (
                        <div className="py-8 text-center text-sm text-zinc-500">
                          {t('dashboard.progressTrajectory.empty')}
                        </div>
                      ) : (
                        <>
                          <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5 ${trajectory.weakness ? 'sm:grid-cols-3' : ''}`}>
                            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
                              <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-400 mb-1">
                                {t('dashboard.progressTrajectory.average')}
                              </p>
                              <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                                {trajectory.average ?? '—'}
                              </p>
                            </div>
                            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
                              <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-400 mb-1">
                                {t('dashboard.progressTrajectory.change')}
                              </p>
                              <p className={`text-lg font-semibold ${trajectory.change != null && trajectory.change > 0 ? 'text-emerald-600 dark:text-emerald-400' : trajectory.change != null && trajectory.change < 0 ? 'text-red-600 dark:text-red-400' : 'text-zinc-900 dark:text-zinc-100'}`}>
                                {trajectory.change == null ? '—' : trajectory.change > 0 ? `+${trajectory.change}` : trajectory.change}
                              </p>
                            </div>
                            {trajectory.weakness && (
                              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
                                <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-400 mb-1">
                                  {t('dashboard.progressTrajectory.weakness')}
                                </p>
                                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 leading-snug">
                                  {trajectory.weakness}
                                </p>
                              </div>
                            )}
                          </div>
                          <svg viewBox="0 0 600 180" className="w-full h-auto">
                            {[0, 5, 10].map((value) => {
                              const y = 150 - (value / 10) * 120;
                              return (
                                <g key={value}>
                                  <line x1="30" y1={y} x2="570" y2={y} className="stroke-zinc-200 dark:stroke-zinc-800" strokeWidth="1" />
                                  <text x="18" y={y + 4} className="fill-zinc-400 dark:fill-zinc-500" fontSize="10">
                                    {value}
                                  </text>
                                </g>
                              );
                            })}
                            <polyline
                              points={trajectory.chart
                                .map((item, index) => {
                                  const x = 30 + (index / (trajectory.chart.length - 1)) * 540;
                                  const y = 150 - (item.score / 10) * 120;
                                  return `${x},${y}`;
                                })
                                .join(' ')}
                              className="fill-none stroke-zinc-900 dark:stroke-white"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            {trajectory.chart.map((item, index) => {
                              const x = 30 + (index / (trajectory.chart.length - 1)) * 540;
                              const y = 150 - (item.score / 10) * 120;
                              return (
                                <g key={item.id}>
                                  <circle cx={x} cy={y} r="4" className="fill-zinc-900 dark:fill-white" />
                                  <text x={x} y={y - 9} textAnchor="middle" className="fill-zinc-700 dark:fill-zinc-300" fontSize="10" fontWeight="600">
                                    {item.score}
                                  </text>
                                  <text x={x} y={y + 22} textAnchor="middle" className="fill-zinc-400 dark:fill-zinc-500" fontSize="9">
                                    {new Date(item.completedAt).toLocaleDateString(
                                      locale === 'zh-CN' ? 'zh-CN' : locale === 'zh-TW' ? 'zh-TW' : 'en-US',
                                      { month: 'numeric', day: 'numeric' }
                                    )}
                                  </text>
                                </g>
                              );
                            })}
                          </svg>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </section>
              )}

              {/* Interview evaluations - compact list */}
              {data.interviewEvaluations && data.interviewEvaluations.length > 0 && (
                <section>
                  <h3 className="text-sm font-medium text-zinc-400 dark:text-zinc-500 tracking-widest uppercase mb-4">
                    {t('dashboard.evaluationsTitle')}
                  </h3>
                  <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {data.interviewEvaluations.slice(0, 5).map((ev) => {
                      const scoreColor =
                        ev.overallScore != null
                          ? ev.overallScore >= 7
                            ? 'bg-zinc-900 text-white'
                            : ev.overallScore >= 4
                            ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100'
                            : 'bg-zinc-100 text-zinc-500'
                          : 'bg-zinc-100 text-zinc-500';
                      return (
                        <div key={ev.id} className="px-4 py-3 flex items-center justify-between">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-7 h-7 rounded-lg bg-zinc-900 flex items-center justify-center flex-shrink-0">
                              <MessageSquare className="h-3.5 w-3.5 text-white" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-900 truncate">
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
                              <span className="text-xs font-medium text-zinc-500">
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

            {data.diagnosis?.window === 'preparation' && !isPro && (
              <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800 mb-4">
                <CardContent className="p-6 flex flex-col items-center gap-3 text-center">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('paywall.title')}</p>
                  <p className="text-sm text-zinc-500 max-w-md">{t('paywall.description')}</p>
                  <Button asChild className="rounded-full bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">
                    <Link href="/pricing">{t('paywall.upgrade')}</Link>
                  </Button>
                </CardContent>
              </Card>
            )}
            {data.diagnosis?.window === 'preparation' && isPro && networkingError && (
              <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800 mb-4">
                <CardContent className="p-6 text-center text-sm text-red-500">
                  {networkingError}
                </CardContent>
              </Card>
            )}
            {data.diagnosis?.window === 'preparation' && isPro && networkingLoading && !networking && (
              <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800 mb-4">
                <CardContent className="p-6 text-center text-sm text-zinc-500">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                  {t('dashboard.networking.loading')}
                </CardContent>
              </Card>
            )}
            {data.diagnosis?.window === 'preparation' && isPro && !networkingLoading && !networking && !networkingError && (
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
            {data.diagnosis?.window === 'preparation' && isPro && networkingProgress && networking && (
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
                  <Button variant="outline" size="sm" onClick={() => loadNetworking()} disabled={networkingLoading}>
                    {networkingLoading ? (
                      <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />{t('dashboard.networking.loading')}</>
                    ) : (
                      <><RefreshCw className="h-3.5 w-3.5 mr-1" />{t('dashboard.networking.regenerate')}</>
                    )}
                  </Button>
                </div>
                <div>
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
                                  <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
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
                                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.title}</p>
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
                                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.scenario}</p>
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
                                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
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
                </div>
              </section>
            )}

            {/* 成长故事线 */}
            <section id="story">
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
      'bg-white text-zinc-900 hover:bg-zinc-200',
  },
  medium: {
    className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200',
  },
  low: {
    className: 'bg-zinc-50 text-zinc-500',
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
    <div className="min-w-0">
      <div className="flex items-center gap-2 mb-3">
        <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900">
          {icon}
        </span>
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 tracking-wide">
          {label}
        </span>
      </div>
      <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {items.map((item, idx) => (
          <div key={idx} className="group py-3 first:pt-0 last:pb-0">
            {item.href ? (
              <Link href={item.href} className="block hover:opacity-80 transition-opacity">
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

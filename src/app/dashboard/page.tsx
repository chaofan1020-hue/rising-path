'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Header1 } from '@/components/header1';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLanguage } from '@/lib/language-context';
import {
  ArrowRight,
  Bell,
  Briefcase,
  Calendar,
  FileText,
  LineChart,
  MapPin,
  MessageSquare,
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
}

export default function DashboardPage() {
  const { locale, t } = useLanguage();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingRegion, setSavingRegion] = useState(false);

  const accessCodeId = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return (
      localStorage.getItem('access_code_id') ||
      localStorage.getItem('access_code') ||
      ''
    );
  }, []);

  const fetchDashboard = useCallback(() => {
    if (!accessCodeId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`/api/dashboard?access_code_id=${accessCodeId}&lang=${locale}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.error) {
          setError(json.error);
        } else {
          setData(json as DashboardData);
        }
      })
      .catch((err) => setError(err?.message || t('dashboard.loadError') || '加载失败'))
      .finally(() => setLoading(false));
  }, [accessCodeId, locale, t]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const handleRegionChange = useCallback(
    async (value: string) => {
      if (!data?.latestResumeId) return;
      setSavingRegion(true);
      try {
        const res = await fetch(`/api/resume/${data.latestResumeId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accessCodeId: Number(accessCodeId),
            overrides: { regions: [value] },
          }),
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

  const translate = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      if (!params) return t(key);
      const translatedParams: Record<string, string | number> = {};
      Object.entries(params).forEach(([k, v]) => {
        if (typeof v === 'string') {
          translatedParams[k] = t(v);
        } else {
          translatedParams[k] = v;
        }
      });
      return t(key, translatedParams);
    },
    [t]
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
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <Header1 />
      <main className="container mx-auto px-4 pt-16 md:pt-20 pb-16">
        {/* Hero */}
        <div className="mb-8 md:mb-10">
          <p className="text-sm font-medium text-zinc-400 dark:text-zinc-500 mb-3">
            {t('dashboard.eyebrow')}
          </p>
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
  );
}

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

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  Briefcase,
  FileText,
  Globe,
  HeartPulse,
  Loader2,
  Radio,
  Send,
  TrendingUp,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminPageShell } from '@/components/admin/page-shell';
import { APPLICATION_STATUS_LABELS } from '@/components/admin/format';
import { ADMIN_PERMISSIONS } from '@/lib/admin-permission-constants';
import { studentDisplayName } from '@/lib/admin-student-identity';

type AnalyticsData = {
  overview: {
    totalUsers: number;
    recentUsers: number;
    totalResumes: number;
    recentResumes: number;
    totalJobs: number;
    recentJobs: number;
    totalApplications: number;
    recentApplications: number;
    totalAiMatches: number;
    recentAiMatches: number;
    activeUsers: number;
    averageActivityPerActiveUser: number;
  };
  charts: {
    jobsByRegion: Record<string, number>;
    jobsByDirection: Record<string, number>;
    applicationsByStatus: Record<string, number>;
    dailyStats: { date: string; resumes: number; applications: number; aiMatches: number }[];
  };
  userActivity: { userId: string; userName: string; resumes: number; applications: number; aiMatches: number }[];
};

const RANGE_LABELS = { '7d': '近 7 天', '30d': '近 30 天', '90d': '近 90 天', all: '全部' } as const;
const SHORTCUTS = [
  { href: '/admin/students', label: '学员', icon: Users },
  { href: '/admin/jobs', label: '岗位', icon: Briefcase },
  { href: '/admin/jobs/sync', label: '同步', icon: Radio },
  { href: '/admin/quality', label: '质量', icon: Activity },
  { href: '/admin/usage', label: '用量', icon: TrendingUp },
  { href: '/admin/health', label: '健康', icon: HeartPulse },
];

function BarList({ items, color }: { items: [string, number][]; color: string }) {
  const max = Math.max(...items.map(([, count]) => count), 1);
  return (
    <div className="space-y-3">
      {items.map(([label, count]) => (
        <div key={label} className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="truncate pr-2">{label}</span>
            <span className="text-muted-foreground">{count}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.round((count / max) * 100)}%` }} />
          </div>
        </div>
      ))}
      {items.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">暂无数据</p>}
    </div>
  );
}

export function AdminOverviewPanel() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [range, setRange] = useState<keyof typeof RANGE_LABELS>('7d');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void fetch(`/api/admin/analytics?range=${range}`, { cache: 'no-store' })
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok) {
          const required = Array.isArray(json.error?.requiredMigrations) ? `（所需迁移：${json.error.requiredMigrations.join('、')}）` : '';
          throw new Error(`${json.error?.message || '分析数据加载失败'}${required}`);
        }
        if (!cancelled) setAnalytics(json.data || null);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setAnalytics(null);
          setError(reason instanceof Error ? reason.message : '分析数据加载失败');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range]);

  return (
    <AdminPageShell title="工作台" description="核心业务数据与待处理入口" permission={ADMIN_PERMISSIONS.dashboardRead}>
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2">
          {SHORTCUTS.map((item) => {
            const Icon = item.icon;
            return (
              <Button key={item.href} variant="outline" size="sm" asChild>
                <Link href={item.href}><Icon className="mr-1.5 h-4 w-4" />{item.label}</Link>
              </Button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <span className="shrink-0 text-sm text-muted-foreground">时间范围：</span>
          {(Object.keys(RANGE_LABELS) as Array<keyof typeof RANGE_LABELS>).map((item) => (
            <Button key={item} variant={range === item ? 'default' : 'outline'} size="sm" className="h-8 px-3 text-xs" onClick={() => setRange(item)}>
              {RANGE_LABELS[item]}
            </Button>
          ))}
        </div>

        {loading ? (
          <div className="py-16 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">加载分析数据...</p>
          </div>
        ) : error ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-destructive">{error}</div>
        ) : !analytics ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">暂无分析数据</div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Stat label="新增 / 总用户" value={`${analytics.overview.recentUsers} / ${analytics.overview.totalUsers}`} icon={<Users className="h-4 w-4" />} />
              <Stat label="新增 / 总岗位" value={`${analytics.overview.recentJobs} / ${analytics.overview.totalJobs}`} icon={<Briefcase className="h-4 w-4" />} />
              <Stat label="新增 / 总简历" value={`${analytics.overview.recentResumes} / ${analytics.overview.totalResumes}`} icon={<FileText className="h-4 w-4" />} />
              <Stat label="新增 / 总网申" value={`${analytics.overview.recentApplications} / ${analytics.overview.totalApplications}`} icon={<Send className="h-4 w-4" />} />
              <Stat label="AI 选岗次数" value={`${analytics.overview.recentAiMatches} / ${analytics.overview.totalAiMatches}`} icon={<Activity className="h-4 w-4" />} />
              <Stat label="活跃学员平均操作" value={String(analytics.overview.averageActivityPerActiveUser)} icon={<TrendingUp className="h-4 w-4" />} />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Globe className="h-4 w-4" />岗位地区分布</CardTitle></CardHeader>
                <CardContent>
                  <BarList items={Object.entries(analytics.charts.jobsByRegion).sort(([, left], [, right]) => right - left).slice(0, 6)} color="bg-zinc-900 dark:bg-zinc-100" />
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4" />岗位方向分布</CardTitle></CardHeader>
                <CardContent>
                  <BarList items={Object.entries(analytics.charts.jobsByDirection).sort(([, left], [, right]) => right - left).slice(0, 6)} color="bg-zinc-700 dark:bg-zinc-300" />
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Send className="h-4 w-4" />范围内网申状态</CardTitle></CardHeader>
                <CardContent>
                  <BarList
                    items={Object.entries(analytics.charts.applicationsByStatus).map(([status, count]) => [APPLICATION_STATUS_LABELS[status] || status, count])}
                    color="bg-zinc-500"
                  />
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="h-4 w-4" />近 7 天活跃趋势</CardTitle></CardHeader>
              <CardContent>
                <div className="flex h-40 items-end gap-2">
                  {analytics.charts.dailyStats.map((day) => {
                    const max = Math.max(...analytics.charts.dailyStats.map((item) => Math.max(item.resumes, item.applications, item.aiMatches)), 1);
                    return (
                      <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
                        <div className="flex w-full flex-1 items-end justify-center gap-0.5">
                          <div className="w-2.5 rounded-t bg-emerald-500" style={{ height: `${(day.resumes / max) * 100}%`, minHeight: day.resumes ? 3 : 0 }} title={`简历 ${day.resumes}`} />
                          <div className="w-2.5 rounded-t bg-sky-600" style={{ height: `${(day.applications / max) * 100}%`, minHeight: day.applications ? 3 : 0 }} title={`网申 ${day.applications}`} />
                          <div className="w-2.5 rounded-t bg-zinc-700" style={{ height: `${(day.aiMatches / max) * 100}%`, minHeight: day.aiMatches ? 3 : 0 }} title={`AI 选岗 ${day.aiMatches}`} />
                        </div>
                        <span className="text-xs text-muted-foreground">{new Date(day.date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 flex justify-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded bg-emerald-500" />简历</span>
                  <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded bg-sky-600" />网申</span>
                  <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded bg-zinc-700" />AI 选岗</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" />学员活跃度</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b text-left text-muted-foreground">
                      <tr><th className="py-2">学员</th><th className="py-2 text-right">简历</th><th className="py-2 text-right">网申</th><th className="py-2 text-right">AI 选岗</th></tr>
                    </thead>
                    <tbody>
                      {analytics.userActivity.slice(0, 10).map((user) => (
                        <tr key={user.userId} className="border-b last:border-0">
                          <td className="py-3">
                            <Link href={`/admin/students/${encodeURIComponent(user.userId)}`} className="font-medium hover:underline">
                              {studentDisplayName(user.userName)}
                            </Link>
                          </td>
                          <td className="py-3 text-right">{user.resumes}</td>
                          <td className="py-3 text-right">{user.applications}</td>
                          <td className="py-3 text-right">{user.aiMatches}</td>
                        </tr>
                      ))}
                      {analytics.userActivity.length === 0 && (
                        <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">暂无学员活动</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AdminPageShell>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
        <p className="mt-2 text-xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

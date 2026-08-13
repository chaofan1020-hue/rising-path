'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, BriefcaseBusiness, CircleAlert, Clock3, RefreshCw, Radio, Server, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAdminPermissions } from '@/components/admin-shell';
import { ADMIN_PERMISSIONS } from '@/lib/admin-permission-constants';

type RemoteRun = { id: string; company: string; connector_type: string; status: string; discovered_count: number; created_count: number; updated_count: number; error: string | null; started_at: string; completed_at: string | null };
type ChangeRow = { id: string; company_name: string; title: string; location: string | null; closed_at: string | null; updated_at: string };
type RotationData = {
  generatedAt: string;
  lookbackHours: number;
  healthy: boolean;
  sync: { sourceSystem: string; lastIncrementalSuccessAt: string | null; lastReconcileSuccessAt: string | null; lastError: string | null; consecutiveFailures: number; syncInProgress: boolean; updatedAt: string };
  source: { reachable: boolean; generatedAt: string | null; contractVersion?: string | null; message: string; openJobs: number | null; closedJobs: number | null; latestCrawlStatus: string | null; latestCrawlAt: string | null };
  summary: { platformActiveJobs: number; platformFeedJobs: number; createdInRecentRuns: number; updatedInRecentRuns: number; recentRuns: number; failedRuns: number; closed24h: number; closedCapped: boolean };
  changes: { runs: RemoteRun[]; removed: ChangeRow[] };
};

function formatNumber(value: number) { return new Intl.NumberFormat('zh-CN').format(value); }
function formatTime(value: string | null) {
  if (!value) return '暂无记录';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
function relativeTime(value: string | null) {
  if (!value) return '暂无记录';
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function StatusMark({ healthy, label }: { healthy: boolean; label: string }) {
  return <Badge variant={healthy ? 'secondary' : 'destructive'} className="gap-1.5 px-2.5 py-1"><span className={`h-1.5 w-1.5 rounded-full ${healthy ? 'bg-emerald-500' : 'bg-red-500'}`} />{label}</Badge>;
}

function ClosedList({ rows, emptyText }: { rows: ChangeRow[]; emptyText: string }) {
  return rows.length === 0 ? <p className="px-1 py-8 text-center text-sm text-muted-foreground">{emptyText}</p> : (
    <div className="divide-y">
      {rows.map((row) => <div key={row.id} className="flex items-start gap-3 px-1 py-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-600"><ArrowDownRight className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{row.title}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{row.company_name} · {row.location || '地区未注明'}</p></div>
        <span className="shrink-0 pt-1 text-xs text-muted-foreground">{relativeTime(row.closed_at || row.updated_at)}</span>
      </div>)}
    </div>
  );
}

export default function JobRotationPage() {
  const { loading: permissionsLoading, hasPermission } = useAdminPermissions();
  const allowed = hasPermission(ADMIN_PERMISSIONS.dashboardRead);
  const [data, setData] = useState<RotationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/admin/job-rotation', { cache: 'no-store' });
      const payload = await response.json() as RotationData & { error?: string };
      if (!response.ok) throw new Error(payload.error || '读取岗位轮换状态失败');
      setData(payload); setLastRefresh(new Date().toISOString());
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取岗位轮换状态失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (!permissionsLoading && allowed) void fetchData(); }, [allowed, fetchData, permissionsLoading]);
  useEffect(() => { if (!allowed) return; const timer = window.setInterval(() => void fetchData(), 60_000); return () => window.clearInterval(timer); }, [allowed, fetchData]);

  if (permissionsLoading || loading && !data) return <main className="min-h-[calc(100vh-3.5rem)] bg-muted/20 px-4 py-8 md:px-8"><div className="mx-auto max-w-7xl animate-pulse space-y-4"><div className="h-24 rounded-xl bg-muted" /><div className="grid gap-4 md:grid-cols-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-28 rounded-xl bg-muted" />)}</div></div></main>;
  if (!allowed) return <main className="p-8"><Card><CardContent className="py-12 text-center text-sm text-muted-foreground">当前管理员没有查看岗位轮换的权限。</CardContent></Card></main>;

  return <main className="min-h-[calc(100vh-3.5rem)] bg-muted/20 px-4 py-6 md:px-8 md:py-8">
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div><div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground"><Radio className="h-4 w-4 text-primary" />岗位运营监控</div><h1 className="text-2xl font-semibold tracking-tight md:text-3xl">岗位轮换</h1><p className="mt-1 text-sm text-muted-foreground">看清岗位池是否在持续更新，以及哪些岗位刚刚上下架。</p></div>
        <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{lastRefresh ? `更新于 ${formatTime(lastRefresh)}` : '等待更新'}</span><Button variant="outline" size="sm" onClick={() => void fetchData()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /><span className="hidden sm:inline">刷新</span></Button></div>
      </section>

      {error && <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><TriangleAlert className="h-4 w-4 shrink-0" />{error}<Button variant="ghost" size="sm" className="ml-auto" onClick={() => void fetchData()}>重试</Button></div>}
      {data && <>
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card className="border-l-4 border-l-emerald-500"><CardContent className="p-5"><div className="flex items-start justify-between"><div><p className="text-sm text-muted-foreground">主服务器抓取</p><p className="mt-2 text-xl font-semibold">{data.healthy ? '运行正常' : '需要关注'}</p></div><span className={`rounded-lg p-2 ${data.healthy ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'}`}><Server className="h-5 w-5" /></span></div><div className="mt-3 flex items-center gap-2"><StatusMark healthy={data.healthy} label={data.healthy ? '健康' : '异常'} /><span className="text-xs text-muted-foreground">数据源 {relativeTime(data.source.generatedAt)}</span></div></CardContent></Card>
          <Card><CardContent className="p-5"><div className="flex items-start justify-between"><div><p className="text-sm text-muted-foreground">主服务器开放岗位</p><p className="mt-2 text-3xl font-semibold tracking-tight">{formatNumber(data.source.openJobs || 0)}</p></div><span className="rounded-lg bg-primary/10 p-2 text-primary"><BriefcaseBusiness className="h-5 w-5" /></span></div><p className="mt-3 text-xs text-muted-foreground">本站已接入 {formatNumber(data.summary.platformFeedJobs)} 条</p></CardContent></Card>
          <Card><CardContent className="p-5"><div className="flex items-start justify-between"><div><p className="text-sm text-muted-foreground">最近批次新增</p><p className="mt-2 text-3xl font-semibold tracking-tight text-emerald-600">+{formatNumber(data.summary.createdInRecentRuns)}</p></div><span className="rounded-lg bg-emerald-500/10 p-2 text-emerald-600"><ArrowUpRight className="h-5 w-5" /></span></div><p className="mt-3 text-xs text-muted-foreground">最近 {data.summary.recentRuns} 个抓取批次</p></CardContent></Card>
          <Card><CardContent className="p-5"><div className="flex items-start justify-between"><div><p className="text-sm text-muted-foreground">近 24 小时下架</p><p className="mt-2 text-3xl font-semibold tracking-tight text-amber-600">-{formatNumber(data.summary.closed24h)}</p></div><span className="rounded-lg bg-amber-500/10 p-2 text-amber-600"><ArrowDownRight className="h-5 w-5" /></span></div><p className="mt-3 text-xs text-muted-foreground">同步更新 {formatNumber(data.summary.updatedInRecentRuns)} 条</p></CardContent></Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3"><div><CardTitle className="text-base">最近抓取批次</CardTitle><p className="mt-1 text-xs text-muted-foreground">显示主服务器最近完成的采集批次</p></div><Badge variant="outline">{data.summary.failedRuns ? `${data.summary.failedRuns} 个失败` : '无失败批次'}</Badge></CardHeader><CardContent className="pt-0"><div className="divide-y">{data.changes.runs.slice(0, 8).map((run) => <div key={run.id} className="flex items-start gap-3 py-3"><span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${run.status === 'success' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}><Radio className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{run.company}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{run.status === 'success' ? '完成' : '部分完成'} · 发现 {formatNumber(run.discovered_count)} · 新增 {formatNumber(run.created_count)} · 更新 {formatNumber(run.updated_count)}</p></div><span className="shrink-0 pt-1 text-xs text-muted-foreground">{relativeTime(run.completed_at || run.started_at)}</span></div>)}</div></CardContent></Card>
          <div className="space-y-6"><Card><CardHeader className="pb-3"><CardTitle className="text-base">本站同步水位</CardTitle></CardHeader><CardContent className="space-y-3 pt-0"><div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">增量同步</span><span className="font-medium">{relativeTime(data.sync.lastIncrementalSuccessAt)}</span></div><div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">完整对账</span><span className="font-medium">{formatTime(data.sync.lastReconcileSuccessAt)}</span></div><div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">同步状态</span>{data.sync.syncInProgress ? <Badge variant="outline" className="gap-1"><RefreshCw className="h-3 w-3 animate-spin" />同步中</Badge> : <Badge variant="secondary">空闲</Badge>}</div>{data.sync.lastError && <div className="rounded-md bg-destructive/5 p-3 text-xs text-destructive"><CircleAlert className="mr-1 inline h-3.5 w-3.5" />{data.sync.lastError}</div>}</CardContent></Card><Card><CardHeader className="pb-3"><CardTitle className="text-base">上游数据源</CardTitle></CardHeader><CardContent className="space-y-3 pt-0"><div className="flex items-center justify-between"><div className="flex items-center gap-2 text-sm"><span className={`h-2 w-2 rounded-full ${data.source.reachable ? 'bg-emerald-500' : 'bg-red-500'}`} />{data.source.message}</div><StatusMark healthy={data.source.reachable} label={data.source.reachable ? '可达' : '不可达'} /></div><div className="flex items-center justify-between text-xs text-muted-foreground"><span>最近抓取</span><span>{formatTime(data.source.latestCrawlAt)}</span></div><div className="flex items-center justify-between text-xs text-muted-foreground"><span>开放 / 已关闭</span><span>{formatNumber(data.source.openJobs || 0)} / {formatNumber(data.source.closedJobs || 0)}</span></div>{data.source.contractVersion && <div className="flex items-center justify-between text-xs text-muted-foreground"><span>接口版本</span><span>{data.source.contractVersion}</span></div>}</CardContent></Card><Card><CardHeader className="pb-3"><CardTitle className="text-base">最近下架</CardTitle></CardHeader><CardContent className="pt-0"><ClosedList rows={data.changes.removed.slice(0, 4)} emptyText="近 24 小时暂无下架岗位" /></CardContent></Card></div>
        </section>
      </>}
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />自动刷新间隔 60 秒 · 下架统计读取主服务器关闭记录 {data?.summary.closedCapped && '（已达到展示上限）'}</div>
    </div>
  </main>;
}

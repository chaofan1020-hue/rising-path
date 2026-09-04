'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  BriefcaseBusiness,
  CheckCircle2,
  CircleAlert,
  Clock3,
  ExternalLink,
  Filter,
  Link2,
  Loader2,
  Play,
  Radio,
  RefreshCw,
  Server,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAdminPermissions } from '@/components/admin-shell';
import { ADMIN_PERMISSIONS } from '@/lib/admin-permission-constants';

type ChangeType = 'all' | 'new' | 'updated' | 'closed';
type RemoteRun = { id: string; company: string; connector_type: string; status: string; discovered_count: number; created_count: number; updated_count: number; error: string | null; started_at: string; completed_at: string | null };
type ChangeRow = {
  id: number;
  title: string;
  company: string;
  region: string;
  direction: string;
  job_type: string | null;
  job_url: string | null;
  source_url: string | null;
  valid_through: string | null;
  is_active: boolean;
  is_closed: boolean;
  created_at: string;
  updated_at: string | null;
  change_type: 'new' | 'updated' | 'closed';
  last_verified_at: string | null;
  last_link_checked_at: string | null;
  last_link_status: number | null;
  link_check_failures: number;
  missing_feed_checks: number;
  availability_status: 'valid' | 'closed' | 'blocked' | 'timeout' | 'unknown' | null;
  link_health: 'healthy' | 'closed' | 'blocked' | 'timeout' | 'unknown' | null;
  last_link_error: string | null;
  last_link_http_status: number | null;
  availability_checked_at: string | null;
};
type RotationData = {
  generatedAt: string;
  lookbackHours: number;
  healthy: boolean;
  sync: { sourceSystem: string; lastIncrementalSuccessAt: string | null; lastReconcileSuccessAt: string | null; lastError: string | null; consecutiveFailures: number; syncInProgress: boolean; updatedAt: string };
  source: { reachable: boolean; generatedAt: string | null; contractVersion?: string | null; message: string; openJobs: number | null; closedJobs: number | null; latestCrawlStatus: string | null; latestCrawlAt: string | null };
  summary: { platformActiveJobs: number; platformFeedJobs: number; createdInRecentRuns: number; updatedInRecentRuns: number; recentRuns: number; failedRuns: number; closed24h: number; closedCapped: boolean; lookbackHours: number; localNew: number; localUpdated: number; localClosed: number };
  changes: { runs: RemoteRun[]; removed: Array<{ id: string; company_name: string; title: string; location: string | null; closed_at: string | null; updated_at: string }>; jobs: ChangeRow[]; pagination: { page: number; pageSize: number; total: number; totalPages: number; changeType: ChangeType } };
};
type FieldQualityCompany = {
  company: string;
  total: number;
  verifiedDeadline: number;
  verifiedSalary: number;
  verifiedLocation: number;
  pending: number;
  rejected: number;
  invalidDeadline: number;
  latestVerifiedAt: string | null;
  coverage: { deadline: number; salary: number; location: number };
  priorityScore: number;
  releaseGate: 'passed' | 'pending_recheck';
  ruleConfigured: boolean;
  companyId: string | null;
};
type FieldQualityData = { generatedAt: string; companySyncAvailable: boolean; companies: FieldQualityCompany[] };

const changeFilters: Array<{ value: ChangeType; label: string }> = [
  { value: 'all', label: '全部变更' },
  { value: 'new', label: '新增岗位' },
  { value: 'updated', label: '更新岗位' },
  { value: 'closed', label: '下架岗位' },
];

function formatNumber(value: number) { return new Intl.NumberFormat('zh-CN').format(value); }
function formatTime(value: string | null) {
  if (!value) return '暂无记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间无效' : new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
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
function formatDeadline(value: string | null) {
  if (!value) return '未提供';
  const dateOnly = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  const date = new Date(dateOnly ? `${dateOnly}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? '未提供' : new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function StatusMark({ healthy, label }: { healthy: boolean; label: string }) {
  return <Badge variant={healthy ? 'secondary' : 'destructive'} className="gap-1.5 px-2.5 py-1"><span className={`h-1.5 w-1.5 rounded-full ${healthy ? 'bg-emerald-500' : 'bg-red-500'}`} />{label}</Badge>;
}

function ChangeBadge({ type }: { type: ChangeRow['change_type'] }) {
  if (type === 'new') return <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600"><ArrowUpRight className="h-3 w-3" />新增</Badge>;
  if (type === 'closed') return <Badge className="gap-1 bg-amber-600 text-white hover:bg-amber-600"><ArrowDownRight className="h-3 w-3" />下架</Badge>;
  return <Badge variant="outline" className="gap-1"><RefreshCw className="h-3 w-3" />更新</Badge>;
}

function LinkHealth({ row }: { row: ChangeRow }) {
  if (row.availability_status === 'closed' || row.link_health === 'closed') return <span className="text-red-600">已确认下架</span>;
  if (row.availability_status === 'blocked' || row.link_health === 'blocked') return <span className="text-amber-600">验证拦截，保留岗位</span>;
  if (row.availability_status === 'timeout' || row.link_health === 'timeout') return <span className="text-amber-600">请求超时，待重试</span>;
  if (row.availability_status === 'unknown' || row.link_health === 'unknown') return <span className="text-amber-600">状态不确定，待重试</span>;
  if (!row.last_link_checked_at && !row.availability_checked_at) return <span className="text-muted-foreground">未核验</span>;
  if (row.link_check_failures > 0) return <span className="text-amber-600">失败 {row.link_check_failures} 次</span>;
  const status = row.last_link_http_status || row.last_link_status;
  if (status && status >= 200 && status < 300) return <span className="text-emerald-600">可读取 · HTTP {status}</span>;
  return <span className="text-muted-foreground">HTTP {status || '未知'}</span>;
}

function ClosedList({ rows, emptyText }: { rows: RotationData['changes']['removed']; emptyText: string }) {
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
  const canSync = hasPermission(ADMIN_PERMISSIONS.jobsWrite);
  const [data, setData] = useState<RotationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [changeType, setChangeType] = useState<ChangeType>('all');
  const [page, setPage] = useState(1);
  const [syncing, setSyncing] = useState(false);
  const [companySyncing, setCompanySyncing] = useState<string | null>(null);
  const [quality, setQuality] = useState<FieldQualityData | null>(null);
  const [syncMessage, setSyncMessage] = useState('');
  const [syncError, setSyncError] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ change_type: changeType, page: String(page), page_size: '50', hours: '24' });
      const [response, qualityResponse] = await Promise.all([
        fetch(`/api/admin/job-rotation?${params.toString()}`, { cache: 'no-store' }),
        fetch('/api/admin/job-field-quality', { cache: 'no-store' }),
      ]);
      const payload = await response.json() as RotationData & { error?: string };
      if (!response.ok) throw new Error(payload.error || '读取岗位轮换状态失败');
      if (qualityResponse.ok) setQuality(await qualityResponse.json() as FieldQualityData);
      setData(payload);
      setLastRefresh(new Date().toISOString());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取岗位轮换状态失败');
    } finally {
      setLoading(false);
    }
  }, [changeType, page]);

  useEffect(() => { if (!permissionsLoading && allowed) void fetchData(); }, [allowed, fetchData, permissionsLoading]);
  useEffect(() => { if (!allowed) return; const timer = window.setInterval(() => void fetchData(), 60_000); return () => window.clearInterval(timer); }, [allowed, fetchData]);

  const handleSync = async () => {
    if (!canSync || syncing) return;
    setSyncing(true);
    setSyncMessage('');
    setSyncError('');
    try {
      const response = await fetch('/api/jobs/sync-feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'incremental', maxPages: 20 }) });
      const payload = await response.json() as { result?: { received: number; upserted: number; closed: number; failed: number; has_more: boolean }; error?: string };
      if (!response.ok || !payload.result) throw new Error(payload.error || '岗位同步失败');
      const result = payload.result;
      setSyncMessage(`同步完成：接收 ${formatNumber(result.received)} 条，新增/更新 ${formatNumber(result.upserted)} 条，下架 ${formatNumber(result.closed)} 条${result.failed ? `，失败 ${formatNumber(result.failed)} 条` : ''}${result.has_more ? '；仍有剩余数据，下一次同步会从游标继续' : ''}。`);
      await fetchData();
    } catch (cause) {
      setSyncError(cause instanceof Error ? cause.message : '岗位同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const handleCompanySync = async (company: string, companyId: string | null) => {
    if (!companyId) {
      setSyncError(`${company} 尚未在主服务器公司目录中找到稳定标识，无法安全定向同步。`);
      return;
    }
    setCompanySyncing(company);
    setSyncError('');
    setSyncMessage('');
    try {
      const response = await fetch('/api/jobs/sync-feed', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'incremental', maxPages: 20, companyId }),
      });
      const payload = await response.json() as { error?: string; result?: { received?: number; upserted?: number; closed?: number } };
      if (!response.ok) throw new Error(payload.error || '定向同步失败');
      setSyncMessage(`${company} 同步完成：收到 ${payload.result?.received || 0} 条，更新 ${payload.result?.upserted || 0} 条，下架 ${payload.result?.closed || 0} 条。`);
      await fetchData();
    } catch (cause) {
      setSyncError(cause instanceof Error ? cause.message : '定向同步失败');
    } finally {
      setCompanySyncing(null);
    }
  };

  if (permissionsLoading || loading && !data) return <main className="min-h-[calc(100vh-3.5rem)] bg-background px-4 py-8 md:px-8"><div className="mx-auto max-w-7xl animate-pulse space-y-4"><div className="h-24 rounded-lg bg-zinc-100 dark:bg-zinc-900" /><div className="grid gap-4 md:grid-cols-5">{[1, 2, 3, 4, 5].map((item) => <div key={item} className="h-28 rounded-lg bg-zinc-100 dark:bg-zinc-900" />)}</div></div></main>;
  if (!allowed) return <main className="p-8"><Card><CardContent className="py-12 text-center text-sm text-muted-foreground">当前管理员没有查看岗位轮换的权限。</CardContent></Card></main>;

  const totalPages = data?.changes.pagination.totalPages || 0;
  return <main className="min-h-[calc(100vh-3.5rem)] bg-background px-4 py-6 md:px-8 md:py-8">
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div><div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground"><Radio className="h-4 w-4 text-primary" />岗位运营监控</div><h1 className="text-2xl font-semibold tracking-tight md:text-3xl">岗位轮换</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">查看最近 24 小时本站实际新增、更新和下架的每一条岗位，并随时从上游同步，避免服务器与网站数据出现偏差。</p></div>
        <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">{lastRefresh ? `更新于 ${formatTime(lastRefresh)}` : '等待更新'}</span><Button variant="outline" size="sm" onClick={() => void fetchData()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /><span className="hidden sm:inline">刷新明细</span></Button><Button size="sm" onClick={() => void handleSync()} disabled={!canSync || syncing || data?.sync.syncInProgress} title={!canSync ? '当前管理员没有岗位写入权限' : undefined}><>{syncing || data?.sync.syncInProgress ? <Loader2 className="h-4 w-4 animate-spin sm:mr-1.5" /> : <Play className="h-4 w-4 sm:mr-1.5" />}</><span>{syncing ? '同步中' : '立即同步岗位'}</span></Button></div>
      </section>

      {error && <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><TriangleAlert className="h-4 w-4 shrink-0" />{error}<Button variant="ghost" size="sm" className="ml-auto" onClick={() => void fetchData()}>重试</Button></div>}
      {syncMessage && <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{syncMessage}</div>}
      {syncError && <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{syncError}</div>}

      {data && <>
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Card className="border-l-4 border-l-emerald-500"><CardContent className="p-5"><p className="text-sm text-muted-foreground">主服务器抓取</p><p className="mt-2 text-xl font-semibold">{data.healthy ? '运行正常' : '需要关注'}</p><div className="mt-3 flex items-center gap-2"><StatusMark healthy={data.healthy} label={data.healthy ? '健康' : '异常'} /><span className="text-xs text-muted-foreground">{relativeTime(data.source.generatedAt)}</span></div></CardContent></Card>
          <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">本站可投递岗位</p><p className="mt-2 text-3xl font-semibold tracking-tight">{formatNumber(data.summary.platformFeedJobs)}</p><p className="mt-3 text-xs text-muted-foreground">上游开放 {formatNumber(data.source.openJobs || 0)} 条</p></CardContent></Card>
          <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">本站新增</p><p className="mt-2 text-3xl font-semibold tracking-tight text-emerald-600">+{formatNumber(data.summary.localNew)}</p><p className="mt-3 text-xs text-muted-foreground">最近 {data.summary.lookbackHours} 小时</p></CardContent></Card>
          <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">本站更新</p><p className="mt-2 text-3xl font-semibold tracking-tight text-primary">{formatNumber(data.summary.localUpdated)}</p><p className="mt-3 text-xs text-muted-foreground">最近 {data.summary.lookbackHours} 小时</p></CardContent></Card>
          <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">本站下架</p><p className="mt-2 text-3xl font-semibold tracking-tight text-amber-600">-{formatNumber(data.summary.localClosed)}</p><p className="mt-3 text-xs text-muted-foreground">含过期与上游关闭</p></CardContent></Card>
        </section>

        <Card>
          <CardHeader className="flex flex-col gap-3 pb-3 md:flex-row md:items-center md:justify-between"><div><CardTitle className="text-base">本站岗位变更明细</CardTitle><p className="mt-1 text-xs text-muted-foreground">每条记录对应本站数据库的一次岗位新增、内容更新或下架。链接核验状态来自后台健康检查。</p></div><div className="flex items-center gap-2 text-xs text-muted-foreground"><Filter className="h-3.5 w-3.5" />最近 {data.summary.lookbackHours} 小时</div></CardHeader>
          <CardContent className="pt-0">
            <div className="mb-4 flex flex-wrap gap-2">{changeFilters.map((filter) => <Button key={filter.value} type="button" size="sm" variant={changeType === filter.value ? 'default' : 'outline'} onClick={() => { setChangeType(filter.value); setPage(1); }}>{filter.label}{filter.value === 'new' && ` ${formatNumber(data.summary.localNew)}`}{filter.value === 'updated' && ` ${formatNumber(data.summary.localUpdated)}`}{filter.value === 'closed' && ` ${formatNumber(data.summary.localClosed)}`}</Button>)}</div>
            <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[1080px] text-sm"><thead className="bg-muted/50"><tr className="border-b"><th className="px-3 py-3 text-left font-medium">变更</th><th className="px-3 py-3 text-left font-medium">岗位</th><th className="px-3 py-3 text-left font-medium">地区 / 方向</th><th className="px-3 py-3 text-left font-medium">截止日期</th><th className="px-3 py-3 text-left font-medium">时间</th><th className="px-3 py-3 text-left font-medium">链接核验</th><th className="px-3 py-3 text-right font-medium">操作</th></tr></thead><tbody className="divide-y">
              {loading ? <tr><td colSpan={7} className="py-12 text-center text-muted-foreground"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />正在加载轮换明细…</td></tr> : data.changes.jobs.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-muted-foreground">当前时间窗口内没有匹配的岗位变更</td></tr> : data.changes.jobs.map((row) => <tr key={row.id} className="align-top hover:bg-muted/30"><td className="px-3 py-3"><ChangeBadge type={row.change_type} /><p className="mt-1 text-xs text-muted-foreground">ID {row.id}</p>{row.missing_feed_checks > 0 && <p className="mt-1 text-xs text-amber-600">缺席对账 {row.missing_feed_checks} 次</p>}</td><td className="max-w-[320px] px-3 py-3"><p className="font-medium">{row.title}</p><p className="mt-1 text-xs text-muted-foreground">{row.company}{row.job_type ? ` · ${row.job_type}` : ''}</p></td><td className="px-3 py-3"><p>{row.region || '未注明'}</p><p className="mt-1 text-xs text-muted-foreground">{row.direction || '方向未注明'}</p></td><td className="px-3 py-3 whitespace-nowrap">{formatDeadline(row.valid_through)}</td><td className="px-3 py-3 whitespace-nowrap"><p>{formatTime(row.updated_at || row.created_at)}</p><p className="mt-1 text-xs text-muted-foreground">创建于 {formatTime(row.created_at)}</p><p className="mt-1 text-xs text-muted-foreground">来源核验 {relativeTime(row.last_verified_at)}</p></td><td className="px-3 py-3 whitespace-nowrap"><LinkHealth row={row} />{(row.last_link_checked_at || row.availability_checked_at) && <p className="mt-1 text-xs text-muted-foreground">{relativeTime(row.last_link_checked_at || row.availability_checked_at)}</p>}{row.last_link_error && <p className="mt-1 max-w-[220px] truncate text-xs text-muted-foreground" title={row.last_link_error}>{row.last_link_error}</p>}</td><td className="px-3 py-3 text-right"><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" title="查看原岗位链接" aria-label="查看原岗位链接" disabled={!row.job_url} asChild={Boolean(row.job_url)}>{row.job_url ? <a href={row.job_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /></a> : <Link2 className="h-4 w-4 text-muted-foreground" />}</Button><Button size="sm" variant="outline" asChild><a href={`/admin?tab=jobs`}><BriefcaseBusiness className="mr-1 h-3.5 w-3.5" />管理</a></Button></div></td></tr>)}
            </tbody></table></div>
            <div className="mt-4 flex flex-col items-center justify-between gap-3 text-xs text-muted-foreground sm:flex-row"><span>共 {formatNumber(data.changes.pagination.total)} 条，当前第 {data.changes.pagination.page} / {Math.max(totalPages, 1)} 页</span><div className="flex items-center gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || loading}>上一页</Button><Button type="button" size="sm" variant="outline" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages || loading || totalPages === 0}>下一页</Button></div></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-3 pb-3 md:flex-row md:items-center md:justify-between"><div><CardTitle className="text-base">公司字段质量</CardTitle><p className="mt-1 text-xs text-muted-foreground">只统计已进入本站的开放岗位。字段缺少官网证据时保持不展示，不会触发下架。</p></div><Badge variant="outline">{quality ? `已审计 ${formatNumber(quality.companies.length)} 家` : '读取中'}</Badge></CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[980px] text-sm"><thead className="bg-muted/50"><tr className="border-b"><th className="px-3 py-3 text-left font-medium">公司</th><th className="px-3 py-3 text-right font-medium">岗位</th><th className="px-3 py-3 text-center font-medium">截止日期</th><th className="px-3 py-3 text-center font-medium">薪资</th><th className="px-3 py-3 text-center font-medium">地点</th><th className="px-3 py-3 text-center font-medium">待复核</th><th className="px-3 py-3 text-left font-medium">发布闸门</th><th className="px-3 py-3 text-right font-medium">操作</th></tr></thead><tbody className="divide-y">
              {!quality ? <tr><td colSpan={8} className="py-8 text-center text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr> : quality.companies.slice(0, 20).map((company) => <tr key={company.company} className="hover:bg-muted/30"><td className="px-3 py-3"><p className="font-medium">{company.company}</p><p className="mt-1 text-xs text-muted-foreground">{company.ruleConfigured ? '已配置公司规则' : '通用官网规则'}</p></td><td className="px-3 py-3 text-right">{formatNumber(company.total)}</td><td className="px-3 py-3 text-center">{company.coverage.deadline}%</td><td className="px-3 py-3 text-center">{company.coverage.salary}%</td><td className="px-3 py-3 text-center">{company.coverage.location}%</td><td className="px-3 py-3 text-center">{formatNumber(company.pending + company.rejected)}</td><td className="px-3 py-3">{company.releaseGate === 'passed' ? <Badge variant="secondary">可发布</Badge> : <Badge variant="outline">待复核</Badge>}{company.invalidDeadline > 0 && <p className="mt-1 text-xs text-destructive">异常日期 {company.invalidDeadline}</p>}</td><td className="px-3 py-3 text-right"><Button size="sm" variant="outline" disabled={!canSync || !quality.companySyncAvailable || !company.companyId || companySyncing !== null} title={quality.companySyncAvailable ? company.companyId ? '仅同步该公司开放岗位与关闭事件' : '主服务器未返回该公司的稳定标识' : '等待上游启用按公司安全过滤'} onClick={() => void handleCompanySync(company.company, company.companyId)}>{companySyncing === company.company ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}<span className="ml-1">同步</span></Button></td></tr>)}
            </tbody></table></div>
            {quality && !quality.companySyncAvailable && <p className="mt-3 text-xs text-muted-foreground">定向同步将会在主服务器发布公司过滤能力后自动可用；当前禁用是为了避免按钮误触发全库扫描。</p>}
          </CardContent>
        </Card>

        <section className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3"><div><CardTitle className="text-base">最近抓取批次</CardTitle><p className="mt-1 text-xs text-muted-foreground">上游各企业采集器的批次结果</p></div><Badge variant="outline">{data.summary.failedRuns ? `${data.summary.failedRuns} 个失败` : '无失败批次'}</Badge></CardHeader><CardContent className="pt-0"><div className="divide-y">{data.changes.runs.map((run) => <div key={run.id} className="flex items-start gap-3 py-3"><span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${run.status === 'success' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}><Radio className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="font-medium">{run.company}</p><p className="mt-0.5 text-xs text-muted-foreground">{run.connector_type} · {run.status === 'success' ? '完成' : '部分完成'} · 发现 {formatNumber(run.discovered_count)} · 新增 {formatNumber(run.created_count)} · 更新 {formatNumber(run.updated_count)}</p>{run.error && <p className="mt-1 break-words text-xs text-destructive">{run.error}</p>}</div><span className="shrink-0 pt-1 text-xs text-muted-foreground">{relativeTime(run.completed_at || run.started_at)}</span></div>)}</div></CardContent></Card>
          <div className="space-y-6"><Card><CardHeader className="pb-3"><CardTitle className="text-base">本站同步水位</CardTitle></CardHeader><CardContent className="space-y-3 pt-0"><div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">增量同步</span><span className="font-medium">{relativeTime(data.sync.lastIncrementalSuccessAt)}</span></div><div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">完整对账</span><span className="font-medium">{formatTime(data.sync.lastReconcileSuccessAt)}</span></div><div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">当前状态</span>{data.sync.syncInProgress ? <Badge variant="outline" className="gap-1"><RefreshCw className="h-3 w-3 animate-spin" />同步中</Badge> : <Badge variant="secondary">空闲</Badge>}</div><p className="text-xs text-muted-foreground">状态更新时间：{formatTime(data.sync.updatedAt)}</p>{data.sync.lastError && <div className="rounded-md bg-destructive/5 p-3 text-xs text-destructive"><CircleAlert className="mr-1 inline h-3.5 w-3.5" />{data.sync.lastError}</div>}</CardContent></Card><Card><CardHeader className="pb-3"><CardTitle className="text-base">最近下架（上游）</CardTitle></CardHeader><CardContent className="pt-0"><ClosedList rows={data.changes.removed} emptyText="近 24 小时暂无下架岗位" /></CardContent></Card></div>
        </section>
      </>}
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />页面每 60 秒自动刷新；一键同步使用增量游标，未完成的记录会在下一次继续。</div>
    </div>
  </main>;
}

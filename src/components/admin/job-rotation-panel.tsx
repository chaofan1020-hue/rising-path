'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownRight,
  ArrowUpRight,
  BriefcaseBusiness,
  ExternalLink,
  Link2,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAdminPermissions } from '@/components/admin-shell';
import { ADMIN_PERMISSIONS } from '@/lib/admin-permission-constants';

type ChangeType = 'all' | 'new' | 'updated' | 'closed';
type ChangeRow = {
  id: number;
  title: string;
  company: string;
  region: string;
  direction: string;
  job_type: string | null;
  job_url: string | null;
  valid_through: string | null;
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
  healthy: boolean;
  summary: { platformFeedJobs: number; localNew: number; localUpdated: number; localClosed: number; lookbackHours: number };
  changes: { jobs: ChangeRow[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } };
};

const changeFilters: Array<{ value: ChangeType; label: string }> = [
  { value: 'all', label: '全部变更' },
  { value: 'new', label: '新增' },
  { value: 'updated', label: '更新' },
  { value: 'closed', label: '下架' },
];

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}
function formatTime(value: string | null) {
  if (!value) return '暂无记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间无效' : new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
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

function ChangeBadge({ type }: { type: ChangeRow['change_type'] }) {
  if (type === 'new') return <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600"><ArrowUpRight className="h-3 w-3" />新增</Badge>;
  if (type === 'closed') return <Badge className="gap-1 bg-amber-600 text-white hover:bg-amber-600"><ArrowDownRight className="h-3 w-3" />下架</Badge>;
  return <Badge variant="outline" className="gap-1"><RefreshCw className="h-3 w-3" />更新</Badge>;
}

function LinkHealth({ row }: { row: ChangeRow }) {
  if (row.availability_status === 'closed' || row.link_health === 'closed') return <span className="text-red-600">已确认下架</span>;
  if (row.availability_status === 'blocked' || row.link_health === 'blocked') return <span className="text-amber-600">验证拦截</span>;
  if (row.availability_status === 'timeout' || row.link_health === 'timeout') return <span className="text-amber-600">请求超时</span>;
  if (row.availability_status === 'unknown' || row.link_health === 'unknown') return <span className="text-amber-600">状态不确定</span>;
  if (!row.last_link_checked_at && !row.availability_checked_at) return <span className="text-muted-foreground">未核验</span>;
  if (row.link_check_failures > 0) return <span className="text-amber-600">失败 {row.link_check_failures} 次</span>;
  const status = row.last_link_http_status || row.last_link_status;
  if (status && status >= 200 && status < 300) return <span className="text-emerald-600">可读取</span>;
  return <span className="text-muted-foreground">HTTP {status || '未知'}</span>;
}

export function JobRotationChangesPanel() {
  const { hasPermission } = useAdminPermissions();
  const allowed = hasPermission(ADMIN_PERMISSIONS.jobsRead);
  const [data, setData] = useState<RotationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [changeType, setChangeType] = useState<ChangeType>('all');
  const [page, setPage] = useState(1);

  const fetchData = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ change_type: changeType, page: String(page), page_size: '20', hours: '24' });
      const response = await fetch(`/api/admin/job-rotation?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json() as RotationData & { error?: string };
      if (!response.ok) throw new Error(payload.error || '读取岗位变更失败');
      setData(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取岗位变更失败');
    } finally {
      setLoading(false);
    }
  }, [allowed, changeType, page]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  if (!allowed) return null;

  const totalPages = data?.changes.pagination.totalPages || 0;
  return (
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">本站可投递</p><p className="mt-1 text-2xl font-semibold tabular-nums">{data ? formatNumber(data.summary.platformFeedJobs) : '—'}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">近 24 小时新增</p><p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600">+{data ? formatNumber(data.summary.localNew) : '—'}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">近 24 小时更新</p><p className="mt-1 text-2xl font-semibold tabular-nums">{data ? formatNumber(data.summary.localUpdated) : '—'}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">近 24 小时下架</p><p className="mt-1 text-2xl font-semibold tabular-nums text-amber-600">-{data ? formatNumber(data.summary.localClosed) : '—'}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 pb-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="text-base">近 24 小时岗位变更</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">本站实际新增、更新和下架的岗位，不再单独占用一个后台入口。</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void fetchData()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="ml-1.5 hidden sm:inline">刷新明细</span>
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          {error && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <TriangleAlert className="h-4 w-4 shrink-0" />{error}
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void fetchData()}>重试</Button>
            </div>
          )}
          <div className="mb-4 flex flex-wrap gap-2">
            {changeFilters.map((filter) => (
              <Button
                key={filter.value}
                type="button"
                size="sm"
                variant={changeType === filter.value ? 'default' : 'outline'}
                onClick={() => { setChangeType(filter.value); setPage(1); }}
              >
                {filter.label}
                {filter.value === 'new' && data ? ` ${formatNumber(data.summary.localNew)}` : ''}
                {filter.value === 'updated' && data ? ` ${formatNumber(data.summary.localUpdated)}` : ''}
                {filter.value === 'closed' && data ? ` ${formatNumber(data.summary.localClosed)}` : ''}
              </Button>
            ))}
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-muted/50">
                <tr className="border-b">
                  <th className="px-3 py-3 text-left font-medium">变更</th>
                  <th className="px-3 py-3 text-left font-medium">岗位</th>
                  <th className="px-3 py-3 text-left font-medium">地区 / 方向</th>
                  <th className="px-3 py-3 text-left font-medium">截止日期</th>
                  <th className="px-3 py-3 text-left font-medium">时间</th>
                  <th className="px-3 py-3 text-left font-medium">链接核验</th>
                  <th className="px-3 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading && !data ? (
                  <tr><td colSpan={7} className="py-12 text-center text-muted-foreground"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />正在加载变更明细…</td></tr>
                ) : !data || data.changes.jobs.length === 0 ? (
                  <tr><td colSpan={7} className="py-12 text-center text-muted-foreground">当前时间窗口内没有匹配的岗位变更</td></tr>
                ) : data.changes.jobs.map((row) => (
                  <tr key={row.id} className="align-top hover:bg-muted/30">
                    <td className="px-3 py-3">
                      <ChangeBadge type={row.change_type} />
                      {row.missing_feed_checks > 0 && <p className="mt-1 text-xs text-amber-600">缺席对账 {row.missing_feed_checks} 次</p>}
                    </td>
                    <td className="max-w-[280px] px-3 py-3">
                      <p className="font-medium">{row.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{row.company}{row.job_type ? ` · ${row.job_type}` : ''}</p>
                    </td>
                    <td className="px-3 py-3">
                      <p>{row.region || '未注明'}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{row.direction || '方向未注明'}</p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">{formatDeadline(row.valid_through)}</td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <p>{formatTime(row.updated_at || row.created_at)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">来源核验 {relativeTime(row.last_verified_at)}</p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <LinkHealth row={row} />
                      {(row.last_link_checked_at || row.availability_checked_at) && (
                        <p className="mt-1 text-xs text-muted-foreground">{relativeTime(row.last_link_checked_at || row.availability_checked_at)}</p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" title="查看原岗位链接" aria-label="查看原岗位链接" disabled={!row.job_url} asChild={Boolean(row.job_url)}>
                          {row.job_url ? <a href={row.job_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /></a> : <Link2 className="h-4 w-4 text-muted-foreground" />}
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                          <Link href="/admin/jobs"><BriefcaseBusiness className="mr-1 h-3.5 w-3.5" />管理</Link>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-col items-center justify-between gap-3 text-xs text-muted-foreground sm:flex-row">
            <span>共 {formatNumber(data?.changes.pagination.total || 0)} 条，当前第 {data?.changes.pagination.page || page} / {Math.max(totalPages, 1)} 页</span>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || loading}>上一页</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages || loading || totalPages === 0}>下一页</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

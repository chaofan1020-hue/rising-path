'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminPageShell } from '@/components/admin/page-shell';
import { formatAiFeature, formatCount } from '@/components/admin/format';
import { ADMIN_PERMISSIONS } from '@/lib/admin-permission-constants';

type ServiceHealthData = {
  overview: { callCount: number; successfulCalls: number; failedCalls: number; providersWithCalls: number; lastCallAt: string | null };
  providers: Array<{ provider: string; callCount: number; successfulCalls: number; failedCalls: number; successRate: number; averageDurationMs: number | null; lastCallAt: string | null; status: 'healthy' | 'warning' | 'degraded' | 'unknown' }>;
  failureHotspots: Array<{ provider: string; feature: string; failedCalls: number; callCount: number; failureRate: number; lastCallAt: string | null }>;
  jobSync: Array<{ sourceSystem: string; lastIncrementalSuccessAt: string | null; consecutiveFailures: number; status: 'healthy' | 'running' | 'degraded' | 'stale' | 'unknown' }>;
};

const RANGES = ['24h', '7d', '30d'] as const;

export function AdminHealthPanel() {
  const [data, setData] = useState<ServiceHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [range, setRange] = useState<(typeof RANGES)[number]>('24h');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/service-health?range=${range}`, { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) {
        const required = Array.isArray(json.error?.requiredMigrations) ? `（所需迁移：${json.error.requiredMigrations.join('、')}）` : '';
        throw new Error(`${json.error?.message || '服务健康数据加载失败'}${required}`);
      }
      setData(json.data || null);
    } catch (reason) {
      setData(null);
      setError(reason instanceof Error ? reason.message : '服务健康数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { void load(); }, [load]);

  const degraded = data?.providers.filter((item) => item.status === 'degraded').length || 0;
  const warning = data?.providers.filter((item) => item.status === 'warning').length || 0;
  const staleSyncs = data?.jobSync.filter((item) => item.status === 'stale' || item.status === 'degraded').length || 0;
  const runningSyncs = data?.jobSync.filter((item) => item.status === 'running').length || 0;
  const hasIssues = degraded + warning + staleSyncs > 0;

  return (
    <AdminPageShell
      title="服务健康"
      description="监控 AI 调用与岗位同步状态"
      permission={ADMIN_PERMISSIONS.dashboardRead}
      actions={<Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新</Button>}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">调用窗口：</span>
          {RANGES.map((item) => (
            <Button key={item} variant={range === item ? 'default' : 'outline'} size="sm" className="h-8 px-3 text-xs" onClick={() => setRange(item)}>
              {item === '24h' ? '近 24 小时' : item === '7d' ? '近 7 天' : '近 30 天'}
            </Button>
          ))}
          <Button variant="outline" size="sm" className="ml-auto" asChild><Link href="/admin/jobs/sync">打开同步页</Link></Button>
        </div>

        {loading && !data ? (
          <div className="py-16 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" /><p className="mt-2 text-sm text-muted-foreground">加载服务健康数据...</p></div>
        ) : error && !data ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-destructive">{error}</div>
        ) : data ? (
          <>
            <div className={`border-l-4 px-4 py-3 text-sm ${hasIssues ? 'border-amber-500 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100' : 'border-emerald-500 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-100'}`}>
              {hasIssues ? `需要关注：${degraded} 个供应商异常，${warning} 个供应商有失败告警，${staleSyncs} 个岗位同步异常或滞后。` : '当前窗口未发现供应商降级或岗位同步滞后。'}
              {runningSyncs > 0 && <span className="ml-2">{runningSyncs} 个岗位同步正在运行。</span>}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card><CardContent className="pt-5"><p className="text-2xl font-semibold">{formatCount(data.overview.callCount)}</p><p className="mt-1 text-sm text-muted-foreground">记录调用数</p></CardContent></Card>
              <Card><CardContent className="pt-5"><p className="text-2xl font-semibold">{data.overview.callCount > 0 ? ((data.overview.successfulCalls / data.overview.callCount) * 100).toFixed(1) : '0.0'}%</p><p className="mt-1 text-sm text-muted-foreground">整体成功率</p></CardContent></Card>
              <Card><CardContent className="pt-5"><p className="text-2xl font-semibold">{formatCount(data.overview.failedCalls)}</p><p className="mt-1 text-sm text-muted-foreground">失败调用数</p></CardContent></Card>
              <Card><CardContent className="pt-5"><p className="text-2xl font-semibold">{formatCount(data.overview.providersWithCalls)}</p><p className="mt-1 text-sm text-muted-foreground">有调用的供应商</p></CardContent></Card>
            </div>
            <Card>
              <CardHeader><CardTitle className="text-lg">AI 服务健康</CardTitle><CardDescription>基于已记录调用计算，不会因为打开后台而请求第三方服务。</CardDescription></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] text-sm">
                    <thead><tr className="border-b text-left text-muted-foreground"><th className="py-2 font-medium">供应商</th><th className="py-2 text-right font-medium">调用</th><th className="py-2 text-right font-medium">成功率</th><th className="py-2 text-right font-medium">平均耗时</th><th className="py-2 font-medium">最近调用</th><th className="py-2 font-medium">状态</th></tr></thead>
                    <tbody>
                      {data.providers.map((provider) => (
                        <tr key={provider.provider} className="border-b last:border-0">
                          <td className="py-2.5">{provider.provider}</td>
                          <td className="py-2.5 text-right">{provider.callCount}</td>
                          <td className="py-2.5 text-right">{provider.successRate}%</td>
                          <td className="py-2.5 text-right">{provider.averageDurationMs === null ? '-' : `${provider.averageDurationMs} ms`}</td>
                          <td className="py-2.5">{provider.lastCallAt ? new Date(provider.lastCallAt).toLocaleString('zh-CN') : '-'}</td>
                          <td className="py-2.5"><Badge variant={provider.status === 'healthy' ? 'secondary' : provider.status === 'warning' ? 'outline' : 'destructive'}>{provider.status === 'healthy' ? '正常' : provider.status === 'warning' ? '有告警' : provider.status === 'degraded' ? '异常' : '未知'}</Badge></td>
                        </tr>
                      ))}
                      {data.providers.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">当前窗口没有已记录的 AI 调用</td></tr>}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle className="text-lg">失败热点</CardTitle><CardDescription>按供应商和功能聚合，不展示请求内容或错误正文。</CardDescription></CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-sm">
                      <thead><tr className="border-b text-left text-muted-foreground"><th className="py-2 font-medium">供应商</th><th className="py-2 font-medium">功能</th><th className="py-2 text-right font-medium">失败</th><th className="py-2 text-right font-medium">失败率</th></tr></thead>
                      <tbody>
                        {data.failureHotspots.map((item) => (
                          <tr key={`${item.provider}-${item.feature}`} className="border-b last:border-0">
                            <td className="py-2.5">{item.provider}</td>
                            <td className="py-2.5">{formatAiFeature(item.feature)}</td>
                            <td className="py-2.5 text-right">{item.failedCalls}/{item.callCount}</td>
                            <td className="py-2.5 text-right">{item.failureRate}%</td>
                          </tr>
                        ))}
                        {data.failureHotspots.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">当前窗口未记录失败调用</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-lg">岗位同步健康</CardTitle><CardDescription>同步超过 24 小时无成功记录会标记为滞后。</CardDescription></CardHeader>
                <CardContent className="space-y-3">
                  {data.jobSync.map((sync) => (
                    <div key={sync.sourceSystem} className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0">
                      <div>
                        <p className="font-medium">{sync.sourceSystem}</p>
                        <p className="mt-1 text-xs text-muted-foreground">上次增量成功：{sync.lastIncrementalSuccessAt ? new Date(sync.lastIncrementalSuccessAt).toLocaleString('zh-CN') : '-'}</p>
                        <p className="text-xs text-muted-foreground">连续失败：{sync.consecutiveFailures}</p>
                      </div>
                      <Badge variant={sync.status === 'healthy' ? 'secondary' : sync.status === 'running' ? 'outline' : 'destructive'}>
                        {sync.status === 'healthy' ? '正常' : sync.status === 'running' ? '同步中' : sync.status === 'stale' ? '已滞后' : sync.status === 'degraded' ? '异常' : '未知'}
                      </Badge>
                    </div>
                  ))}
                  {data.jobSync.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">尚未初始化岗位同步状态</p>}
                </CardContent>
              </Card>
            </div>
          </>
        ) : (
          <div className="py-12 text-center text-muted-foreground">暂无服务健康数据</div>
        )}
      </div>
    </AdminPageShell>
  );
}

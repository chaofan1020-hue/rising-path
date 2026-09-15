'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminPageShell } from '@/components/admin/page-shell';
import { formatCount } from '@/components/admin/format';
import { ADMIN_PERMISSIONS } from '@/lib/admin-permission-constants';

type PrefillQualityData = {
  overview: { confirmationRate: number; correctionRate: number; decided: number; ignored: number; contributingUsers: number };
  dailyStats: { date: string; confirmed: number; edited: number; ignored: number }[];
  fieldQuality: { domain: string; semanticKey: string; totalFeedback: number; correctionRate: number }[];
  templateQuality: { domainPattern: string; atsType: string; semanticKey: string; usageCount: number; correctionRate: number }[];
};

const RANGES = ['7d', '30d', '90d'] as const;

export function AdminQualityPanel() {
  const [data, setData] = useState<PrefillQualityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [range, setRange] = useState<(typeof RANGES)[number]>('30d');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/prefill-quality?range=${range}`, { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) {
        const required = Array.isArray(json.error?.requiredMigrations) ? `（所需迁移：${json.error.requiredMigrations.join('、')}）` : '';
        throw new Error(`${json.error?.message || '网申预填质量加载失败'}${required}`);
      }
      setData(json.data || null);
    } catch (reason) {
      setData(null);
      setError(reason instanceof Error ? reason.message : '网申预填质量加载失败');
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { void load(); }, [load]);

  return (
    <AdminPageShell
      title="网申质量"
      description="查看字段映射与预填反馈质量"
      permission={ADMIN_PERMISSIONS.dashboardRead}
      actions={<Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新</Button>}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">时间：</span>
          {RANGES.map((item) => (
            <Button key={item} variant={range === item ? 'default' : 'outline'} size="sm" className="h-8 px-3 text-xs" onClick={() => setRange(item)}>
              {item === '7d' ? '近 7 天' : item === '30d' ? '近 30 天' : '近 90 天'}
            </Button>
          ))}
        </div>
        {loading && !data ? (
          <div className="py-16 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" /><p className="mt-2 text-sm text-muted-foreground">加载网申预填质量数据...</p></div>
        ) : error && !data ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-destructive">{error}</div>
        ) : data ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Card><CardContent className="pt-5"><p className="text-2xl font-semibold">{data.overview.confirmationRate}%</p><p className="mt-1 text-sm text-muted-foreground">确认率</p></CardContent></Card>
              <Card><CardContent className="pt-5"><p className="text-2xl font-semibold">{data.overview.correctionRate}%</p><p className="mt-1 text-sm text-muted-foreground">修改率</p></CardContent></Card>
              <Card><CardContent className="pt-5"><p className="text-2xl font-semibold">{formatCount(data.overview.decided)}</p><p className="mt-1 text-sm text-muted-foreground">已决策字段</p></CardContent></Card>
              <Card><CardContent className="pt-5"><p className="text-2xl font-semibold">{formatCount(data.overview.ignored)}</p><p className="mt-1 text-sm text-muted-foreground">忽略字段</p></CardContent></Card>
              <Card><CardContent className="pt-5"><p className="text-2xl font-semibold">{formatCount(data.overview.contributingUsers)}</p><p className="mt-1 text-sm text-muted-foreground">贡献学生数</p></CardContent></Card>
            </div>
            <Card>
              <CardHeader><CardTitle className="text-lg">反馈趋势</CardTitle><CardDescription>确认率和修改率只统计已确认或修改的字段；忽略单独列出。</CardDescription></CardHeader>
              <CardContent>
                <div className="flex h-40 items-end gap-2">
                  {data.dailyStats.map((day) => {
                    const maximum = Math.max(...data.dailyStats.map((item) => Math.max(item.confirmed, item.edited, item.ignored)), 1);
                    return (
                      <div key={day.date} className="flex min-w-8 flex-1 flex-col items-center gap-1">
                        <div className="flex h-28 w-full items-end justify-center gap-0.5">
                          <div className="w-2 rounded-t bg-emerald-500" style={{ height: `${(day.confirmed / maximum) * 100}%`, minHeight: day.confirmed ? 3 : 0 }} />
                          <div className="w-2 rounded-t bg-amber-500" style={{ height: `${(day.edited / maximum) * 100}%`, minHeight: day.edited ? 3 : 0 }} />
                          <div className="w-2 rounded-t bg-zinc-400" style={{ height: `${(day.ignored / maximum) * 100}%`, minHeight: day.ignored ? 3 : 0 }} />
                        </div>
                        <span className="text-xs text-muted-foreground">{new Date(day.date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-emerald-500" />确认</span>
                  <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-amber-500" />修改</span>
                  <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-zinc-400" />忽略</span>
                </div>
              </CardContent>
            </Card>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle className="text-lg">字段高纠错榜</CardTitle><CardDescription>按站点和字段语义聚合，优先处理修改率高且反馈量足够的映射。</CardDescription></CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-sm">
                      <thead><tr className="border-b text-left text-muted-foreground"><th className="py-2 font-medium">站点</th><th className="py-2 font-medium">字段</th><th className="py-2 text-right font-medium">反馈</th><th className="py-2 text-right font-medium">修改率</th></tr></thead>
                      <tbody>
                        {data.fieldQuality.map((item) => (
                          <tr key={`${item.domain}-${item.semanticKey}`} className="border-b last:border-0">
                            <td className="py-2.5">{item.domain}</td>
                            <td className="py-2.5 font-mono text-xs">{item.semanticKey}</td>
                            <td className="py-2.5 text-right">{item.totalFeedback}</td>
                            <td className="py-2.5 text-right">{item.correctionRate}%</td>
                          </tr>
                        ))}
                        {data.fieldQuality.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">当前范围暂无字段反馈</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-lg">共享模板高纠错榜</CardTitle><CardDescription>仅显示已启用的平台共享模板，计数为历史累计。</CardDescription></CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead><tr className="border-b text-left text-muted-foreground"><th className="py-2 font-medium">模板</th><th className="py-2 font-medium">ATS</th><th className="py-2 text-right font-medium">使用</th><th className="py-2 text-right font-medium">纠错率</th></tr></thead>
                      <tbody>
                        {data.templateQuality.map((item) => (
                          <tr key={`${item.domainPattern}-${item.semanticKey}`} className="border-b last:border-0">
                            <td className="py-2.5"><div>{item.domainPattern}</div><div className="font-mono text-xs text-muted-foreground">{item.semanticKey}</div></td>
                            <td className="py-2.5">{item.atsType}</td>
                            <td className="py-2.5 text-right">{item.usageCount}</td>
                            <td className="py-2.5 text-right">{item.correctionRate}%</td>
                          </tr>
                        ))}
                        {data.templateQuality.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">当前没有可评估的共享模板</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        ) : (
          <div className="py-12 text-center text-muted-foreground">暂无网申预填质量数据</div>
        )}
      </div>
    </AdminPageShell>
  );
}

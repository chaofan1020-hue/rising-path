'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Coins, History, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { AuthGuard } from '@/components/auth-guard';
import { Header1 } from '@/components/header1';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';

type Price = { metric: string; display_name: string; unit_name: string; creditCost: number; maxUnitsPerRequest: number | null; notes: string | null };
type LedgerEntry = { id: number; entry_type: string; delta: number | string; balance_after: number | string; metric: string | null; reason: string | null; metadata?: Record<string, unknown> | null; created_at: string };
type CreditsData = { balance: number; lifetimeGranted: number; lifetimeSpent: number; prices: Price[]; ledger: LedgerEntry[] };
const number = (value: number | string | null | undefined) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 }).format(Number(value || 0));
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
const metricNames: Record<string, string> = { interview_turn: 'AI 模拟面试', asr_minutes: '面试语音识别', tts_minutes: '面试语音合成', ai_match: 'AI 选岗', resume_optimize: '简历优化', resume_score: '简历评分', resume_parse: '简历解析', application_profile: '求职档案', application_prefill: '网申预填', career_plan_refine: '求职规划' };
const entryNames: Record<string, string> = { grant: '内测发放', purchase: '购买积分', reserve: '语音使用中', refund: '差额退回', adjustment: '管理员调整' };

export default function CreditsPage() {
  const [data, setData] = useState<CreditsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true); setError('');
    void apiFetch('/api/credits', { cache: 'no-store' })
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok) throw new Error(json.error?.message || '读取积分失败');
        setData(json.data);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '读取积分失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  return <AuthGuard showAccountBar={false}><div className="min-h-screen bg-muted/20"><Header1 /><main className="mx-auto max-w-6xl px-4 pb-12 pt-24 sm:px-6"><Link href="/dashboard"><Button variant="ghost" size="sm" className="mb-5"><ArrowLeft className="mr-2 h-4 w-4" />返回驾驶舱</Button></Link><header className="flex flex-wrap items-end justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-primary"><Coins className="h-3.5 w-3.5" />AI 使用额度</div><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">我的积分</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">所有 AI 能力统一使用积分。面试回合和语音服务会消耗更多积分。</p></div><Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新</Button></header>{error && <div className="mt-5 rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>}{loading && !data ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div> : <><section className="mt-6 grid gap-4 sm:grid-cols-3"><Card className="border-primary/20 bg-primary/[0.04] shadow-sm"><CardContent className="p-5"><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">当前可用</p><p className="mt-2 text-3xl font-semibold tracking-tight">{number(data?.balance)} <span className="text-sm font-normal text-muted-foreground">分</span></p><p className="mt-2 text-xs text-muted-foreground">可直接用于 AI 功能</p></CardContent></Card><Card className="shadow-sm"><CardContent className="p-5"><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">累计发放</p><p className="mt-2 text-3xl font-semibold tracking-tight">{number(data?.lifetimeGranted)} <span className="text-sm font-normal text-muted-foreground">分</span></p><p className="mt-2 text-xs text-muted-foreground">包含内测赠送积分</p></CardContent></Card><Card className="shadow-sm"><CardContent className="p-5"><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">累计使用</p><p className="mt-2 text-3xl font-semibold tracking-tight">{number(data?.lifetimeSpent)} <span className="text-sm font-normal text-muted-foreground">分</span></p><p className="mt-2 text-xs text-muted-foreground">失败请求会自动退回</p></CardContent></Card></section><section className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"><Card className="shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4 text-primary" />最近流水</CardTitle><CardDescription>预扣、成功使用和失败退回都会记录在这里。</CardDescription></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="py-3 font-medium">时间</th><th className="py-3 font-medium">项目</th><th className="py-3 text-right font-medium">变动</th><th className="py-3 text-right font-medium">余额</th></tr></thead><tbody>{(data?.ledger || []).map((entry) => <tr key={entry.id} className="border-b last:border-0"><td className="py-3 text-xs text-muted-foreground">{date(entry.created_at)}</td><td><div>{entry.metric ? metricNames[entry.metric] || entry.metric : entryNames[entry.entry_type] || entry.entry_type}</div><div className="mt-0.5 text-xs text-muted-foreground">{entry.reason || entryNames[entry.entry_type] || entry.entry_type}</div></td><td className={`py-3 text-right font-medium ${Number(entry.delta) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{Number(entry.delta) >= 0 ? '+' : ''}{number(entry.delta)}</td><td className="py-3 text-right text-muted-foreground">{number(entry.balance_after)}</td></tr>)}{!data?.ledger?.length && <tr><td colSpan={4} className="py-12 text-center text-muted-foreground">暂无积分流水</td></tr>}</tbody></table></div></CardContent></Card><Card className="shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-primary" />功能价格</CardTitle><CardDescription>价格可能会根据内测成本调整。</CardDescription></CardHeader><CardContent className="space-y-3">{(data?.prices || []).map((price) => <div key={price.metric} className="flex items-center justify-between gap-3 border-b pb-3 text-sm last:border-0 last:pb-0"><div className="min-w-0"><p className="truncate font-medium">{price.display_name}</p><p className="mt-0.5 text-xs text-muted-foreground">每{price.unit_name}</p></div><Badge variant={price.metric === 'interview_turn' ? 'default' : 'secondary'}>{number(price.creditCost)} 分</Badge></div>)}{!data?.prices?.length && <p className="text-sm text-muted-foreground">暂无价格规则</p>}</CardContent></Card></section></>}</main></div></AuthGuard>;
}

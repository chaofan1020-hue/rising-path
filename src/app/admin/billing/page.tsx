'use client';

import { useCallback, useEffect, useState } from 'react';
import { Ban, CreditCard, Loader2, RefreshCw, RotateCcw, Save, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAdminPermissions } from '@/components/admin-shell';
import { ADMIN_PERMISSIONS } from '@/lib/admin-permission-constants';

type Order = { id: number; order_no: string; plan_code: string; status: string; provider: string; amount_minor: number | null; credits_granted: number; created_at: string; attempts: Array<{ channel: string; status: string; merchant_order_no: string }> };
type Summary = { total: number; byStatus: Record<string, number>; grossAmountMinor: number; paidAmountMinor: number };
type Plan = { plan_code: string; plan_type: string; name: string | Record<string, string>; currency: string; amount_minor: number; display_currency: string; display_amount_minor: number; credits: number; version: number; is_active: boolean };
type PlanDraft = { amount: string; displayAmount: string; credits: string };
const statusLabel: Record<string, string> = { pending: '待支付', created: '已创建', paid: '已支付', cancelled: '已取消', failed: '失败', expired: '已过期', refunded: '已退款', partially_refunded: '退款处理中' };
const statusClass = (status: string) => status === 'paid' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : status === 'refunded' ? 'border-zinc-200 bg-zinc-100 text-zinc-700' : status === 'failed' || status === 'cancelled' || status === 'expired' ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-700';
const money = (minor: number | null) => `¥${(Number(minor || 0) / 100).toFixed(2)}`;
const planName = (name: Plan['name'], code: string) => typeof name === 'string' ? name : name?.['zh-CN'] || name?.en || code;
const toMinor = (value: string) => {
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const minor = Math.round(Number(value) * 100);
  return minor <= 100_000_000 ? minor : null;
};

export default function AdminBillingPage() {
  const { loading: permissionLoading, hasPermission } = useAdminPermissions();
  const canRead = hasPermission(ADMIN_PERMISSIONS.billingRead);
  const canWrite = hasPermission(ADMIN_PERMISSIONS.billingWrite);
  const [orders, setOrders] = useState<Order[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planDrafts, setPlanDrafts] = useState<Record<string, PlanDraft>>({});
  const [summary, setSummary] = useState<Summary | null>(null);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<number | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const query = new URLSearchParams({ limit: '200' });
      if (status !== 'all') query.set('status', status);
      if (search.trim()) query.set('search', search.trim());
      const response = await fetch(`/api/admin/billing?${query.toString()}`, { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || '读取支付订单失败');
      setOrders(json.data?.orders || []); setSummary(json.data?.summary || null);
      const loadedPlans: Plan[] = json.data?.plans || [];
      setPlans(loadedPlans);
      setPlanDrafts(Object.fromEntries(loadedPlans.map((plan) => [plan.plan_code, { amount: (plan.amount_minor / 100).toFixed(2), displayAmount: (plan.display_amount_minor / 100).toFixed(2), credits: String(plan.credits) }])));
    } catch (reason) { setError(reason instanceof Error ? reason.message : '读取支付订单失败'); }
    finally { setLoading(false); }
  }, [search, status]);

  useEffect(() => { if (!permissionLoading && canRead) void load(); }, [canRead, load, permissionLoading]);

  const operate = async (orderId: number, action: 'cancel' | 'refund') => {
    setWorking(orderId); setError('');
    try {
      const response = await fetch('/api/admin/billing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, action }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || '订单操作失败');
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '订单操作失败'); }
    finally { setWorking(null); }
  };

  const updatePlan = async (plan: Plan) => {
    const draft = planDrafts[plan.plan_code];
    const amountMinor = toMinor(draft?.amount || '');
    const displayAmountMinor = toMinor(draft?.displayAmount || '');
    const credits = Number(draft?.credits);
    if (amountMinor === null || displayAmountMinor === null || !Number.isFinite(credits) || credits < 0 || !/^\d+(?:\.\d{1,4})?$/.test(draft?.credits || '')) {
      setError('套餐价格需为最多两位小数的非负金额，积分最多四位小数');
      return;
    }
    setWorking(-1); setError('');
    try {
      const response = await fetch('/api/admin/billing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update_plan', planCode: plan.plan_code, amountMinor, displayAmountMinor, credits, expectedVersion: plan.version }) });
      const json = await response.json();
      if (!response.ok || !json.data) throw new Error(json.error?.message || '保存套餐失败');
      const updated = json.data as Plan;
      setPlans((current) => current.map((item) => item.plan_code === updated.plan_code ? updated : item));
      setPlanDrafts((current) => ({ ...current, [updated.plan_code]: { amount: (updated.amount_minor / 100).toFixed(2), displayAmount: (updated.display_amount_minor / 100).toFixed(2), credits: String(updated.credits) } }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存套餐失败'); }
    finally { setWorking(null); }
  };

  if (permissionLoading) return <main className="flex min-h-80 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></main>;
  if (!canRead) return <main className="mx-auto max-w-6xl px-4 py-8"><div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">当前管理员角色无权查看支付订单</div></main>;
  return <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8"><header className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500"><CreditCard className="h-3.5 w-3.5" />支付运营</div><h1 className="text-2xl font-semibold tracking-tight">支付订单</h1><p className="mt-2 text-sm text-muted-foreground">查看订单状态、支付尝试和退款安全状态。</p></div><Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新</Button></header>
    {error && <div className="mb-5 rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>}
    <section className="mb-5 grid gap-3 sm:grid-cols-3"><Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">订单总数</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{summary?.total ?? 0}</CardContent></Card><Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">订单金额</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{money(summary?.grossAmountMinor || 0)}</CardContent></Card><Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">已支付金额</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{money(summary?.paidAmountMinor || 0)}</CardContent></Card></section>
    <div className="mb-4 flex flex-wrap gap-2"><div className="relative min-w-[240px] flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void load(); }} placeholder="搜索订单号或套餐" /></div><Select value={status} onValueChange={(value) => { setStatus(value); }}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem>{Object.entries(statusLabel).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Button variant="outline" onClick={() => void load()}>筛选</Button></div>
    {canWrite && <section className="mb-6"><div className="mb-3"><h2 className="text-base font-semibold">套餐价格与积分</h2><p className="mt-1 text-xs text-muted-foreground">人民币为支付宝实际扣款价，美元为产品站展示价。修改仅用于新订单。</p></div><Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead className="border-b bg-muted/30 text-left text-xs text-muted-foreground"><tr><th className="px-4 py-3">套餐</th><th className="px-4 py-3">人民币扣款价（元）</th><th className="px-4 py-3">美元展示价（美元）</th><th className="px-4 py-3">积分</th><th className="px-4 py-3">版本</th><th className="px-4 py-3 text-right">操作</th></tr></thead><tbody>{plans.map((plan) => <tr key={plan.plan_code} className="border-b last:border-0"><td className="px-4 py-3"><div className="font-medium">{planName(plan.name, plan.plan_code)}</div><div className="text-xs text-muted-foreground">{plan.plan_code}{!plan.is_active ? ' · 已下架' : ''}</div></td><td className="px-4 py-3"><Input aria-label={`${plan.plan_code} 人民币扣款价`} type="number" min="0" step="0.01" value={planDrafts[plan.plan_code]?.amount ?? ''} onChange={(event) => setPlanDrafts((current) => ({ ...current, [plan.plan_code]: { ...current[plan.plan_code], amount: event.target.value } }))} className="w-36" /></td><td className="px-4 py-3"><Input aria-label={`${plan.plan_code} 美元展示价`} type="number" min="0" step="0.01" value={planDrafts[plan.plan_code]?.displayAmount ?? ''} onChange={(event) => setPlanDrafts((current) => ({ ...current, [plan.plan_code]: { ...current[plan.plan_code], displayAmount: event.target.value } }))} className="w-36" /></td><td className="px-4 py-3"><Input aria-label={`${plan.plan_code} 积分`} type="number" min="0" step="0.0001" value={planDrafts[plan.plan_code]?.credits ?? ''} onChange={(event) => setPlanDrafts((current) => ({ ...current, [plan.plan_code]: { ...current[plan.plan_code], credits: event.target.value } }))} className="w-36" /></td><td className="px-4 py-3 text-xs text-muted-foreground">v{plan.version}</td><td className="px-4 py-3 text-right"><Button size="sm" onClick={() => void updatePlan(plan)} disabled={working !== null}><Save className="mr-1.5 h-4 w-4" />保存</Button></td></tr>)}</tbody></table>{!plans.length && !loading && <p className="px-4 py-8 text-center text-sm text-muted-foreground">暂无套餐</p>}</div></CardContent></Card></section>}
    <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead className="border-b bg-muted/30 text-left text-xs text-muted-foreground"><tr><th className="px-5 py-3">订单</th><th className="px-5 py-3">套餐</th><th className="px-5 py-3">渠道</th><th className="px-5 py-3">金额</th><th className="px-5 py-3">积分</th><th className="px-5 py-3">状态</th><th className="px-5 py-3">时间</th><th className="px-5 py-3 text-right">操作</th></tr></thead><tbody>{orders.map((order) => { const busy = working === order.id; const attempt = order.attempts[0]; return <tr key={order.id} className="border-b last:border-0"><td className="px-5 py-3 font-mono text-xs">{order.order_no}</td><td className="px-5 py-3">{order.plan_code}</td><td className="px-5 py-3 text-xs text-muted-foreground">{attempt?.channel || order.provider}</td><td className="px-5 py-3">{money(order.amount_minor)}</td><td className="px-5 py-3">{Number(order.credits_granted || 0)}</td><td className="px-5 py-3"><Badge variant="outline" className={statusClass(order.status)}>{statusLabel[order.status] || order.status}</Badge></td><td className="px-5 py-3 text-xs text-muted-foreground">{new Date(order.created_at).toLocaleString('zh-CN')}</td><td className="px-5 py-3 text-right">{canWrite && ['pending', 'created'].includes(order.status) && <Button variant="ghost" size="sm" onClick={() => void operate(order.id, 'cancel')} disabled={busy}><Ban className="mr-1.5 h-3.5 w-3.5" />取消</Button>}{canWrite && ['paid', 'partially_refunded'].includes(order.status) && <Button variant="outline" size="sm" onClick={() => void operate(order.id, 'refund')} disabled={busy}>{busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}退款</Button>}</td></tr>; })}{!loading && !orders.length && <tr><td colSpan={8} className="px-5 py-12 text-center text-muted-foreground">暂无订单</td></tr>}{loading && <tr><td colSpan={8} className="px-5 py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}</tbody></table></div></CardContent></Card>
  </main>;
}

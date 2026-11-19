'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Clock3, ExternalLink, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Checkout = { order: { id: number; order_no: string; plan_code: string; status: string; amountMinor?: number; currency: string; creditsGranted?: number; created_at: string }; payment: { channel: string; qrImage?: string | null; redirectUrl?: string | null; expiresAt?: string | null } | null; returnUrl?: string };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const body = await response.json() as { data?: T; error?: { message?: string } };
  if (!response.ok || !body.data) throw new Error(body.error?.message || '支付请求失败');
  return body.data;
}

function money(minor: number | undefined, currency: string) { return new Intl.NumberFormat('zh-CN', { style: 'currency', currency, minimumFractionDigits: 2 }).format(Number(minor || 0) / 100); }

export function PaymentCheckout() {
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    const ticket = new URLSearchParams(window.location.search).get('ticket');
    const initialRequest = ticket
      ? json<Checkout>('/api/payments/handoff/redeem', { method: 'POST', body: JSON.stringify({ ticket }) })
      : json<Checkout>('/api/payments/session/status');
    void initialRequest
      .then((value) => {
        setCheckout(value);
        setPaid(value.order.status === 'paid');
        if (ticket) window.history.replaceState({}, '', '/pay/checkout');
        if (value.order.status === 'cancelled' || value.order.status === 'expired') window.location.replace(value.returnUrl || 'https://liorvix.com/account/billing');
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '支付链接无效'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!checkout || !['pending', 'created'].includes(checkout.order.status)) return;
    const timer = window.setInterval(() => {
      void json<Checkout>('/api/payments/session/status').then((value) => {
        setCheckout(value);
        setPaid(value.order.status === 'paid');
        if (value.order.status === 'cancelled' || value.order.status === 'expired') window.location.replace(value.returnUrl || 'https://liorvix.com/account/billing');
      }).catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [checkout]);

  /**
   * Manual confirmation for the case where the buyer already paid in Alipay but
   * the server-side query has not seen it yet (slow channel state, lost
   * callback). It only re-reads the server state, never marks the order paid.
   */
  const recheck = async () => {
    setChecking(true); setError('');
    let latest: Checkout | null = null;
    try {
      // Alipay can lag a few seconds behind the buyer's screen, so re-read the
      // server state up to three times before telling the buyer it is pending.
      // This only re-reads; it never marks the order paid on the client.
      for (let index = 0; index < 3; index += 1) {
        // eslint-disable-next-line no-await-in-loop
        latest = await json<Checkout>('/api/payments/session/status');
        setCheckout(latest);
        setPaid(latest.order.status === 'paid');
        if (latest.order.status !== 'pending' && latest.order.status !== 'created') break;
        if (index < 2) await new Promise((resolve) => { window.setTimeout(resolve, 2500); });
      }
      if (latest && (latest.order.status === 'pending' || latest.order.status === 'created')) {
        setError('支付渠道还没有确认到这笔交易。如果你确实已付款，请保留支付宝账单截图并联系 support@liorvix.com，我们会按订单号核对补单。');
      }
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '暂时无法确认支付状态');
    } finally {
      setChecking(false);
    }
  };

  const cancel = async () => {
    setCancelling(true); setError('');
    try {
      const value = await json<Checkout>('/api/payments/session/cancel', { method: 'POST' });
      setCheckout(value);
      if (value.order.status === 'cancelled' || value.order.status === 'expired') window.location.replace(value.returnUrl || 'https://liorvix.com/account/billing');
    }
    catch (reason: unknown) { setError(reason instanceof Error ? reason.message : '无法取消订单'); }
    finally { setCancelling(false); }
  };

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-zinc-50 text-zinc-700"><Loader2 className="mr-2 h-5 w-5 animate-spin" />正在准备安全支付页面</main>;
  return <main className="min-h-screen bg-zinc-50 px-4 py-10 text-zinc-900 sm:py-16">
    <div className="mx-auto max-w-xl">
      <header className="mb-8 flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Liorvix</p><h1 className="mt-2 text-2xl font-semibold">安全结算</h1></div><div className="flex items-center gap-1.5 text-xs text-zinc-500"><ShieldCheck className="h-4 w-4" />支付信息加密处理</div></header>
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {checkout && <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 pb-6"><div><p className="text-sm text-zinc-500">订单号</p><p className="mt-1 font-mono text-sm">{checkout.order.order_no}</p><p className="mt-5 text-sm text-zinc-500">本次购买</p><p className="mt-1 text-lg font-medium">{checkout.order.creditsGranted || 0} 积分</p></div><p className="text-2xl font-semibold">{money(checkout.order.amountMinor, checkout.order.currency)}</p></div>
        {paid ? <div className="py-12 text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" /><h2 className="mt-4 text-xl font-semibold">支付已完成</h2><p className="mt-2 text-sm text-zinc-500">积分已记入你的 Liorvix 账户，可以返回主站继续使用。</p></div> : checkout.order.status === 'cancelled' || checkout.order.status === 'expired' ? <div className="py-12 text-center"><XCircle className="mx-auto h-12 w-12 text-zinc-400" /><h2 className="mt-4 text-xl font-semibold">订单已关闭</h2><p className="mt-2 text-sm text-zinc-500">如果你已经完成付款，请点击下方按钮重新确认，或联系 support@liorvix.com。</p><Button className="mt-5" variant="outline" onClick={() => void recheck()} disabled={checking}>{checking ? '正在向支付宝确认...' : '我已付款，重新确认'}</Button></div> : <div className="pt-6 text-center"><p className="flex items-center justify-center gap-2 text-sm text-zinc-600"><Clock3 className="h-4 w-4" />等待支付确认</p>{checkout.payment?.redirectUrl ? <Button className="mt-6" asChild><a href={checkout.payment.redirectUrl} target="_blank" rel="noreferrer">打开支付宝电脑支付页面 <ExternalLink className="ml-2 h-4 w-4" /></a></Button> : null}<div className="mt-4 flex flex-wrap items-center justify-center gap-2"><Button variant="outline" onClick={() => void recheck()} disabled={checking}>{checking ? '正在向支付宝确认...' : '我已完成支付'}</Button><Button variant="ghost" onClick={() => void cancel()} disabled={cancelling}>{cancelling ? '取消中...' : '取消订单'}</Button></div><p className="mt-3 text-xs text-zinc-500">支付成功后本页会自动更新，无需关闭。</p></div>}
      </section>}
      <footer className="mt-6 text-center text-xs leading-5 text-zinc-500">Liorvix 提供求职工具与 AI 服务。订单、退款和客服信息以主站公示规则为准。</footer>
    </div>
  </main>;
}

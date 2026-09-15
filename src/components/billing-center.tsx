'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Clipboard, Clock3, Coins, ExternalLink, Loader2, QrCode, RefreshCw, ShieldCheck, Smartphone, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch } from '@/lib/api-client';
import { defaultChannelForSurface, isChannelAllowedOnSurface, readBrowserBillingSurface, type BillingSurface } from '@/lib/billing-device';
import { formatCnyFen, formatUsdCents } from '@/lib/billing-fx';
import { useLanguage, type Locale } from '@/lib/language-context';
import { BILLING_COPY } from '@/lib/billing-copy';
import type { BillingPaymentChannel } from '@/lib/billing-provider';

type LocalizedValue = string | Record<string, string> | null;
type Plan = {
  plan_code: string;
  plan_type: string;
  name: LocalizedValue;
  description: LocalizedValue;
  currency: string;
  amountMinor: number;
  displayAmountMinor?: number;
  displayCurrency?: string;
  chargeCurrency?: string;
  credits: number;
  durationDays: number | null;
  display_order?: number;
  metadata?: Record<string, unknown> | null;
};
type Payment = {
  provider: string;
  channel: string;
  merchantOrderNo: string;
  qrCode?: string | null;
  qrImage?: string | null;
  redirectUrl?: string | null;
  status: string;
  expiresAt?: string | null;
  enabled?: boolean;
};
type Order = {
  id: number;
  order_no: string;
  plan_code: string;
  status: string;
  provider?: string;
  amount_minor?: number | null;
  amountMinor?: number | null;
  displayAmountMinor?: number | null;
  displayCurrency?: string;
  currency: string;
  credits_granted?: number;
  creditsGranted?: number;
  paid_at?: string | null;
  created_at: string;
  updated_at?: string;
};
type Checkout = { order: Order; payment: Payment | null };
type CheckoutChannel = BillingPaymentChannel;

function localized(value: LocalizedValue, locale: Locale, fallback: string): string {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  return value[locale] || value.en || value['zh-CN'] || fallback;
}

function formatNumber(value: number | string | null | undefined, locale: Locale) {
  return new Intl.NumberFormat(locale === 'en' ? 'en-US' : locale === 'zh-TW' ? 'zh-TW' : 'zh-CN', { maximumFractionDigits: 2 }).format(Number(value || 0));
}

function formatDate(value: string | undefined, locale: Locale) {
  if (!value) return '-';
  return new Date(value).toLocaleString(locale === 'en' ? 'en-US' : locale === 'zh-TW' ? 'zh-TW' : 'zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

function getCopy(locale: Locale) {
  return BILLING_COPY[locale];
}

function errorMessage(code: string | undefined, copy: ReturnType<typeof getCopy>) {
  if (code === 'BILLING_DISABLED' || code === 'BILLING_PROVIDER_DISABLED') return copy.paymentDisabled;
  if (code === 'BILLING_PLANS_QUERY_FAILED') return copy.plansLoadFailed;
  if (code === 'BILLING_ORDER_CREATE_FAILED') return copy.orderCreateFailed;
  if (code === 'BILLING_PLAN_NOT_PAYABLE') return copy.subscriptionComingSoon;
  if (code === 'BILLING_ORDER_ALREADY_PAID') return copy.paymentPaid;
  if (code === 'BILLING_ORDER_QUERY_FAILED' || code === 'BILLING_ORDER_NOT_FOUND') return copy.statusLoadFailed;
  return copy.loadFailed;
}

function statusLabel(status: string, copy: ReturnType<typeof getCopy>) {
  if (status === 'paid') return copy.paymentPaid;
  if (status === 'cancelled') return copy.paymentCancelled;
  if (status === 'failed') return copy.paymentFailed;
  if (status === 'expired') return copy.paymentExpired;
  return copy.paymentPending;
}

function statusClass(status: string) {
  if (status === 'paid') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300';
  if (status === 'failed' || status === 'cancelled' || status === 'expired') return 'border-destructive/25 bg-destructive/5 text-destructive';
  return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300';
}

function usdPrice(amountMinor: number | null | undefined, locale: Locale, fallbackCnyFen = 0, copyFree: string) {
  if (typeof amountMinor === 'number' && amountMinor <= 0 && fallbackCnyFen <= 0) return copyFree;
  if (typeof amountMinor === 'number' && amountMinor >= 0) return formatUsdCents(amountMinor, locale);
  if (fallbackCnyFen > 0) return formatCnyFen(fallbackCnyFen, locale);
  return copyFree;
}

export function BillingCenter() {
  const { locale } = useLanguage();
  const copy = getCopy(locale);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [selectedPlanCode, setSelectedPlanCode] = useState<string | null>(null);
  const [surface, setSurface] = useState<BillingSurface>('desktop');
  const [channel, setChannel] = useState<CheckoutChannel>('wechat_native');
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [loading, setLoading] = useState(true);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [billingUnavailable, setBillingUnavailable] = useState(false);
  const [channelAvailability, setChannelAvailability] = useState({ wechat: true, alipay: true });
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const openedRedirect = useRef<number | null>(null);
  const checkoutOrderId = checkout?.order?.id;

  const loadPlans = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiFetch('/api/billing/plans', { cache: 'no-store' });
      const json = await response.json() as { data?: Plan[]; billing?: { enabled?: boolean; wechatEnabled?: boolean; alipayEnabled?: boolean }; error?: { code?: string } };
      if (!response.ok || !json.data) throw new Error(errorMessage(json.error?.code, copy));
      setPlans(json.data);
      if (json.billing) {
        const availability = { wechat: json.billing.enabled === true && json.billing.wechatEnabled === true, alipay: json.billing.enabled === true && json.billing.alipayEnabled === true };
        setBillingUnavailable(!availability.wechat && !availability.alipay);
        setChannelAvailability(availability);
      }
      setSelectedPlanCode((current) => current && json.data?.some((plan) => plan.plan_code === current && plan.plan_type !== 'subscription' && plan.amountMinor > 0)
        ? current
        : json.data?.find((plan) => plan.amountMinor > 0 && plan.plan_type !== 'subscription')?.plan_code || json.data?.[0]?.plan_code || null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : copy.plansLoadFailed);
    } finally {
      setLoading(false);
    }
  }, [copy]);

  const loadOrders = useCallback(async (resumePending = false) => {
    setOrdersLoading(true);
    try {
      const response = await apiFetch('/api/billing/orders', { cache: 'no-store' });
      const json = await response.json() as { data?: Order[]; error?: { code?: string } };
      if (!response.ok || !json.data) throw new Error(errorMessage(json.error?.code, copy));
      setOrders(json.data);
      if (resumePending) {
        const pending = json.data.find((item) => item.status === 'pending' || item.status === 'created');
        if (pending) {
          const statusResponse = await apiFetch(`/api/billing/orders/${pending.id}/status`, { cache: 'no-store' });
          const statusJson = await statusResponse.json() as { data?: Checkout };
          if (statusResponse.ok && statusJson.data) setCheckout(statusJson.data);
        }
      }
    } catch (reason: unknown) {
      if (!String(reason instanceof Error ? reason.message : '').includes('401')) setError(reason instanceof Error ? reason.message : copy.loadFailed);
    } finally {
      setOrdersLoading(false);
    }
  }, [copy]);

  const loadBalance = useCallback(async () => {
    try {
      const response = await apiFetch('/api/credits', { cache: 'no-store' });
      const json = await response.json() as { data?: { balance?: number } };
      if (response.ok && json.data) setBalance(Number(json.data.balance || 0));
    } catch { /* Balance is supplementary to checkout. */ }
  }, []);

  useEffect(() => {
    setSurface(readBrowserBillingSurface());
  }, []);

  useEffect(() => {
    setChannel((current) => isChannelAllowedOnSurface(current, surface) ? current : defaultChannelForSurface(surface, channelAvailability));
  }, [channelAvailability, surface]);

  useEffect(() => { void loadPlans(); void loadOrders(true); void loadBalance(); }, [loadBalance, loadOrders, loadPlans]);

  const selectedPlan = useMemo(() => plans.find((plan) => plan.plan_code === selectedPlanCode) || null, [plans, selectedPlanCode]);

  const createOrder = async () => {
    if (!selectedPlan || selectedPlan.amountMinor <= 0 || billingUnavailable) return;
    const checkoutChannel = isChannelAllowedOnSurface(channel, surface) ? channel : defaultChannelForSurface(surface, channelAvailability);
    if ((checkoutChannel.startsWith('wechat_') && !channelAvailability.wechat) || (checkoutChannel.startsWith('alipay_') && !channelAvailability.alipay)) {
      setBillingUnavailable(true);
      return;
    }
    setCreating(true); setError(''); setBillingUnavailable(false); setCopied(false);
    try {
      const response = await apiFetch('/api/billing/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planCode: selectedPlan.plan_code, channel: checkoutChannel }) });
      const json = await response.json() as { data?: Checkout; error?: { code?: string } };
      if (!response.ok || !json.data) {
        if (json.error?.code === 'BILLING_DISABLED' || json.error?.code === 'BILLING_PROVIDER_DISABLED') setBillingUnavailable(true);
        throw new Error(errorMessage(json.error?.code, copy));
      }
      setCheckout(json.data);
      void loadOrders();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : copy.orderCreateFailed);
    } finally {
      setCreating(false);
    }
  };

  const refreshCheckout = useCallback(async () => {
    if (!checkoutOrderId) return;
    setRefreshing(true);
    try {
      const response = await apiFetch(`/api/billing/orders/${checkoutOrderId}/status`, { cache: 'no-store' });
      const json = await response.json() as { data?: Checkout; error?: { code?: string } };
      if (!response.ok || !json.data) throw new Error(errorMessage(json.error?.code, copy));
      setCheckout(json.data);
      if (json.data.order.status === 'paid') { await loadBalance(); await loadOrders(); }
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : copy.statusLoadFailed);
    } finally {
      setRefreshing(false);
    }
  }, [checkoutOrderId, copy, loadBalance, loadOrders]);

  useEffect(() => {
    if (!checkout || !['pending', 'created'].includes(checkout.order.status)) return;
    const timer = window.setInterval(() => { void refreshCheckout(); }, 4000);
    return () => window.clearInterval(timer);
  }, [checkout, refreshCheckout]);

  useEffect(() => {
    const redirectUrl = checkout?.payment?.redirectUrl;
    const orderId = checkout?.order?.id;
    if (!redirectUrl || !orderId || !checkout?.payment?.channel) return;
    if (!['pending', 'created'].includes(checkout.order.status)) return;
    if (openedRedirect.current === orderId) return;
    if (checkout.payment.channel !== 'wechat_h5' && checkout.payment.channel !== 'alipay_wap') return;
    openedRedirect.current = orderId;
    window.open(redirectUrl, '_blank', 'noopener,noreferrer');
  }, [checkout]);

  const cancelCheckout = async () => {
    if (!checkoutOrderId) { setCheckout(null); return; }
    setCancelling(true); setError('');
    try {
      const response = await apiFetch(`/api/billing/orders/${checkoutOrderId}/cancel`, { method: 'POST' });
      const json = await response.json() as { data?: Checkout; error?: { code?: string } };
      if (json.data) setCheckout(json.data);
      else setCheckout(null);
      if (json.data?.order.status === 'paid') { await loadBalance(); }
      await loadOrders();
      if (!json.data || json.data.order.status === 'cancelled' || json.data.order.status === 'expired') setCheckout(json.data || null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : copy.statusLoadFailed);
    } finally {
      setCancelling(false);
    }
  };

  const copyPaymentCode = async () => {
    const value = checkout?.payment?.qrCode;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { setError(copy.loadFailed); }
  };

  const catalogPrice = (plan: Plan) => usdPrice(plan.displayAmountMinor, locale, plan.amountMinor, copy.free);
  const orderPrice = (order: Order) => usdPrice(order.displayAmountMinor, locale, order.amountMinor ?? order.amount_minor ?? 0, copy.free);
  const visibleChannels = useMemo((): Array<[CheckoutChannel, string, 'wechat' | 'alipay']> => (
    surface === 'mobile'
      ? [['wechat_h5', copy.wechatH5, 'wechat'], ['alipay_wap', copy.alipayWap, 'alipay']]
      : [['wechat_native', copy.wechat, 'wechat'], ['alipay_qr', copy.alipay, 'alipay']]
  ), [copy, surface]);
  const hasActiveCheckout = Boolean(checkout && ['pending', 'created'].includes(checkout.order.status));

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-primary">
            <Coins className="h-3.5 w-3.5" />{copy.eyebrow}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{copy.title}</h1>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
          <Coins className="h-4 w-4 text-amber-600" />
          <span className="text-muted-foreground">{copy.balance}</span>
          <strong>{balance === null ? '—' : formatNumber(balance, locale)}</strong>
        </div>
      </header>

      {error && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <span>{error}</span>
          <button type="button" className="text-xs underline" onClick={() => setError('')}>×</button>
        </div>
      )}
      {billingUnavailable && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">{copy.paymentDisabled}</p>
            <p className="mt-1 text-xs opacity-80">{copy.paymentDisabledDescription}</p>
          </div>
        </div>
      )}

      <section aria-label={copy.title} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {loading ? Array.from({ length: 6 }, (_, index) => (
          <Card key={index} className="min-h-[220px]">
            <CardHeader><Skeleton className="h-5 w-28" /><Skeleton className="h-4 w-full" /></CardHeader>
            <CardContent className="space-y-4"><Skeleton className="h-10 w-32" /><Skeleton className="h-4 w-24" /><Skeleton className="h-10 w-full" /></CardContent>
          </Card>
        )) : plans.map((plan) => {
          const selected = selectedPlanCode === plan.plan_code;
          const recommended = plan.metadata?.recommended === true;
          return (
            <Card key={plan.plan_code} className={`relative transition-colors ${selected ? 'border-primary ring-1 ring-primary' : ''}`}>
              {recommended && <Badge className="absolute right-4 top-4 bg-primary/10 text-primary hover:bg-primary/10">{copy.recommended}</Badge>}
              <CardHeader>
                <CardTitle className="pr-20 text-lg">{localized(plan.name, locale, plan.plan_code)}</CardTitle>
                <CardDescription className="min-h-10">{localized(plan.description, locale, '')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-semibold tracking-tight">{catalogPrice(plan)}</span>
                  {plan.plan_type === 'subscription' ? <span className="text-sm text-muted-foreground">{copy.perMonth}</span> : null}
                </div>
                <p className="mt-3 flex items-center gap-1.5 text-sm font-medium">
                  <Coins className="h-4 w-4 text-amber-600" />{formatNumber(plan.credits, locale)} {copy.credits}
                </p>
              </CardContent>
              <CardFooter>
                <Button type="button" variant={selected ? 'default' : 'outline'} className="w-full" onClick={() => setSelectedPlanCode(plan.plan_code)} disabled={plan.amountMinor <= 0 || plan.plan_type === 'subscription' || hasActiveCheckout}>
                  {plan.plan_type === 'subscription' ? copy.subscriptionComingSoon : selected ? <><Check className="mr-2 h-4 w-4" />{copy.choosing}</> : copy.choosePlan}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </section>

      {selectedPlan && selectedPlan.amountMinor > 0 && selectedPlan.plan_type !== 'subscription' && !hasActiveCheckout && (
        <Card className="border-primary/20 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">{copy.paymentTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              {visibleChannels.map(([value, label, provider]) => {
                const available = provider === 'wechat' ? channelAvailability.wechat : channelAvailability.alipay;
                return (
                  <button
                    key={value}
                    type="button"
                    disabled={!available || billingUnavailable}
                    className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${channel === value ? 'border-primary bg-primary/[0.04]' : 'hover:bg-muted/50'}`}
                    onClick={() => setChannel(value)}
                  >
                    <span className={`flex h-9 w-9 items-center justify-center rounded-full ${provider === 'wechat' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}`}>
                      {surface === 'mobile' ? <Smartphone className="h-4 w-4" /> : <QrCode className="h-4 w-4" />}
                    </span>
                    <span className="block text-sm font-medium">{label}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 px-4 py-3">
              <div>
                <p className="text-xs text-muted-foreground">{localized(selectedPlan.name, locale, selectedPlan.plan_code)}</p>
                <p className="mt-1 text-lg font-semibold">{catalogPrice(selectedPlan)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{formatNumber(selectedPlan.credits, locale)} {copy.credits}</p>
              </div>
              <Button type="button" onClick={() => void createOrder()} disabled={creating || billingUnavailable || (!channelAvailability.wechat && !channelAvailability.alipay)}>
                {creating ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{copy.creatingOrder}</> : copy.createOrder}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {checkout && (
        <Card className="border-primary/20 shadow-sm">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  {checkout.order.status === 'paid'
                    ? <Check className="h-4 w-4 text-emerald-600" />
                    : checkout.order.status === 'failed' || checkout.order.status === 'cancelled' || checkout.order.status === 'expired'
                      ? <XCircle className="h-4 w-4 text-destructive" />
                      : <Clock3 className="h-4 w-4 text-amber-600" />}
                  {statusLabel(checkout.order.status, copy)}
                </CardTitle>
                <CardDescription className="mt-2">
                  {checkout.order.status === 'paid'
                    ? copy.paymentPaidDescription
                    : checkout.order.status === 'pending' || checkout.order.status === 'created'
                      ? copy.paymentPendingDescription
                      : statusLabel(checkout.order.status, copy)}
                </CardDescription>
              </div>
              <Badge variant="outline" className={statusClass(checkout.order.status)}>{statusLabel(checkout.order.status, copy)}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">{copy.orderAmount}</p>
                <p className="mt-1 font-medium">{orderPrice(checkout.order)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{copy.orderCredits}</p>
                <p className="mt-1 font-medium">{formatNumber(checkout.order.creditsGranted ?? checkout.order.credits_granted, locale)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{copy.orderNumber}</p>
                <p className="mt-1 break-all font-mono text-xs">{checkout.order.order_no}</p>
              </div>
            </div>
            {checkout.payment && checkout.order.status !== 'paid' && (checkout.payment.qrImage || checkout.payment.qrCode || checkout.payment.redirectUrl) && (
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-sm font-medium">{checkout.payment.qrImage || checkout.payment.qrCode ? copy.scanQr : copy.paymentPending}</p>
                {checkout.payment.qrImage && (
                  <>
                    {/* Payment QR is an inline SVG data URL and cannot go through next/image. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={checkout.payment.qrImage} alt={copy.scanQr} className="mx-auto mt-3 h-52 w-52 rounded-md bg-white p-2" />
                  </>
                )}
                {!checkout.payment.qrImage && checkout.payment.qrCode && (
                  <code className="mt-2 block max-h-20 overflow-auto break-all rounded bg-background px-3 py-2 text-xs text-muted-foreground">{checkout.payment.qrCode}</code>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {checkout.payment.qrCode && (
                    <Button type="button" size="sm" variant="outline" onClick={() => void copyPaymentCode()}>
                      <Clipboard className="mr-2 h-3.5 w-3.5" />{copied ? copy.copied : copy.copyCode}
                    </Button>
                  )}
                  {checkout.payment.redirectUrl && (
                    <Button type="button" size="sm" variant="outline" onClick={() => window.open(checkout.payment?.redirectUrl || '', '_blank', 'noopener,noreferrer')}>
                      <ExternalLink className="mr-2 h-3.5 w-3.5" />{copy.openPayment}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2 border-t">
            <Button type="button" variant="outline" size="sm" onClick={() => void refreshCheckout()} disabled={refreshing || checkout.order.status === 'paid'}>
              <RefreshCw className={`mr-2 h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />{refreshing ? copy.refreshing : copy.refreshStatus}
            </Button>
            {hasActiveCheckout && (
              <Button type="button" variant="ghost" size="sm" onClick={() => void cancelCheckout()} disabled={cancelling}>
                {cancelling ? copy.cancelling : copy.cancelPayment}
              </Button>
            )}
            {hasActiveCheckout && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setCheckout(null)}>{copy.closePayment}</Button>
            )}
            {checkout.order.status === 'paid' && (
              <Button asChild type="button" size="sm"><Link href="/account/credits">{copy.viewCredits}</Link></Button>
            )}
          </CardFooter>
        </Card>
      )}

      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-semibold">{copy.orderHistory}</h2>
          <Button type="button" variant="ghost" size="sm" onClick={() => void loadOrders()} disabled={ordersLoading}>
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${ordersLoading ? 'animate-spin' : ''}`} />{copy.refreshStatus}
          </Button>
        </div>
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="border-b bg-muted/30 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-6 py-3 font-medium">{copy.orderNumber}</th>
                    <th className="px-6 py-3 font-medium">{copy.orderAmount}</th>
                    <th className="px-6 py-3 font-medium">{copy.orderCredits}</th>
                    <th className="px-6 py-3 font-medium">{copy.orderStatus}</th>
                    <th className="px-6 py-3 font-medium">{copy.orderDate}</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id} className="border-b last:border-0">
                      <td className="px-6 py-3 font-mono text-xs">{order.order_no}</td>
                      <td className="px-6 py-3">{orderPrice(order)}</td>
                      <td className="px-6 py-3">{formatNumber(order.creditsGranted ?? order.credits_granted, locale)}</td>
                      <td className="px-6 py-3"><Badge variant="outline" className={statusClass(order.status)}>{statusLabel(order.status, copy)}</Badge></td>
                      <td className="px-6 py-3 text-xs text-muted-foreground">{formatDate(order.created_at, locale)}</td>
                    </tr>
                  ))}
                  {!ordersLoading && !orders.length && (
                    <tr><td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">{copy.emptyOrders}</td></tr>
                  )}
                  {ordersLoading && (
                    <tr><td colSpan={5} className="px-6 py-8"><Skeleton className="h-5 w-full" /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

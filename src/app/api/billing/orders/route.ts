import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { getBillingConfig, getBillingReadiness } from '@/lib/billing-config';
import { BILLING_DISPLAY_CURRENCY, orderDisplayUsdCents, planCatalogUsdCents } from '@/lib/billing-fx';
import { getBillingProvider, type BillingPaymentChannel, type BillingProviderName } from '@/lib/billing-provider';
import { BillingProviderDisabledError } from '@/lib/billing-errors';
import { cancelOpenOrder, findOpenOrder, getCheckoutSnapshot } from '@/lib/billing-order-service';
import { paymentExpiryDate } from '@/lib/billing-status';
import { getSupabaseClient } from '@/storage/database/supabase-client';

const CHANNELS = new Set<BillingPaymentChannel>(['wechat_native', 'wechat_h5', 'alipay_qr', 'alipay_wap']);

function orderNo(): string {
  return `LV${Date.now().toString(36).toUpperCase()}${randomBytes(5).toString('hex').toUpperCase()}`;
}

function providerFor(channel: BillingPaymentChannel): BillingProviderName {
  return channel.startsWith('wechat_') ? 'wechat' : 'alipay';
}

function localizedPlanName(name: unknown): string {
  if (!name || typeof name !== 'object') return '';
  const values = name as Record<string, string>;
  return values['zh-CN'] || values.en || values['zh-TW'] || '';
}

export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorizedResponse();
  const { data, error } = await getSupabaseClient()
    .from('billing_orders')
    .select('id,order_no,plan_code,status,provider,amount,amount_minor,currency,credits_granted,metadata,paid_at,refunded_at,created_at,updated_at')
    .eq('user_id', auth.user.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ data: null, error: { code: 'BILLING_ORDERS_QUERY_FAILED', message: '读取订单失败' } }, { status: 500 });
  return NextResponse.json({
    data: (data || []).map((item) => {
      const amountMinor = item.amount_minor === null ? null : Number(item.amount_minor);
      const metadata = (item.metadata && typeof item.metadata === 'object') ? item.metadata as Record<string, unknown> : {};
      return {
        ...item,
        amountMinor,
        creditsGranted: Number(item.credits_granted || 0),
        displayCurrency: typeof metadata.display_currency === 'string' ? metadata.display_currency : BILLING_DISPLAY_CURRENCY,
        displayAmountMinor: orderDisplayUsdCents(metadata, amountMinor || 0),
      };
    }),
    error: null,
  });
}

export async function POST(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorizedResponse();
  const config = getBillingConfig();
  if (!config.enabled) return NextResponse.json({ data: null, error: { code: 'BILLING_DISABLED', message: '支付功能尚未开放' } }, { status: 503 });

  try {
    const body = await request.json() as Record<string, unknown>;
    const planCode = typeof body.planCode === 'string' ? body.planCode.trim() : '';
    const channel = typeof body.channel === 'string' ? body.channel as BillingPaymentChannel : null;
    if (body.amount != null || body.amountMinor != null || body.credits != null || body.price != null || body.displayAmountMinor != null) {
      return NextResponse.json({ data: null, error: { code: 'AMOUNT_NOT_CLIENT_SETTABLE', message: '支付金额由套餐决定，不能由页面提交' } }, { status: 400 });
    }
    if (!/^[a-z0-9_\-]{2,80}$/i.test(planCode) || !channel || !CHANNELS.has(channel)) {
      return NextResponse.json({ data: null, error: { code: 'INVALID_BILLING_ORDER', message: '套餐或支付方式无效' } }, { status: 400 });
    }
    const providerName = providerFor(channel);
    const readiness = getBillingReadiness();
    const providerReadiness = providerName === 'wechat' ? readiness.wechat : readiness.alipay;
    if (!providerReadiness.enabled || !providerReadiness.configured) {
      return NextResponse.json({ data: null, error: { code: 'BILLING_PROVIDER_DISABLED', message: '支付渠道尚未配置完成' } }, { status: 503 });
    }
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip')?.trim() || '';
    if (channel === 'wechat_h5' && !clientIp) {
      return NextResponse.json({ data: null, error: { code: 'CLIENT_IP_REQUIRED', message: '微信 H5 支付需要可识别的客户端 IP' } }, { status: 400 });
    }

    const currency = config.defaultCurrency;
    const client = getSupabaseClient();
    const { data: plan, error: planError } = await client
      .from('billing_plans')
      .select('id,plan_code,plan_type,name,currency,amount_minor,display_currency,display_amount_minor,credits,version,is_active')
      .eq('plan_code', planCode)
      .eq('currency', currency)
      .eq('is_active', true)
      .maybeSingle();
    if (planError) throw new Error(planError.message);
    if (!plan) return NextResponse.json({ data: null, error: { code: 'BILLING_PLAN_NOT_FOUND', message: '套餐不存在或已下架' } }, { status: 404 });
    if (plan.plan_type === 'subscription') {
      return NextResponse.json({ data: null, error: { code: 'BILLING_PLAN_NOT_PAYABLE', message: '订阅套餐尚未开放自动续费' } }, { status: 409 });
    }
    const amountMinor = Number(plan.amount_minor);
    const displayAmountMinor = planCatalogUsdCents(plan);
    const credits = Number(plan.credits);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !Number.isFinite(credits) || credits <= 0) {
      return NextResponse.json({ data: null, error: { code: 'BILLING_PLAN_NOT_PAYABLE', message: '当前套餐暂不可购买' } }, { status: 409 });
    }

    const openOrder = await findOpenOrder(auth.user.id);
    if (openOrder) {
      const existing = await getCheckoutSnapshot(openOrder.id, auth.user.id);
      const samePlan = openOrder.plan_code === planCode;
      const sameChannel = existing?.payment?.channel === channel;
      const notExpired = !existing?.payment?.expiresAt || new Date(existing.payment.expiresAt).getTime() > Date.now();
      if (samePlan && sameChannel && notExpired && existing?.order.status === 'pending') {
        return NextResponse.json({ data: existing, error: null }, { status: 200 });
      }
      const cancelled = await cancelOpenOrder(openOrder.id, auth.user.id);
      if (cancelled.code === 'BILLING_ORDER_ALREADY_PAID') {
        return NextResponse.json({ data: cancelled.checkout, error: { code: 'BILLING_ORDER_ALREADY_PAID', message: '已有订单完成支付' } }, { status: 409 });
      }
    }

    const businessOrderNo = orderNo();
    const merchantOrderNo = orderNo();
    const { data: order, error: orderError } = await client
      .from('billing_orders')
      .insert({
        user_id: auth.user.id,
        order_no: businessOrderNo,
        plan_id: plan.id,
        plan_code: plan.plan_code,
        provider: providerName,
        status: 'pending',
        amount: (amountMinor / 100).toFixed(2),
        amount_minor: amountMinor,
        currency: plan.currency,
        credits_granted: credits,
        price_version: plan.version,
        metadata: {
          channel,
          source: 'checkout',
          charge_currency: plan.currency,
          display_currency: plan.display_currency || BILLING_DISPLAY_CURRENCY,
          display_amount_minor: displayAmountMinor,
        },
      })
      .select('id,order_no,plan_code,status,amount_minor,currency,credits_granted,created_at,updated_at,paid_at,provider')
      .single();
    if (orderError?.code === '23505') {
      const raced = await findOpenOrder(auth.user.id);
      if (raced) return NextResponse.json({ data: await getCheckoutSnapshot(raced.id, auth.user.id), error: null }, { status: 200 });
    }
    if (orderError || !order) throw new Error(orderError?.message || '订单创建失败');

    let createdMerchantOrderNo: string | null = null;
    try {
      const provider = getBillingProvider(providerName);
      const notifyUrl = providerName === 'wechat' ? process.env.WECHAT_PAY_NOTIFY_URL : process.env.ALIPAY_NOTIFY_URL;
      const expiresAt = paymentExpiryDate(120);
      const payment = await provider.createPaymentSession({
        userId: auth.user.id,
        orderNo: merchantOrderNo,
        planCode,
        amountMinor,
        currency: plan.currency as 'CNY' | 'USD',
        channel,
        notifyUrl,
        returnUrl: process.env.ALIPAY_RETURN_URL || `${request.nextUrl.origin}/account/billing`,
        clientIp,
        description: localizedPlanName(plan.name) || planCode,
        expiresAt,
      });
      createdMerchantOrderNo = payment.merchantOrderNo;
      const { error: attemptError } = await client.from('payment_attempts').insert({
        order_id: order.id,
        provider: providerName,
        channel,
        merchant_order_no: payment.merchantOrderNo,
        provider_trade_no: payment.providerTradeNo || null,
        status: payment.status,
        amount_minor: amountMinor,
        currency: plan.currency,
        qr_code: payment.qrCode || null,
        redirect_url: payment.redirectUrl || null,
        expires_at: payment.expiresAt || expiresAt.toISOString(),
      });
      if (attemptError) throw new Error(attemptError.message);
      return NextResponse.json({ data: await getCheckoutSnapshot(order.id, auth.user.id), error: null }, { status: 201 });
    } catch (error) {
      if (createdMerchantOrderNo) {
        try { await getBillingProvider(providerName).closePayment({ merchantOrderNo: createdMerchantOrderNo }); } catch { /* best effort */ }
      }
      await client.from('billing_orders').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', order.id).eq('status', 'pending');
      throw error;
    }
  } catch (error) {
    console.error('[Billing] order creation failed:', error instanceof Error ? error.message : error);
    if (error instanceof BillingProviderDisabledError) {
      return NextResponse.json({ data: null, error: { code: 'BILLING_PROVIDER_DISABLED', message: '支付渠道尚未配置完成' } }, { status: 503 });
    }
    return NextResponse.json({ data: null, error: { code: 'BILLING_ORDER_CREATE_FAILED', message: '创建支付订单失败' } }, { status: 502 });
  }
}

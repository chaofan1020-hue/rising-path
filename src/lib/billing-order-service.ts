import { getBillingAdapter, type BillingPaymentStatus, type BillingProviderName } from '@/lib/billing-provider';
import { BILLING_DISPLAY_CURRENCY, orderDisplayUsdCents } from '@/lib/billing-fx';
import { paymentQrImage } from '@/lib/billing-qr';
import { settleBillingEvent } from '@/lib/billing-settlement';
import { getSupabaseClient } from '@/storage/database/supabase-client';

const OPEN_ORDER_STATUSES = ['pending', 'created'] as const;
const OPEN_ATTEMPT_STATUSES = ['pending', 'created'] as const;

type OrderRow = {
  id: number;
  order_no: string;
  plan_code: string;
  status: string;
  provider: string | null;
  amount_minor: number | null;
  currency: string;
  credits_granted: number | string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
  user_id?: string;
  metadata?: Record<string, unknown> | null;
};

type AttemptRow = {
  id: number;
  provider: string;
  channel: string;
  merchant_order_no: string;
  provider_trade_no: string | null;
  status: string;
  amount_minor: number | null;
  currency: string;
  qr_code: string | null;
  redirect_url: string | null;
  expires_at: string | null;
  provider_payload?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

function isOpenStatus(status: string): boolean {
  return (OPEN_ORDER_STATUSES as readonly string[]).includes(status);
}

function asProvider(value: string): BillingProviderName {
  return value === 'wechat' || value === 'alipay' ? value : 'manual_beta';
}

export function publicOrder(order: OrderRow) {
  const amountMinor = Number(order.amount_minor || 0);
  const metadata = order.metadata && typeof order.metadata === 'object' ? order.metadata : {};
  return {
    ...order,
    amountMinor,
    creditsGranted: Number(order.credits_granted || 0),
    displayCurrency: typeof metadata.display_currency === 'string' ? metadata.display_currency : BILLING_DISPLAY_CURRENCY,
    displayAmountMinor: orderDisplayUsdCents(metadata, amountMinor),
  };
}

export async function publicPayment(attempt: AttemptRow | null) {
  if (!attempt) return null;
  return {
    provider: attempt.provider,
    channel: attempt.channel,
    merchantOrderNo: attempt.merchant_order_no,
    providerTradeNo: attempt.provider_trade_no,
    status: attempt.status,
    amountMinor: Number(attempt.amount_minor || 0),
    currency: attempt.currency,
    qrCode: attempt.qr_code,
    qrImage: await paymentQrImage(attempt.qr_code),
    redirectUrl: attempt.redirect_url,
    expiresAt: attempt.expires_at,
    enabled: true,
  };
}

async function loadOrder(orderId: number, userId?: string) {
  const client = getSupabaseClient();
  let query = client.from('billing_orders')
    .select('id,order_no,plan_code,status,provider,amount_minor,currency,credits_granted,metadata,paid_at,created_at,updated_at,user_id')
    .eq('id', orderId);
  if (userId) query = query.eq('user_id', userId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data as OrderRow | null;
}

async function loadLatestAttempt(orderId: number) {
  const { data, error } = await getSupabaseClient()
    .from('payment_attempts')
    .select('id,provider,channel,merchant_order_no,provider_trade_no,status,amount_minor,currency,qr_code,redirect_url,expires_at,provider_payload,created_at,updated_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as AttemptRow | null;
}

async function markClosed(orderId: number, attemptId: number | null, status: 'cancelled' | 'expired' | 'failed') {
  const client = getSupabaseClient();
  const now = new Date().toISOString();
  if (attemptId) {
    await client.from('payment_attempts').update({ status, updated_at: now }).eq('id', attemptId).in('status', [...OPEN_ATTEMPT_STATUSES]);
  }
  await client.from('billing_orders').update({ status, updated_at: now }).eq('id', orderId).in('status', [...OPEN_ORDER_STATUSES]);
}

async function settlePaid(params: {
  provider: string;
  merchantOrderNo: string;
  providerTradeNo?: string | null;
  amountMinor: number;
  source: string;
}) {
  return settleBillingEvent(params.provider, {
    eventId: `${params.source}:${params.merchantOrderNo}`,
    eventType: params.source,
    merchantOrderNo: params.merchantOrderNo,
    providerTradeNo: params.providerTradeNo || null,
    status: 'paid',
    amountMinor: params.amountMinor,
    payload: { source: params.source },
  });
}

async function closeRemoteThenQuery(attempt: AttemptRow): Promise<BillingPaymentStatus | null> {
  if (attempt.provider === 'manual_beta') return null;
  const provider = getBillingAdapter(asProvider(attempt.provider));
  try {
    await provider.closePayment({
      merchantOrderNo: attempt.merchant_order_no,
      providerTradeNo: attempt.provider_trade_no || undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/ORDERPAID|ORDER_PAID|TRADE_FINISHED|TRADE_SUCCESS|ACQ.TRADE_STATUS_ERROR/i.test(message)) {
      console.error('[Billing] close payment failed:', message);
    }
  }
  try {
    const result = await provider.queryPayment({
      merchantOrderNo: attempt.merchant_order_no,
      providerTradeNo: attempt.provider_trade_no || undefined,
    });
    return result.status;
  } catch (error) {
    console.error('[Billing] close follow-up query failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

export async function findOpenOrder(userId: string) {
  const { data, error } = await getSupabaseClient()
    .from('billing_orders')
    .select('id,order_no,plan_code,status,provider,amount_minor,currency,credits_granted,metadata,paid_at,created_at,updated_at,user_id')
    .eq('user_id', userId)
    .in('status', [...OPEN_ORDER_STATUSES])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as OrderRow | null;
}

export async function reconcileOpenPayment(order: OrderRow, attempt: AttemptRow | null) {
  if (!attempt || !isOpenStatus(order.status)) {
    return { order, payment: attempt };
  }

  const expired = attempt.expires_at && new Date(attempt.expires_at).getTime() <= Date.now();
  if (expired) {
    const remoteStatus = await closeRemoteThenQuery(attempt);
    if (remoteStatus === 'paid') {
      const amountMinor = Number(attempt.amount_minor || order.amount_minor || 0);
      if (amountMinor > 0) {
        await settlePaid({
          provider: attempt.provider,
          merchantOrderNo: attempt.merchant_order_no,
          providerTradeNo: attempt.provider_trade_no,
          amountMinor,
          source: 'expire-race',
        });
      }
    } else {
      await markClosed(order.id, attempt.id, 'expired');
    }
  } else if (attempt.provider !== 'manual_beta') {
    try {
      const provider = getBillingAdapter(asProvider(attempt.provider));
      const result = await provider.queryPayment({
        merchantOrderNo: attempt.merchant_order_no,
        providerTradeNo: attempt.provider_trade_no || undefined,
      });
      if (result.status === 'paid') {
        if (result.amountMinor == null || result.amountMinor <= 0) {
          console.error('[Billing] provider query returned paid without amount, waiting for signed callback');
        } else {
          await settlePaid({
            provider: attempt.provider,
            merchantOrderNo: attempt.merchant_order_no,
            providerTradeNo: result.providerTradeNo || attempt.provider_trade_no,
            amountMinor: result.amountMinor,
            source: 'status-query',
          });
        }
      } else if (result.status === 'cancelled' || result.status === 'expired' || result.status === 'failed') {
        await markClosed(order.id, attempt.id, result.status === 'failed' ? 'failed' : result.status === 'expired' ? 'expired' : 'cancelled');
      }
    } catch (error) {
      console.error('[Billing] status query failed:', error instanceof Error ? error.message : error);
    }
  }

  const refreshedOrder = await loadOrder(order.id) || order;
  const refreshedAttempt = await loadLatestAttempt(order.id);
  return { order: refreshedOrder, payment: refreshedAttempt };
}

export async function getCheckoutSnapshot(orderId: number, userId?: string) {
  const order = await loadOrder(orderId, userId);
  if (!order) return null;
  const attempt = await loadLatestAttempt(order.id);
  const reconciled = await reconcileOpenPayment(order, attempt);
  return {
    order: publicOrder(reconciled.order),
    payment: await publicPayment(reconciled.payment),
  };
}

export async function cancelOpenOrder(orderId: number, userId?: string) {
  const order = await loadOrder(orderId, userId);
  if (!order) return { code: 'BILLING_ORDER_NOT_FOUND' as const, checkout: null };
  const attempt = await loadLatestAttempt(order.id);
  if (!isOpenStatus(order.status)) {
    const reconciled = await reconcileOpenPayment(order, attempt);
    return {
      code: reconciled.order.status === 'paid' ? 'BILLING_ORDER_ALREADY_PAID' as const : 'BILLING_ORDER_NOT_CANCELLABLE' as const,
      checkout: {
        order: publicOrder(reconciled.order),
        payment: await publicPayment(reconciled.payment),
      },
    };
  }

  if (attempt) {
    const remoteStatus = await closeRemoteThenQuery(attempt);
    if (remoteStatus === 'paid') {
      const amountMinor = Number(attempt.amount_minor || order.amount_minor || 0);
      if (amountMinor > 0) {
        await settlePaid({
          provider: attempt.provider,
          merchantOrderNo: attempt.merchant_order_no,
          providerTradeNo: attempt.provider_trade_no,
          amountMinor,
          source: 'cancel-race',
        });
      }
      const paid = await getCheckoutSnapshot(order.id, userId);
      return { code: 'BILLING_ORDER_ALREADY_PAID' as const, checkout: paid };
    }
  }

  await markClosed(order.id, attempt?.id || null, 'cancelled');
  const cancelled = await getCheckoutSnapshot(order.id, userId);
  return { code: 'CANCELLED' as const, checkout: cancelled };
}

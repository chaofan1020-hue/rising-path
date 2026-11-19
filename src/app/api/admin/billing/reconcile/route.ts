import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { recordAdminAuditEvent } from '@/lib/admin-audit';
import { getBillingProvider } from '@/lib/billing-provider';
import { orderLookupCandidates } from '@/lib/billing-reconcile';
import { settleBillingEvent } from '@/lib/billing-settlement';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const dynamic = 'force-dynamic';

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

/** Human-readable meaning of every code complete_billing_order can return. */
const OUTCOME: Record<string, string> = {
  PAID: '已补单入账，积分已发放',
  IDEMPOTENT_REPLAY: '该订单此前已入账，未重复发放',
  ORDER_NOT_FOUND: '数据库中不存在该订单号',
  PAYMENT_ATTEMPT_NOT_FOUND: '找不到匹配的支付尝试记录',
  PAYMENT_AMOUNT_MISMATCH: '渠道金额与订单金额不一致，已拒绝入账',
  ORDER_ALREADY_REFUNDED: '订单已退款，不能重新入账',
  ORDER_NOT_PAYABLE: '数据库函数尚未更新，请先执行迁移 0133',
  INVALID_PAYMENT_CONFIRMATION: '补单参数不完整',
};

/**
 * POST /api/admin/billing/reconcile
 *
 * Re-checks one order against the payment channel and settles it when the
 * channel reports PAID. This is the manual repair path for buyers who paid but
 * still see "pending" (lost callback, delayed notification, or an order that
 * was locally expired before settlement was wired correctly).
 *
 * Body: { orderNo?: string, tradeNo?: string, orderId?: number, apply?: boolean }
 * `apply: false` performs the channel query only and reports what would happen.
 */
export async function POST(request: NextRequest) {
  const permissionError = await requireAdminPermission(request, ADMIN_PERMISSIONS.billingWrite);
  if (permissionError) return permissionError;

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const orderNo = typeof body.orderNo === 'string' ? body.orderNo.trim() : '';
  const tradeNo = typeof body.tradeNo === 'string' ? body.tradeNo.trim() : '';
  const orderId = Number(body.orderId);
  const apply = body.apply !== false;
  if (!orderNo && !tradeNo && !Number.isSafeInteger(orderId)) {
    return jsonError('INVALID_RECONCILE_TARGET', '请提供订单号、支付交易号或订单 ID', 400);
  }

  const client = getSupabaseClient();
  let orderQuery = client.from('billing_orders').select('id,order_no,status,provider,amount_minor,credits_granted,user_id,created_at').limit(1);
  if (Number.isSafeInteger(orderId) && orderId > 0) orderQuery = orderQuery.eq('id', orderId);
  else if (orderNo) orderQuery = orderQuery.eq('order_no', orderNo);
  else {
    const { data: attempt } = await client.from('payment_attempts').select('order_id').eq('provider_trade_no', tradeNo).maybeSingle();
    if (!attempt) return jsonError('PAYMENT_TRADE_NOT_FOUND', '没有找到对应的支付交易记录', 404);
    orderQuery = orderQuery.eq('id', attempt.order_id);
  }
  const { data: order } = await orderQuery.maybeSingle();
  if (!order) return jsonError('ORDER_NOT_FOUND', '订单不存在', 404);

  if (order.status === 'paid') {
    return NextResponse.json({ data: { orderNo: order.order_no, status: 'paid', code: 'IDEMPOTENT_REPLAY' }, error: null });
  }
  if (order.status === 'refunded' || order.status === 'partially_refunded') {
    return jsonError('ORDER_ALREADY_REFUNDED', '订单已退款，不能重新入账', 409);
  }
  if (order.provider !== 'alipay' && order.provider !== 'wechat') {
    return jsonError('ORDER_PROVIDER_UNSUPPORTED', '该订单不是真实支付渠道订单', 400);
  }

  const { data: attempts } = await client
    .from('payment_attempts')
    .select('id,provider,channel,merchant_order_no,provider_trade_no,status,amount_minor')
    .eq('order_id', order.id)
    .order('created_at', { ascending: false });
  if (!attempts?.length) return jsonError('PAYMENT_ATTEMPT_NOT_FOUND', '该订单没有支付尝试记录', 409);

  const provider = getBillingProvider(order.provider as 'alipay' | 'wechat');
  const trace: Array<{ merchantOrderNo: string; status?: string; error?: string }> = [];
  let matched: { merchantOrderNo: string; providerTradeNo: string | null; amountMinor: number; attemptId: number } | null = null;

  for (const attempt of attempts) {
    const candidates = orderLookupCandidates(order.order_no, attempt);
    for (const candidate of candidates) {
      try {
        // Provider trade number is only meaningful for the attempt that owns it.
        const providerTradeNo = candidate === attempt.merchant_order_no ? attempt.provider_trade_no || undefined : undefined;
        const result = await provider.queryPayment({ merchantOrderNo: candidate, providerTradeNo });
        trace.push({ merchantOrderNo: candidate, status: result.status });
        if (result.status === 'paid' && Number(result.amountMinor) > 0) {
          matched = {
            merchantOrderNo: candidate,
            providerTradeNo: result.providerTradeNo || attempt.provider_trade_no || null,
            amountMinor: Number(result.amountMinor),
            attemptId: attempt.id,
          };
          break;
        }
      } catch (error) {
        trace.push({ merchantOrderNo: candidate, error: error instanceof Error ? error.message : 'unknown' });
      }
    }
    if (matched) break;
  }

  if (!matched) {
    await recordAdminAuditEvent({ request, action: 'billing.order.reconcile', resourceType: 'billing_order', resourceId: order.id, subjectUserId: order.user_id, metadata: { result: 'not_paid', trace } });
    return NextResponse.json({ data: { orderNo: order.order_no, status: order.status, code: 'CHANNEL_NOT_PAID', trace }, error: null });
  }

  const localAmount = Number(order.amount_minor || 0);
  if (matched.amountMinor !== localAmount) {
    // Never grant credits for an amount we cannot tie to our own order.
    await recordAdminAuditEvent({ request, action: 'billing.order.reconcile', resourceType: 'billing_order', resourceId: order.id, subjectUserId: order.user_id, metadata: { result: 'amount_mismatch', channelAmount: matched.amountMinor, localAmount } });
    return jsonError('PAYMENT_AMOUNT_MISMATCH', `渠道金额 ${matched.amountMinor} 分与订单金额 ${localAmount} 分不一致，已拒绝入账，请核对支付宝账单`, 409);
  }

  if (!apply) {
    return NextResponse.json({ data: { orderNo: order.order_no, status: order.status, code: 'WOULD_SETTLE', merchantOrderNo: matched.merchantOrderNo, amountMinor: localAmount, trace }, error: null });
  }

  if (matched.merchantOrderNo !== attempts.find((item) => item.id === matched?.attemptId)?.merchant_order_no) {
    const { error: repointError } = await client
      .from('payment_attempts')
      .update({ merchant_order_no: matched.merchantOrderNo, updated_at: new Date().toISOString() })
      .eq('id', matched.attemptId);
    if (repointError) return jsonError('PAYMENT_ATTEMPT_REPOINT_FAILED', repointError.message, 500);
  }

  const result = await settleBillingEvent(order.provider, {
    eventId: `admin-reconcile:${order.order_no}:${matched.providerTradeNo || matched.merchantOrderNo}`,
    eventType: 'reconcile',
    merchantOrderNo: matched.merchantOrderNo,
    providerTradeNo: matched.providerTradeNo,
    status: 'paid',
    amountMinor: localAmount,
    payload: { source: 'admin-reconcile', orderNo: order.order_no },
  });

  const { data: refreshed } = await client.from('billing_orders').select('id,order_no,status,paid_at,credits_granted').eq('id', order.id).maybeSingle();
  await recordAdminAuditEvent({ request, action: 'billing.order.reconcile', resourceType: 'billing_order', resourceId: order.id, subjectUserId: order.user_id, beforeData: { status: order.status }, afterData: { status: refreshed?.status, code: result.code }, metadata: { merchantOrderNo: matched.merchantOrderNo, amountMinor: localAmount, trace } });

  return NextResponse.json({
    data: {
      orderNo: order.order_no,
      status: refreshed?.status || order.status,
      code: result.code,
      outcome: OUTCOME[result.code] || '',
      merchantOrderNo: matched.merchantOrderNo,
      amountMinor: localAmount,
      trace,
    },
    error: null,
  });
}

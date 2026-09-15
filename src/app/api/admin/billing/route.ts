import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';
import { BillingProviderDisabledError, getBillingProvider, type BillingProviderName } from '@/lib/billing-provider';
import { getBillingReadiness } from '@/lib/billing-config';
import { cancelOpenOrder } from '@/lib/billing-order-service';
import { getSupabaseClient } from '@/storage/database/supabase-client';

const STATUSES = new Set(['pending', 'created', 'paid', 'cancelled', 'failed', 'expired', 'refunded', 'partially_refunded']);
const jsonError = (code: string, message: string, status: number) => NextResponse.json({ data: null, error: { code, message } }, { status });
function validId(value: unknown): number | null { const id = Number(value); return Number.isSafeInteger(id) && id > 0 ? id : null; }

export async function GET(request: NextRequest) {
  const permissionError = await requireAdminPermission(request, ADMIN_PERMISSIONS.billingRead);
  if (permissionError) return permissionError;
  const params = request.nextUrl.searchParams;
  const status = params.get('status')?.trim() || '';
  const search = params.get('search')?.trim().slice(0, 80) || '';
  const limit = Math.min(Math.max(Number(params.get('limit') || 100), 1), 500);
  if (status && !STATUSES.has(status)) return jsonError('INVALID_BILLING_STATUS', '订单状态无效', 400);
  const client = getSupabaseClient();
  let orderQuery = client.from('billing_orders').select('id,order_no,plan_code,status,provider,amount,amount_minor,currency,credits_granted,price_version,paid_at,refunded_at,created_at,updated_at').order('created_at', { ascending: false }).limit(limit);
  if (status) orderQuery = orderQuery.eq('status', status);
  if (search) orderQuery = orderQuery.or(`order_no.ilike.%${search}%,plan_code.ilike.%${search}%`);
  const [{ data: orders, error: orderError }, { data: plans, error: planError }] = await Promise.all([orderQuery, client.from('billing_plans').select('plan_code,name,description,currency')]);
  if (orderError || planError) return jsonError('ADMIN_BILLING_QUERY_FAILED', '读取支付订单失败', 500);
  const rows = orders || [];
  const ids = rows.map((row) => row.id);
  const { data: attempts, error: attemptError } = ids.length ? await client.from('payment_attempts').select('id,order_id,provider,channel,merchant_order_no,provider_trade_no,status,amount_minor,currency,expires_at,paid_at,refunded_at,created_at,updated_at').in('order_id', ids).order('created_at', { ascending: false }) : { data: [], error: null };
  if (attemptError) return jsonError('ADMIN_BILLING_ATTEMPT_QUERY_FAILED', '读取支付尝试失败', 500);
  const planMap = new Map((plans || []).map((plan) => [plan.plan_code, plan]));
  const attemptMap = new Map<number, typeof attempts>();
  for (const attempt of attempts || []) attemptMap.set(attempt.order_id, [...(attemptMap.get(attempt.order_id) || []), attempt]);
  const normalized = rows.map((order) => ({ ...order, amountMinor: order.amount_minor === null ? null : Number(order.amount_minor), creditsGranted: Number(order.credits_granted || 0), plan: planMap.get(order.plan_code) || null, attempts: attemptMap.get(order.id) || [] }));
  const summary = normalized.reduce((result, order) => { result.total += 1; result.byStatus[order.status] = (result.byStatus[order.status] || 0) + 1; result.grossAmountMinor += Number(order.amount_minor || 0); if (['paid', 'refunded', 'partially_refunded'].includes(order.status)) result.paidAmountMinor += Number(order.amount_minor || 0); return result; }, { total: 0, byStatus: {} as Record<string, number>, grossAmountMinor: 0, paidAmountMinor: 0 });
  return NextResponse.json({ data: { orders: normalized, summary, billing: getBillingReadiness() }, error: null });
}

export async function POST(request: NextRequest) {
  const permissionError = await requireAdminPermission(request, ADMIN_PERMISSIONS.billingWrite);
  if (permissionError) return permissionError;
  let action = 'unknown'; let id: number | null = null;
  try {
    const body = await request.json() as Record<string, unknown>;
    action = typeof body.action === 'string' ? body.action : 'unknown';
    id = validId(body.orderId);
    if (!id) return jsonError('INVALID_BILLING_ORDER_ID', '订单 ID 无效', 400);
    const client = getSupabaseClient();
    const { data: order, error: orderError } = await client.from('billing_orders').select('id,order_no,status,provider,amount_minor,credits_granted,user_id').eq('id', id).maybeSingle();
    if (orderError) throw new Error(orderError.message);
    if (!order) return jsonError('BILLING_ORDER_NOT_FOUND', '订单不存在', 404);
    if (action === 'cancel') {
      const cancelled = await cancelOpenOrder(id);
      if (cancelled.code === 'BILLING_ORDER_NOT_FOUND') return jsonError('BILLING_ORDER_NOT_FOUND', '订单不存在', 404);
      if (cancelled.code === 'BILLING_ORDER_ALREADY_PAID') {
        await recordAdminAuditEvent({ request, action: 'billing.order.cancel', resourceType: 'billing_order', resourceId: id, subjectUserId: order.user_id, afterData: { status: 'paid' } });
        return NextResponse.json({ data: { id, status: 'paid', code: cancelled.code }, error: null });
      }
      if (cancelled.code !== 'CANCELLED') return jsonError('BILLING_ORDER_NOT_CANCELLABLE', '当前订单不能取消', 409);
      await recordAdminAuditEvent({ request, action: 'billing.order.cancel', resourceType: 'billing_order', resourceId: id, subjectUserId: order.user_id, beforeData: { status: order.status }, afterData: { status: 'cancelled' } });
      return NextResponse.json({ data: { id, status: 'cancelled' }, error: null });
    }
    if (action !== 'refund') return jsonError('INVALID_BILLING_ACTION', '支付订单操作无效', 400);
    if (order.status === 'refunded') return NextResponse.json({ data: { id, status: 'refunded', idempotent: true }, error: null });
    if (order.status !== 'paid' && order.status !== 'partially_refunded') return jsonError('BILLING_ORDER_NOT_REFUNDABLE', '只有已支付订单可以退款', 409);
    const { data: attempt, error: attemptError } = await client.from('payment_attempts').select('id,provider,merchant_order_no,provider_trade_no,amount_minor,status,provider_payload').eq('order_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (attemptError) throw new Error(attemptError.message);
    if (!attempt) return jsonError('BILLING_PAYMENT_ATTEMPT_NOT_FOUND', '找不到支付尝试记录', 409);
    const provider = getBillingProvider(attempt.provider as BillingProviderName);
    const payload = attempt.provider_payload && typeof attempt.provider_payload === 'object' ? attempt.provider_payload as Record<string, unknown> : {};
    const existingRefundNo = typeof payload.refund_no === 'string' ? payload.refund_no : '';
    if (order.status === 'partially_refunded' && existingRefundNo) {
      const refundStatus = await provider.queryRefund({ refundNo: existingRefundNo, merchantOrderNo: attempt.merchant_order_no });
      if (refundStatus === 'refunded') {
        const finalized = await client.rpc('finalize_billing_refund', { p_order_id: id, p_success: true, p_reason: typeof body.reason === 'string' ? body.reason : null });
        if (finalized.error) throw new Error(finalized.error.message);
        await client.from('payment_attempts').update({ status: 'refunded', refunded_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', attempt.id);
      } else if (refundStatus === 'failed') {
        await client.rpc('finalize_billing_refund', { p_order_id: id, p_success: false, p_reason: '支付渠道退款失败' });
      }
      await recordAdminAuditEvent({ request, action: 'billing.order.refund', resourceType: 'billing_order', resourceId: id, subjectUserId: order.user_id, metadata: { refundNo: existingRefundNo, provider: attempt.provider, status: refundStatus } });
      return NextResponse.json({ data: { id, status: refundStatus, refundNo: existingRefundNo }, error: null });
    }
    const prepared = await client.rpc('prepare_billing_refund', { p_order_id: id });
    if (prepared.error) throw new Error(prepared.error.message);
    const prepareResult = Array.isArray(prepared.data) ? prepared.data[0] : prepared.data;
    if (!prepareResult?.ok && prepareResult?.code !== 'IDEMPOTENT_REPLAY') return jsonError(String(prepareResult?.code || 'REFUND_PREPARE_FAILED'), '当前订单无法安全退回积分，请先检查用户余额', 409);
    const refundNo = existingRefundNo || `RF${Date.now().toString(36).toUpperCase()}${id}`;
    try {
      const refund = await provider.refundPayment({ merchantOrderNo: attempt.merchant_order_no, providerTradeNo: attempt.provider_trade_no || undefined, refundNo, amountMinor: Number(attempt.amount_minor || order.amount_minor || 0), totalAmountMinor: Number(order.amount_minor || 0), reason: typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : undefined });
      await client.from('payment_attempts').update({
        provider_payload: { ...payload, refund_no: refundNo },
        status: refund.status === 'refunded' ? 'refunded' : attempt.status,
        refunded_at: refund.status === 'refunded' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq('id', attempt.id);
      if (refund.status === 'refunded') {
        const finalized = await client.rpc('finalize_billing_refund', { p_order_id: id, p_success: true, p_reason: typeof body.reason === 'string' ? body.reason : null });
        if (finalized.error) throw new Error(finalized.error.message);
      }
      await recordAdminAuditEvent({ request, action: 'billing.order.refund', resourceType: 'billing_order', resourceId: id, subjectUserId: order.user_id, metadata: { refundNo, provider: attempt.provider, status: refund.status, reason: body.reason || null } });
      return NextResponse.json({ data: { id, status: refund.status, refundNo }, error: null });
    } catch (providerError) {
      await client.rpc('finalize_billing_refund', { p_order_id: id, p_success: false, p_reason: providerError instanceof Error ? providerError.message : '支付渠道退款失败' });
      throw providerError;
    }
  } catch (error) {
    await recordAdminAuditFailure({ request, action: `billing.order.${action}`, resourceType: 'billing_order', resourceId: id, error });
    if (error instanceof BillingProviderDisabledError) return jsonError('BILLING_PROVIDER_DISABLED', '支付渠道尚未配置完成', 503);
    console.error('[Admin Billing] operation failed:', error instanceof Error ? error.message : error);
    return jsonError('ADMIN_BILLING_OPERATION_FAILED', '支付订单操作失败', 502);
  }
}


import type { BillingWebhookEvent } from '@/lib/billing-provider';
import { getSupabaseClient } from '@/storage/database/supabase-client';

const REPLAYABLE_WEBHOOK_STATUSES = new Set(['failed', 'received']);

async function loadAttempt(provider: string, merchantOrderNo: string) {
  const client = getSupabaseClient();
  const { data: attempt, error: attemptError } = await client
    .from('payment_attempts')
    .select('id,order_id')
    .eq('provider', provider)
    .eq('merchant_order_no', merchantOrderNo)
    .maybeSingle();
  if (attemptError || !attempt) throw new Error(attemptError?.message || '支付尝试不存在');
  const { data: order, error: orderError } = await client
    .from('billing_orders')
    .select('id,order_no')
    .eq('id', attempt.order_id)
    .maybeSingle();
  if (orderError || !order?.order_no) throw new Error(orderError?.message || '支付订单不存在');
  return { attempt, order };
}

export async function settleBillingEvent(provider: string, event: BillingWebhookEvent) {
  const client = getSupabaseClient();
  const safePayload = {
    eventType: event.eventType,
    merchantOrderNo: event.merchantOrderNo || null,
    providerTradeNo: event.providerTradeNo || null,
    status: event.status,
    amountMinor: event.amountMinor ?? null,
  };
  const { data: webhook, error: webhookError } = await client
    .from('billing_webhook_events')
    .insert({ provider, event_id: event.eventId, event_type: event.eventType, payload: safePayload, status: 'received' })
    .select('id')
    .maybeSingle();
  let webhookId = webhook?.id;
  if (webhookError?.code === '23505') {
    const { data: existing } = await client.from('billing_webhook_events').select('id,status').eq('provider', provider).eq('event_id', event.eventId).maybeSingle();
    if (existing?.status === 'processed' || existing?.status === 'ignored') return { duplicate: true, code: 'IDEMPOTENT_REPLAY' };
    if (existing && REPLAYABLE_WEBHOOK_STATUSES.has(existing.status)) {
      const { error: reopenError } = await client.from('billing_webhook_events')
        .update({ status: 'received', result: {}, processed_at: null })
        .eq('id', existing.id)
        .in('status', ['failed', 'received']);
      if (!reopenError) webhookId = existing.id;
    }
    if (!webhookId) return { duplicate: true, code: 'RETRY' };
  }
  if ((webhookError && webhookError.code !== '23505') || !webhookId) throw new Error(`记录支付回调失败: ${webhookError?.message || 'missing event'}`);

  try {
    if (event.status === 'refunded') {
      if (!event.merchantOrderNo) throw new Error('退款回调缺少商户订单号');
      const { order } = await loadAttempt(provider, event.merchantOrderNo);
      const { data, error } = await client.rpc('complete_billing_refund', {
        p_order_no: order.order_no,
        p_provider: provider,
        p_merchant_order_no: event.merchantOrderNo,
        p_reason: '支付渠道退款回调',
      });
      if (error) throw new Error(error.message);
      const result = Array.isArray(data) ? data[0] : data;
      const resultCode = String(result?.code || 'UNKNOWN');
      const ok = Boolean(result?.ok);
      await client.from('billing_webhook_events').update({ status: ok ? 'processed' : 'failed', result: { code: resultCode }, processed_at: new Date().toISOString() }).eq('id', webhookId);
      return { duplicate: false, code: resultCode, result };
    }

    if (event.status !== 'paid') {
      await client.from('billing_webhook_events').update({ status: 'ignored', result: { code: 'NOT_PAID_EVENT' }, processed_at: new Date().toISOString() }).eq('id', webhookId);
      return { duplicate: false, code: 'IGNORED' };
    }
    if (!event.merchantOrderNo) throw new Error('支付回调缺少商户订单号');
    if (event.amountMinor == null || event.amountMinor <= 0) throw new Error('支付回调缺少有效金额');

    const { order } = await loadAttempt(provider, event.merchantOrderNo);
    const { data, error } = await client.rpc('complete_billing_order', {
      p_order_no: order.order_no,
      p_provider: provider,
      p_merchant_order_no: event.merchantOrderNo,
      p_provider_trade_no: event.providerTradeNo || null,
      p_amount_minor: event.amountMinor,
      p_metadata: safePayload,
    });
    if (error) throw new Error(error.message);
    const result = Array.isArray(data) ? data[0] : data;
    const resultCode = String(result?.code || 'UNKNOWN');
    const ok = Boolean(result?.ok);
    await client.from('billing_webhook_events').update({ status: ok ? 'processed' : 'failed', result: { code: resultCode }, processed_at: new Date().toISOString() }).eq('id', webhookId);
    return { duplicate: false, code: resultCode, result };
  } catch (error) {
    await client.from('billing_webhook_events').update({ status: 'failed', result: { code: 'PROCESSING_FAILED' }, processed_at: new Date().toISOString() }).eq('id', webhookId);
    throw error;
  }
}

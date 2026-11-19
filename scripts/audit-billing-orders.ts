import { getSupabaseClient } from '@/storage/database/supabase-client';

/**
 * Read-only audit of the billing settlement path. Never writes.
 *
 *   pnpm exec tsx scripts/audit-billing-orders.ts
 *   DOTENV_CONFIG_PATH=.env.production.local pnpm exec tsx scripts/audit-billing-orders.ts
 *
 * It answers three questions:
 *   1. How many orders have a merchant order number that differs from
 *      billing_orders.order_no? (direct evidence of the duplicated-order-number bug)
 *   2. Which orders are stuck unpaid but have a payment attempt the channel may
 *      have settled? (the backfill candidates)
 *   3. What did the callbacks do? (billing_webhook_events by status/result code)
 */

type OrderRow = {
  id: number;
  order_no: string;
  status: string;
  provider: string | null;
  amount_minor: number | null;
  credits_granted: number | null;
  user_id: string;
  created_at: string;
  paid_at: string | null;
};

type AttemptRow = {
  order_id: number;
  provider: string;
  channel: string;
  merchant_order_no: string;
  provider_trade_no: string | null;
  status: string;
  amount_minor: number | null;
  created_at: string;
};

const DAYS = Math.max(1, Math.min(365, Number(process.argv.includes('--days') ? process.argv[process.argv.indexOf('--days') + 1] : 90)));
const LIMIT = Math.max(1, Math.min(2000, Number(process.argv.includes('--limit') ? process.argv[process.argv.indexOf('--limit') + 1] : 500)));

function pad(value: unknown, width: number): string {
  return String(value ?? '').padEnd(width).slice(0, width);
}

async function main() {
  const client = getSupabaseClient();
  const since = new Date(Date.now() - DAYS * 86400_000).toISOString();
  console.log(`[audit] read-only, since=${since} limit=${LIMIT}`);
  console.log(`[audit] supabase=${(process.env.SUPABASE_URL || '').replace(/https:\/\/([a-z0-9]+)\..*/, '$1')}`);

  const { data: orders, error: orderError } = await client
    .from('billing_orders')
    .select('id,order_no,status,provider,amount_minor,credits_granted,user_id,created_at,paid_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(LIMIT);
  if (orderError) throw new Error(orderError.message);
  const rows = (orders || []) as OrderRow[];
  console.log(`\n[audit] orders in window: ${rows.length}`);

  const byStatus = new Map<string, number>();
  for (const order of rows) byStatus.set(order.status, (byStatus.get(order.status) || 0) + 1);
  console.log('[audit] by status: ' + Array.from(byStatus.entries()).map(([status, count]) => `${status}=${count}`).join(' '));

  const ids = rows.map((order) => order.id);
  if (!ids.length) {
    console.log('[audit] nothing to inspect.');
    return;
  }

  const { data: attempts, error: attemptError } = await client
    .from('payment_attempts')
    .select('order_id,provider,channel,merchant_order_no,provider_trade_no,status,amount_minor,created_at')
    .in('order_id', ids);
  if (attemptError) throw new Error(attemptError.message);
  const attemptRows = (attempts || []) as AttemptRow[];
  const attemptByOrder = new Map<number, AttemptRow>();
  for (const attempt of attemptRows) attemptByOrder.set(attempt.order_id, attempt);

  const mismatched = rows.filter((order) => {
    const attempt = attemptByOrder.get(order.id);
    return attempt && attempt.merchant_order_no && attempt.merchant_order_no !== order.order_no;
  });
  console.log(`\n[audit] orders whose channel order number != order_no: ${mismatched.length}`);
  if (mismatched.length) {
    console.log('  ' + pad('order_no', 26) + pad('channel(out_trade_no)', 26) + pad('status', 10) + 'amount');
    for (const order of mismatched.slice(0, 40)) {
      const attempt = attemptByOrder.get(order.id)!;
      console.log('  ' + pad(order.order_no, 26) + pad(attempt.merchant_order_no, 26) + pad(order.status, 10) + order.amount_minor);
    }
  }

  const stuck = rows.filter((order) => ['pending', 'created', 'expired', 'cancelled', 'failed'].includes(order.status));
  console.log(`\n[audit] stuck (unpaid status) orders: ${stuck.length}`);
  const withAttempt = stuck.filter((order) => attemptByOrder.has(order.id));
  console.log(`[audit]   of which have a payment attempt (channel may have captured money): ${withAttempt.length}`);
  for (const order of withAttempt.slice(0, 60)) {
    const attempt = attemptByOrder.get(order.id)!;
    const mismatch = attempt.merchant_order_no !== order.order_no ? ' ORDER_NO-MISMATCH' : '';
    console.log(`  order=${order.order_no} status=${order.status} amount=${order.amount_minor} credits=${order.credits_granted} channel=${attempt.channel} attempt=${attempt.status} trade_no=${attempt.provider_trade_no || '-'} created=${order.created_at}${mismatch}`);
  }

  const paidWithoutCredits = rows.filter((order) => order.status === 'paid' && Number(order.credits_granted || 0) === 0);
  console.log(`\n[audit] paid orders with 0 credits granted: ${paidWithoutCredits.length}`);

  const { data: events, error: eventError } = await client
    .from('billing_webhook_events')
    .select('id,provider,event_id,event_type,status,result,received_at,processed_at')
    .gte('received_at', since)
    .order('id', { ascending: false })
    .limit(500);
  if (eventError) throw new Error(eventError.message);
  const eventRows = events || [];
  console.log(`\n[audit] webhook events in window: ${eventRows.length}`);
  const eventStats = new Map<string, number>();
  for (const event of eventRows) {
    const resultCode = event.result && typeof event.result === 'object' ? (event.result as { code?: string }).code || '-' : '-';
    const key = `${event.status}/${resultCode}`;
    eventStats.set(key, (eventStats.get(key) || 0) + 1);
  }
  for (const [key, count] of Array.from(eventStats.entries()).sort((a, b) => b[1] - a[1])) console.log(`  ${key}: ${count}`);
  const failed = eventRows.filter((event) => event.status === 'failed');
  if (failed.length) {
    console.log('[audit] failed events (replay these after fixing the cause):');
    for (const event of failed.slice(0, 20)) console.log(`  id=${event.id} provider=${event.provider} type=${event.event_type} code=${JSON.stringify(event.result)} at=${event.received_at}`);
  }
}

main().catch((error) => {
  console.error('[audit] fatal:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

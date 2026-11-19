import { AlipayProvider } from '@/lib/alipay-provider';
import { orderLookupCandidates, alipayTradeStatusFromOrder, shouldAdoptChannelPaidAmount } from '@/lib/billing-reconcile';
import { settleBillingEvent } from '@/lib/billing-settlement';
import { getBillingProvider } from '@/lib/billing-provider';
import { getSupabaseClient } from '@/storage/database/supabase-client';

/**
 * One-shot reconciliation for orders the channel says are paid but our
 * database still shows pending / expired / cancelled. Safe to run repeatedly:
 * every path ends in complete_billing_order, which is idempotent per order.
 *
 *   pnpm exec tsx scripts/reconcile-billing-orders.ts            # dry run
 *   pnpm exec tsx scripts/reconcile-billing-orders.ts --apply    # settle
 *   pnpm exec tsx scripts/reconcile-billing-orders.ts --apply --order LVXXXX
 *   pnpm exec tsx scripts/reconcile-billing-orders.ts --apply --trade 2024...
 *   pnpm exec tsx scripts/reconcile-billing-orders.ts --apply --days 30 --limit 200
 */

type OrderRow = {
  id: number;
  order_no: string;
  status: string;
  provider: string | null;
  amount_minor: number | null;
  credits_granted: number | string | null;
  user_id: string;
  created_at: string;
};

type AttemptRow = {
  id: number;
  order_id: number;
  provider: string;
  channel: string;
  merchant_order_no: string;
  provider_trade_no: string | null;
  status: string;
  amount_minor: number | null;
};

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] || null) : null;
}

const apply = process.argv.includes('--apply');
const orderNoArg = arg('order');
const tradeNoArg = arg('trade');
const days = Math.max(1, Math.min(365, Number(arg('days') || 14)));
const limit = Math.max(1, Math.min(1000, Number(arg('limit') || 200)));

function describeCode(code: string): string {
  switch (code) {
    case 'PAID': return 'settled now, credits granted';
    case 'IDEMPOTENT_REPLAY': return 'already settled earlier, nothing changed';
    case 'ORDER_NOT_FOUND': return 'billing_orders has no such order_no';
    case 'PAYMENT_ATTEMPT_NOT_FOUND': return 'payment_attempts has no matching merchant_order_no';
    case 'PAYMENT_AMOUNT_MISMATCH': return 'channel amount != order amount, refused';
    case 'ORDER_ALREADY_REFUNDED': return 'order was refunded, refused (migration 0133)';
    case 'ORDER_NOT_PAYABLE': return 'old RPC still rejects this order status; apply migration 0133';
    case 'INVALID_PAYMENT_CONFIRMATION': return 'missing order_no/provider/merchant_order_no';
    default: return '';
  }
}

async function main() {
  const client = getSupabaseClient();
  console.log(`[reconcile] mode=${apply ? 'APPLY' : 'DRY-RUN'} days=${days} limit=${limit} order=${orderNoArg || '-'} trade=${tradeNoArg || '-'}`);

  let orderQuery = client
    .from('billing_orders')
    .select('id,order_no,status,provider,amount_minor,credits_granted,user_id,created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (orderNoArg) orderQuery = orderQuery.eq('order_no', orderNoArg);
  else orderQuery = orderQuery.in('status', ['pending', 'created', 'expired', 'cancelled', 'failed']).gte('created_at', new Date(Date.now() - days * 86400_000).toISOString());
  const { data: orders, error } = await orderQuery;
  if (error) throw new Error(error.message);

  const attemptQuery = client
    .from('payment_attempts')
    .select('id,order_id,provider,channel,merchant_order_no,provider_trade_no,status,amount_minor')
    .eq('provider', 'alipay');
  const { data: attempts, error: attemptError } = tradeNoArg
    ? await attemptQuery.eq('provider_trade_no', tradeNoArg)
    : await attemptQuery.order('created_at', { ascending: false }).limit(1000);
  if (attemptError) throw new Error(attemptError.message);

  const attemptByOrder = new Map<number, AttemptRow>();
  for (const attempt of (attempts || []) as AttemptRow[]) attemptByOrder.set(attempt.order_id, attempt);

  const targets: Array<{ order: OrderRow; attempt: AttemptRow }> = [];
  if (tradeNoArg) {
    for (const order of (orders || []) as OrderRow[]) {
      const attempt = attemptByOrder.get(order.id);
      if (attempt) targets.push({ order, attempt });
    }
  } else {
    for (const order of (orders || []) as OrderRow[]) {
      const attempt = attemptByOrder.get(order.id);
      if (attempt) targets.push({ order, attempt });
    }
  }

  if (!targets.length) {
    console.log('[reconcile] no candidate orders. If you know the Alipay trade_no, pass --trade <trade_no>.');
    return;
  }

  const provider = getBillingProvider('alipay');
  let failed = 0;

  for (const { order, attempt } of targets) {
    // The pre-fix code called the cashier with a merchant order number that was
    // never written to billing_orders, so querying with order.order_no can
    // legitimately return TRADE_NOT_EXIST. Try every plausible number.
    const candidates = orderLookupCandidates(order.order_no, attempt);
    console.log(`\n[reconcile] order=${order.order_no} status=${order.status} attempt_status=${attempt.status} merchant_no=${attempt.merchant_order_no} candidates=${candidates.join(',') || 'none'}`);

    let matched: { status: string; amountMinor?: number | null; providerTradeNo?: string | null; merchantOrderNo: string } | null = null;
    for (const merchantOrderNo of candidates) {
      try {
        const result = await provider.queryPayment({
          merchantOrderNo,
          providerTradeNo: attempt.provider_trade_no || undefined,
        });
        console.log(`  query(${merchantOrderNo}) -> ${result.status} amountMinor=${result.amountMinor} tradeNo=${result.providerTradeNo}`);
        if (result.status === 'paid') {
          matched = { status: result.status, amountMinor: result.amountMinor, providerTradeNo: result.providerTradeNo, merchantOrderNo };
          break;
        }
        const mapped = alipayTradeStatusFromOrder(result.status);
        console.log(`  query(${merchantOrderNo}) not paid (${mapped})`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`  query(${merchantOrderNo}) failed: ${message}`);
      }
    }

    if (!matched) {
      console.log('  => channel says not paid; nothing to do');
      continue;
    }

    const localAmount = Number(order.amount_minor || 0);
    const channelAmount = matched.amountMinor ?? 0;
    if (!localAmount || !channelAmount) {
      console.error('  => paid but amount evidence is incomplete; refusing to settle without amount');
      failed += 1;
      continue;
    }
    // AliPay must report exactly the amount we charged. A different number means
    // either a currency/price drift or a forged event: report it instead of
    // silently granting credits for an unverified amount.
    if (channelAmount !== localAmount) {
      console.error(`  => AMOUNT MISMATCH channel=${channelAmount} local=${localAmount}; not settling automatically. Check the Alipay bill and fix the plan price first.`);
      failed += 1;
      continue;
    }
    const settleAmount = shouldAdoptChannelPaidAmount(localAmount, channelAmount) ? channelAmount : localAmount;

    if (!apply) {
      console.log(`  => DRY-RUN would settle order=${order.order_no} amount=${localAmount} merchant_no=${matched.merchantOrderNo}`);
      continue;
    }

    // Keep the attempt row pointing at the number the channel actually knows,
    // otherwise complete_billing_order cannot find payment_attempts.
    if (matched.merchantOrderNo !== attempt.merchant_order_no) {
      const { error: updateError } = await client
        .from('payment_attempts')
        .update({ merchant_order_no: matched.merchantOrderNo, updated_at: new Date().toISOString() })
        .eq('id', attempt.id);
      if (updateError) {
        console.error(`  => could not repoint attempt: ${updateError.message}`);
        failed += 1;
        continue;
      }
      console.log(`  => attempt merchant_order_no repointed: ${attempt.merchant_order_no} -> ${matched.merchantOrderNo}`);
    }

    try {
      const result = await settleBillingEvent('alipay', {
        eventId: `reconcile:${order.order_no}:${matched.providerTradeNo || matched.merchantOrderNo}`,
        eventType: 'reconcile',
        merchantOrderNo: matched.merchantOrderNo,
        providerTradeNo: matched.providerTradeNo || null,
        status: 'paid',
        amountMinor: settleAmount,
        payload: { source: 'reconcile-script', orderNo: order.order_no },
      });
      console.log(`  => settle result: ${result.code} ${describeCode(result.code)}`);
      if (!['PAID', 'IDEMPOTENT_REPLAY'].includes(result.code)) failed += 1;
    } catch (error) {
      console.error(`  => settle failed: ${error instanceof Error ? error.message : error}`);
      failed += 1;
    }
  }

  console.log(`\n[reconcile] done. targets=${targets.length} failed=${failed}`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[reconcile] fatal:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

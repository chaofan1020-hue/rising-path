import { getSupabaseClient } from '@/storage/database/supabase-client';

/**
 * Read-only detail dump for one order: order row, payment attempts, webhook
 * events and credit ledger. Never writes.
 *
 *   DOTENV_CONFIG_PATH=.env.production.local pnpm exec tsx scripts/inspect-billing-order.ts LVMVYYP0ZEFF32E63FFB
 */
async function main() {
  const orderNo = process.argv[2];
  if (!orderNo) throw new Error('usage: inspect-billing-order.ts <order_no> [<order_no>...]');
  const client = getSupabaseClient();

  for (const target of process.argv.slice(2)) {
    const { data: order } = await client.from('billing_orders').select('*').eq('order_no', target).maybeSingle();
    console.log(`\n=== order ${target} ===`);
    if (!order) { console.log('  not found'); continue; }
    const { metadata, ...rest } = order as Record<string, unknown>;
    console.log('  ' + JSON.stringify(rest));
    console.log('  metadata=' + JSON.stringify(metadata));

    const { data: attempts } = await client.from('payment_attempts').select('*').eq('order_id', (rest as { id: number }).id);
    for (const attempt of attempts || []) {
      const { provider_payload, ...others } = attempt as Record<string, unknown>;
      console.log('  attempt ' + JSON.stringify(others));
      console.log('    provider_payload=' + JSON.stringify(provider_payload));
    }

    const { data: events } = await client
      .from('billing_webhook_events')
      .select('id,provider,event_id,event_type,status,result,payload,received_at,processed_at')
      .or(`event_id.ilike.%${target}%,payload->>merchantOrderNo.eq.${target}`);
    for (const event of events || []) console.log('  webhook ' + JSON.stringify(event));

    const { data: ledger } = await client
      .from('credit_ledger')
      .select('id,entry_type,delta,reason,idempotency_key,created_at')
      .ilike('idempotency_key', `billing:order:${(rest as { id: number }).id}`);
    for (const entry of ledger || []) console.log('  ledger ' + JSON.stringify(entry));
  }
}

main().catch((error) => { console.error('fatal:', error instanceof Error ? error.message : error); process.exitCode = 1; });

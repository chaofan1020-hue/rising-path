import { AlipayProvider } from '@/lib/alipay-provider';

/**
 * Read-only: asks Alipay for the real trade status of one or more merchant
 * order numbers. `alipay.trade.query` never changes state.
 *
 *   DOTENV_CONFIG_PATH=.env.production.local pnpm exec tsx scripts/query-alipay-trade.ts LVMVYYP0ZE73DF8BC337
 *
 * Use it to prove whether the buyer actually paid before any backfill.
 */
async function main() {
  const targets = process.argv.slice(2).filter((value) => value && !value.startsWith('-'));
  if (!targets.length) throw new Error('usage: query-alipay-trade.ts <out_trade_no> [...]');
  const provider = new AlipayProvider();
  console.log(`querying ${targets.length} merchant order number(s)`);
  for (const merchantOrderNo of targets) {
    try {
      const result = await provider.queryPayment({ merchantOrderNo });
      console.log(`  ${merchantOrderNo} -> status=${result.status} amountMinor=${result.amountMinor} tradeNo=${result.providerTradeNo || '-'}`);
    } catch (error) {
      console.log(`  ${merchantOrderNo} -> ERROR ${error instanceof Error ? error.message : error}`);
    }
  }
}

main().catch((error) => { console.error('fatal:', error instanceof Error ? error.message : error); process.exitCode = 1; });

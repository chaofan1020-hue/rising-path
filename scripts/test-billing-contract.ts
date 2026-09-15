import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (relativePath: string) => readFileSync(resolve(root, relativePath), 'utf8');

const settlement = read('src/lib/billing-settlement.ts');
assert.match(settlement, /event\.status !== 'paid'/, 'non-paid callbacks must not settle credits');
assert.match(settlement, /complete_billing_order/, 'webhooks must settle through the database transaction');
assert.match(settlement, /REPLAYABLE_WEBHOOK_STATUSES/, 'failed and interrupted webhook events must be retryable');
assert.match(settlement, /status: 'received'/, 'retry must reopen failed webhook events');

const completionSql = read('supabase/migrations/0117_payment_order_settlement.sql');
assert.match(completionSql, /billing_order\.amount_minor is distinct from p_amount_minor/, 'payment amount must be checked server-side');
assert.match(completionSql, /billing:order:/, 'credit settlement must use an order-scoped idempotency key');
assert.match(completionSql, /billing_order\.status = 'paid'/, 'paid orders must be idempotent');
assert.match(completionSql, /status not in \('pending', 'created'\)/, 'closed orders must reject payment confirmation');

const refundSql = read('supabase/migrations/0118_billing_refund_settlement.sql');
assert.match(refundSql, /for update/, 'refund preparation must lock the order/account');
assert.match(refundSql, /CREDIT_BALANCE_INSUFFICIENT/, 'refund must stop when the user has already spent the credits');
assert.match(refundSql, /partially_refunded/, 'refund must reserve a distinct intermediate state');
assert.match(refundSql, /ROLLBACK_COMPLETE/, 'provider refund failure must restore credits');

const creditsSql = read('supabase/migrations/0064_unified_credits.sql');
assert.match(creditsSql, /unique \(user_id, idempotency_key\)/i, 'credit ledger idempotency must remain enforced');

const hardeningSql = read('supabase/migrations/0119_billing_payment_hardening.sql');
assert.match(hardeningSql, /billing_orders_one_open_per_user_uidx/, 'one open checkout per user must be enforced');
assert.match(hardeningSql, /cancelled', 'expired', 'failed/, 'delayed paid callbacks must still settle after local cancel/expiry');
assert.match(hardeningSql, /complete_billing_refund/, 'refund callbacks must settle through a database function');

const ordersRoute = read('src/app/api/billing/orders/route.ts');
assert.match(ordersRoute, /wechat_h5/);
assert.match(ordersRoute, /alipay_wap/);
assert.match(ordersRoute, /CLIENT_IP_REQUIRED/);
assert.match(ordersRoute, /subscription/);
assert.match(ordersRoute, /AMOUNT_NOT_CLIENT_SETTABLE/, 'checkout must reject client-submitted prices');
assert.match(ordersRoute, /display_amount_minor/, 'orders must snapshot the USD catalog amount without charging it');
assert.match(ordersRoute, /planCatalogUsdCents/, 'order USD snapshots must come from the stored catalog price');
assert.doesNotMatch(ordersRoute, /cnyFenToUsdCents/, 'orders must not convert CNY into a live USD quote');

const plansRoute = read('src/app/api/billing/plans/route.ts');
assert.match(plansRoute, /displayAmountMinor/, 'catalog USD amounts must be returned by the server');
assert.match(plansRoute, /planCatalogUsdCents/, 'catalog USD must use the stored plan price');
assert.doesNotMatch(plansRoute, /cnyFenToUsdCents/, 'catalog USD must not be derived from CNY at request time');

const catalogSql = read('supabase/migrations/0120_billing_usd_catalog.sql');
assert.match(catalogSql, /display_amount_minor/, 'plans must store a fixed USD catalog price');
assert.match(catalogSql, /699/, 'explorer catalog price must be a fixed USD amount');

const settlementService = read('src/lib/billing-order-service.ts');
assert.match(settlementService, /merchant_order_no/, 'status sync must use the payment attempt merchant order no');
assert.match(settlementService, /amountMinor/, 'status sync must require a provider amount');

console.log('billing contract tests passed');

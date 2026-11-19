import assert from 'node:assert/strict';
import { orderLookupCandidates, alipayTradeStatusFromOrder, shouldAdoptChannelPaidAmount } from '../src/lib/billing-reconcile';

// Historical attempts carry the out_trade_no that was actually sent to Alipay,
// and it may differ from billing_orders.order_no. Both must be queried.
assert.deepEqual(orderLookupCandidates('LVORDER', { merchant_order_no: 'LVMERCHANT', provider_trade_no: null }), ['LVMERCHANT', 'LVORDER']);
assert.deepEqual(orderLookupCandidates('LVORDER', { merchant_order_no: 'LVORDER', provider_trade_no: null }), ['LVORDER']);
assert.deepEqual(orderLookupCandidates('LVORDER', null), ['LVORDER']);
assert.deepEqual(orderLookupCandidates(null, { merchant_order_no: 'LVMERCHANT', provider_trade_no: null }), ['LVMERCHANT']);
assert.deepEqual(orderLookupCandidates('  ', { merchant_order_no: '', provider_trade_no: null }), []);

// TRADE_CLOSED covers both "never paid" and "paid then refunded"; only the
// refund path may be reported as refunded.
assert.equal(alipayTradeStatusFromOrder('paid'), 'paid');
assert.equal(alipayTradeStatusFromOrder('refunded'), 'refunded');
assert.equal(alipayTradeStatusFromOrder('partially_refunded'), 'refunded');
assert.equal(alipayTradeStatusFromOrder('cancelled'), 'closed');
assert.equal(alipayTradeStatusFromOrder('expired'), 'closed');
assert.equal(alipayTradeStatusFromOrder('pending'), 'pending');

// Amount evidence rules: never settle on 0 or on a non-integer.
assert.equal(shouldAdoptChannelPaidAmount(4900, 4900), false);
assert.equal(shouldAdoptChannelPaidAmount(4900, 4901), true);
assert.equal(shouldAdoptChannelPaidAmount(4900, 0), false);
assert.equal(shouldAdoptChannelPaidAmount(4900, null), false);
assert.equal(shouldAdoptChannelPaidAmount(4900, Number.NaN), false);

console.log('billing reconcile tests passed');

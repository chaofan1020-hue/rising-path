import assert from 'node:assert/strict';
import { channelsForSurface, detectBillingSurface, defaultChannelForSurface } from '../src/lib/billing-device';
import { cnyFenToUsdCents, DEFAULT_USD_CNY_RATE, formatCnyFen, formatUsdCents, getUsdCnyRate, orderDisplayUsdCents, planCatalogUsdCents } from '../src/lib/billing-fx';
import { qrSvgDataUrl } from '../src/lib/qr-svg';
import { alipayTimestamp, mapAlipayTradeStatus, mapWechatRefundState, mapWechatTradeState, shanghaiRfc3339, yuanToMinor } from '../src/lib/billing-status';

const shanghai = alipayTimestamp(new Date('2026-09-10T04:05:06.000Z'));
assert.match(shanghai, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
assert.equal(shanghai, '2026-09-10 12:05:06');
assert.doesNotMatch(shanghai, /Z/);

const expire = shanghaiRfc3339(new Date('2026-09-10T04:05:06.000Z'));
assert.equal(expire, '2026-09-10T12:05:06+08:00');

assert.equal(mapWechatTradeState('SUCCESS'), 'paid');
assert.equal(mapWechatTradeState('PAYERROR'), 'failed');
assert.equal(mapWechatTradeState('CLOSED'), 'cancelled');
assert.equal(mapWechatTradeState('NOTPAY'), 'pending');
assert.equal(mapWechatRefundState('SUCCESS'), 'refunded');
assert.equal(mapWechatRefundState('ABNORMAL'), 'failed');
assert.equal(mapAlipayTradeStatus('TRADE_SUCCESS'), 'paid');
assert.equal(mapAlipayTradeStatus('TRADE_CLOSED'), 'cancelled');
assert.equal(yuanToMinor('99.00'), 9900);
assert.equal(yuanToMinor('19.99'), 1999);
assert.equal(yuanToMinor(null), null);

const qr = qrSvgDataUrl('weixin://wxpay/bizpayurl?pr=test');
assert.match(qr, /^data:image\/svg\+xml/);
assert.match(qr, /%3Csvg/);
assert.match(qr, /rect/);

assert.equal(cnyFenToUsdCents(9900, 7.2), 1375);
assert.equal(cnyFenToUsdCents(0, 7.2), 0);
assert.equal(planCatalogUsdCents({ display_amount_minor: 1399, amount_minor: 9900 }), 1399);
assert.equal(planCatalogUsdCents({ display_amount_minor: 0, amount_minor: 0 }), 0);
assert.equal(planCatalogUsdCents({ amount_minor: 9900 }), 1375);
assert.equal(orderDisplayUsdCents({ display_amount_minor: 699 }, 4900), 699);
assert.equal(getUsdCnyRate(), DEFAULT_USD_CNY_RATE);
const previousRate = process.env.BILLING_USD_CNY_RATE;
process.env.BILLING_USD_CNY_RATE = '99';
assert.equal(getUsdCnyRate(), DEFAULT_USD_CNY_RATE);
if (previousRate === undefined) delete process.env.BILLING_USD_CNY_RATE;
else process.env.BILLING_USD_CNY_RATE = previousRate;
assert.match(formatUsdCents(1375, 'en').replace(/\s/g, ''), /13\.75/);
assert.match(formatCnyFen(9900, 'zh-CN').replace(/\s/g, ''), /99/);

assert.deepEqual(channelsForSurface('desktop'), ['wechat_native', 'alipay_qr']);
assert.deepEqual(channelsForSurface('mobile'), ['wechat_h5', 'alipay_wap']);
assert.equal(detectBillingSurface({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }), 'desktop');
assert.equal(detectBillingSurface({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }), 'mobile');
assert.equal(detectBillingSurface({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }), 'mobile');
assert.equal(defaultChannelForSurface('desktop', { wechat: true, alipay: true }), 'wechat_native');
assert.equal(defaultChannelForSurface('mobile', { wechat: true, alipay: true }), 'wechat_h5');
assert.equal(defaultChannelForSurface('desktop', { wechat: false, alipay: true }), 'alipay_qr');

console.log('billing payment tests passed');

import assert from 'node:assert/strict';
import { getBillingReadiness } from '../src/lib/billing-config';

const names = [
  'BILLING_ENABLED', 'WECHAT_PAY_ENABLED', 'ALIPAY_ENABLED', 'WECHAT_PAY_MCH_ID', 'WECHAT_PAY_APP_ID',
  'WECHAT_PAY_SERIAL_NO', 'WECHAT_PAY_PRIVATE_KEY', 'WECHAT_PAY_API_V3_KEY', 'WECHAT_PAY_NOTIFY_URL',
  'WECHAT_PAY_PLATFORM_CERTIFICATE', 'WECHAT_PAY_PLATFORM_PUBLIC_KEY', 'ALIPAY_APP_ID', 'ALIPAY_PRIVATE_KEY',
  'ALIPAY_PUBLIC_KEY', 'ALIPAY_NOTIFY_URL',
];
const previous = new Map(names.map((name) => [name, process.env[name]]));

try {
  for (const name of names) delete process.env[name];
  let readiness = getBillingReadiness();
  assert.equal(readiness.checkoutReady, false);
  assert.equal(readiness.wechat.enabled, false);
  assert.ok(readiness.wechat.missing.includes('WECHAT_PAY_MCH_ID'));

  process.env.BILLING_ENABLED = 'true';
  process.env.WECHAT_PAY_ENABLED = 'true';
  for (const name of ['WECHAT_PAY_MCH_ID', 'WECHAT_PAY_APP_ID', 'WECHAT_PAY_SERIAL_NO', 'WECHAT_PAY_PRIVATE_KEY', 'WECHAT_PAY_API_V3_KEY', 'WECHAT_PAY_NOTIFY_URL', 'WECHAT_PAY_PLATFORM_PUBLIC_KEY']) process.env[name] = 'configured';
  process.env.WECHAT_PAY_NOTIFY_URL = 'https://example.com/api/payments/wechat/notify';
  readiness = getBillingReadiness();
  assert.equal(readiness.wechat.configured, true);
  assert.equal(readiness.checkoutReady, true);

  process.env.WECHAT_PAY_NOTIFY_URL = 'http://localhost:5000/api/payments/wechat/notify';
  readiness = getBillingReadiness();
  assert.equal(readiness.wechat.configured, false);
  assert.ok(readiness.wechat.warnings.some((warning) => warning.includes('HTTPS')));
} finally {
  for (const name of names) {
    const value = previous.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

console.log('billing readiness tests passed');


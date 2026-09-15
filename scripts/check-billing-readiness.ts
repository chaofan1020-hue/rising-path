import dotenv from 'dotenv';
import process from 'node:process';
import { getBillingReadiness } from '../src/lib/billing-config';

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || '.env.local', quiet: true });

const readiness = getBillingReadiness();
const output = {
  enabled: readiness.enabled,
  defaultCurrency: readiness.defaultCurrency,
  checkoutReady: readiness.checkoutReady,
  wechat: { enabled: readiness.wechat.enabled, configured: readiness.wechat.configured, missing: readiness.wechat.missing, warnings: readiness.wechat.warnings },
  alipay: { enabled: readiness.alipay.enabled, configured: readiness.alipay.configured, missing: readiness.alipay.missing, warnings: readiness.alipay.warnings },
};
console.log(JSON.stringify(output, null, 2));

const enabledProviders = [readiness.wechat, readiness.alipay].filter((provider) => provider.enabled);
if (enabledProviders.some((provider) => !provider.configured)) {
  process.exitCode = 1;
}


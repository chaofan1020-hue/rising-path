export type BillingCurrency = 'CNY' | 'USD';

export type BillingProviderReadiness = {
  enabled: boolean;
  configured: boolean;
  missing: string[];
  warnings: string[];
};

function envBoolean(name: string, fallback = false): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return value === 'true' || value === '1' || value === 'yes';
}

/** Payment stays disabled until merchant credentials and callback verification are configured. */
export function getBillingConfig() {
  const currency = process.env.BILLING_DEFAULT_CURRENCY?.trim().toUpperCase();
  return {
    enabled: envBoolean('BILLING_ENABLED'),
    defaultCurrency: currency === 'USD' ? 'USD' as const : 'CNY' as const,
    wechatEnabled: envBoolean('WECHAT_PAY_ENABLED'),
    alipayEnabled: envBoolean('ALIPAY_ENABLED'),
  };
}

function hasValue(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function isHttpsUrl(name: string): boolean {
  try {
    const value = process.env[name]?.trim();
    return Boolean(value && new URL(value).protocol === 'https:');
  } catch {
    return false;
  }
}

/**
 * Preflight only. It exposes variable names and safety warnings, never secret values.
 * Keep this server-side so production can validate before opening checkout.
 */
export function getBillingReadiness() {
  const config = getBillingConfig();
  const wechatMissing = ['WECHAT_PAY_MCH_ID', 'WECHAT_PAY_APP_ID', 'WECHAT_PAY_SERIAL_NO', 'WECHAT_PAY_PRIVATE_KEY', 'WECHAT_PAY_API_V3_KEY', 'WECHAT_PAY_NOTIFY_URL']
    .filter((name) => !hasValue(name));
  const alipayMissing = ['ALIPAY_APP_ID', 'ALIPAY_PRIVATE_KEY', 'ALIPAY_PUBLIC_KEY', 'ALIPAY_NOTIFY_URL', 'ALIPAY_RETURN_URL']
    .filter((name) => !hasValue(name));
  const wechatWarnings: string[] = [];
  const alipayWarnings: string[] = [];
  if (!hasValue('WECHAT_PAY_PLATFORM_CERTIFICATE') && !hasValue('WECHAT_PAY_PLATFORM_PUBLIC_KEY')) wechatMissing.push('WECHAT_PAY_PLATFORM_CERTIFICATE or WECHAT_PAY_PLATFORM_PUBLIC_KEY');
  if (hasValue('WECHAT_PAY_NOTIFY_URL') && !isHttpsUrl('WECHAT_PAY_NOTIFY_URL')) wechatWarnings.push('WECHAT_PAY_NOTIFY_URL must use HTTPS');
  if (hasValue('ALIPAY_NOTIFY_URL') && !isHttpsUrl('ALIPAY_NOTIFY_URL')) alipayWarnings.push('ALIPAY_NOTIFY_URL must use HTTPS');
  const wechat: BillingProviderReadiness = { enabled: config.enabled && config.wechatEnabled, configured: wechatMissing.length === 0 && wechatWarnings.length === 0, missing: wechatMissing, warnings: wechatWarnings };
  const alipay: BillingProviderReadiness = { enabled: config.enabled && config.alipayEnabled, configured: alipayMissing.length === 0 && alipayWarnings.length === 0, missing: alipayMissing, warnings: alipayWarnings };
  // The handoff secret signs every checkout ticket and payment session. Without
  // it order creation succeeds but /pay/checkout fails, so it belongs in the
  // same preflight list instead of surfacing as a 502 later.
  if (!hasValue('PAYMENT_HANDOFF_SECRET')) {
    wechatMissing.push('PAYMENT_HANDOFF_SECRET');
    alipayMissing.push('PAYMENT_HANDOFF_SECRET');
  } else if ((process.env.PAYMENT_HANDOFF_SECRET || '').trim().length < 32) {
    wechatWarnings.push('PAYMENT_HANDOFF_SECRET must be at least 32 characters');
    alipayWarnings.push('PAYMENT_HANDOFF_SECRET must be at least 32 characters');
  }
  const handoffReady = hasValue('PAYMENT_HANDOFF_SECRET') && (process.env.PAYMENT_HANDOFF_SECRET || '').trim().length >= 32;
  return {
    enabled: config.enabled,
    defaultCurrency: config.defaultCurrency,
    checkoutReady: handoffReady && (wechat.enabled && wechat.configured || alipay.enabled && alipay.configured),
    handoffReady,
    wechat,
    alipay,
  };
}

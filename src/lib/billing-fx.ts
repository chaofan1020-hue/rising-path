import type { Locale } from '@/lib/language-context';

export const BILLING_CHARGE_CURRENCY = 'CNY' as const;
export const BILLING_DISPLAY_CURRENCY = 'USD' as const;
export const DEFAULT_USD_CNY_RATE = 7.2;

function localeTag(locale: Locale | string): string {
  if (locale === 'zh-TW') return 'zh-TW';
  if (locale === 'zh-CN') return 'zh-CN';
  return 'en-US';
}

/** Fallback quote only. Catalog USD is stored on billing_plans.display_amount_minor. */
export function getUsdCnyRate(): number {
  const raw = process.env.BILLING_USD_CNY_RATE?.trim();
  if (!raw) return DEFAULT_USD_CNY_RATE;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 5 || value > 10) return DEFAULT_USD_CNY_RATE;
  return value;
}

export function cnyFenToUsdCents(cnyFen: number, usdCnyRate = getUsdCnyRate()): number {
  if (!Number.isFinite(cnyFen) || cnyFen <= 0) return 0;
  const rate = Number.isFinite(usdCnyRate) && usdCnyRate >= 5 && usdCnyRate <= 10 ? usdCnyRate : DEFAULT_USD_CNY_RATE;
  return Math.round(cnyFen / rate);
}

export function planCatalogUsdCents(plan: {
  display_amount_minor?: number | string | null;
  displayAmountMinor?: number | string | null;
  amount_minor?: number | string | null;
  amountMinor?: number | string | null;
}): number {
  const raw = plan.display_amount_minor ?? plan.displayAmountMinor;
  if (raw != null && raw !== '') {
    const stored = Number(raw);
    if (Number.isSafeInteger(stored) && stored >= 0) return stored;
  }
  return cnyFenToUsdCents(Number(plan.amount_minor ?? plan.amountMinor ?? 0));
}

export function orderDisplayUsdCents(metadata: Record<string, unknown> | null | undefined, amountMinor = 0): number | null {
  const stored = Number(metadata?.display_amount_minor);
  if (Number.isSafeInteger(stored) && stored >= 0) return stored;
  if (amountMinor > 0) return cnyFenToUsdCents(amountMinor);
  return null;
}

export function formatUsdCents(cents: number, locale: Locale | string = 'en'): string {
  return new Intl.NumberFormat(localeTag(locale), { style: 'currency', currency: 'USD' }).format(Number(cents || 0) / 100);
}

export function formatCnyFen(fen: number, locale: Locale | string = 'zh-CN'): string {
  return new Intl.NumberFormat(localeTag(locale), { style: 'currency', currency: 'CNY' }).format(Number(fen || 0) / 100);
}

export function getBillingDisplayQuote() {
  const usdCnyRate = getUsdCnyRate();
  return {
    displayCurrency: BILLING_DISPLAY_CURRENCY,
    chargeCurrency: BILLING_CHARGE_CURRENCY,
    usdCnyRate,
  };
}

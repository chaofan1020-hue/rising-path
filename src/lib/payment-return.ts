export const PAYMENT_RETURN_PATHS = ['/pricing', '/account/billing'] as const;
export type PaymentReturnPath = typeof PAYMENT_RETURN_PATHS[number];

export function normalizePaymentReturnPath(value: unknown): PaymentReturnPath {
  return PAYMENT_RETURN_PATHS.includes(value as PaymentReturnPath) ? value as PaymentReturnPath : '/account/billing';
}

export function paymentReturnUrl(value: unknown): string {
  const url = new URL(normalizePaymentReturnPath(value), 'https://liorvix.com');
  url.searchParams.set('payment_return', '1');
  return url.toString();
}

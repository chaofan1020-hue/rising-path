/**
 * Helpers shared by the reconciliation script and the admin replay action.
 *
 * Historical orders created before the order-number fix called Alipay with a
 * merchant order number (out_trade_no) that was never persisted on
 * billing_orders. Those payments can only be found again by trying every
 * number we might have sent.
 */

export type LookupAttempt = {
  merchant_order_no: string | null;
  provider_trade_no: string | null;
};

/** Ordered, de-duplicated list of out_trade_no values worth querying. */
export function orderLookupCandidates(orderNo: string | null | undefined, attempt: LookupAttempt | null | undefined): string[] {
  const values = [attempt?.merchant_order_no, orderNo].filter((value): value is string => Boolean(value && value.trim()));
  return Array.from(new Set(values));
}

/**
 * Alipay returns TRADE_CLOSED for both "buyer never paid" and "paid then fully
 * refunded". Only the refunded case carries refund_fee > 0.
 */
export function alipayTradeStatusFromOrder(status: string): 'paid' | 'closed' | 'pending' | 'refunded' {
  if (status === 'paid') return 'paid';
  if (status === 'refunded' || status === 'partially_refunded') return 'refunded';
  if (status === 'cancelled' || status === 'expired') return 'closed';
  return 'pending';
}

/**
 * Trust the channel amount only when it is a positive integer; otherwise fall
 * back to the amount stored on the order so settlement never runs with 0.
 */
export function shouldAdoptChannelPaidAmount(localAmountMinor: number, channelAmountMinor: number | null | undefined): boolean {
  return Number.isSafeInteger(channelAmountMinor) && (channelAmountMinor as number) > 0 && channelAmountMinor !== localAmountMinor;
}

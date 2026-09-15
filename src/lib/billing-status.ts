export function alipayTimestamp(date = new Date()): string {
  return date.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hourCycle: 'h23' });
}

export function shanghaiRfc3339(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || '00';
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}:${value('second')}+08:00`;
}

export function paymentExpiryDate(minutes = 120): Date {
  return new Date(Date.now() + minutes * 60_000);
}

export function mapWechatTradeState(value: unknown): 'paid' | 'failed' | 'cancelled' | 'refunded' | 'pending' {
  if (value === 'SUCCESS') return 'paid';
  if (value === 'PAYERROR') return 'failed';
  if (value === 'CLOSED' || value === 'REVOKED') return 'cancelled';
  if (value === 'REFUND') return 'refunded';
  return 'pending';
}

export function mapWechatRefundState(value: unknown): 'paid' | 'failed' | 'cancelled' | 'refunded' | 'pending' {
  if (value === 'SUCCESS') return 'refunded';
  if (value === 'ABNORMAL' || value === 'CLOSED') return 'failed';
  return 'pending';
}

export function mapAlipayTradeStatus(value: unknown): 'paid' | 'failed' | 'cancelled' | 'refunded' | 'pending' {
  if (value === 'TRADE_SUCCESS' || value === 'TRADE_FINISHED') return 'paid';
  if (value === 'TRADE_CLOSED') return 'cancelled';
  return 'pending';
}

export function yuanToMinor(value: unknown): number | null {
  if (value == null || value === '') return null;
  const amount = Math.round(Number(value) * 100);
  return Number.isSafeInteger(amount) ? amount : null;
}

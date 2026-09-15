import type { BillingPaymentChannel } from '@/lib/billing-provider';

export type BillingSurface = 'desktop' | 'mobile';

const MOBILE_UA = /iPhone|iPod|Android.+Mobile|webOS|BlackBerry|IEMobile|Opera Mini|Mobile/i;
const TABLET_UA = /iPad|Android(?!.*Mobile)|Tablet/i;

export function detectBillingSurface(input: { userAgent?: string; maxTouchPoints?: number } = {}): BillingSurface {
  const userAgent = input.userAgent || '';
  if (MOBILE_UA.test(userAgent) || TABLET_UA.test(userAgent)) return 'mobile';
  // iPadOS 13+ desktop UA still has touch points.
  if (/Macintosh/i.test(userAgent) && (input.maxTouchPoints || 0) > 1) return 'mobile';
  return 'desktop';
}

export function readBrowserBillingSurface(): BillingSurface {
  if (typeof navigator === 'undefined') return 'desktop';
  return detectBillingSurface({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
  });
}

export function channelsForSurface(surface: BillingSurface): BillingPaymentChannel[] {
  return surface === 'mobile' ? ['wechat_h5', 'alipay_wap'] : ['wechat_native', 'alipay_qr'];
}

export function defaultChannelForSurface(
  surface: BillingSurface,
  availability: { wechat: boolean; alipay: boolean },
): BillingPaymentChannel {
  const channels = channelsForSurface(surface);
  const wechat = channels.find((channel) => channel.startsWith('wechat_'));
  const alipay = channels.find((channel) => channel.startsWith('alipay_'));
  if (availability.wechat && wechat) return wechat;
  if (availability.alipay && alipay) return alipay;
  return channels[0];
}

export function isChannelAllowedOnSurface(channel: BillingPaymentChannel, surface: BillingSurface): boolean {
  return channelsForSurface(surface).includes(channel);
}

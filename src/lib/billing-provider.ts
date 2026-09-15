import type { BillingCurrency } from '@/lib/billing-config';
import { getBillingConfig } from '@/lib/billing-config';
import { AlipayProvider } from '@/lib/alipay-provider';
import { WechatPayProvider } from '@/lib/wechat-pay-provider';
import { BillingProviderDisabledError } from '@/lib/billing-errors';

export { BillingProviderDisabledError } from '@/lib/billing-errors';

export type BillingProviderName = 'manual_beta' | 'wechat' | 'alipay';
export type BillingPaymentChannel = 'wechat_native' | 'wechat_h5' | 'wechat_jsapi' | 'alipay_qr' | 'alipay_wap' | 'manual';
export type BillingPaymentStatus = 'created' | 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded' | 'partially_refunded' | 'expired';

export interface BillingCheckoutRequest {
  userId: string;
  planCode: string;
  successUrl?: string;
  cancelUrl?: string;
}

export interface BillingPaymentRequest {
  userId: string;
  orderNo: string;
  planCode: string;
  amountMinor: number;
  currency: BillingCurrency;
  channel: BillingPaymentChannel;
  notifyUrl?: string;
  returnUrl?: string;
  clientIp?: string;
  description?: string;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface BillingPaymentSession {
  provider: BillingProviderName;
  channel: BillingPaymentChannel;
  merchantOrderNo: string;
  providerTradeNo?: string | null;
  qrCode?: string | null;
  redirectUrl?: string | null;
  status: BillingPaymentStatus;
  expiresAt?: string | null;
  enabled: boolean;
}

export interface BillingPaymentQuery {
  merchantOrderNo: string;
  providerTradeNo?: string;
}

export interface BillingPaymentQueryResult {
  status: BillingPaymentStatus;
  amountMinor?: number | null;
  providerTradeNo?: string | null;
}

export interface BillingRefundRequest extends BillingPaymentQuery {
  refundNo: string;
  amountMinor: number;
  totalAmountMinor?: number;
  reason?: string;
}

export interface BillingWebhookEvent {
  eventId: string;
  eventType: string;
  merchantOrderNo?: string | null;
  providerTradeNo?: string | null;
  status: BillingPaymentStatus;
  amountMinor?: number | null;
  payload: Record<string, unknown>;
}

export interface BillingCheckoutSession {
  provider: string;
  sessionId: string;
  checkoutUrl: string | null;
  enabled: boolean;
}

export interface BillingProvider {
  readonly name: BillingProviderName;
  createPaymentSession(input: BillingPaymentRequest): Promise<BillingPaymentSession>;
  queryPayment(input: BillingPaymentQuery): Promise<BillingPaymentQueryResult>;
  closePayment(input: BillingPaymentQuery): Promise<void>;
  refundPayment(input: BillingRefundRequest): Promise<{ status: BillingPaymentStatus; refundNo: string }>;
  queryRefund(input: { refundNo: string; merchantOrderNo: string }): Promise<BillingPaymentStatus>;
  verifyWebhook(headers: Headers, rawBody: string): Promise<BillingWebhookEvent>;
  /** Compatibility shim for the original provider contract. */
  createCheckoutSession(input: BillingCheckoutRequest): Promise<BillingCheckoutSession>;
}

/** Payment is deliberately disabled until the operating entity, market and provider are confirmed. */
export class ManualBetaBillingProvider implements BillingProvider {
  readonly name = 'manual_beta' as const;

  async createPaymentSession(input: BillingPaymentRequest): Promise<BillingPaymentSession> {
    return {
      provider: this.name,
      channel: input.channel,
      merchantOrderNo: input.orderNo,
      providerTradeNo: null,
      qrCode: null,
      redirectUrl: null,
      status: 'created',
      expiresAt: null,
      enabled: false,
    };
  }

  async queryPayment(): Promise<BillingPaymentQueryResult> {
    return { status: 'created', amountMinor: null, providerTradeNo: null };
  }

  async closePayment(): Promise<void> {}

  async refundPayment(): Promise<never> {
    throw new BillingProviderDisabledError('manual_beta 不支持真实支付退款');
  }

  async queryRefund(): Promise<never> {
    throw new BillingProviderDisabledError('manual_beta 不支持真实支付退款查询');
  }

  async createCheckoutSession(): Promise<BillingCheckoutSession> {
    return { provider: this.name, sessionId: '', checkoutUrl: null, enabled: false };
  }

  async verifyWebhook(): Promise<never> {
    throw new BillingProviderDisabledError('manual_beta 不接收外部支付回调');
  }
}

export function getBillingAdapter(provider: BillingProviderName = 'manual_beta'): BillingProvider {
  if (provider === 'wechat') return new WechatPayProvider();
  if (provider === 'alipay') return new AlipayProvider();
  return new ManualBetaBillingProvider();
}

export function getBillingProvider(provider: BillingProviderName = 'manual_beta'): BillingProvider {
  if (provider === 'wechat') {
    if (!getBillingConfig().enabled || !getBillingConfig().wechatEnabled) {
      throw new BillingProviderDisabledError('微信支付渠道尚未启用');
    }
    return getBillingAdapter('wechat');
  }
  if (provider === 'alipay') {
    if (!getBillingConfig().enabled || !getBillingConfig().alipayEnabled) {
      throw new BillingProviderDisabledError('支付宝支付渠道尚未启用');
    }
    return getBillingAdapter('alipay');
  }
  return getBillingAdapter('manual_beta');
}

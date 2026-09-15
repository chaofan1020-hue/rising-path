import { createDecipheriv, createPrivateKey, createPublicKey, createSign, createVerify, randomBytes } from 'node:crypto';
import type {
  BillingPaymentQuery,
  BillingPaymentQueryResult,
  BillingPaymentRequest,
  BillingPaymentSession,
  BillingPaymentStatus,
  BillingProvider,
  BillingRefundRequest,
  BillingWebhookEvent,
} from '@/lib/billing-provider';
import { BillingProviderDisabledError } from '@/lib/billing-errors';
import { mapWechatRefundState, mapWechatTradeState, paymentExpiryDate, shanghaiRfc3339 } from '@/lib/billing-status';

const API_BASE = 'https://api.mch.weixin.qq.com';
const WEBHOOK_MAX_SKEW_SECONDS = 300;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new BillingProviderDisabledError(`缺少微信支付配置：${name}`);
  return value;
}

function pem(value: string): string {
  return value.replace(/\\n/g, '\n');
}

function requestPath(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

function signRequest(method: string, url: string, body: string): { authorization: string } {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(16).toString('hex');
  const message = `${method.toUpperCase()}\n${requestPath(url)}\n${timestamp}\n${nonce}\n${body}\n`;
  const signer = createSign('RSA-SHA256');
  signer.update(message);
  signer.end();
  const signature = signer.sign(createPrivateKey(pem(required('WECHAT_PAY_PRIVATE_KEY')))).toString('base64');
  const merchantId = required('WECHAT_PAY_MCH_ID');
  const serial = required('WECHAT_PAY_SERIAL_NO');
  return { authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${merchantId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${serial}"` };
}

async function requestWechat(method: string, path: string, body = ''): Promise<Record<string, unknown>> {
  const url = `${API_BASE}${path}`;
  const { authorization } = signRequest(method, url, body);
  const response = await fetch(url, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: authorization },
    body: body || undefined,
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try { data = JSON.parse(text) as Record<string, unknown>; } catch { throw new Error(`微信支付返回了无效 JSON（HTTP ${response.status}）`); }
  }
  if (!response.ok) throw new Error(`微信支付请求失败（HTTP ${response.status}）：${String(data.code || data.message || 'unknown')}`);
  return data;
}

function amountFrom(payload: Record<string, unknown> | undefined): number | null {
  const amount = payload?.amount;
  if (!amount || typeof amount !== 'object') return null;
  const total = Number((amount as { total?: number; refund?: number }).refund ?? (amount as { total?: number }).total);
  return Number.isSafeInteger(total) ? total : null;
}

export class WechatPayProvider implements BillingProvider {
  readonly name = 'wechat' as const;

  async createPaymentSession(input: BillingPaymentRequest): Promise<BillingPaymentSession> {
    if (input.channel !== 'wechat_native' && input.channel !== 'wechat_h5') throw new Error('当前阶段仅开放微信扫码和 H5 支付');
    if (input.channel === 'wechat_h5' && !input.clientIp) throw new Error('微信 H5 支付需要真实客户端 IP');
    const expiresAt = input.expiresAt || paymentExpiryDate(120);
    const payload = {
      appid: required('WECHAT_PAY_APP_ID'),
      mchid: required('WECHAT_PAY_MCH_ID'),
      description: (input.description || input.planCode).slice(0, 127),
      out_trade_no: input.orderNo,
      time_expire: shanghaiRfc3339(expiresAt),
      notify_url: input.notifyUrl || required('WECHAT_PAY_NOTIFY_URL'),
      amount: { total: input.amountMinor, currency: input.currency },
      ...(input.channel === 'wechat_h5' ? { scene_info: { payer_client_ip: input.clientIp, h5_info: { type: 'Wap' } } } : {}),
    };
    const data = await requestWechat('POST', input.channel === 'wechat_h5' ? '/v3/pay/transactions/h5' : '/v3/pay/transactions/native', JSON.stringify(payload));
    return {
      provider: this.name,
      channel: input.channel,
      merchantOrderNo: input.orderNo,
      qrCode: typeof data.code_url === 'string' ? data.code_url : null,
      redirectUrl: typeof data.h5_url === 'string' ? data.h5_url : null,
      status: 'pending',
      expiresAt: expiresAt.toISOString(),
      enabled: true,
    };
  }

  async queryPayment(input: BillingPaymentQuery): Promise<BillingPaymentQueryResult> {
    const data = await requestWechat('GET', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(input.merchantOrderNo)}?mchid=${encodeURIComponent(required('WECHAT_PAY_MCH_ID'))}`);
    return {
      status: mapWechatTradeState(data.trade_state),
      amountMinor: amountFrom(data),
      providerTradeNo: typeof data.transaction_id === 'string' ? data.transaction_id : null,
    };
  }

  async closePayment(input: BillingPaymentQuery): Promise<void> {
    try {
      await requestWechat('POST', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(input.merchantOrderNo)}/close`, JSON.stringify({ mchid: required('WECHAT_PAY_MCH_ID') }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('ORDERPAID') || message.includes('ORDER_PAID')) throw error;
      if (message.includes('ORDERCLOSED') || message.includes('ORDER_CLOSED')) return;
      throw error;
    }
  }

  async refundPayment(input: BillingRefundRequest): Promise<{ status: BillingPaymentStatus; refundNo: string }> {
    const body = JSON.stringify({
      out_trade_no: input.merchantOrderNo,
      out_refund_no: input.refundNo,
      reason: input.reason || '用户退款',
      notify_url: process.env.WECHAT_PAY_NOTIFY_URL?.trim() || undefined,
      amount: { refund: input.amountMinor, total: input.totalAmountMinor ?? input.amountMinor, currency: 'CNY' },
    });
    const data = await requestWechat('POST', '/v3/refund/domestic/refunds', body);
    const status = data.status === 'SUCCESS' ? 'refunded' : data.status === 'CLOSED' || data.status === 'ABNORMAL' ? 'failed' : 'pending';
    return { status, refundNo: input.refundNo };
  }

  async queryRefund(input: { refundNo: string }): Promise<BillingPaymentStatus> {
    const data = await requestWechat('GET', `/v3/refund/domestic/refunds/out-refund-no/${encodeURIComponent(input.refundNo)}`);
    return mapWechatRefundState(data.status);
  }

  async verifyWebhook(headers: Headers, rawBody: string): Promise<BillingWebhookEvent> {
    const timestamp = headers.get('wechatpay-timestamp');
    const nonce = headers.get('wechatpay-nonce');
    const signature = headers.get('wechatpay-signature');
    if (!timestamp || !nonce || !signature) throw new Error('微信支付回调缺少验签头');
    const timestampSeconds = Number(timestamp);
    if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > WEBHOOK_MAX_SKEW_SECONDS) {
      throw new Error('微信支付回调时间戳无效');
    }
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${timestamp}\n${nonce}\n${rawBody}\n`);
    verifier.end();
    const platformCertificate = process.env.WECHAT_PAY_PLATFORM_CERTIFICATE?.trim();
    const platformPublicKey = process.env.WECHAT_PAY_PLATFORM_PUBLIC_KEY?.trim();
    const key = platformCertificate || platformPublicKey;
    if (!key || !verifier.verify(createPublicKey(pem(key)), Buffer.from(signature, 'base64'))) throw new Error('微信支付回调验签失败');
    const envelope = JSON.parse(rawBody) as { id?: string; event_type?: string; resource?: { algorithm?: string; ciphertext?: string; nonce?: string; associated_data?: string } };
    const resource = envelope.resource;
    if (!resource || resource.algorithm !== 'AEAD_AES_256_GCM' || !resource.ciphertext || !resource.nonce) throw new Error('微信支付回调资源无效');
    const apiKey = required('WECHAT_PAY_API_V3_KEY');
    if (Buffer.byteLength(apiKey) !== 32) throw new Error('WECHAT_PAY_API_V3_KEY 必须是 32 字节');
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(apiKey), Buffer.from(resource.nonce));
    decipher.setAAD(Buffer.from(resource.associated_data || ''));
    const encrypted = Buffer.from(resource.ciphertext, 'base64');
    decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));
    const plaintext = Buffer.concat([decipher.update(encrypted.subarray(0, encrypted.length - 16)), decipher.final()]).toString('utf8');
    const payload = JSON.parse(plaintext) as Record<string, unknown>;
    const eventType = String(envelope.event_type || 'TRANSACTION.NOTIFY');
    const isRefund = eventType.includes('REFUND');
    return {
      eventId: String(envelope.id || `${payload.out_trade_no || ''}:${payload.transaction_id || payload.refund_id || ''}`),
      eventType,
      merchantOrderNo: typeof payload.out_trade_no === 'string' ? payload.out_trade_no : null,
      providerTradeNo: typeof payload.transaction_id === 'string' ? payload.transaction_id : null,
      status: isRefund ? mapWechatRefundState(payload.refund_status) : mapWechatTradeState(payload.trade_state),
      amountMinor: amountFrom(payload),
      payload,
    };
  }

  async createCheckoutSession() {
    return { provider: this.name, sessionId: '', checkoutUrl: null, enabled: false };
  }
}

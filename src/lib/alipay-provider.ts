import { createPrivateKey, createPublicKey, createSign, createVerify } from 'node:crypto';
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
import { alipayTimestamp, mapAlipayTradeStatus, paymentExpiryDate, yuanToMinor } from '@/lib/billing-status';

const DEFAULT_GATEWAY = 'https://openapi.alipay.com/gateway.do';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new BillingProviderDisabledError(`缺少支付宝配置：${name}`);
  return value;
}

function pem(value: string): string {
  return value.replace(/\\n/g, '\n');
}

function canonicalParams(params: Record<string, string>): string {
  return Object.keys(params).sort().filter((key) => params[key] !== '').map((key) => `${key}=${params[key]}`).join('&');
}

function signParams(params: Record<string, string>): string {
  const signer = createSign('RSA-SHA256');
  signer.update(canonicalParams(params), 'utf8');
  signer.end();
  return signer.sign(createPrivateKey(pem(required('ALIPAY_PRIVATE_KEY')))).toString('base64');
}

function verifyParams(params: Record<string, string>, signature: string): boolean {
  const verifier = createVerify('RSA-SHA256');
  verifier.update(canonicalParams(params), 'utf8');
  verifier.end();
  return verifier.verify(createPublicKey(pem(required('ALIPAY_PUBLIC_KEY'))), Buffer.from(signature, 'base64'));
}

function extractResponseJson(rawText: string, method: string): string {
  const responseKey = `${method.replaceAll('.', '_')}_response`;
  const startToken = `"${responseKey}"`;
  const start = rawText.indexOf(startToken);
  if (start < 0) throw new Error('支付宝响应缺少业务节点');
  const jsonStart = rawText.indexOf('{', start);
  if (jsonStart < 0) throw new Error('支付宝响应格式无效');
  let depth = 0;
  for (let index = jsonStart; index < rawText.length; index += 1) {
    const char = rawText[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return rawText.slice(jsonStart, index + 1);
    }
  }
  throw new Error('支付宝响应 JSON 不完整');
}

function verifyAlipayGatewayResponse(rawText: string, method: string): Record<string, unknown> {
  const envelope = JSON.parse(rawText) as Record<string, unknown>;
  const sign = typeof envelope.sign === 'string' ? envelope.sign : '';
  if (!sign) throw new Error('支付宝响应缺少签名');
  const content = extractResponseJson(rawText, method);
  const verifier = createVerify('RSA-SHA256');
  verifier.update(content, 'utf8');
  verifier.end();
  if (!verifier.verify(createPublicKey(pem(required('ALIPAY_PUBLIC_KEY'))), Buffer.from(sign, 'base64'))) {
    throw new Error('支付宝响应验签失败');
  }
  return JSON.parse(content) as Record<string, unknown>;
}

function signedParams(method: string, bizContent: Record<string, unknown>, extra: Record<string, string> = {}): Record<string, string> {
  const params: Record<string, string> = {
    app_id: required('ALIPAY_APP_ID'),
    method,
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: alipayTimestamp(),
    version: '1.0',
    biz_content: JSON.stringify(bizContent),
    ...extra,
  };
  params.sign = signParams(params);
  return params;
}

async function callAlipay(method: string, bizContent: Record<string, unknown>, notifyUrl?: string): Promise<Record<string, unknown>> {
  const extra: Record<string, string> = {};
  if (notifyUrl || process.env.ALIPAY_NOTIFY_URL) extra.notify_url = notifyUrl || required('ALIPAY_NOTIFY_URL');
  const params = signedParams(method, bizContent, extra);
  const response = await fetch(process.env.ALIPAY_GATEWAY_URL?.trim() || DEFAULT_GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`支付宝请求失败（HTTP ${response.status}）`);
  const result = verifyAlipayGatewayResponse(text, method);
  if (result.code !== '10000') throw new Error(`支付宝业务请求失败：${String(result.sub_code || result.sub_msg || result.msg || 'unknown')}`);
  return result;
}

function buildAlipayWapUrl(input: BillingPaymentRequest, expiresAt: Date): string {
  const timeoutMinutes = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 60000));
  const params = signedParams('alipay.trade.wap.pay', {
    out_trade_no: input.orderNo,
    total_amount: (input.amountMinor / 100).toFixed(2),
    subject: (input.description || input.planCode).slice(0, 256),
    product_code: 'QUICK_WAP_WAY',
    timeout_express: `${timeoutMinutes}m`,
  }, {
    notify_url: input.notifyUrl || required('ALIPAY_NOTIFY_URL'),
    return_url: input.returnUrl || required('ALIPAY_RETURN_URL'),
  });
  return `${process.env.ALIPAY_GATEWAY_URL?.trim() || DEFAULT_GATEWAY}?${new URLSearchParams(params).toString()}`;
}

export class AlipayProvider implements BillingProvider {
  readonly name = 'alipay' as const;

  async createPaymentSession(input: BillingPaymentRequest): Promise<BillingPaymentSession> {
    const expiresAt = input.expiresAt || paymentExpiryDate(120);
    const timeoutMinutes = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 60000));
    if (input.channel === 'alipay_wap') {
      return {
        provider: this.name,
        channel: input.channel,
        merchantOrderNo: input.orderNo,
        qrCode: null,
        redirectUrl: buildAlipayWapUrl(input, expiresAt),
        status: 'pending',
        expiresAt: expiresAt.toISOString(),
        enabled: true,
      };
    }
    if (input.channel !== 'alipay_qr') throw new Error('当前阶段仅开放支付宝扫码和 WAP 支付');
    const result = await callAlipay('alipay.trade.precreate', {
      out_trade_no: input.orderNo,
      total_amount: (input.amountMinor / 100).toFixed(2),
      subject: (input.description || input.planCode).slice(0, 256),
      timeout_express: `${timeoutMinutes}m`,
    }, input.notifyUrl);
    return {
      provider: this.name,
      channel: input.channel,
      merchantOrderNo: input.orderNo,
      qrCode: typeof result.qr_code === 'string' ? result.qr_code : null,
      redirectUrl: null,
      status: 'pending',
      expiresAt: expiresAt.toISOString(),
      enabled: true,
    };
  }

  async queryPayment(input: BillingPaymentQuery): Promise<BillingPaymentQueryResult> {
    const result = await callAlipay('alipay.trade.query', { out_trade_no: input.merchantOrderNo, ...(input.providerTradeNo ? { trade_no: input.providerTradeNo } : {}) });
    return {
      status: mapAlipayTradeStatus(result.trade_status),
      amountMinor: yuanToMinor(result.total_amount),
      providerTradeNo: typeof result.trade_no === 'string' ? result.trade_no : null,
    };
  }

  async closePayment(input: BillingPaymentQuery): Promise<void> {
    try {
      await callAlipay('alipay.trade.close', { out_trade_no: input.merchantOrderNo, ...(input.providerTradeNo ? { trade_no: input.providerTradeNo } : {}) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('TRADE_NOT_EXIST') || message.includes('ACQ.TRADE_NOT_EXIST')) return;
      throw error;
    }
  }

  async refundPayment(input: BillingRefundRequest): Promise<{ status: BillingPaymentStatus; refundNo: string }> {
    const result = await callAlipay('alipay.trade.refund', {
      out_trade_no: input.merchantOrderNo,
      refund_amount: (input.amountMinor / 100).toFixed(2),
      refund_reason: input.reason || '用户退款',
      out_request_no: input.refundNo,
    });
    const fundChange = String(result.fund_change || 'Y').toUpperCase();
    return { status: fundChange === 'N' ? 'pending' : 'refunded', refundNo: input.refundNo };
  }

  async queryRefund(input: { refundNo: string; merchantOrderNo: string }): Promise<BillingPaymentStatus> {
    const result = await callAlipay('alipay.trade.fastpay.refund.query', {
      out_trade_no: input.merchantOrderNo,
      out_request_no: input.refundNo,
    });
    return String(result.refund_status || '').toUpperCase() === 'REFUND_SUCCESS' ? 'refunded' : 'pending';
  }

  async verifyWebhook(_headers: Headers, rawBody: string): Promise<BillingWebhookEvent> {
    const values = new URLSearchParams(rawBody);
    const sign = values.get('sign');
    if (!sign) throw new Error('支付宝回调缺少签名');
    const params: Record<string, string> = {};
    values.forEach((value, key) => { if (key !== 'sign' && key !== 'sign_type') params[key] = value; });
    if (!verifyParams(params, sign)) throw new Error('支付宝回调验签失败');
    const tradeStatus = values.get('trade_status');
    const refundFee = values.get('refund_fee');
    const status = refundFee && Number(refundFee) > 0 ? 'refunded' as const : mapAlipayTradeStatus(tradeStatus);
    return {
      eventId: values.get('notify_id') || `${values.get('out_trade_no') || ''}:${values.get('trade_no') || ''}:${status}`,
      eventType: tradeStatus || 'notify',
      merchantOrderNo: values.get('out_trade_no'),
      providerTradeNo: values.get('trade_no'),
      status,
      amountMinor: status === 'refunded' ? yuanToMinor(refundFee) : yuanToMinor(values.get('total_amount')),
      payload: Object.fromEntries(values.entries()),
    };
  }

  async createCheckoutSession() {
    return { provider: this.name, sessionId: '', checkoutUrl: null, enabled: false };
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { WechatPayProvider } from '@/lib/wechat-pay-provider';
import { settleBillingEvent } from '@/lib/billing-settlement';

export const dynamic = 'force-dynamic';

/**
 * WeChat Pay API v3 webhook. Same response contract as the Alipay route:
 * signature or decryption failures answer FAIL so WeChat retries, while an
 * event that was stored but could not be settled answers SUCCESS and is
 * replayed by the reconciliation script.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  try {
    const event = await new WechatPayProvider().verifyWebhook(request.headers, rawBody);
    const result = await settleBillingEvent('wechat', event);
    if (!['PAID', 'IDEMPOTENT_REPLAY', 'REFUNDED', 'IGNORED', 'NOT_PAID_EVENT'].includes(result.code)) {
      console.error('[Billing] WeChat notify stored but not settled:', result.code, event.merchantOrderNo);
    }
    return NextResponse.json({ code: 'SUCCESS', message: result.code === 'IGNORED' ? '事件已接收' : '成功' });
  } catch (error) {
    console.error('[Billing] WeChat notify failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ code: 'FAIL', message: '回调处理失败' }, { status: 400 });
  }
}

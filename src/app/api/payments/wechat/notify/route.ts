import { NextRequest, NextResponse } from 'next/server';
import { WechatPayProvider } from '@/lib/wechat-pay-provider';
import { settleBillingEvent } from '@/lib/billing-settlement';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  try {
    const event = await new WechatPayProvider().verifyWebhook(request.headers, rawBody);
    const result = await settleBillingEvent('wechat', event);
    if (!['PAID', 'IDEMPOTENT_REPLAY', 'IGNORED', 'REFUNDED'].includes(result.code)) {
      return NextResponse.json({ code: 'FAIL', message: '订单确认失败' }, { status: 400 });
    }
    return NextResponse.json({ code: 'SUCCESS', message: result.code === 'IGNORED' ? '事件已接收' : '成功' });
  } catch (error) {
    console.error('[Billing] WeChat notify failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ code: 'FAIL', message: '回调处理失败' }, { status: 400 });
  }
}

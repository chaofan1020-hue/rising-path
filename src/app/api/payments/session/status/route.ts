import { NextRequest, NextResponse } from 'next/server';
import { getCheckoutSnapshot } from '@/lib/billing-order-service';
import { PAYMENT_SESSION_COOKIE, paymentReturnUrl, verifyPaymentSession } from '@/lib/payment-handoff';

export const dynamic = 'force-dynamic';

/**
 * Polled by /pay/checkout every few seconds and by the "I have paid" button.
 * getCheckoutSnapshot always queries the channel before answering, so a buyer
 * whose callback was lost still sees the paid state on the next poll.
 */
export async function GET(request: NextRequest) {
  const session = verifyPaymentSession(request.cookies.get(PAYMENT_SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ data: null, error: { code: 'PAYMENT_SESSION_REQUIRED', message: '支付会话已过期，请从主站重新进入' } }, { status: 401 });
  try {
    const checkout = await getCheckoutSnapshot(session.orderId, session.userId);
    if (!checkout) return NextResponse.json({ data: null, error: { code: 'ORDER_NOT_FOUND', message: '订单不存在' } }, { status: 404 });
    return NextResponse.json({ data: { ...checkout, returnUrl: paymentReturnUrl(session.returnPath) }, error: null });
  } catch (error) {
    console.error('[Billing] session status failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ data: null, error: { code: 'PAYMENT_STATUS_UNAVAILABLE', message: '暂时无法确认支付状态，请稍后重试' } }, { status: 503 });
  }
}

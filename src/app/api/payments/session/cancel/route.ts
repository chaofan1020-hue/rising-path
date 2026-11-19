import { NextRequest, NextResponse } from 'next/server';
import { cancelOpenOrder } from '@/lib/billing-order-service';
import { PAYMENT_SESSION_COOKIE, paymentReturnUrl, verifyPaymentSession } from '@/lib/payment-handoff';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const session = verifyPaymentSession(request.cookies.get(PAYMENT_SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ data: null, error: { code: 'PAYMENT_SESSION_REQUIRED', message: '支付会话已过期，请从主站重新进入' } }, { status: 401 });
  const result = await cancelOpenOrder(session.orderId, session.userId);
  if (result.code === 'BILLING_ORDER_NOT_FOUND') return NextResponse.json({ data: null, error: { code: result.code, message: '订单不存在' } }, { status: 404 });
  if (result.code === 'BILLING_ORDER_ALREADY_PAID') return NextResponse.json({ data: result.checkout, error: { code: result.code, message: '订单已支付' } }, { status: 409 });
  const response = NextResponse.json({ data: { ...result.checkout, returnUrl: paymentReturnUrl(session.returnPath) }, error: null });
  response.cookies.delete(PAYMENT_SESSION_COOKIE);
  return response;
}

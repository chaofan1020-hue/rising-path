import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { cancelOpenOrder } from '@/lib/billing-order-service';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorizedResponse();
  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ data: null, error: { code: 'INVALID_ORDER_ID', message: '订单 ID 无效' } }, { status: 400 });
  const result = await cancelOpenOrder(Number(id), auth.user.id);
  if (result.code === 'BILLING_ORDER_NOT_FOUND') {
    return NextResponse.json({ data: null, error: { code: result.code, message: '订单不存在' } }, { status: 404 });
  }
  if (result.code === 'BILLING_ORDER_ALREADY_PAID') {
    return NextResponse.json({ data: result.checkout, error: { code: result.code, message: '订单已支付，积分将自动到账' } }, { status: 409 });
  }
  if (result.code !== 'CANCELLED') {
    return NextResponse.json({ data: result.checkout, error: { code: result.code, message: '当前订单不能取消' } }, { status: 409 });
  }
  return NextResponse.json({ data: result.checkout, error: null });
}

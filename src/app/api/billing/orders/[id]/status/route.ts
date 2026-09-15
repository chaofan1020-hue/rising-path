import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { getCheckoutSnapshot } from '@/lib/billing-order-service';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorizedResponse();
  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ data: null, error: { code: 'INVALID_ORDER_ID', message: '订单 ID 无效' } }, { status: 400 });
  const checkout = await getCheckoutSnapshot(Number(id), auth.user.id);
  if (!checkout) return NextResponse.json({ data: null, error: { code: 'BILLING_ORDER_NOT_FOUND', message: '订单不存在' } }, { status: 404 });
  return NextResponse.json({ data: checkout, error: null });
}

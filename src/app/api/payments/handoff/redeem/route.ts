import { NextRequest, NextResponse } from 'next/server';
import { getCheckoutSnapshot } from '@/lib/billing-order-service';
import { handoffDigest, PAYMENT_SESSION_COOKIE, PAYMENT_SESSION_MAX_AGE, signPaymentSession, verifyHandoffTicket } from '@/lib/payment-handoff';
import { normalizePaymentReturnPath, paymentReturnUrl } from '@/lib/payment-return';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { ticket?: unknown };
  const token = typeof body.ticket === 'string' ? body.ticket : '';
  if (!token || token.length > 200) return NextResponse.json({ data: null, error: { code: 'INVALID_HANDOFF', message: '支付链接无效或已过期' } }, { status: 400 });
  const client = getSupabaseClient();
  const hash = (() => { try { return handoffDigest(token); } catch { return ''; } })();
  if (!hash) return NextResponse.json({ data: null, error: { code: 'INVALID_HANDOFF', message: '支付链接无效或已过期' } }, { status: 400 });
  const { data: ticket, error } = await client.from('payment_handoff_tickets').select('id,order_id,user_id,token_hash,expires_at,redeemed_at').eq('token_hash', hash).maybeSingle();
  if (error || !ticket || !verifyHandoffTicket(token, ticket.token_hash) || ticket.redeemed_at || new Date(ticket.expires_at).getTime() <= Date.now()) return NextResponse.json({ data: null, error: { code: 'INVALID_HANDOFF', message: '支付链接无效或已过期' } }, { status: 410 });
  const { data: claimed, error: claimError } = await client.from('payment_handoff_tickets').update({ redeemed_at: new Date().toISOString() }).eq('id', ticket.id).is('redeemed_at', null).select('id').maybeSingle();
  if (claimError || !claimed) return NextResponse.json({ data: null, error: { code: 'HANDOFF_REDEEMED', message: '支付链接已使用' } }, { status: 409 });
  const { data: order, error: orderError } = await client.from('billing_orders').select('metadata').eq('id', ticket.order_id).eq('user_id', ticket.user_id).maybeSingle();
  if (orderError || !order) return NextResponse.json({ data: null, error: { code: 'ORDER_NOT_FOUND', message: '订单不存在' } }, { status: 404 });
  const metadata = order.metadata && typeof order.metadata === 'object' ? order.metadata as Record<string, unknown> : {};
  const returnPath = normalizePaymentReturnPath(metadata.return_path);
  const checkout = await getCheckoutSnapshot(ticket.order_id, ticket.user_id);
  if (!checkout) return NextResponse.json({ data: null, error: { code: 'ORDER_NOT_FOUND', message: '订单不存在' } }, { status: 404 });
  const response = NextResponse.json({ data: { ...checkout, returnUrl: paymentReturnUrl(returnPath) }, error: null });
  response.cookies.set(PAYMENT_SESSION_COOKIE, signPaymentSession({ orderId: ticket.order_id, userId: ticket.user_id, returnPath }), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: PAYMENT_SESSION_MAX_AGE });
  return response;
}

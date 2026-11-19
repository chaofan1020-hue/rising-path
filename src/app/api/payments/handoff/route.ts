import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { createHandoffTicket } from '@/lib/payment-handoff';
import { normalizePaymentReturnPath } from '@/lib/payment-return';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorizedResponse();
  const body = await request.json().catch(() => ({})) as { orderId?: unknown; returnPath?: unknown };
  const orderId = Number(body.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) return NextResponse.json({ data: null, error: { code: 'INVALID_ORDER_ID', message: '订单 ID 无效' } }, { status: 400 });
  const client = getSupabaseClient();
  const { data: order, error } = await client.from('billing_orders').select('id,status,user_id,metadata').eq('id', orderId).eq('user_id', auth.user.id).maybeSingle();
  if (error) return NextResponse.json({ data: null, error: { code: 'HANDOFF_FAILED', message: '无法准备支付页面' } }, { status: 500 });
  if (!order || !['pending', 'created'].includes(order.status)) return NextResponse.json({ data: null, error: { code: 'ORDER_NOT_PAYABLE', message: '订单当前不可支付' } }, { status: 409 });
  const ticket = createHandoffTicket();
  const metadata = order.metadata && typeof order.metadata === 'object' ? order.metadata as Record<string, unknown> : {};
  const returnPath = normalizePaymentReturnPath(body.returnPath ?? metadata.return_path);
  const { error: metadataError } = await client.from('billing_orders').update({ metadata: { ...metadata, return_path: returnPath } }).eq('id', order.id).eq('user_id', auth.user.id).in('status', ['pending', 'created']);
  if (metadataError) return NextResponse.json({ data: null, error: { code: 'HANDOFF_FAILED', message: '无法准备支付页面' } }, { status: 500 });
  const { error: insertError } = await client.from('payment_handoff_tickets').insert({ token_hash: ticket.hash, order_id: order.id, user_id: auth.user.id, expires_at: ticket.expiresAt });
  if (insertError) return NextResponse.json({ data: null, error: { code: 'HANDOFF_FAILED', message: '无法准备支付页面' } }, { status: 500 });
  const configuredPaymentSite = process.env.PAYMENT_SITE_URL?.trim();
  const paymentOrigin = configuredPaymentSite ? new URL(configuredPaymentSite).origin : request.nextUrl.origin;
  const url = new URL('/pay/checkout', paymentOrigin);
  url.searchParams.set('ticket', ticket.token);
  return NextResponse.json({ data: { paymentUrl: url.toString(), expiresAt: ticket.expiresAt }, error: null });
}

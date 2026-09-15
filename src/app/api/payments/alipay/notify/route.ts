import { NextRequest } from 'next/server';
import { AlipayProvider } from '@/lib/alipay-provider';
import { settleBillingEvent } from '@/lib/billing-settlement';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  try {
    const event = await new AlipayProvider().verifyWebhook(request.headers, rawBody);
    const result = await settleBillingEvent('alipay', event);
    if (!['PAID', 'IDEMPOTENT_REPLAY', 'IGNORED', 'REFUNDED'].includes(result.code)) {
      return new Response('fail', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    return new Response('success', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  } catch (error) {
    console.error('[Billing] Alipay notify failed:', error instanceof Error ? error.message : error);
    return new Response('fail', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

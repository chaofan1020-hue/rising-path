import { NextRequest } from 'next/server';
import { AlipayProvider } from '@/lib/alipay-provider';
import { settleBillingEvent } from '@/lib/billing-settlement';

export const dynamic = 'force-dynamic';

/**
 * Alipay webhook.
 *
 * Every notification that passes signature verification is stored in
 * `billing_webhook_events` before settlement is attempted, so a payment that
 * could not be matched at the time (wrong merchant order number, amount
 * mismatch, missing attempt) stays visible and replayable instead of being
 * dropped. Alipay only answers retries when we return "fail", so:
 *
 * - signature / payload errors  -> "fail"  (let Alipay retry)
 * - stored but not settled      -> "success" (we will replay it ourselves)
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  try {
    const event = await new AlipayProvider().verifyWebhook(request.headers, rawBody);
    const result = await settleBillingEvent('alipay', event);
    if (!['PAID', 'IDEMPOTENT_REPLAY', 'REFUNDED', 'IGNORED', 'NOT_PAID_EVENT'].includes(result.code)) {
      console.error('[Billing] Alipay notify stored but not settled:', result.code, event.merchantOrderNo);
    }
    return new Response('success', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  } catch (error) {
    console.error('[Billing] Alipay notify failed:', error instanceof Error ? error.message : error);
    return new Response('fail', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

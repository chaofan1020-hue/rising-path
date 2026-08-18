import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { getBillingSnapshot } from '@/lib/entitlements';

export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorizedResponse();

  try {
    const [billing, subscriptionResult] = await Promise.all([
      getBillingSnapshot(auth.client, auth.user.id),
      auth.client
        .from('subscriptions')
        .select('id, plan_id, status, billing_interval, current_period_start, current_period_end, cancel_at_period_end, stripe_customer_id')
        .eq('user_id', auth.user.id)
        .maybeSingle(),
    ]);
    if (subscriptionResult.error) {
      console.error('[Billing status] subscription query failed:', subscriptionResult.error.message);
    }
    return NextResponse.json({
      billing,
      subscription: subscriptionResult.data || null,
    });
  } catch (error) {
    console.error('[Billing status] failed:', error);
    return NextResponse.json(
      { error: '获取订阅状态失败' },
      { status: 500 },
    );
  }
}

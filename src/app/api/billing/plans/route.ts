import { NextResponse } from 'next/server';
import { getBillingConfig, getBillingReadiness } from '@/lib/billing-config';
import { BILLING_DISPLAY_CURRENCY, planCatalogUsdCents } from '@/lib/billing-fx';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { defaultCurrency } = getBillingConfig();
  const { data, error } = await getSupabaseClient()
    .from('billing_plans')
    .select('plan_code,plan_type,name,description,currency,amount_minor,display_currency,display_amount_minor,credits,duration_days,display_order,version,metadata')
    .eq('is_active', true)
    .eq('currency', defaultCurrency)
    .order('display_order', { ascending: true });

  if (error) {
    return NextResponse.json({ data: null, error: { code: 'BILLING_PLANS_QUERY_FAILED', message: '读取套餐失败' } }, { status: 500 });
  }

  const readiness = getBillingReadiness();
  return NextResponse.json({
    data: (data || []).map((plan) => {
      const amountMinor = Number(plan.amount_minor || 0);
      return {
        ...plan,
        amountMinor,
        credits: Number(plan.credits || 0),
        durationDays: plan.duration_days === null ? null : Number(plan.duration_days),
        chargeCurrency: plan.currency,
        displayCurrency: plan.display_currency || BILLING_DISPLAY_CURRENCY,
        displayAmountMinor: planCatalogUsdCents(plan),
      };
    }),
    billing: {
      enabled: getBillingConfig().enabled,
      wechatEnabled: readiness.wechat.enabled && readiness.wechat.configured,
      alipayEnabled: readiness.alipay.enabled && readiness.alipay.configured,
      checkoutReady: readiness.checkoutReady,
      displayCurrency: BILLING_DISPLAY_CURRENCY,
      chargeCurrency: defaultCurrency,
    },
    error: null,
  });
}

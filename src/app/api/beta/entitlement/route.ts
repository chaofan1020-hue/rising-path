import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorizedResponse();
  const serviceClient = getSupabaseClient();
  const { data, error } = await serviceClient
    .from('beta_entitlements')
    .select('id,plan_code,status,period_start,period_end,bonus_limits,version,updated_at')
    .eq('user_id', auth.user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ data: null, error: { code: 'BETA_ENTITLEMENT_QUERY_FAILED', message: '读取内测额度失败' } }, { status: 500 });
  if (!data) return NextResponse.json({ data: null, error: null });

  const [{ data: limits, error: limitsError }, { data: reservations, error: usageError }] = await Promise.all([
    serviceClient
      .from('beta_entitlement_limits')
      .select('metric,limit_value,overage_policy')
      .eq('plan_code', data.plan_code)
      .lte('active_from', new Date().toISOString())
      .or('active_to.is.null,active_to.gt.' + new Date().toISOString()),
    serviceClient
      .from('beta_usage_reservations')
      .select('metric,amount,status')
      .eq('entitlement_id', data.id)
      .gte('created_at', data.period_start)
      .in('status', ['reserved', 'committed']),
  ]);
  if (limitsError || usageError) {
    return NextResponse.json({ data: null, error: { code: 'BETA_USAGE_QUERY_FAILED', message: '读取内测使用量失败' } }, { status: 500 });
  }
  const bonusLimits = data.bonus_limits && typeof data.bonus_limits === 'object'
    ? data.bonus_limits as Record<string, unknown>
    : {};
  const consumedByMetric = new Map<string, number>();
  for (const row of reservations || []) {
    consumedByMetric.set(row.metric, (consumedByMetric.get(row.metric) || 0) + Number(row.amount || 0));
  }
  const usage = (limits || []).map((limit) => {
    const bonus = Number(bonusLimits[limit.metric] || 0);
    const limitValue = Number(limit.limit_value || 0) + (Number.isFinite(bonus) ? bonus : 0);
    const consumed = consumedByMetric.get(limit.metric) || 0;
    return { metric: limit.metric, limit: limitValue, used: consumed, remaining: Math.max(0, limitValue - consumed), overagePolicy: limit.overage_policy };
  });
  return NextResponse.json({ data: { entitlement: data, usage }, error: null });
}

import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { mapCreditPriceRows } from '@/lib/credit-prices';
import { grantSignupWelcomeCredits } from '@/lib/credits';
import { getSupabaseClient } from '@/storage/database/supabase-client';

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0, must-revalidate' };

export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorizedResponse();
  await grantSignupWelcomeCredits(auth.user.id);
  const client = getSupabaseClient();
  const [{ data: account, error: accountError }, { data: prices, error: pricesError }, { data: ledger, error: ledgerError }] = await Promise.all([
    client.from('credit_accounts').select('balance,lifetime_granted,lifetime_spent,updated_at').eq('user_id', auth.user.id).maybeSingle(),
    client.from('credit_price_rules').select('metric,display_name,unit_name,credit_cost,max_units_per_request,notes').eq('enabled', true).order('id'),
    client.from('credit_ledger').select('id,entry_type,delta,balance_after,metric,reason,metadata,created_at').eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(30),
  ]);
  if (accountError || pricesError || ledgerError) {
    return NextResponse.json({ data: null, error: { code: 'CREDIT_QUERY_FAILED', message: '读取积分信息失败' } }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json({
    data: {
      balance: Number(account?.balance || 0),
      lifetimeGranted: Number(account?.lifetime_granted || 0),
      lifetimeSpent: Number(account?.lifetime_spent || 0),
      updatedAt: account?.updated_at || null,
      prices: mapCreditPriceRows(prices),
      ledger: ledger || [],
    },
    error: null,
  }, { headers: NO_STORE });
}

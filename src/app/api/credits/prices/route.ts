import { NextResponse } from 'next/server';
import { mapCreditPriceRows } from '@/lib/credit-prices';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0, must-revalidate' };

export async function GET() {
  const { data, error } = await getSupabaseClient()
    .from('credit_price_rules')
    .select('metric,display_name,unit_name,credit_cost,max_units_per_request')
    .eq('enabled', true)
    .order('id');

  if (error) {
    return NextResponse.json(
      { data: null, error: { code: 'CREDIT_PRICES_QUERY_FAILED', message: '读取功能价格失败' } },
      { status: 500, headers: NO_STORE },
    );
  }

  return NextResponse.json(
    { data: { prices: mapCreditPriceRows(data) }, error: null },
    { headers: NO_STORE },
  );
}

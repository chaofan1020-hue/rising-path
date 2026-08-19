import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { adminMigrationUnavailable } from '@/lib/admin-dependency-status';

const MAX_PAGE_SIZE = 100;

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalDate(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

export async function GET(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.dashboardRead);
  if (permissionError) return permissionError;

  const searchParams = request.nextUrl.searchParams;
  const page = positiveInteger(searchParams.get('page'), 1);
  const pageSize = Math.min(positiveInteger(searchParams.get('pageSize'), 50), MAX_PAGE_SIZE);
  const userId = searchParams.get('userId')?.trim() || null;
  const feature = searchParams.get('feature')?.trim() || null;
  const provider = searchParams.get('provider')?.trim() || null;
  const status = searchParams.get('status')?.trim() || null;
  const usageSource = searchParams.get('usageSource')?.trim() || null;
  const from = optionalDate(searchParams.get('from'));
  const to = optionalDate(searchParams.get('to'));

  if ((searchParams.has('from') && !from) || (searchParams.has('to') && !to)) {
    return NextResponse.json({ error: { code: 'INVALID_DATE', message: '日期参数无效' } }, { status: 400 });
  }

  try {
    const client = getSupabaseClient();
    let query = client
      .from('ai_usage_events')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (userId) query = query.eq('user_id', userId);
    if (feature) query = query.eq('feature', feature);
    if (provider) query = query.eq('provider', provider);
    if (status) query = query.eq('status', status);
    if (usageSource) query = query.eq('usage_source', usageSource);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lt('created_at', to);

    const { data, error, count } = await query;
    if (error) throw new Error(error.message);

    const summaryQuery = await client.rpc('get_ai_usage_summary_v3', {
      p_user_id: userId,
      p_feature: feature,
      p_provider: provider,
      p_status: status,
      p_usage_source: usageSource,
      p_from: from,
      p_to: to,
    });
    if (summaryQuery.error) throw new Error(summaryQuery.error.message);

    const featureSummaryQuery = await client.rpc('get_ai_usage_feature_summary_v3', {
      p_user_id: userId,
      p_feature: feature,
      p_provider: provider,
      p_status: status,
      p_usage_source: usageSource,
      p_from: from,
      p_to: to,
    });
    if (featureSummaryQuery.error) throw new Error(featureSummaryQuery.error.message);

    return NextResponse.json({
      data: {
        events: data || [],
        summary: summaryQuery.data?.[0] || {
          call_count: 0,
          successful_calls: 0,
          failed_calls: 0,
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          actual_calls: 0,
          estimated_calls: 0,
           unknown_calls: 0,
          audio_calls: 0,
          input_audio_seconds: 0,
          output_audio_seconds: 0,
          input_audio_bytes: 0,
          output_audio_bytes: 0,
          audio_tokens: 0,
          text_characters: 0,
          billing_units: 0,
          priced_calls: 0,
          unpriced_calls: 0,
          estimated_costs: {},
        },
        features: featureSummaryQuery.data || [],
      },
      meta: { page, pageSize, total: count || 0 },
      error: null,
    });
  } catch (error) {
    console.error('[Admin AI Usage] query failed:', error);
    const migrationResponse = adminMigrationUnavailable(error, ['0017_ai_usage_events.sql', '0018_ai_usage_admin_aggregates.sql', '0019_audio_ai_usage_metrics.sql', '0023_ai_model_prices.sql'], 'AI 用量依赖数据库迁移，当前环境尚未部署');
    if (migrationResponse) return migrationResponse;
    return NextResponse.json(
      { data: null, error: { code: 'ADMIN_AI_USAGE_QUERY_FAILED', message: '获取 AI 使用量失败' } },
      { status: 500 },
    );
  }
}

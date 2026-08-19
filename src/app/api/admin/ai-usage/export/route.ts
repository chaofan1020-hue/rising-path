import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';
import { getSupabaseClient } from '@/storage/database/supabase-client';

const MAX_EXPORT_ROWS = 5_000;

function optionalDate(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function csvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.usageExport);
  if (permissionError) return permissionError;

  const params = request.nextUrl.searchParams;
  const feature = params.get('feature')?.trim() || null;
  const provider = params.get('provider')?.trim() || null;
  const status = params.get('status')?.trim() || null;
  const usageSource = params.get('usageSource')?.trim() || null;
  const from = optionalDate(params.get('from'));
  const to = optionalDate(params.get('to'));
  if ((params.has('from') && !from) || (params.has('to') && !to)) {
    return NextResponse.json({ error: { code: 'INVALID_DATE', message: '日期参数无效' } }, { status: 400 });
  }

  try {
    const client = getSupabaseClient();
    let query = client
      .from('ai_usage_events')
      .select('request_id,user_id,feature,provider,model,status,usage_source,input_tokens,output_tokens,total_tokens,modality,input_audio_seconds,output_audio_seconds,input_audio_bytes,output_audio_bytes,audio_tokens,text_characters,billing_units,estimated_cost,currency,cost_source,duration_ms,created_at')
      .order('created_at', { ascending: false })
      .limit(MAX_EXPORT_ROWS);
    if (feature) query = query.eq('feature', feature);
    if (provider) query = query.eq('provider', provider);
    if (status) query = query.eq('status', status);
    if (usageSource) query = query.eq('usage_source', usageSource);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lt('created_at', to);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const columns = [
      'request_id', 'user_id', 'feature', 'provider', 'model', 'status', 'usage_source',
      'input_tokens', 'output_tokens', 'total_tokens', 'modality', 'input_audio_seconds',
      'output_audio_seconds', 'input_audio_bytes', 'output_audio_bytes', 'audio_tokens',
      'text_characters', 'billing_units', 'estimated_cost', 'currency', 'cost_source',
      'duration_ms', 'created_at',
    ] as const;
    const csv = [
      columns.join(','),
      ...(data || []).map((event) => columns.map((column) => csvValue(event[column])).join(',')),
    ].join('\r\n');

    await recordAdminAuditEvent({
      request,
      action: 'ai_usage.export',
      resourceType: 'ai_usage_event',
      metadata: {
        exported_rows: data?.length || 0,
        max_rows: MAX_EXPORT_ROWS,
        filters: { feature, provider, status, usage_source: usageSource, from, to },
      },
    });

    const dateSuffix = new Date().toISOString().slice(0, 10);
    return new NextResponse(`\uFEFF${csv}`, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="liorvix-ai-usage-${dateSuffix}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    await recordAdminAuditFailure({ request, action: 'ai_usage.export', resourceType: 'ai_usage_event', error });
    console.error('[Admin AI Usage] export failed:', error);
    return NextResponse.json(
      { error: { code: 'ADMIN_AI_USAGE_EXPORT_FAILED', message: '导出 AI 使用量失败' } },
      { status: 500 },
    );
  }
}

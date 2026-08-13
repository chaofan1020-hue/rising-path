import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { adminMigrationUnavailable } from '@/lib/admin-dependency-status';

const MAX_PAGE_SIZE = 100;

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function validPrice(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function validDate(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

export async function GET(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.configWrite);
  if (permissionError) return permissionError;

  const params = request.nextUrl.searchParams;
  const page = positiveInteger(params.get('page'), 1);
  const pageSize = Math.min(positiveInteger(params.get('pageSize'), 50), MAX_PAGE_SIZE);
  try {
    const { data, error, count } = await getSupabaseClient()
      .from('ai_model_prices')
      .select('id,provider,model,currency,input_token_price_per_million,output_token_price_per_million,audio_second_price,billing_unit_price,effective_from,effective_to,is_active,notes,created_at,updated_at', { count: 'exact' })
      .order('provider', { ascending: true })
      .order('model', { ascending: true })
      .order('effective_from', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new Error(error.message);
    return NextResponse.json({ data: data || [], meta: { page, pageSize, total: count || 0 }, error: null });
  } catch (error) {
    console.error('[Admin AI Prices] query failed:', error);
    const migrationResponse = adminMigrationUnavailable(error, ['0023_ai_model_prices.sql', '0024_seed_ai_model_prices.sql'], '模型价格依赖数据库迁移，当前环境尚未部署');
    if (migrationResponse) return migrationResponse;
    return NextResponse.json({ data: null, error: { code: 'ADMIN_AI_PRICES_QUERY_FAILED', message: '获取模型价格失败' } }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.configWrite);
  if (permissionError) return permissionError;

  try {
    const body = await request.json() as Record<string, unknown>;
    const provider = typeof body.provider === 'string' ? body.provider.trim().toLowerCase().slice(0, 100) : '';
    const model = typeof body.model === 'string' ? body.model.trim().slice(0, 200) : '';
    const currency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : 'USD';
    const inputPrice = validPrice(body.inputTokenPricePerMillion);
    const outputPrice = validPrice(body.outputTokenPricePerMillion);
    const audioPrice = validPrice(body.audioSecondPrice);
    const billingPrice = validPrice(body.billingUnitPrice);
    const effectiveFromValue = validDate(body.effectiveFrom);
    if (effectiveFromValue === undefined) {
      return NextResponse.json({ data: null, error: { code: 'INVALID_AI_PRICE_DATE', message: '生效时间无效' } }, { status: 400 });
    }
    const effectiveFrom = effectiveFromValue === null ? new Date().toISOString() : effectiveFromValue;
    const effectiveTo = validDate(body.effectiveTo);
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 1000) : null;

    if (!provider || !model || !/^[A-Z]{3}$/.test(currency) || [inputPrice, outputPrice, audioPrice, billingPrice, effectiveFrom, effectiveTo].includes(undefined)) {
      return NextResponse.json({ data: null, error: { code: 'INVALID_AI_PRICE', message: '模型价格参数无效' } }, { status: 400 });
    }
    if (inputPrice === null && outputPrice === null && audioPrice === null && billingPrice === null) {
      return NextResponse.json({ data: null, error: { code: 'EMPTY_AI_PRICE', message: '至少需要设置一种计费价格' } }, { status: 400 });
    }
    if (
      ((inputPrice !== null || outputPrice !== null) && (audioPrice !== null || billingPrice !== null))
      || (audioPrice !== null && billingPrice !== null)
    ) {
      return NextResponse.json({ data: null, error: { code: 'MIXED_AI_PRICE_UNITS', message: '同一模型只能配置 Token、音频秒或自定义计费单位中的一种口径' } }, { status: 400 });
    }
    if (effectiveTo && effectiveTo <= effectiveFrom) {
      return NextResponse.json({ data: null, error: { code: 'INVALID_AI_PRICE_RANGE', message: '结束时间必须晚于生效时间' } }, { status: 400 });
    }

    const payload = {
      provider,
      model,
      currency,
      input_token_price_per_million: inputPrice,
      output_token_price_per_million: outputPrice,
      audio_second_price: audioPrice,
      billing_unit_price: billingPrice,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      notes,
    };
    const { data, error } = await getSupabaseClient()
      .from('ai_model_prices')
      .insert(payload)
      .select('id,provider,model,currency,input_token_price_per_million,output_token_price_per_million,audio_second_price,billing_unit_price,effective_from,effective_to,is_active,notes,created_at,updated_at')
      .single();
    if (error) throw new Error(error.message);
    await recordAdminAuditEvent({ request, action: 'ai_price.create', resourceType: 'ai_model_price', resourceId: data.id, afterData: data });
    return NextResponse.json({ data, error: null }, { status: 201 });
  } catch (error) {
    await recordAdminAuditFailure({ request, action: 'ai_price.create', resourceType: 'ai_model_price', error });
    console.error('[Admin AI Prices] create failed:', error);
    return NextResponse.json({ data: null, error: { code: 'ADMIN_AI_PRICE_CREATE_FAILED', message: '创建模型价格失败' } }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.configWrite);
  if (permissionError) return permissionError;

  try {
    const body = await request.json() as Record<string, unknown>;
    const id = Number(body.id);
    const isActive = body.isActive;
    if (!Number.isInteger(id) || id <= 0 || typeof isActive !== 'boolean') {
      return NextResponse.json({ data: null, error: { code: 'INVALID_AI_PRICE_UPDATE', message: '价格状态参数无效' } }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { data: before, error: beforeError } = await client
      .from('ai_model_prices')
      .select('id,provider,model,currency,is_active,effective_from,effective_to')
      .eq('id', id)
      .maybeSingle();
    if (beforeError) throw new Error(beforeError.message);
    if (!before) {
      return NextResponse.json({ data: null, error: { code: 'AI_PRICE_NOT_FOUND', message: '模型价格不存在' } }, { status: 404 });
    }

    const { data, error } = await client
      .from('ai_model_prices')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id,provider,model,currency,input_token_price_per_million,output_token_price_per_million,audio_second_price,billing_unit_price,effective_from,effective_to,is_active,notes,created_at,updated_at')
      .single();
    if (error) throw new Error(error.message);
    await recordAdminAuditEvent({ request, action: 'ai_price.status_update', resourceType: 'ai_model_price', resourceId: id, beforeData: before, afterData: data });
    return NextResponse.json({ data, error: null });
  } catch (error) {
    await recordAdminAuditFailure({ request, action: 'ai_price.status_update', resourceType: 'ai_model_price', error });
    console.error('[Admin AI Prices] status update failed:', error);
    return NextResponse.json({ data: null, error: { code: 'ADMIN_AI_PRICE_UPDATE_FAILED', message: '更新模型价格状态失败' } }, { status: 500 });
  }
}

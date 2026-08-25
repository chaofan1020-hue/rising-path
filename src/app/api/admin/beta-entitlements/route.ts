import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';

function validUserId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
}

export async function GET(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.usersRead);
  if (permissionError) return permissionError;
  const { data, error } = await getSupabaseClient()
    .from('beta_entitlements')
    .select('id,user_id,plan_code,status,period_start,period_end,bonus_limits,source,version,notes,created_at,updated_at')
    .order('updated_at', { ascending: false });
  if (error) return NextResponse.json({ data: null, error: { code: 'BETA_ENTITLEMENT_LIST_FAILED', message: '读取内测资格失败' } }, { status: 500 });
  return NextResponse.json({ data: data || [], error: null });
}

export async function POST(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.configWrite);
  if (permissionError) return permissionError;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (!validUserId(body.userId)) return NextResponse.json({ data: null, error: { code: 'INVALID_USER_ID', message: '用户 ID 无效' } }, { status: 400 });
    const now = new Date();
    const periodStart = typeof body.periodStart === 'string' ? new Date(body.periodStart) : now;
    const periodEnd = typeof body.periodEnd === 'string' ? new Date(body.periodEnd) : new Date(now.getTime() + 30 * 86400000);
    if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime()) || periodEnd <= periodStart) {
      return NextResponse.json({ data: null, error: { code: 'INVALID_BETA_PERIOD', message: '内测周期无效' } }, { status: 400 });
    }
    const client = getSupabaseClient();
    const { data, error } = await client.from('beta_entitlements').upsert({
      user_id: body.userId,
      plan_code: 'beta',
      status: body.status === 'suspended' ? 'suspended' : 'active',
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      bonus_limits: body.bonusLimits && typeof body.bonusLimits === 'object' ? body.bonusLimits : {},
      source: 'manual_beta',
      notes: typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : null,
      created_by: 'admin_session',
      updated_at: now.toISOString(),
    }, { onConflict: 'user_id' }).select('id,user_id,plan_code,status,period_start,period_end,bonus_limits,source,version,notes,created_at,updated_at').single();
    if (error) throw new Error(error.message);
    await recordAdminAuditEvent({ request, action: 'beta_entitlement.upsert', resourceType: 'beta_entitlement', resourceId: data.id, subjectUserId: body.userId, afterData: data });
    return NextResponse.json({ data, error: null }, { status: 201 });
  } catch (error) {
    await recordAdminAuditFailure({ request, action: 'beta_entitlement.upsert', resourceType: 'beta_entitlement', error });
    return NextResponse.json({ data: null, error: { code: 'BETA_ENTITLEMENT_UPSERT_FAILED', message: '写入内测资格失败' } }, { status: 500 });
  }
}

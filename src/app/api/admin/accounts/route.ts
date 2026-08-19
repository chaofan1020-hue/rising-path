import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';
import { isAdminRole } from '@/lib/admin-auth';

const ACCOUNT_COLUMNS = 'id,auth_user_id,role_key,status,last_login_at,created_at,updated_at';

export async function GET(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.rolesWrite);
  if (permissionError) return permissionError;
  try {
    const { data, error } = await getSupabaseClient()
      .from('admin_users')
      .select(ACCOUNT_COLUMNS)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return NextResponse.json({ data: data || [], error: null });
  } catch (error) {
    console.error('[Admin Accounts] query failed:', error);
    return NextResponse.json({ data: null, error: { code: 'ADMIN_ACCOUNT_QUERY_FAILED', message: '获取管理员账号失败' } }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.rolesWrite);
  if (permissionError) return permissionError;
  try {
    const body = await request.json() as { authUserId?: unknown; roleKey?: unknown };
    const authUserId = typeof body.authUserId === 'string' ? body.authUserId.trim() : '';
    const roleKey = body.roleKey;
    if (!/^[0-9a-f-]{36}$/i.test(authUserId) || !isAdminRole(roleKey)) {
      return NextResponse.json({ data: null, error: { code: 'INVALID_ADMIN_ACCOUNT', message: 'Auth 用户 ID 或角色无效' } }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { data: authUser, error: authError } = await client.auth.admin.getUserById(authUserId);
    if (authError || !authUser.user) {
      return NextResponse.json({ data: null, error: { code: 'AUTH_USER_NOT_FOUND', message: 'Supabase Auth 用户不存在' } }, { status: 404 });
    }
    const { data, error } = await client
      .from('admin_users')
      .upsert({ auth_user_id: authUserId, role_key: roleKey, status: 'active', updated_at: new Date().toISOString() }, { onConflict: 'auth_user_id' })
      .select(ACCOUNT_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    await recordAdminAuditEvent({ request, action: 'admin_account.upsert', resourceType: 'admin_user', resourceId: data.id, afterData: data });
    return NextResponse.json({ data, error: null }, { status: 201 });
  } catch (error) {
    await recordAdminAuditFailure({ request, action: 'admin_account.upsert', resourceType: 'admin_user', error });
    console.error('[Admin Accounts] upsert failed:', error);
    return NextResponse.json({ data: null, error: { code: 'ADMIN_ACCOUNT_UPSERT_FAILED', message: '绑定管理员账号失败' } }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.rolesWrite);
  if (permissionError) return permissionError;
  try {
    const body = await request.json() as { id?: unknown; roleKey?: unknown; status?: unknown };
    const id = typeof body.id === 'string' ? body.id : '';
    const updates: Record<string, string> = {};
    if (body.roleKey !== undefined) {
      if (!isAdminRole(body.roleKey)) return NextResponse.json({ data: null, error: { code: 'INVALID_ADMIN_ROLE', message: '角色无效' } }, { status: 400 });
      updates.role_key = body.roleKey;
    }
    if (body.status !== undefined) {
      if (body.status !== 'active' && body.status !== 'suspended') return NextResponse.json({ data: null, error: { code: 'INVALID_ADMIN_STATUS', message: '账号状态无效' } }, { status: 400 });
      updates.status = body.status;
    }
    if (!/^[0-9a-f-]{36}$/i.test(id) || Object.keys(updates).length === 0) {
      return NextResponse.json({ data: null, error: { code: 'INVALID_ADMIN_ACCOUNT_UPDATE', message: '账号更新参数无效' } }, { status: 400 });
    }
    updates.updated_at = new Date().toISOString();
    const { data, error } = await getSupabaseClient().from('admin_users').update(updates).eq('id', id).select(ACCOUNT_COLUMNS).single();
    if (error) throw new Error(error.message);
    await recordAdminAuditEvent({ request, action: 'admin_account.update', resourceType: 'admin_user', resourceId: id, afterData: data });
    return NextResponse.json({ data, error: null });
  } catch (error) {
    await recordAdminAuditFailure({ request, action: 'admin_account.update', resourceType: 'admin_user', error });
    console.error('[Admin Accounts] update failed:', error);
    return NextResponse.json({ data: null, error: { code: 'ADMIN_ACCOUNT_UPDATE_FAILED', message: '更新管理员账号失败' } }, { status: 500 });
  }
}

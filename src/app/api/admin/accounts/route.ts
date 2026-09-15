import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';
import { countActiveSuperAdmins, isAdminRole, resolveAdminSession, revokeAdminSessionsForUser } from '@/lib/admin-auth';
import { ensureAuthUserIdByEmail } from '@/lib/admin-account-users';
import { isValidEmail } from '@/lib/auth-shared';
import { normalizeEmail } from '@/lib/auth-security';

const ACCOUNT_COLUMNS = 'id,auth_user_id,role_key,status,last_login_at,created_at,updated_at';

function maskEmail(email: string | null | undefined): string {
  if (!email || !email.includes('@')) return email || '';
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  const visible = local.slice(0, 2);
  return `${visible}***@${domain}`;
}

export async function GET(request: NextRequest) {
  const permissionError = await requireAdminPermission(request, ADMIN_PERMISSIONS.rolesWrite);
  if (permissionError) return permissionError;
  try {
    const listed = await getSupabaseClient().rpc('list_admin_accounts');
    if (!listed.error && Array.isArray(listed.data)) {
      return NextResponse.json({
        data: listed.data.map((row: { email?: string | null }) => ({ ...row, email: maskEmail(row.email) })),
        error: null,
      });
    }
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
  const permissionError = await requireAdminPermission(request, ADMIN_PERMISSIONS.rolesWrite);
  if (permissionError) return permissionError;
  try {
    const body = await request.json() as { authUserId?: unknown; email?: unknown; roleKey?: unknown };
    let roleKey = body.roleKey;
    if (!isAdminRole(roleKey)) {
      return NextResponse.json({ data: null, error: { code: 'INVALID_ADMIN_ACCOUNT', message: '角色无效' } }, { status: 400 });
    }

    const client = getSupabaseClient();
    let authUserId = typeof body.authUserId === 'string' ? body.authUserId.trim() : '';
    const email = normalizeEmail(body.email);
    if (!authUserId && !isValidEmail(email)) {
      return NextResponse.json({ data: null, error: { code: 'INVALID_ADMIN_EMAIL', message: '请输入有效的管理员邮箱' } }, { status: 400 });
    }
    if (!authUserId && isValidEmail(email)) {
      authUserId = await ensureAuthUserIdByEmail(email);
    }
    if (!/^[0-9a-f-]{36}$/i.test(authUserId)) {
      return NextResponse.json({ data: null, error: { code: 'AUTH_USER_NOT_FOUND', message: '无法识别该邮箱对应的平台账号' } }, { status: 404 });
    }
    if ((await countActiveSuperAdmins()) === 0) {
      roleKey = 'super_admin';
    }

    const { data: authUser, error: authError } = await client.auth.admin.getUserById(authUserId);
    if (authError || !authUser.user) {
      return NextResponse.json({ data: null, error: { code: 'AUTH_USER_NOT_FOUND', message: '找不到该邮箱对应的平台账号' } }, { status: 404 });
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
  const permissionError = await requireAdminPermission(request, ADMIN_PERMISSIONS.rolesWrite);
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
    const client = getSupabaseClient();
    const { data: current, error: currentError } = await client.from('admin_users').select('id,role_key,status').eq('id', id).maybeSingle();
    if (currentError) throw new Error(currentError.message);
    if (current?.role_key === 'super_admin' && current.status === 'active' && (updates.status === 'suspended' || (updates.role_key && updates.role_key !== 'super_admin'))) {
      const { count, error: countError } = await client.from('admin_users').select('id', { count: 'exact', head: true }).eq('status', 'active').eq('role_key', 'super_admin');
      if (countError) throw new Error(countError.message);
      if ((count || 0) <= 1) {
        return NextResponse.json({ data: null, error: { code: 'LAST_SUPER_ADMIN', message: '不能停用或降级最后一名超级管理员' } }, { status: 400 });
      }
    }
    updates.updated_at = new Date().toISOString();
    const { data, error } = await client.from('admin_users').update(updates).eq('id', id).select(ACCOUNT_COLUMNS).single();
    if (error) throw new Error(error.message);
    if (updates.status === 'suspended' || updates.role_key) {
      await revokeAdminSessionsForUser(id);
    }
    await recordAdminAuditEvent({ request, action: 'admin_account.update', resourceType: 'admin_user', resourceId: id, afterData: data });
    return NextResponse.json({ data, error: null });
  } catch (error) {
    await recordAdminAuditFailure({ request, action: 'admin_account.update', resourceType: 'admin_user', error });
    console.error('[Admin Accounts] update failed:', error);
    return NextResponse.json({ data: null, error: { code: 'ADMIN_ACCOUNT_UPDATE_FAILED', message: '更新管理员账号失败' } }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const permissionError = await requireAdminPermission(request, ADMIN_PERMISSIONS.rolesWrite);
  if (permissionError) return permissionError;
  try {
    const body = await request.json() as { id?: unknown };
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ data: null, error: { code: 'INVALID_ADMIN_ACCOUNT', message: '管理员账号无效' } }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { data: current, error: currentError } = await client
      .from('admin_users')
      .select('id,auth_user_id,role_key,status')
      .eq('id', id)
      .maybeSingle();
    if (currentError) throw new Error(currentError.message);
    if (!current) {
      return NextResponse.json({ data: null, error: { code: 'ADMIN_ACCOUNT_NOT_FOUND', message: '管理员账号不存在' } }, { status: 404 });
    }

    const session = await resolveAdminSession(request);
    if (current.role_key === 'super_admin' && current.status === 'active' && (await countActiveSuperAdmins()) <= 1) {
      return NextResponse.json({ data: null, error: { code: 'LAST_SUPER_ADMIN', message: '不能删除最后一名超级管理员' } }, { status: 400 });
    }

    await revokeAdminSessionsForUser(id);
    const { error } = await client.from('admin_users').delete().eq('id', id);
    if (error) throw new Error(error.message);
    await recordAdminAuditEvent({
      request,
      action: 'admin_account.delete',
      resourceType: 'admin_user',
      resourceId: id,
      beforeData: { id: current.id, role_key: current.role_key, status: current.status },
      metadata: { deleted_self: session?.adminUserId === id },
    });
    return NextResponse.json({ data: { id }, error: null });
  } catch (error) {
    await recordAdminAuditFailure({ request, action: 'admin_account.delete', resourceType: 'admin_user', error });
    console.error('[Admin Accounts] delete failed:', error);
    return NextResponse.json({ data: null, error: { code: 'ADMIN_ACCOUNT_DELETE_FAILED', message: '删除管理员账号失败' } }, { status: 500 });
  }
}

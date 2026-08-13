import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth-server';
import {
  createAdminSessionToken,
  getAdminSessionCookie,
  getAdminSessionRole,
  hasValidAdminSession,
  isAdminRole,
} from '@/lib/admin-auth';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';
import { getAdminPermissions } from '@/lib/admin-permissions';

export async function GET(request: NextRequest) {
  const authenticated = hasValidAdminSession(request);
  const role = authenticated ? getAdminSessionRole(request) : null;
  return NextResponse.json({
    authenticated,
    role,
    permissions: role ? getAdminPermissions(role) : [],
  });
}

export async function POST(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ data: null, error: { code: 'AUTH_REQUIRED', message: '需要 Supabase 登录会话' } }, { status: 401 });
  }

  try {
    const { data, error } = await getSupabaseClient()
      .from('admin_users')
      .select('id,auth_user_id,role_key,status')
      .eq('auth_user_id', auth.user.id)
      .eq('status', 'active')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || !isAdminRole(data.role_key)) {
      return NextResponse.json({ data: null, error: { code: 'ADMIN_ACCOUNT_NOT_FOUND', message: '该 Supabase 账号尚未绑定管理员权限' } }, { status: 403 });
    }

    const now = new Date().toISOString();
    await getSupabaseClient().from('admin_users').update({ last_login_at: now, updated_at: now }).eq('id', data.id);
    const response = NextResponse.json({ data: { role: data.role_key }, error: null });
    response.cookies.set(getAdminSessionCookie(createAdminSessionToken(Math.floor(Date.now() / 1000), data.role_key)));
    await recordAdminAuditEvent({
      request,
      action: 'admin_auth.login',
      resourceType: 'admin_user',
      resourceId: data.id,
      metadata: { role: data.role_key, auth_user_id: auth.user.id },
    });
    return response;
  } catch (error) {
    await recordAdminAuditFailure({ request, action: 'admin_auth.login', resourceType: 'admin_user', error });
    console.error('[Admin Auth] account exchange failed:', error);
    return NextResponse.json({ data: null, error: { code: 'ADMIN_AUTH_FAILED', message: '管理员账号登录失败' } }, { status: 500 });
  }
}

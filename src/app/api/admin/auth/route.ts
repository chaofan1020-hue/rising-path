import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth-server';
import {
  isAdminRole,
  isSharedAdminPasswordAllowed,
  issueAdminSession,
  parseAdminSession,
  resolveAdminSessionFromPayload,
} from '@/lib/admin-auth';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';
import { getEffectiveAdminPermissions } from '@/lib/admin-permissions';

export async function GET(request: NextRequest) {
  // Resolve the session once. This handler used to call hasValidAdminSession,
  // resolveAdminSession and getAdminSessionRole, each of which re-ran the same
  // `admin_sessions` lookup — three round trips to answer one question, before
  // the admin UI could paint anything.
  const session = await resolveAdminSessionFromPayload(await parseAdminSession(request));
  const role = session?.role ?? null;

  const [permissions, passwordLoginAllowed] = await Promise.all([
    role ? getEffectiveAdminPermissions(role) : [],
    isSharedAdminPasswordAllowed(),
  ]);

  return NextResponse.json({
    authenticated: Boolean(session),
    role,
    adminUserId: session?.adminUserId || null,
    permissions,
    passwordLoginAllowed,
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
    response.cookies.set(await issueAdminSession({ adminUserId: data.id, role: data.role_key, request }));
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

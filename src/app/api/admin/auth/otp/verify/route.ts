import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getClientIp } from '@/lib/auth-server';
import { isValidEmail } from '@/lib/auth-shared';
import {
  consumeAuthRateLimit,
  isValidOtpToken,
  normalizeEmail,
  normalizeOtpToken,
} from '@/lib/auth-security';
import { isAllowedAdminOrigin, rejectedAdminOriginResponse } from '@/lib/admin-origin';
import { issueAdminSession, isAdminRole } from '@/lib/admin-auth';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';
import { adminMigrationUnavailable } from '@/lib/admin-dependency-status';
import { ADMIN_LOGIN_EMAIL_OTP_TYPES, verifyLoginEmailOtp } from '@/lib/auth-email-otp';

export async function POST(request: NextRequest) {
  if (!isAllowedAdminOrigin(request)) return NextResponse.json(await rejectedAdminOriginResponse().json(), { status: 403 });

  const ip = getClientIp(request);
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    const token = normalizeOtpToken(body.token);
    if (!isValidEmail(email) || !isValidOtpToken(token)) {
      return NextResponse.json({ error: '验证码格式不正确' }, { status: 400 });
    }

    const ipLimit = await consumeAuthRateLimit(`admin-otp-verify:ip:${ip}`, 8, 900, 1800);
    const emailLimit = await consumeAuthRateLimit(`admin-otp-verify:email:${email}`, 5, 900, 1800);
    if (!ipLimit.allowed || !emailLimit.allowed) {
      return NextResponse.json({ error: '验证尝试过于频繁，请稍后再试' }, { status: 429 });
    }

    const verified = await verifyLoginEmailOtp(email, token, ADMIN_LOGIN_EMAIL_OTP_TYPES);
    if (!verified.user) {
      await recordAdminAuditEvent({
        request,
        action: 'admin_auth.login',
        resourceType: 'admin_user',
        success: false,
        errorCode: 'OTP_INVALID',
      });
      return NextResponse.json({ error: '验证码不正确或已过期' }, { status: 401 });
    }

    const client = getSupabaseClient();
    const { data: adminUser, error: adminError } = await client
      .from('admin_users')
      .select('id,auth_user_id,role_key,status')
      .eq('auth_user_id', verified.user.id)
      .eq('status', 'active')
      .maybeSingle();
    if (adminError) throw new Error(adminError.message);
    if (!adminUser || !isAdminRole(adminUser.role_key)) {
      await recordAdminAuditEvent({
        request,
        action: 'admin_auth.login',
        resourceType: 'admin_user',
        success: false,
        errorCode: 'ADMIN_ACCOUNT_NOT_FOUND',
      });
      return NextResponse.json({ error: '该邮箱尚未绑定管理员权限' }, { status: 403 });
    }

    const now = new Date().toISOString();
    await client.from('admin_users').update({ last_login_at: now, updated_at: now }).eq('id', adminUser.id);
    const cookie = await issueAdminSession({ adminUserId: adminUser.id, role: adminUser.role_key, request });
    const response = NextResponse.json({ data: { role: adminUser.role_key }, error: null });
    response.cookies.set(cookie);
    await recordAdminAuditEvent({
      request,
      action: 'admin_auth.login',
      resourceType: 'admin_user',
      resourceId: adminUser.id,
      metadata: { role: adminUser.role_key, method: 'otp' },
    });
    return response;
  } catch (error) {
    await recordAdminAuditFailure({ request, action: 'admin_auth.login', resourceType: 'admin_user', error });
    const migrationResponse = adminMigrationUnavailable(error, ['0121_admin_sessions.sql', '0125_confirm_auth_user_email.sql'], '管理员登录依赖数据库迁移，当前环境尚未部署');
    if (migrationResponse) return migrationResponse;
    console.error('[Admin Auth] OTP verify failed:', error);
    return NextResponse.json({ error: '管理员登录失败' }, { status: 500 });
  }
}

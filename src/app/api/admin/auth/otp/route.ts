import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getClientIp } from '@/lib/auth-server';
import { isValidEmail } from '@/lib/auth-shared';
import {
  consumeAuthRateLimit,
  normalizeEmail,
  captchaErrorIfInvalid,
} from '@/lib/auth-security';
import { readCaptchaToken } from '@/lib/altcha';
import { isAllowedAdminOrigin, rejectedAdminOriginResponse } from '@/lib/admin-origin';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';
import { adminMigrationUnavailable } from '@/lib/admin-dependency-status';
import { confirmAuthUserEmail, sendLoginEmailOtp } from '@/lib/auth-email-otp';

const GENERIC_SENT = { success: true, message: '如果该邮箱已绑定管理员，将收到验证码' };

export async function POST(request: NextRequest) {
  if (!isAllowedAdminOrigin(request)) return NextResponse.json(await rejectedAdminOriginResponse().json(), { status: 403 });

  const ip = getClientIp(request);
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: '请输入有效的邮箱地址' }, { status: 400 });
    }
    const captchaError = await captchaErrorIfInvalid(readCaptchaToken(body));
    if (captchaError) {
      return NextResponse.json({ error: captchaError }, { status: 400 });
    }

    const ipLimit = await consumeAuthRateLimit(`admin-otp:ip:${ip}`, 5, 900, 1800);
    const emailLimit = await consumeAuthRateLimit(`admin-otp:email:${email}`, 3, 900, 1800);
    if (!ipLimit.allowed || !emailLimit.allowed) {
      const retryAfter = Math.max(ipLimit.retryAfterSeconds, emailLimit.retryAfterSeconds, 60);
      return NextResponse.json({ error: '发送过于频繁，请稍后再试' }, { status: 429, headers: { 'Retry-After': String(retryAfter) } });
    }

    const client = getSupabaseClient();
    const { data: authUserId, error: lookupError } = await client.rpc('find_auth_user_id_by_email', { p_email: email });
    if (lookupError) {
      const migrationResponse = adminMigrationUnavailable(lookupError, ['0121_admin_sessions.sql', '0125_confirm_auth_user_email.sql'], '管理员登录依赖数据库迁移，当前环境尚未部署');
      if (migrationResponse) return migrationResponse;
      throw new Error(lookupError.message);
    }

    let isAdmin = false;
    if (typeof authUserId === 'string' && authUserId) {
      const { data: adminUser, error: adminError } = await client
        .from('admin_users')
        .select('id,status')
        .eq('auth_user_id', authUserId)
        .eq('status', 'active')
        .maybeSingle();
      if (adminError) throw new Error(adminError.message);
      isAdmin = Boolean(adminUser);
    }

    if (isAdmin && typeof authUserId === 'string' && authUserId) {
      try {
        await confirmAuthUserEmail(authUserId);
        await sendLoginEmailOtp(email);
        await recordAdminAuditEvent({ request, action: 'admin_auth.otp_send', resourceType: 'admin_user', metadata: { delivered: true } });
      } catch (error) {
        console.error('[Admin Auth] OTP send failed:', error instanceof Error ? error.message : error);
        await recordAdminAuditFailure({ request, action: 'admin_auth.otp_send', resourceType: 'admin_user', error });
        return NextResponse.json(GENERIC_SENT);
      }
    } else {
      await recordAdminAuditEvent({
        request,
        action: 'admin_auth.otp_send',
        resourceType: 'admin_user',
        success: false,
        errorCode: 'ADMIN_ACCOUNT_NOT_FOUND',
        metadata: { delivered: false },
      });
    }

    return NextResponse.json(GENERIC_SENT);
  } catch (error) {
    console.error('[Admin Auth] OTP request failed:', error);
    const migrationResponse = adminMigrationUnavailable(error, ['0121_admin_sessions.sql', '0125_confirm_auth_user_email.sql'], '管理员登录依赖数据库迁移，当前环境尚未部署');
    if (migrationResponse) return migrationResponse;
    return NextResponse.json({ error: '验证码发送失败，请稍后重试' }, { status: 500 });
  }
}

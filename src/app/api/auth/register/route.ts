import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAnonClient } from '@/storage/database/supabase-client';
import { getAuthRedirectOrigin, getClientIp } from '@/lib/auth-server';
import { isValidEmail } from '@/lib/auth-shared';
import {
  authErrorMessage,
  consumeAuthRateLimit,
  normalizeEmail,
  validatePassword,
  verifyTurnstileToken,
} from '@/lib/auth-security';

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    const username = typeof body.username === 'string' ? body.username.trim() : '';

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: '请输入有效的邮箱地址' }, { status: 400 });
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }
    if (username.length < 2 || username.length > 40 || /[\u0000-\u001f\u007f]/.test(username)) {
      return NextResponse.json({ error: '用户名长度需要在 2 到 40 个字符之间' }, { status: 400 });
    }

    const ipLimit = await consumeAuthRateLimit(`signup:ip:${ip}`, 5, 3600, 3600);
    const emailLimit = await consumeAuthRateLimit(`signup:email:${email}`, 3, 3600, 3600);
    if (!ipLimit.allowed || !emailLimit.allowed) {
      const retryAfter = Math.max(ipLimit.retryAfterSeconds, emailLimit.retryAfterSeconds, 60);
      return NextResponse.json(
        { error: '注册请求过于频繁，请稍后再试' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }

    if (!(await verifyTurnstileToken(body.captchaToken, ip))) {
      return NextResponse.json({ error: '请完成安全验证后再注册' }, { status: 400 });
    }

    const supabase = getSupabaseAnonClient();
    const redirectOrigin = getAuthRedirectOrigin(request);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username },
        emailRedirectTo: `${redirectOrigin}/auth/callback?next=%2Fhome`,
        captchaToken: typeof body.captchaToken === 'string' ? body.captchaToken : undefined,
      },
    });

    if (error) {
      console.error('[Auth] Sign-up failed:', error.message);
      return NextResponse.json({ error: authErrorMessage(error) }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      requiresEmailConfirmation: !data.session,
      session: data.session,
    });
  } catch (error) {
    console.error('[Auth] Sign-up request failed:', error);
    return NextResponse.json({ error: '注册失败，请稍后重试' }, { status: 500 });
  }
}

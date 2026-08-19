import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAnonClient, getSupabaseClient } from '@/storage/database/supabase-client';
import { getClientIp } from '@/lib/auth-server';
import { isValidEmail } from '@/lib/auth-shared';
import {
  authErrorMessage,
  consumeAuthRateLimit,
  isValidOtpToken,
  normalizeEmail,
  normalizeOtpToken,
} from '@/lib/auth-security';

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    const token = normalizeOtpToken(body.token);
    if (!isValidEmail(email) || !isValidOtpToken(token)) {
      console.warn('[Auth] Signup OTP format rejected:', {
        email,
        tokenLength: token.length,
        isAsciiDigits: /^\d+$/.test(token),
      });
      return NextResponse.json({ error: '验证码格式不正确' }, { status: 400 });
    }

    const ipLimit = await consumeAuthRateLimit(`signup-verify:ip:${ip}`, 10, 900, 1800);
    const emailLimit = await consumeAuthRateLimit(`signup-verify:email:${email}`, 6, 900, 1800);
    if (!ipLimit.allowed || !emailLimit.allowed) {
      return NextResponse.json({ error: '验证尝试过于频繁，请稍后再试' }, { status: 429 });
    }

    const supabase = getSupabaseAnonClient();
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'signup',
    });
    if (error || !data.session) {
      console.warn('[Auth] Signup OTP rejected:', {
        email,
        status: error?.status,
        code: error?.code,
        message: error?.message,
      });
      return NextResponse.json({ error: authErrorMessage(error) }, { status: 401 });
    }
    if (!data.user) {
      return NextResponse.json({ error: '用户信息缺失，请重新验证' }, { status: 500 });
    }
    try {
      await getSupabaseClient(data.session.access_token).rpc('grant_signup_credits', {
        p_user: data.user.id,
      });
    } catch (grantError) {
      console.error('[Auth] Failed to grant signup credits:', grantError);
    }

    return NextResponse.json({ session: data.session, user: data.user });
  } catch (error) {
    console.error('[Auth] Sign-up verification failed:', error);
    return NextResponse.json({ error: '邮箱验证失败，请稍后重试' }, { status: 500 });
  }
}

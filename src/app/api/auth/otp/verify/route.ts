import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAnonClient } from '@/storage/database/supabase-client';
import { getClientIp } from '@/lib/auth-server';
import { authErrorMessage, consumeAuthRateLimit, normalizeEmail } from '@/lib/auth-security';

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!email || !/^\d{6}$/.test(token)) {
      return NextResponse.json({ error: '验证码格式不正确' }, { status: 400 });
    }

    const ipLimit = await consumeAuthRateLimit(`otp-verify:ip:${ip}`, 10, 900, 1800);
    const emailLimit = await consumeAuthRateLimit(`otp-verify:email:${email}`, 6, 900, 1800);
    if (!ipLimit.allowed || !emailLimit.allowed) {
      return NextResponse.json({ error: '验证尝试过于频繁，请稍后再试' }, { status: 429 });
    }

    const supabase = getSupabaseAnonClient();
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error || !data.session) {
      return NextResponse.json({ error: authErrorMessage(error) }, { status: 401 });
    }
    return NextResponse.json({ session: data.session, user: data.user });
  } catch (error) {
    console.error('[Auth] OTP verification failed:', error);
    return NextResponse.json({ error: '验证码验证失败，请稍后重试' }, { status: 500 });
  }
}

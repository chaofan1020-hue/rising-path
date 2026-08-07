import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAnonClient } from '@/storage/database/supabase-client';
import { getClientIp } from '@/lib/auth-server';
import { consumeAuthRateLimit, normalizeEmail } from '@/lib/auth-security';

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    if (!email) return NextResponse.json({ error: '请输入邮箱地址' }, { status: 400 });

    const ipLimit = await consumeAuthRateLimit(`otp:ip:${ip}`, 5, 900, 1800);
    const emailLimit = await consumeAuthRateLimit(`otp:email:${email}`, 3, 900, 1800);
    if (!ipLimit.allowed || !emailLimit.allowed) {
      return NextResponse.json({ error: '发送过于频繁，请稍后再试' }, { status: 429 });
    }

    const supabase = getSupabaseAnonClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (error) {
      console.error('[Auth] OTP send failed:', error.message);
      return NextResponse.json({ error: '验证码发送失败，请稍后重试' }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Auth] OTP request failed:', error);
    return NextResponse.json({ error: '验证码发送失败，请稍后重试' }, { status: 500 });
  }
}

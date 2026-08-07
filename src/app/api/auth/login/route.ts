import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAnonClient } from '@/storage/database/supabase-client';
import { getClientIp } from '@/lib/auth-server';
import { authErrorMessage, consumeAuthRateLimit, normalizeEmail } from '@/lib/auth-security';

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) {
      return NextResponse.json({ error: '请输入邮箱和密码' }, { status: 400 });
    }

    const ipLimit = await consumeAuthRateLimit(`login:ip:${ip}`, 20, 900, 1800);
    const emailLimit = await consumeAuthRateLimit(`login:email:${email}`, 8, 900, 1800);
    if (!ipLimit.allowed || !emailLimit.allowed) {
      const retryAfter = Math.max(ipLimit.retryAfterSeconds, emailLimit.retryAfterSeconds, 60);
      return NextResponse.json(
        { error: '登录尝试过于频繁，请稍后再试' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }

    const supabase = getSupabaseAnonClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      return NextResponse.json({ error: authErrorMessage(error) }, { status: 401 });
    }

    return NextResponse.json({
      user: data.user,
      session: data.session,
    });
  } catch (error) {
    console.error('[Auth] Login request failed:', error);
    return NextResponse.json({ error: '登录失败，请稍后重试' }, { status: 500 });
  }
}

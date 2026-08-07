import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAnonClient } from '@/storage/database/supabase-client';
import { getAuthRedirectOrigin, getClientIp } from '@/lib/auth-server';
import { consumeAuthRateLimit, normalizeEmail } from '@/lib/auth-security';

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    if (!email) return NextResponse.json({ error: '请输入邮箱地址' }, { status: 400 });

    const ipLimit = await consumeAuthRateLimit(`reset:ip:${ip}`, 5, 3600, 3600);
    const emailLimit = await consumeAuthRateLimit(`reset:email:${email}`, 3, 3600, 3600);
    if (!ipLimit.allowed || !emailLimit.allowed) {
      const retryAfter = Math.max(ipLimit.retryAfterSeconds, emailLimit.retryAfterSeconds, 60);
      return NextResponse.json(
        { error: '请求过于频繁，请稍后再试' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }

    const supabase = getSupabaseAnonClient();
    const redirectOrigin = getAuthRedirectOrigin(request);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${redirectOrigin}/auth/callback?next=${encodeURIComponent('/login?mode=password')}`,
    });
    if (error) console.error('[Auth] Password reset failed:', error.message);

    // Keep the response generic so the endpoint cannot be used for account enumeration.
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Auth] Password reset request failed:', error);
    return NextResponse.json({ error: '请求失败，请稍后重试' }, { status: 500 });
  }
}

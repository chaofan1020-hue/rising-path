import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAnonClient } from '@/storage/database/supabase-client';
import { getClientIp } from '@/lib/auth-server';
import { isValidEmail } from '@/lib/auth-shared';
import {
  authErrorMessage,
  consumeAuthRateLimit,
  isAuthRateLimitError,
  normalizeEmail,
  verifyTurnstileToken,
} from '@/lib/auth-security';

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: '请输入有效的邮箱地址' }, { status: 400 });
    }

    const ipLimit = await consumeAuthRateLimit(`resend:ip:${ip}`, 3, 3600, 3600);
    const emailLimit = await consumeAuthRateLimit(`resend:email:${email}`, 2, 3600, 3600);
    if (!ipLimit.allowed || !emailLimit.allowed) {
      return NextResponse.json({ error: '发送过于频繁，请稍后再试' }, { status: 429 });
    }
    if (!(await verifyTurnstileToken(body.captchaToken, ip))) {
      return NextResponse.json({ error: '请完成安全验证后再发送' }, { status: 400 });
    }

    const supabase = getSupabaseAnonClient();
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        captchaToken: typeof body.captchaToken === 'string' ? body.captchaToken : undefined,
      },
    });
    if (error) {
      console.error('[Auth] Resend verification failed:', error.message);
      const status = isAuthRateLimitError(error) ? 429 : 400;
      return NextResponse.json(
        { error: authErrorMessage(error) },
        status === 429 ? { status, headers: { 'Retry-After': '60' } } : { status }
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Auth] Resend request failed:', error);
    return NextResponse.json({ error: '发送失败，请稍后重试' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/auth-server';
import { consumeAuthRateLimit } from '@/lib/auth-security';
import { createAltchaChallenge, isCaptchaEnabled } from '@/lib/altcha';

export const runtime = 'nodejs';

async function issueChallenge(request: NextRequest) {
  if (!isCaptchaEnabled()) {
    return NextResponse.json({ error: '人机验证未启用' }, { status: 404 });
  }

  const ip = getClientIp(request);
  const limit = await consumeAuthRateLimit(`captcha:ip:${ip}`, 40, 60, 120);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: '请求过于频繁，请稍后再试' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds || 60) } },
    );
  }

  try {
    const challenge = await createAltchaChallenge();
    return NextResponse.json(challenge, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[Auth] ALTCHA challenge failed:', error);
    return NextResponse.json({ error: '人机验证暂时不可用' }, { status: 503 });
  }
}

export async function GET(request: NextRequest) {
  return issueChallenge(request);
}

export async function POST(request: NextRequest) {
  return issueChallenge(request);
}

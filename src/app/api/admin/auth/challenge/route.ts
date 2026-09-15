import { NextResponse } from 'next/server';
import { createAdminCaptchaChallenge } from '@/lib/admin-captcha';

export async function GET() {
  try {
    const challenge = await createAdminCaptchaChallenge();
    return NextResponse.json({ challenge });
  } catch (error) {
    console.error('[Admin Auth] captcha challenge failed:', error);
    return NextResponse.json({ error: '安全验证暂时不可用，请稍后重试' }, { status: 500 });
  }
}

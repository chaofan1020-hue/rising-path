import { NextResponse } from 'next/server';
import { getSupabaseCredentials } from '@/storage/database/supabase-client';
import { isCaptchaEnabled } from '@/lib/altcha';
import { isLocalDevAuthEnabled } from '@/lib/dev-auth';

/**
 * 暴露 Supabase 公共配置给浏览器端初始化客户端。
 * anon key 是公开凭证，允许前端调用 Auth / 公开表等接口。
 */
export async function GET() {
  const devAuth = isLocalDevAuthEnabled();
  try {
    const { url, anonKey } = getSupabaseCredentials();
    return NextResponse.json(
      {
        url,
        anonKey,
        captchaEnabled: isCaptchaEnabled(),
        devAuth,
      },
      { headers: { 'Cache-Control': 'private, max-age=60' } },
    );
  } catch (error) {
    if (devAuth) {
      return NextResponse.json(
        { url: '', anonKey: '', captchaEnabled: false, devAuth: true },
        { headers: { 'Cache-Control': 'private, max-age=60' } },
      );
    }
    console.error('[Auth] Public Supabase config unavailable:', error);
    return NextResponse.json({ error: 'Supabase 配置缺失' }, { status: 500 });
  }
}

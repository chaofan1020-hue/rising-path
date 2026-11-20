import { NextResponse } from 'next/server';
import { getSupabaseCredentials } from '@/storage/database/supabase-client';
import { isCaptchaEnabled } from '@/lib/altcha';
import { isLocalDevAuthEnabled } from '@/lib/dev-auth';

/**
 * 暴露 Supabase 公共配置给浏览器端初始化客户端。
 * anon key 是公开凭证，允许前端调用 Auth / 公开表等接口。
 */
const PUBLIC_CONFIG_CACHE = 'public, max-age=300, s-maxage=300, stale-while-revalidate=600';

/**
 * Values here are deployment constants (Supabase URL + publishable anon key,
 * captcha + dev-auth flags), never user data. Letting the edge serve them keeps
 * the login page's captcha from waiting on a cross-region origin round trip.
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
      { headers: { 'Cache-Control': PUBLIC_CONFIG_CACHE } },
    );
  } catch (error) {
    if (devAuth) {
      return NextResponse.json(
        { url: '', anonKey: '', captchaEnabled: false, devAuth: true },
        { headers: { 'Cache-Control': PUBLIC_CONFIG_CACHE } },
      );
    }
    console.error('[Auth] Public Supabase config unavailable:', error);
    return NextResponse.json({ error: 'Supabase 配置缺失' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { getSupabaseCredentials } from '@/storage/database/supabase-client';

/**
 * 暴露 Supabase 公共配置给浏览器端初始化客户端。
 * anon key 是公开凭证，允许前端调用 Auth / 公开表等接口。
 */
export async function GET() {
  try {
    const { url, anonKey } = getSupabaseCredentials();
    return NextResponse.json(
      { url, anonKey },
      { headers: { 'Cache-Control': 'private, max-age=300' } },
    );
  } catch (error) {
    console.error('[Auth] Public Supabase config unavailable:', error);
    return NextResponse.json({ error: 'Supabase 配置缺失' }, { status: 500 });
  }
}

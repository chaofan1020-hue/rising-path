import { NextResponse } from 'next/server';

/**
 * 暴露 Supabase 公共配置给浏览器端初始化客户端。
 * anon key 是公开凭证，允许前端调用 Auth / 公开表等接口。
 */
export async function GET() {
  const url = process.env.SUPABASE_URL || process.env.COZE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.COZE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return NextResponse.json({ error: 'Supabase 配置缺失' }, { status: 500 });
  }

  return NextResponse.json({ url, anonKey });
}

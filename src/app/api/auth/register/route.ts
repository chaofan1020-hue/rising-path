import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { email, password } = body;

  if (!email || !password || password.length < 6) {
    return NextResponse.json(
      { error: '请提供有效的邮箱和至少 6 位密码' },
      { status: 400 }
    );
  }

  const supabase = getSupabaseClient();

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
  });

  if (signUpError || !authData.user) {
    return NextResponse.json(
      { error: signUpError?.message || '注册失败，请稍后重试' },
      { status: 400 }
    );
  }

  const userId = authData.user.id;

  // Create a corresponding access code for data isolation backward compatibility
  const { data: codeData, error: codeError } = await supabase
    .from('access_codes')
    .insert({
      code: userId.slice(0, 16),
      name: email,
      duration_days: 3650,
      is_active: true,
    })
    .select('id')
    .single();

  if (codeError || !codeData) {
    return NextResponse.json(
      { error: '注册成功但初始化用户空间失败，请联系管理员' },
      { status: 500 }
    );
  }

  await supabase.from('user_access_codes').insert({
    user_id: userId,
    access_code_id: codeData.id,
  });

  return NextResponse.json({
    user: { id: userId, email: authData.user.email },
    accessCodeId: codeData.id,
  });
}

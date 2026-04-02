import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function POST(request: NextRequest) {
  try {
    const { email, password, fullName } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: '邮箱和密码不能为空' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: '密码长度至少为6位' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // Register user with Supabase Auth
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
        // Disable email confirmation for development
        emailRedirectTo: undefined,
      },
    });

    if (error) {
      console.error('Registration error:', error);
      
      // Handle specific error cases
      if (error.message.includes('already registered')) {
        return NextResponse.json(
          { error: '该邮箱已被注册' },
          { status: 400 }
        );
      }
      
      return NextResponse.json(
        { error: error.message || '注册失败' },
        { status: 400 }
      );
    }

    // Check if user was created successfully
    if (!data.user) {
      return NextResponse.json(
        { error: '注册失败，请重试' },
        { status: 500 }
      );
    }

    // Check if email confirmation is required
    if (!data.session && data.user.identities?.length === 0) {
      return NextResponse.json({
        success: true,
        message: '注册成功！请检查邮箱验证后登录。',
        requiresEmailConfirmation: true,
      });
    }

    // If session exists, user is auto-confirmed
    return NextResponse.json({
      success: true,
      message: '注册成功！',
      user: {
        id: data.user.id,
        email: data.user.email,
      },
      session: data.session ? {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      } : null,
    });

  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: '服务器错误，请稍后重试' },
      { status: 500 }
    );
  }
}

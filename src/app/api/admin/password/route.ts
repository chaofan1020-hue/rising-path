import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import {
  getAdminSessionCookie,
  getClearedAdminSessionCookie,
  hasValidAdminSession,
} from '@/lib/admin-auth';
import { getClientIp } from '@/lib/auth-server';
import { consumeAuthRateLimit } from '@/lib/auth-security';
import crypto from 'node:crypto';

const DEFAULT_PASSWORD = 'risingpath2024';

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password + 'risingpath_salt').digest('hex');
}

function verifyPassword(inputPassword: string, hashedPassword: string): boolean {
  return hashPassword(inputPassword) === hashedPassword;
}

// 获取当前密码
export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    
    const { data, error } = await client
      .from('job_configs')
      .select('config_value')
      .eq('config_type', 'admin_password_hash')
      .eq('is_active', true)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`查询密码失败: ${error.message}`);
    }

    // 如果没有设置密码，使用默认密码
    const hasCustomPassword = !!data?.config_value;
    
    return NextResponse.json({ 
      hasCustomPassword,
      authenticated: hasValidAdminSession(request),
      message: hasCustomPassword ? '已设置自定义密码' : '使用默认密码'
    });
  } catch (error) {
    console.error('Error fetching password:', error);
    return NextResponse.json(
      { error: '获取密码信息失败' },
      { status: 500 }
    );
  }
}

// 验证密码
export async function POST(request: NextRequest) {
  try {
    const rateLimit = await consumeAuthRateLimit(`admin-login:ip:${getClientIp(request)}`, 5, 900, 1800);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: '尝试过于频繁，请稍后再试' },
        { status: 429, headers: { 'Retry-After': String(Math.max(rateLimit.retryAfterSeconds, 60)) } }
      );
    }

    const client = getSupabaseClient();
    const body = await request.json();
    const { password } = body;

    if (!password) {
      return NextResponse.json(
        { error: '请输入密码' },
        { status: 400 }
      );
    }

    // 查询自定义密码
    const { data, error } = await client
      .from('job_configs')
      .select('config_value')
      .eq('config_type', 'admin_password_hash')
      .eq('is_active', true)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`查询密码失败: ${error.message}`);
    }

    let isValid = false;

    if (data?.config_value) {
      // 使用自定义密码验证
      isValid = verifyPassword(password, data.config_value);
    } else {
      // 使用默认密码
      isValid = password === DEFAULT_PASSWORD;
    }

    const response = NextResponse.json({
      valid: isValid,
      message: isValid ? '验证成功' : '密码错误'
    });
    if (isValid) response.cookies.set(getAdminSessionCookie());
    return response;
  } catch (error) {
    console.error('Error verifying password:', error);
    return NextResponse.json(
      { error: '验证密码失败' },
      { status: 500 }
    );
  }
}

// 修改密码
export async function PUT(request: NextRequest) {
  try {
    if (!hasValidAdminSession(request)) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 401 });
    }

    const client = getSupabaseClient();
    const body = await request.json();
    const { oldPassword, newPassword } = body;

    if (!oldPassword || !newPassword) {
      return NextResponse.json(
        { error: '请填写完整信息' },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { error: '新密码至少6位' },
        { status: 400 }
      );
    }

    // 查询当前密码
    const { data: existingPassword, error: queryError } = await client
      .from('job_configs')
      .select('id, config_value')
      .eq('config_type', 'admin_password_hash')
      .eq('is_active', true)
      .single();

    if (queryError && queryError.code !== 'PGRST116') {
      throw new Error(`查询密码失败: ${queryError.message}`);
    }

    // 验证旧密码
    let isOldPasswordValid = false;
    if (existingPassword?.config_value) {
      isOldPasswordValid = verifyPassword(oldPassword, existingPassword.config_value);
    } else {
      isOldPasswordValid = oldPassword === DEFAULT_PASSWORD;
    }

    if (!isOldPasswordValid) {
      return NextResponse.json(
        { error: '原密码错误' },
        { status: 400 }
      );
    }

    // 保存新密码
    const hashedNewPassword = hashPassword(newPassword);

    if (existingPassword?.id) {
      // 更新现有密码
      const { error: updateError } = await client
        .from('job_configs')
        .update({ config_value: hashedNewPassword })
        .eq('id', existingPassword.id);

      if (updateError) {
        throw new Error(`更新密码失败: ${updateError.message}`);
      }
    } else {
      // 创建新密码记录
      const { error: insertError } = await client
        .from('job_configs')
        .insert({
          config_type: 'admin_password_hash',
          config_value: hashedNewPassword,
          sort_order: 999,
          is_active: true,
        });

      if (insertError) {
        throw new Error(`保存密码失败: ${insertError.message}`);
      }
    }

    return NextResponse.json({ 
      success: true,
      message: '密码修改成功'
    });
  } catch (error) {
    console.error('Error updating password:', error);
    return NextResponse.json(
      { error: '修改密码失败' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(getClearedAdminSessionCookie());
  return response;
}

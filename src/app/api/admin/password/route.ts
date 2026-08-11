import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import {
  getAdminSessionCookie,
  getClearedAdminSessionCookie,
  hasValidAdminSession,
} from '@/lib/admin-auth';
import { getClientIp } from '@/lib/auth-server';
import { consumeAuthRateLimit } from '@/lib/auth-security';
import {
  getAdminBootstrapPassword,
  hashAdminPassword,
  isAdminPasswordInput,
  isStrongAdminPasswordInput,
  verifyAdminPasswordHash,
} from '@/lib/admin-password';

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

    const hasCustomPassword = !!data?.config_value;
    const hasBootstrapPassword = !hasCustomPassword && !!getAdminBootstrapPassword();
    
    return NextResponse.json({ 
      hasCustomPassword,
      authenticated: hasValidAdminSession(request),
      message: hasCustomPassword
        ? '已设置自定义密码'
        : hasBootstrapPassword
          ? '等待首次初始化'
          : '管理员密码尚未初始化，请配置 ADMIN_BOOTSTRAP_PASSWORD',
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

    if (!isAdminPasswordInput(password)) {
      return NextResponse.json(
        { error: '请输入有效密码（最多256位）' },
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
      const verification = await verifyAdminPasswordHash(password, data.config_value);
      isValid = verification.valid;
      if (isValid && verification.needsRehash) {
        const upgradedHash = await hashAdminPassword(password);
        const { error: upgradeError } = await client
          .from('job_configs')
          .update({ config_value: upgradedHash })
          .eq('config_type', 'admin_password_hash')
          .eq('is_active', true);
        if (upgradeError) {
          console.error('Admin password hash upgrade failed:', upgradeError);
        }
      }
    } else {
      isValid = password === getAdminBootstrapPassword();
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

    if (!isAdminPasswordInput(oldPassword) || !isStrongAdminPasswordInput(newPassword)) {
      return NextResponse.json(
        { error: `原密码不能为空，新密码长度必须为 ${12}-${256} 位` },
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
      isOldPasswordValid = (await verifyAdminPasswordHash(oldPassword, existingPassword.config_value)).valid;
    } else {
      isOldPasswordValid = oldPassword === getAdminBootstrapPassword();
    }

    if (!isOldPasswordValid) {
      return NextResponse.json(
        { error: '原密码错误' },
        { status: 400 }
      );
    }

    // 保存新密码
    const hashedNewPassword = await hashAdminPassword(newPassword);

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

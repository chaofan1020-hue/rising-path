import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 生成随机访问码
function generateAccessCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// 获取所有访问码
export async function GET() {
  try {
    const client = getSupabaseClient();
    
    const { data, error } = await client
      .from('access_codes')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`查询访问码失败: ${error.message}`);
    }

    return NextResponse.json({ codes: data });
  } catch (error) {
    console.error('Error fetching access codes:', error);
    return NextResponse.json(
      { error: '获取访问码列表失败' },
      { status: 500 }
    );
  }
}

// 创建新访问码
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const body = await request.json();
    
    const { name, duration_days } = body;
    
    // 生成唯一访问码
    let code = generateAccessCode();
    let attempts = 0;
    
    // 确保访问码唯一
    while (attempts < 10) {
      const { data: existing } = await client
        .from('access_codes')
        .select('id')
        .eq('code', code)
        .single();
      
      if (!existing) break;
      code = generateAccessCode();
      attempts++;
    }
    
    // 计算过期时间
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (duration_days || 30));

    const { data, error } = await client
      .from('access_codes')
      .insert({
        code,
        name: name || `访问码 ${code}`,
        duration_days: duration_days || 30,
        expires_at: expiresAt.toISOString(),
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`创建访问码失败: ${error.message}`);
    }

    return NextResponse.json({ code: data });
  } catch (error) {
    console.error('Error creating access code:', error);
    return NextResponse.json(
      { error: '创建访问码失败' },
      { status: 500 }
    );
  }
}

// 删除访问码
export async function DELETE(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ error: '缺少访问码ID' }, { status: 400 });
    }

    const { error } = await client
      .from('access_codes')
      .delete()
      .eq('id', parseInt(id));

    if (error) {
      throw new Error(`删除访问码失败: ${error.message}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting access code:', error);
    return NextResponse.json(
      { error: '删除访问码失败' },
      { status: 500 }
    );
  }
}

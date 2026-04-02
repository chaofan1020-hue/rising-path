import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 验证访问码
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const body = await request.json();
    const { code } = body;
    
    if (!code) {
      return NextResponse.json({ 
        valid: false, 
        error: '请输入访问码' 
      }, { status: 400 });
    }

    const { data: accessCode, error } = await client
      .from('access_codes')
      .select('*')
      .eq('code', code.toUpperCase())
      .single();

    if (error || !accessCode) {
      return NextResponse.json({ 
        valid: false, 
        error: '访问码无效' 
      }, { status: 401 });
    }

    // 检查是否已禁用
    if (!accessCode.is_active) {
      return NextResponse.json({ 
        valid: false, 
        error: '访问码已被禁用' 
      }, { status: 403 });
    }

    // 检查是否过期
    const now = new Date();
    const expiresAt = new Date(accessCode.expires_at);
    
    if (now > expiresAt) {
      return NextResponse.json({ 
        valid: false, 
        error: '访问码已过期' 
      }, { status: 403 });
    }

    // 更新最后使用时间
    await client
      .from('access_codes')
      .update({ last_used_at: now.toISOString() })
      .eq('id', accessCode.id);

    return NextResponse.json({ 
      valid: true, 
      code: {
        id: accessCode.id,
        code: accessCode.code,
        name: accessCode.name,
        expires_at: accessCode.expires_at,
      }
    });
  } catch (error) {
    console.error('Error verifying access code:', error);
    return NextResponse.json({ 
      valid: false, 
      error: '验证失败，请稍后重试' 
    }, { status: 500 });
  }
}

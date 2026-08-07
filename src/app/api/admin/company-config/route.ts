import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { hasValidAdminSession } from '@/lib/admin-auth';

// 获取所有公司配置
export async function GET(request: NextRequest) {
  if (!hasValidAdminSession(request)) {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 401 });
  }

  try {
    const supabase = getSupabaseClient();
    
    const { data, error } = await supabase
      .from('company_config')
      .select('*')
      .order('company_name');

    if (error) {
      console.error('Company config query error:', error);
      return NextResponse.json({ error: '获取失败', detail: error.message }, { status: 500 });
    }

    return NextResponse.json({ companies: data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Company config error:', message);
    return NextResponse.json({ error: '服务器错误', detail: message }, { status: 500 });
  }
}

// 添加或更新公司配置
export async function POST(request: NextRequest) {
  if (!hasValidAdminSession(request)) {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 401 });
  }

  try {
    const supabase = getSupabaseClient();
    const body = await request.json();
    
    const { 
      company_name, 
      short_desc, 
      full_desc, 
      industry, 
      headquarters, 
      founded_year, 
      employees, 
      careers_page,
      logo_url,
    } = body;

    if (!company_name) {
      return NextResponse.json({ error: '公司名称是必填项' }, { status: 400 });
    }

    // 检查是否已存在
    const { data: existing } = await supabase
      .from('company_config')
      .select('id')
      .eq('company_name', company_name)
      .single();

    if (existing) {
      // 更新
      const { error } = await supabase
        .from('company_config')
        .update({
          short_desc,
          full_desc,
          industry,
          headquarters,
          founded_year,
          employees,
          careers_page,
          logo_url,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (error) {
        console.error('Update error:', error);
        return NextResponse.json({ error: '更新失败: ' + error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: '公司配置已更新' });
    } else {
      // 新增
      const { error } = await supabase
        .from('company_config')
        .insert({
          company_name,
          short_desc,
          full_desc,
          industry,
          headquarters,
          founded_year,
          employees,
          careers_page,
          logo_url,
        });

      if (error) {
        return NextResponse.json({ error: '添加失败' }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: '公司已添加' });
    }
  } catch (error) {
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

// 删除公司配置
export async function DELETE(request: NextRequest) {
  if (!hasValidAdminSession(request)) {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 401 });
  }

  try {
    const supabase = getSupabaseClient();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    const { error } = await supabase
      .from('company_config')
      .delete()
      .eq('id', parseInt(id));

    if (error) {
      return NextResponse.json({ error: '删除失败' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 获取所有公司配置
export async function GET() {
  try {
    const supabase = getSupabaseClient();
    
    const { data, error } = await supabase
      .from('company_config')
      .select('*')
      .order('company_name');

    if (error) {
      return NextResponse.json({ error: '获取失败' }, { status: 500 });
    }

    return NextResponse.json({ companies: data });
  } catch (error) {
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

// 添加或更新公司配置
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();
    const body = await request.json();
    
    const { 
      company_name, 
      careers_url, 
      careers_url_label,
      ats_type, 
      ats_id, 
      logo_url,
      description,
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
          careers_url,
          careers_url_label,
          ats_type,
          ats_id,
          logo_url,
          description,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (error) {
        return NextResponse.json({ error: '更新失败' }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: '公司配置已更新' });
    } else {
      // 新增
      const { error } = await supabase
        .from('company_config')
        .insert({
          company_name,
          careers_url,
          careers_url_label,
          ats_type: ats_type || 'manual',
          ats_id,
          logo_url,
          description,
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

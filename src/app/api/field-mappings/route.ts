import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';

// 获取字段映射列表
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const { searchParams } = new URL(request.url);
    const company = searchParams.get('company');

    let query = client
      .from('field_mappings')
      .select('*')
      .eq('user_id', auth.user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    // 如果提供了公司名，进行模糊匹配
    if (company) {
      query = query.ilike('company_pattern', `%${company}%`);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`查询字段映射失败: ${error.message}`);
    }

    return NextResponse.json({ mappings: data });
  } catch (error) {
    console.error('Error fetching field mappings:', error);
    return NextResponse.json(
      { error: '获取字段映射失败' },
      { status: 500 }
    );
  }
}

// 创建字段映射
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const body = await request.json();
    const { mappings } = body;

    if (!mappings || !Array.isArray(mappings)) {
      return NextResponse.json({ error: '无效的映射数据' }, { status: 400 });
    }

    // 准备插入的数据
    const insertData = mappings.map((m: { company_pattern: string; field_name: string; target_field: string }) => ({
      user_id: auth.user.id,
      company_pattern: m.company_pattern,
      field_name: m.field_name,
      target_field: m.target_field,
      is_active: true,
    }));

    const { data, error } = await client
      .from('field_mappings')
      .insert(insertData)
      .select();

    if (error) {
      throw new Error(`创建字段映射失败: ${error.message}`);
    }

    return NextResponse.json({ mappings: data });
  } catch (error) {
    console.error('Error creating field mappings:', error);
    return NextResponse.json(
      { error: '创建字段映射失败' },
      { status: 500 }
    );
  }
}

// 批量更新或删除字段映射
export async function PUT(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const body = await request.json();
    const { mappings } = body;

    // 先删除旧的映射
    await client
      .from('field_mappings')
      .delete()
      .eq('user_id', auth.user.id);

    // 批量插入新映射
    if (mappings && mappings.length > 0) {
      const insertData = mappings.map((m: { company_pattern: string; field_name: string; target_field: string }) => ({
        user_id: auth.user.id,
        company_pattern: m.company_pattern,
        field_name: m.field_name,
        target_field: m.target_field,
        is_active: true,
      }));

      const { error } = await client
        .from('field_mappings')
        .insert(insertData);

      if (error) {
        throw new Error(`更新字段映射失败: ${error.message}`);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating field mappings:', error);
    return NextResponse.json(
      { error: '更新字段映射失败' },
      { status: 500 }
    );
  }
}

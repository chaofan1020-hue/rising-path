import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// GET /api/extension/sync - 扩展同步接口
export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { searchParams } = new URL(request.url);
    const accessCode = searchParams.get('code') || 'demo';

    // 查找访问码对应的 ID
    const { data: accessCodeData, error: codeError } = await client
      .from('access_codes')
      .select('id')
      .eq('code', accessCode)
      .eq('is_active', true)
      .single();

    const accessCodeId = accessCodeData?.id || 1; // 默认使用 ID 1

    // 获取简历
    const { data: resumes } = await client
      .from('resumes')
      .select('id, file_name, parsed_fields, created_at')
      .eq('access_code_id', accessCodeId)
      .order('created_at', { ascending: false })
      .limit(5);

    // 获取字段映射
    const { data: mappings } = await client
      .from('field_mappings')
      .select('*')
      .eq('access_code_id', accessCodeId);

    // 返回简化的数据
    return NextResponse.json({
      success: true,
      resume: resumes?.[0] || null,
      resumes: resumes || [],
      mappings: mappings || [],
      accessCodeId: accessCodeId
    });
  } catch (error) {
    console.error('Extension sync error:', error);
    return NextResponse.json({
      success: false,
      error: '同步失败',
      message: error instanceof Error ? error.message : '未知错误'
    }, { status: 500 });
  }
}

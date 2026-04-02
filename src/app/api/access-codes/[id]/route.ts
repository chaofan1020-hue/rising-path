import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 更新访问码
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = getSupabaseClient();
    const { id } = await params;
    const body = await request.json();
    
    const { data, error } = await client
      .from('access_codes')
      .update(body)
      .eq('id', parseInt(id))
      .select()
      .single();

    if (error) {
      throw new Error(`更新访问码失败: ${error.message}`);
    }

    return NextResponse.json({ success: true, code: data });
  } catch (error) {
    console.error('Error updating access code:', error);
    return NextResponse.json(
      { error: '更新访问码失败' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = getSupabaseClient();
    const { id } = await params;

    // Delete from database (文件内容存储在数据库中，无需单独删除)
    const { error } = await client
      .from('resumes')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`删除简历失败: ${error.message}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting resume:', error);
    return NextResponse.json(
      { error: '删除简历失败' },
      { status: 500 }
    );
  }
}

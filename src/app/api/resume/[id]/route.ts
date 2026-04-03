import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = getSupabaseClient();
    const { id } = await params;

    // 先删除关联的 ai_matches 记录
    const { error: matchError } = await client
      .from('ai_matches')
      .delete()
      .eq('resume_id', id);

    if (matchError) {
      console.error('Error deleting ai_matches:', matchError);
    }

    // 删除关联的 applications 记录
    const { error: appError } = await client
      .from('applications')
      .delete()
      .eq('resume_id', id);

    if (appError) {
      console.error('Error deleting applications:', appError);
    }

    // 最后删除简历本身
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

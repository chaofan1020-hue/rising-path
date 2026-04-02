import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { S3Storage } from 'coze-coding-dev-sdk';

const storage = new S3Storage({
  endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
  accessKey: '',
  secretKey: '',
  bucketName: process.env.COZE_BUCKET_NAME,
  region: 'cn-beijing',
});

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = getSupabaseClient();
    const { id } = await params;

    // Get resume info
    const { data: resume, error: fetchError } = await client
      .from('resumes')
      .select('file_key')
      .eq('id', id)
      .single();

    if (fetchError || !resume) {
      throw new Error('简历不存在');
    }

    // Delete from S3
    await storage.deleteFile({ fileKey: resume.file_key });

    // Delete from database
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

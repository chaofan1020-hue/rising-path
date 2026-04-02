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

export async function GET() {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('resumes')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`查询简历失败: ${error.message}`);
    }

    return NextResponse.json({ resumes: data });
  } catch (error) {
    console.error('Error fetching resumes:', error);
    return NextResponse.json(
      { error: '获取简历列表失败' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: '未提供文件' }, { status: 400 });
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to S3
    const fileKey = await storage.uploadFile({
      fileContent: buffer,
      fileName: `resumes/${Date.now()}_${file.name}`,
      contentType: file.type,
    });

    // Create resume record
    const { data, error } = await client
      .from('resumes')
      .insert({
        file_key: fileKey,
        file_name: file.name,
        parsed_content: '简历解析中...',
        user_info: {},
      })
      .select()
      .single();

    if (error) {
      throw new Error(`创建简历记录失败: ${error.message}`);
    }

    return NextResponse.json({ resume: data });
  } catch (error) {
    console.error('Error uploading resume:', error);
    return NextResponse.json(
      { error: '上传简历失败' },
      { status: 500 }
    );
  }
}

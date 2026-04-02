import { NextRequest, NextResponse } from 'next/server';
import { S3Storage } from 'coze-coding-dev-sdk';

const storage = new S3Storage({
  endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
  accessKey: '',
  secretKey: '',
  bucketName: process.env.COZE_BUCKET_NAME,
  region: 'cn-beijing',
});

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: '未提供文件' }, { status: 400 });
    }

    // 验证文件类型
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: '仅支持 PNG、JPG、SVG、WebP 格式的图片' },
        { status: 400 }
      );
    }

    // 验证文件大小 (最大 2MB)
    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json(
        { error: '文件大小不能超过 2MB' },
        { status: 400 }
      );
    }

    // 转换为 Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 生成文件名
    const timestamp = Date.now();
    const ext = file.name.split('.').pop() || 'png';
    const fileName = `logos/${timestamp}_${Math.random().toString(36).substring(7)}.${ext}`;

    // 上传到 S3
    const fileKey = await storage.uploadFile({
      fileContent: buffer,
      fileName,
      contentType: file.type,
    });

    // 构造公开访问URL
    const bucketName = process.env.COZE_BUCKET_NAME;
    const endpointUrl = process.env.COZE_BUCKET_ENDPOINT_URL;
    
    // fileKey格式通常是 bucket名/路径，需要去掉bucket前缀
    const cleanKey = fileKey.replace(`${bucketName}/`, '');
    const publicUrl = `${endpointUrl}/${cleanKey}`;

    return NextResponse.json({ 
      url: publicUrl,
      fileKey,
    });
  } catch (error) {
    console.error('Error uploading logo:', error);
    return NextResponse.json(
      { error: '上传失败' },
      { status: 500 }
    );
  }
}

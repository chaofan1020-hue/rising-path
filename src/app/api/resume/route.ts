import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { hasValidAdminSession } from '@/lib/admin-auth';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import {
  hasSupportedResumeFileSignature,
  isSupportedResumeFile,
  MAX_RESUME_FILE_SIZE_BYTES,
  sanitizeResumeRecord,
  type ResumeFileOptions,
} from '@/lib/resume-parser';
import { processResume } from '@/lib/resume-processing';
import { deleteResumeFile, uploadResumeFile } from '@/lib/resume-storage';
import { creditResponse, assertCreditsAvailable } from '@/lib/credits';

export async function GET(request: NextRequest) {
  try {
    const isAdmin = hasValidAdminSession(request);
    if (isAdmin) {
      return NextResponse.json({ error: '管理员请使用 /api/admin/resumes 获取脱敏分页数据' }, { status: 403 });
    }
    const auth = isAdmin ? null : await getAuthContext(request);
    if (!isAdmin && !auth) return unauthorizedResponse();
    const client = isAdmin ? getSupabaseClient() : auth!.client;
    let query = client.from('resumes').select('*');
    if (auth) query = query.eq('user_id', auth.user.id);

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw new Error(`查询简历失败: ${error.message}`);

    return NextResponse.json({
      resumes: (data || []).map((resume) => sanitizeResumeRecord(resume)),
    });
  } catch (error) {
    console.error('Error fetching resumes:', error);
    return NextResponse.json({ error: '获取简历列表失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const formData = await request.formData();
    const fileEntry = formData.get('file');

    if (!(fileEntry instanceof File)) {
      return NextResponse.json({ error: '未提供文件' }, { status: 400 });
    }
    if (fileEntry.size === 0) {
      return NextResponse.json({ error: '文件内容为空' }, { status: 400 });
    }
    if (fileEntry.size > MAX_RESUME_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: '简历文件不能超过 10MB' }, { status: 413 });
    }

    const fileName = fileEntry.name.trim() || 'resume';
    const fileOptions: ResumeFileOptions = {
      fileName,
      contentType: fileEntry.type,
    };
    if (!isSupportedResumeFile(fileOptions)) {
      return NextResponse.json(
        { error: '不支持的文件格式，目前仅支持 PDF、DOCX 和 TXT' },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await fileEntry.arrayBuffer());
    if (!hasSupportedResumeFileSignature(buffer, fileOptions)) {
      return NextResponse.json({ error: '文件内容与声明格式不匹配' }, { status: 400 });
    }
    await assertCreditsAvailable({ userId: auth.user.id, metric: 'resume_parse' });
    const fileKey = await uploadResumeFile(buffer, auth.user.id, fileName, fileEntry.type);
    const storedUserInfo = { file_type: fileEntry.type };

    let resumeData: { id: number } & Record<string, unknown>;
    try {
      const { data, error: insertError } = await client
        .from('resumes')
        .insert({
          file_key: fileKey,
          file_name: fileName,
          parsed_content: '正在解析简历内容...',
          user_info: storedUserInfo,
          user_id: auth.user.id,
          processing_status: 'uploaded',
          processing_stage: 'queued',
          processing_attempts: 0,
        })
        .select()
        .single();

      if (insertError || !data) {
        throw new Error(`创建简历记录失败: ${insertError?.message || '未返回简历记录'}`);
      }
      resumeData = data as { id: number } & Record<string, unknown>;
    } catch (error) {
      try {
        await deleteResumeFile(fileKey);
      } catch (cleanupError) {
        console.error('[Resume] orphaned upload cleanup failed:', cleanupError);
      }
      throw error;
    }

    void processResume({
      resumeId: resumeData.id,
      userId: auth.user.id,
      buffer,
      fileOptions,
      initialUserInfo: storedUserInfo,
      source: 'initial_parse',
    }).catch((error) => {
      console.error('Background parsing error:', error);
    });

    return NextResponse.json({ resume: sanitizeResumeRecord(resumeData) });
  } catch (error) {
    console.error('Error uploading resume:', error);
    const creditsResponse = creditResponse(error);
    if (creditsResponse) return creditsResponse;
    return NextResponse.json({ error: '上传简历失败' }, { status: 500 });
  }
}

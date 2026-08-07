import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { hasValidAdminSession } from '@/lib/admin-auth';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import {
  isRecord,
  isSupportedResumeFile,
  mergeResumeUserInfo,
  parseResumeFile,
  sanitizeResumeRecord,
  type ResumeFileOptions,
} from '@/lib/resume-parser';

export async function GET(request: NextRequest) {
  try {
    const isAdmin = hasValidAdminSession(request);
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
    const fileBase64 = buffer.toString('base64');
    const storedUserInfo = {
      file_base64: fileBase64,
      file_type: fileEntry.type,
    };

    const { data: resumeData, error: insertError } = await client
      .from('resumes')
      .insert({
        file_key: `local://${fileName}`,
        file_name: fileName,
        parsed_content: '正在解析简历内容...',
        user_info: storedUserInfo,
        user_id: auth.user.id,
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`创建简历记录失败: ${insertError.message}`);
    }

    void parseResumeInBackground(resumeData.id, auth.user.id, buffer, fileOptions, storedUserInfo);

    return NextResponse.json({ resume: sanitizeResumeRecord(resumeData) });
  } catch (error) {
    console.error('Error uploading resume:', error);
    return NextResponse.json({ error: '上传简历失败' }, { status: 500 });
  }
}

async function parseResumeInBackground(
  resumeId: number,
  userId: string,
  buffer: Buffer,
  fileOptions: ResumeFileOptions,
  initialUserInfo: Record<string, unknown>,
): Promise<void> {
  try {
    const client = getSupabaseClient();
    const parsed = await parseResumeFile(buffer, fileOptions);

    const { data: currentResume, error: currentResumeError } = await client
      .from('resumes')
      .select('user_info, profile, segmentation')
      .eq('id', resumeId)
      .eq('user_id', userId)
      .single();

    if (currentResumeError) {
      console.error('Failed to read current resume metadata:', currentResumeError);
    }

    const currentUserInfo = isRecord(currentResume?.user_info) ? currentResume.user_info : initialUserInfo;
    const { error: updateError } = await client
      .from('resumes')
      .update({
        parsed_content: parsed.parsed_content,
        user_info: mergeResumeUserInfo(currentUserInfo, parsed.user_info),
        profile: parsed.profile ?? currentResume?.profile ?? null,
        segmentation: parsed.segmentation ?? currentResume?.segmentation ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', resumeId)
      .eq('user_id', userId);

    if (updateError) {
      console.error('Failed to update parsed resume:', updateError);
    } else {
      console.log(
        'Resume parsed successfully:',
        resumeId,
        parsed.segmentation ? `[分层] ${parsed.segmentation.summary}` : '[分层] 画像提取失败，仅基础解析',
      );
    }
  } catch (error) {
    console.error('Background parsing error:', error);

    try {
      const client = getSupabaseClient();
      await client
        .from('resumes')
        .update({
          parsed_content: '简历解析失败，请检查文件格式是否正确',
          updated_at: new Date().toISOString(),
        })
        .eq('id', resumeId)
        .eq('user_id', userId);
    } catch (updateError) {
      console.error('Failed to save resume parsing error:', updateError);
    }
  }
}

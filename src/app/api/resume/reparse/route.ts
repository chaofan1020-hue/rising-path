import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import {
  getStoredResumeFile,
  isSupportedResumeFile,
  mergeResumeUserInfo,
  parseResumeFile,
  sanitizeResumeRecord,
  UnsupportedResumeFileError,
  type ResumeFileOptions,
} from '@/lib/resume-parser';

function parsePositiveInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

// POST /api/resume/reparse - 重新解析简历
export async function POST(request: NextRequest) {
  let resumeId: number | null = null;

  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const body = await request.json() as { resumeId?: unknown };
    resumeId = parsePositiveInteger(body.resumeId);

    if (!resumeId) {
      return NextResponse.json({ error: '无效的简历 ID' }, { status: 400 });
    }

    const { data: resume, error: fetchError } = await client
      .from('resumes')
      .select('*')
      .eq('id', resumeId)
      .eq('user_id', auth.user.id)
      .single();

    if (fetchError || !resume) {
      return NextResponse.json({ error: '简历不存在或无权访问' }, { status: 404 });
    }

    const storedFile = getStoredResumeFile(resume.user_info);
    if (!storedFile) {
      return NextResponse.json({ error: '简历文件内容不存在' }, { status: 404 });
    }

    const fileOptions: ResumeFileOptions = {
      fileName: resume.file_name,
      contentType: storedFile.fileType,
    };
    if (!isSupportedResumeFile(fileOptions)) {
      return NextResponse.json(
        { error: '不支持的文件格式，目前仅支持 PDF、DOCX 和 TXT' },
        { status: 400 },
      );
    }

    const fileBuffer = Buffer.from(storedFile.fileBase64, 'base64');
    const { error: statusError } = await client
      .from('resumes')
      .update({ parsed_content: '正在解析简历内容...' })
      .eq('id', resumeId)
      .eq('user_id', auth.user.id);

    if (statusError) throw new Error(`更新解析状态失败: ${statusError.message}`);

    let parsed;
    try {
      parsed = await parseResumeFile(fileBuffer, fileOptions);
    } catch (error) {
      await client
        .from('resumes')
        .update({
          parsed_content: '简历解析失败，请检查文件格式是否正确',
          updated_at: new Date().toISOString(),
        })
        .eq('id', resumeId)
        .eq('user_id', auth.user.id);
      throw error;
    }

    const updatedUserInfo = mergeResumeUserInfo(resume.user_info, parsed.user_info);
    const updatedProfile = parsed.profile ?? resume.profile ?? null;
    const updatedSegmentation = parsed.segmentation ?? resume.segmentation ?? null;
    const { error: updateError } = await client
      .from('resumes')
      .update({
        parsed_content: parsed.parsed_content,
        user_info: updatedUserInfo,
        profile: updatedProfile,
        segmentation: updatedSegmentation,
        updated_at: new Date().toISOString(),
      })
      .eq('id', resumeId)
      .eq('user_id', auth.user.id);

    if (updateError) throw new Error(`更新简历失败: ${updateError.message}`);

    const updatedResume = {
      ...resume,
      parsed_content: parsed.parsed_content,
      user_info: updatedUserInfo,
      profile: updatedProfile,
      segmentation: updatedSegmentation,
      updated_at: new Date().toISOString(),
    };

    console.log('Resume re-parsed successfully:', resumeId);
    return NextResponse.json({ success: true, resume: sanitizeResumeRecord(updatedResume) });
  } catch (error) {
    console.error('Re-parse error:', error);
    if (error instanceof UnsupportedResumeFileError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: '重新解析失败' }, { status: 500 });
  }
}

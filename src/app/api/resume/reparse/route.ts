import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import {
  getStoredResumeFile,
  isRecord,
  isSupportedResumeFile,
  ResumeProfileExtractionError,
  sanitizeResumeRecord,
  UnsupportedResumeFileError,
  type ResumeFileOptions,
} from '@/lib/resume-parser';
import { processResume } from '@/lib/resume-processing';
import { downloadResumeFile, deleteResumeFile, ResumeStorageError, uploadResumeFile } from '@/lib/resume-storage';
import { ResumeProcessingError } from '@/lib/resume-processing';

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
    const storedFileType = storedFile?.fileType || (isRecord(resume.user_info) && typeof resume.user_info.file_type === 'string'
      ? resume.user_info.file_type
      : undefined);

    const fileOptions: ResumeFileOptions = {
      fileName: resume.file_name,
      contentType: storedFileType,
    };
    if (!isSupportedResumeFile(fileOptions)) {
      return NextResponse.json(
        { error: '不支持的文件格式，目前仅支持 PDF、DOCX 和 TXT' },
        { status: 400 },
      );
    }

    let fileBuffer: Buffer;
    if (storedFile) {
      // One-time lazy migration for records created before private object storage.
      fileBuffer = Buffer.from(storedFile.fileBase64, 'base64');
      const migratedKey = await uploadResumeFile(fileBuffer, auth.user.id, resume.file_name, storedFileType);
      const migratedUserInfo = isRecord(resume.user_info)
        ? Object.fromEntries(Object.entries(resume.user_info).filter(([key]) => key !== 'file_base64'))
        : { file_type: storedFileType };
      const { error: migrationError } = await client
        .from('resumes')
        .update({ file_key: migratedKey, user_info: migratedUserInfo, updated_at: new Date().toISOString() })
        .eq('id', resumeId)
        .eq('user_id', auth.user.id);
      if (migrationError) {
        try {
          await deleteResumeFile(migratedKey);
        } catch (cleanupError) {
          console.error('[Resume] legacy migration cleanup failed:', cleanupError);
        }
        throw new Error(`迁移简历文件失败: ${migrationError.message}`);
      }
    } else if (typeof resume.file_key === 'string' && resume.file_key && !resume.file_key.startsWith('local://')) {
      fileBuffer = await downloadResumeFile(resume.file_key);
    } else {
      return NextResponse.json({ error: '简历文件内容不存在，请重新上传' }, { status: 404 });
    }
    await processResume({
      resumeId,
      userId: auth.user.id,
      buffer: fileBuffer,
      fileOptions,
      source: 'reparse',
    });

    const { data: updatedResume, error: updatedResumeError } = await client
      .from('resumes')
      .select('*')
      .eq('id', resumeId)
      .eq('user_id', auth.user.id)
      .single();
    if (updatedResumeError || !updatedResume) throw new Error('重新解析后读取简历失败');

    console.log('Resume re-parsed successfully:', resumeId);
    return NextResponse.json({ success: true, resume: sanitizeResumeRecord(updatedResume) });
  } catch (error) {
    console.error('Re-parse error:', error);
    if (error instanceof UnsupportedResumeFileError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ResumeStorageError || error instanceof ResumeProcessingError || error instanceof ResumeProfileExtractionError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return NextResponse.json({ error: '重新解析失败' }, { status: 500 });
  }
}

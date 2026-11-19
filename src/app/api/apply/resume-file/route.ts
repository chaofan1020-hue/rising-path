import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { getUserResume } from '@/lib/resume-selection';
import { downloadResumeFile } from '@/lib/resume-storage';

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  rtf: 'application/rtf',
};

/**
 * GET /api/apply/resume-file?resumeId=12
 *
 * 本地 Agent 需要把用户的原始简历送到 `input[type=file]`，只能拿真实文件字节。
 * 这里按登录用户 + 简历归属返回文件流，不落公开 URL。
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();

    const resumeId = request.nextUrl.searchParams.get('resumeId');
    const resume = await getUserResume(auth.client, auth.user.id, resumeId ?? undefined);
    if (!resume || typeof resume.file_key !== 'string' || !resume.file_key) {
      return NextResponse.json({ error: '简历不存在或没有原始文件' }, { status: 404 });
    }

    const buffer = await downloadResumeFile(resume.file_key);
    const fileName = typeof resume.file_name === 'string' && resume.file_name.trim() ? resume.file_name.trim() : 'resume.pdf';
    const extension = fileName.split('.').pop()?.toLowerCase() || 'pdf';
    const contentType = MIME_BY_EXTENSION[extension] || 'application/octet-stream';

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(buffer.byteLength),
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('[Apply] resume file failed:', error);
    return NextResponse.json({ error: '读取简历文件失败' }, { status: 500 });
  }
}

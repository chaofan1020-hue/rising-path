import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';

// Deprecated compatibility endpoint. The authoritative data now comes from
// the unified resume processing pipeline and is stored in profile.
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();

    const body = await request.json() as { resume_id?: unknown };
    const resumeId = Number(body.resume_id);
    if (!Number.isInteger(resumeId) || resumeId <= 0) {
      return NextResponse.json({ error: '缺少有效简历ID' }, { status: 400 });
    }

    const { data: resume, error } = await auth.client
      .from('resumes')
      .select('parsed_fields, profile, profile_evidence, profile_confidence')
      .eq('id', resumeId)
      .eq('user_id', auth.user.id)
      .single();

    if (error || !resume) {
      return NextResponse.json({ error: '简历不存在或无权访问' }, { status: 404 });
    }

    if (!resume.profile) {
      return NextResponse.json({ error: '简历画像尚未生成，请等待解析完成' }, { status: 409 });
    }

    const response = NextResponse.json({
      success: true,
      deprecated: true,
      parsed_fields: resume.parsed_fields || null,
      profile: resume.profile,
      profile_evidence: resume.profile_evidence || {},
      profile_confidence: resume.profile_confidence || {},
    });
    response.headers.set('Deprecation', 'true');
    return response;
  } catch (error) {
    console.error('Error reading legacy resume fields:', error);
    return NextResponse.json({ error: '读取简历字段失败' }, { status: 500 });
  }
}

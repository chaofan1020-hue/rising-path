import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { consumeAuthRateLimit } from '@/lib/auth-security';
import { getUserResume } from '@/lib/resume-selection';
import {
  buildProfileFromResume,
  DEFAULT_PROFILE,
  type ApplicationProfile,
} from '@/lib/application-profile';
import { applyResolveRequestSchema } from '@/lib/application-contracts';
import { resolveScan, summarizeScan, type ScanField } from '@/lib/apply/resolve';

/**
 * POST /api/apply/resolve
 *
 * 扫描结果 → 逐字段填写计划。默认零 AI：
 * 配方直连 + 90 题词库 + 档案推导就够覆盖常见问题，识别不了的字段原样返回给扩展，
 * 由用户在侧栏里手动处理（或用 AI 兜底，属于后续步骤）。
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();

    // 巡航一次要连续解析多步表单，窗口给宽一些，但仍然是每用户维度的硬限流。
    const rateLimit = await consumeAuthRateLimit(`apply-resolve:${auth.user.id}`, 240, 60, 60);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: '解析请求过于频繁，请稍后重试' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
      );
    }

    const parsed = applyResolveRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: '扫描参数无效' }, { status: 400 });
    }
    const body = parsed.data;
    const client = auth.client;

    const resume = await getUserResume(client, auth.user.id, body.resumeId);
    if (body.resumeId && !resume) {
      return NextResponse.json({ error: '简历不存在或无权使用' }, { status: 404 });
    }

    let profile: ApplicationProfile = DEFAULT_PROFILE;
    const { data: profileRow } = await client
      .from('application_profiles')
      .select('profile, resume_id')
      .eq('user_id', auth.user.id)
      .maybeSingle();

    const profileMatchesSelectedResume = profileRow
      && (profileRow.resume_id === resume?.id || (!profileRow.resume_id && !resume?.id));
    if (profileMatchesSelectedResume && profileRow?.profile) {
      profile = profileRow.profile as ApplicationProfile;
    } else {
      // 回退到「简历 → 档案」的确定性推导，保证第一次用、还没保存过档案也能填。
      profile = buildProfileFromResume(
        resume?.user_info as Parameters<typeof buildProfileFromResume>[0],
        resume?.profile as Parameters<typeof buildProfileFromResume>[1],
      ).profile;
    }

    const resolution = resolveScan(
      {
        url: body.url,
        fields: body.fields as ScanField[],
        automationIds: body.automationIds,
        pageText: body.pageText,
      },
      profile,
      { domain: body.domain },
    );

    console.info('[Apply] resolve', summarizeScan(resolution), body.domain || '');

    return NextResponse.json({
      ...resolution,
      resume: resume
        ? { id: resume.id as number, fileName: (resume.file_name as string) || 'resume.pdf' }
        : null,
      version: 1,
    });
  } catch (error) {
    console.error('[Apply] resolve failed:', error);
    return NextResponse.json({ error: '解析扫描结果失败' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import {
  buildProfileFromResume,
  buildSourceMapFromProfile,
  mergeAiProfilePreservingManual,
  normalizeAiProfile,
  type ApplicationProfile,
  type ProfileSourceMap,
} from '@/lib/application-profile';
import { createTextProviderClient } from '@/lib/ai/text-provider';
import { invokeTrackedTextGeneration } from '@/lib/ai-usage';
import { betaEntitlementResponse } from '@/lib/beta-entitlements';
import { extractFirstJsonObject } from '@/lib/json-extract';

function buildPrompt(input: {
  profile: unknown;
  parsedContent: string;
}): string {
  return [
    '你是求职网申档案生成助手。请根据候选人的简历内容，生成完整求职档案。',
    '要求：',
    '1. 只使用简历中出现的信息，绝不编造姓名、邮箱、电话、地址、学校、公司或日期。',
    '2. 缺失字段返回空字符串或空数组。',
    '3. 教育经历和经历使用 raw 字段保存为一段可读文本。',
    '4. 工作授权和签证状态如果简历未写，保持为空。',
    '5. 自我介绍 summary 用 2-3 句概括候选人的优势和目标，最多 200 字。',
    '6. 只返回 JSON，格式：',
    '{"personal":{"firstName":"","lastName":"","fullName":"","email":"","phone":"","address":"","city":"","state":"","zipCode":"","country":""},"links":{"linkedin":"","github":"","portfolio":""},"education":[{"raw":"School | Degree | Major | Start-End | GPA"}],"experience":[{"raw":"Company | Title | Start-End | Highlights"}],"skills":[],"languages":[],"workAuthorization":"","visaStatus":"","summary":""}',
    '',
    `简历画像：\n${JSON.stringify(input.profile || {})}`,
    `简历原文：\n${input.parsedContent.slice(0, 20000)}`,
  ].join('\n');
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const body = await request.json() as { resumeId?: unknown };
    const resumeId = Number(body.resumeId);
    if (!Number.isInteger(resumeId) || resumeId <= 0) {
      return NextResponse.json({ error: '无效的简历 ID' }, { status: 400 });
    }

    const { data: resume, error: resumeError } = await client
      .from('resumes')
      .select('id, user_info, profile, parsed_content')
      .eq('id', resumeId)
      .eq('user_id', auth.user.id)
      .single();
    if (resumeError || !resume) {
      return NextResponse.json({ error: '简历不存在或无权访问' }, { status: 404 });
    }

    const built = buildProfileFromResume(
      resume.user_info as Parameters<typeof buildProfileFromResume>[0],
      resume.profile as Parameters<typeof buildProfileFromResume>[1],
    );
    const { data: existing } = await client
      .from('application_profiles')
      .select('id, version, profile, source')
      .eq('user_id', auth.user.id)
      .maybeSingle();
    const llmClient = createTextProviderClient();
    const response = await invokeTrackedTextGeneration(llmClient, [
      { role: 'system', content: '你是一个严谨的求职档案助手，只输出 JSON。' },
      {
        role: 'user',
        content: buildPrompt({
          profile: resume.profile,
          parsedContent: typeof resume.parsed_content === 'string' ? resume.parsed_content : '',
        }),
      },
    ], { temperature: 0.2, thinking: 'disabled' }, {
      userId: auth.user.id,
      feature: 'application_profile',
      resumeId,
    });

    const raw = extractFirstJsonObject(response.content || '');
    const aiProfile = normalizeAiProfile(raw, built.profile);
    const merged = existing
      ? mergeAiProfilePreservingManual(
        aiProfile,
        existing.profile as ApplicationProfile,
        (existing.source || {}) as ProfileSourceMap,
      )
      : { profile: aiProfile, source: buildSourceMapFromProfile(aiProfile) };
    const profile = merged.profile;
    const source = merged.source;
    const version = (existing?.version || 0) + 1;
    const now = new Date().toISOString();

    const profileWrite = {
      user_id: auth.user.id,
      resume_id: resumeId,
      profile,
      source,
      field_stats: source,
      version,
      updated_at: now,
    };
    const { data: inserted, error: saveError } = existing
      ? await client
        .from('application_profiles')
        .update(profileWrite)
        .eq('user_id', auth.user.id)
        .eq('version', existing.version)
        .select()
        .maybeSingle()
      : await client
        .from('application_profiles')
        .insert(profileWrite)
        .select()
        .maybeSingle();
    if (saveError?.code === '23505') {
      return NextResponse.json({ error: '求职档案已更新，请刷新后重试' }, { status: 409 });
    }
    if (saveError) throw new Error(`保存 AI 求职档案失败: ${saveError.message}`);
    if (!inserted) return NextResponse.json({ error: '求职档案已更新，请刷新后重试' }, { status: 409 });

    return NextResponse.json({
      profile: inserted?.profile || profile,
      source: inserted?.source || source,
      fieldStats: inserted?.field_stats || inserted?.source || source,
      version: inserted?.version || version,
      resumeId: inserted?.resume_id || resumeId,
    });
  } catch (error) {
    console.error('Error filling application profile with AI:', error);
    const betaResponse = betaEntitlementResponse(error);
    if (betaResponse) return betaResponse;
    return NextResponse.json({ error: 'AI 填写求职档案失败' }, { status: 500 });
  }
}

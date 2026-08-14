import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import {
  computePersonalityAssessment,
  computeSponsorshipStatsByRole,
  validatePersonalityAnswers,
  type PersonalityAssessment,
} from '@/lib/personality-assessment';

function positiveInteger(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function serializeAssessment(row: Record<string, unknown>): PersonalityAssessment {
  return {
    id: Number(row.id),
    model: 'career_fit',
    resumeId: row.resume_id == null ? null : Number(row.resume_id),
    answers: Array.isArray(row.answers) ? row.answers as PersonalityAssessment['answers'] : [],
    result: (row.result || {}) as PersonalityAssessment['result'],
    recommendations: Array.isArray(row.recommendations)
      ? row.recommendations as PersonalityAssessment['recommendations']
      : [],
    version: Number(row.version || 1),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();

    const { data, error } = await auth.client
      .from('personality_assessments')
      .select('*')
      .eq('user_id', auth.user.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`读取求职方向测评失败: ${error.message}`);
    }

    return NextResponse.json({
      assessment: data ? serializeAssessment(data as Record<string, unknown>) : null,
    });
  } catch (error) {
    console.error('Error fetching personality assessment:', error);
    return NextResponse.json({ error: '读取求职方向测评失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();

    const body = await request.json();
    const answers = validatePersonalityAnswers(body?.answers);

    let resumeId: number | null = null;
    if (body?.resumeId !== undefined && body?.resumeId !== null && body?.resumeId !== '') {
      resumeId = positiveInteger(body.resumeId);
      if (resumeId === null) {
        return NextResponse.json({ error: '简历 ID 无效' }, { status: 400 });
      }
    }

    let profile: Record<string, unknown> | null = null;
    let regionKey: string | null = null;
    if (resumeId !== null) {
      const { data, error } = await auth.client
        .from('resumes')
        .select('profile, segmentation, segmentation_overrides')
        .eq('id', resumeId)
        .eq('user_id', auth.user.id)
        .maybeSingle();
      if (error) throw new Error(`读取简历画像失败: ${error.message}`);
      profile = data?.profile && typeof data.profile === 'object' ? data.profile : null;
      const segmentation = data?.segmentation as { regions?: string[] } | null;
      const overrides = data?.segmentation_overrides as { regions?: string[] } | null;
      regionKey = overrides?.regions?.[0] || segmentation?.regions?.[0] || null;
    }

    const { data: jobs, error: jobsError } = await auth.client
      .from('jobs')
      .select('direction, sponsorship, region')
      .eq('is_active', true);
    if (jobsError) throw new Error(`读取岗位 sponsor 数据失败: ${jobsError.message}`);

    const sponsorshipStatsByRole = computeSponsorshipStatsByRole(jobs || [], regionKey);
    const computed = computePersonalityAssessment(
      answers,
      profile as Parameters<typeof computePersonalityAssessment>[1],
      sponsorshipStatsByRole,
    );

    const { data, error } = await auth.client
      .from('personality_assessments')
      .upsert({
        user_id: auth.user.id,
        resume_id: resumeId,
        model: 'career_fit',
        answers,
        result: computed.result,
        recommendations: computed.recommendations,
        version: 1,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id',
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`保存求职方向测评失败: ${error?.message || '未返回记录'}`);
    }

    let nextProfile: Record<string, unknown> | null = null;
    if (resumeId !== null) {
      const now = new Date().toISOString();
      nextProfile = {
        ...(profile || {}),
        personality: {
          model: 'career_fit',
          dimensions: computed.result.dimensions,
          primaryDimension: computed.result.primaryDimension,
          summaryKey: computed.result.summaryKey,
          recommendations: computed.recommendations,
          completedAt: now,
        },
      };
      const { error: profileError } = await auth.client
        .from('resumes')
        .update({
          profile: nextProfile,
          updated_at: now,
        })
        .eq('id', resumeId)
        .eq('user_id', auth.user.id);
      if (profileError) {
        throw new Error(`写入求职画像失败: ${profileError.message}`);
      }
    }

    return NextResponse.json({
      assessment: serializeAssessment(data as Record<string, unknown>),
      profile: nextProfile,
    });
  } catch (error) {
    console.error('Error saving personality assessment:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : '保存求职方向测评失败',
    }, { status: 500 });
  }
}

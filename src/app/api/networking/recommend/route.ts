import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import {
  buildNetworkingContext,
  generateNetworkingRecommendations,
  type NetworkingProgress,
} from '@/lib/networking-recommender';
import type { PlanLocale } from '@/lib/resume-types';
import { resolveActiveRegion } from '@/lib/user-region';
import { creditResponse, reserveCredits, settleCredits } from '@/lib/credits';

function normalizeLocale(value: unknown): PlanLocale {
  if (value === 'zh-TW' || value === 'en') return value;
  return 'zh-CN';
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const body = await request.json() as { lang?: unknown };
    const lang = normalizeLocale(body.lang);

    const { data: resume } = await client
      .from('resumes')
      .select('id, profile, segmentation, segmentation_overrides')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: favorites } = await client
      .from('favorites')
      .select('job_id, jobs!inner(company)')
      .eq('user_id', auth.user.id);
    const favoriteCompanies = (favorites || [])
      .map((row) => {
        const job = Array.isArray(row.jobs) ? row.jobs[0] : row.jobs;
        return typeof job?.company === 'string' ? job.company : '';
      })
      .filter(Boolean) as string[];

    const { data: interviews } = await client
      .from('interview_sessions')
      .select('target_company')
      .eq('user_id', auth.user.id)
      .not('target_company', 'is', null);
    const interviewCompanies = (interviews || [])
      .map((row) => typeof row.target_company === 'string' ? row.target_company : '')
      .filter(Boolean) as string[];

    const { data: userProfile } = await client
      .from('profiles')
      .select('preferred_region')
      .eq('id', auth.user.id)
      .maybeSingle();

    const segmentation = resume?.segmentation as Parameters<typeof buildNetworkingContext>[0]['segmentation'];
    const profile = resume?.profile as Parameters<typeof buildNetworkingContext>[0]['profile'];
    const region = resolveActiveRegion(userProfile?.preferred_region, {
      profile,
      segmentation,
      segmentation_overrides: resume?.segmentation_overrides,
    });
    const context = buildNetworkingContext({
      profile,
      segmentation,
      region,
      favoriteCompanies,
      interviewCompanies,
    });
    // Networking generates five stages in parallel. Reserve one bundle before
    // starting so an insufficient balance cannot partially charge the user.
    const reservation = await reserveCredits({
      userId: auth.user.id,
      metric: 'networking_recommendation',
      idempotencyKey: crypto.randomUUID(),
      metadata: { feature: 'networking_recommendation', region, language: lang },
    });
    try {
      // The bundle reservation above owns billing for the complete request.
      const recommendations = await generateNetworkingRecommendations(context, lang, null);
      await settleCredits(reservation, 'committed');

      const currentProfile = (resume?.profile || {}) as Record<string, unknown>;
      const current = (currentProfile.networkingProgress || {
        stage: 1,
        completedMilestones: [],
        recommendations: {},
        updatedAt: '',
      }) as NetworkingProgress;
      const progress: NetworkingProgress = {
        ...current,
        stage: 1,
        recommendations,
        region,
        updatedAt: new Date().toISOString(),
      };
      if (resume?.id) {
        await client
          .from('resumes')
          .update({
            profile: { ...currentProfile, networkingProgress: progress },
            updated_at: new Date().toISOString(),
          })
          .eq('id', resume.id)
          .eq('user_id', auth.user.id);
      }

      return NextResponse.json({
        recommendation: recommendations[String(progress.stage)] || recommendations['1'],
        recommendations,
        context,
        progress,
      });
    } catch (error) {
      await settleCredits(reservation, 'released');
      throw error;
    }
  } catch (error) {
    const creditError = creditResponse(error);
    if (creditError) return creditError;
    console.error('Error generating networking recommendations:', error);
    return NextResponse.json({ error: '生成 Networking 建议失败' }, { status: 500 });
  }
}

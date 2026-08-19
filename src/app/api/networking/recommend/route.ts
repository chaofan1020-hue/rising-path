import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { entitlementErrorResponse, requirePlanFeature } from '@/lib/entitlements';
import { resolveRegionKey } from '@/lib/region-dna';
import {
  buildNetworkingContext,
  generateNetworkingRecommendations,
  type NetworkingProgress,
} from '@/lib/networking-recommender';
import type { PlanLocale } from '@/lib/resume-types';

function normalizeLocale(value: unknown): PlanLocale {
  if (value === 'zh-TW' || value === 'en') return value;
  return 'zh-CN';
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const access = await requirePlanFeature(client, auth.user.id, 'networking');
    if (!access.allowed) return entitlementErrorResponse(access);
    const body = await request.json() as { lang?: unknown };
    const lang = normalizeLocale(body.lang);

    const { data: resume } = await client
      .from('resumes')
      .select('id, profile, segmentation')
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

    const segmentation = resume?.segmentation as Parameters<typeof buildNetworkingContext>[0]['segmentation'];
    const profile = resume?.profile as Parameters<typeof buildNetworkingContext>[0]['profile'];
    const region = segmentation?.regions?.[0]
      ?? resolveRegionKey(profile?.intention?.locations?.[0])
      ?? null;
    const context = buildNetworkingContext({
      profile,
      segmentation,
      region,
      favoriteCompanies,
      interviewCompanies,
    });
    const recommendations = await generateNetworkingRecommendations(context, lang);

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
    console.error('Error generating networking recommendations:', error);
    return NextResponse.json({ error: '生成 Networking 建议失败' }, { status: 500 });
  }
}

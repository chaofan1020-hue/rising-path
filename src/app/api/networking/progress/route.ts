import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import type { NetworkingProgress } from '@/lib/networking-recommender';
import { NETWORKING_STAGES } from '@/lib/networking-recommender';

function defaultProgress(): NetworkingProgress {
  return {
    stage: 1,
    completedMilestones: [],
    recommendations: {},
    updatedAt: '',
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const { data: resume } = await client
      .from('resumes')
      .select('id, profile')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const progress = (resume?.profile as { networkingProgress?: NetworkingProgress } | null)
      ?.networkingProgress || defaultProgress();
    return NextResponse.json({ progress, resumeId: resume?.id ?? null });
  } catch (error) {
    console.error('Error loading networking progress:', error);
    return NextResponse.json({ error: '加载 Networking 进度失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const body = await request.json() as {
      stage?: unknown;
      completedMilestones?: unknown;
    };
    const stage = Number(body.stage);
    if (!Number.isInteger(stage) || stage < 1 || stage > NETWORKING_STAGES.length) {
      return NextResponse.json({ error: '无效的 Networking 阶段' }, { status: 400 });
    }
    const milestones = Array.isArray(body.completedMilestones)
      ? body.completedMilestones.filter((item): item is string => typeof item === 'string').slice(0, 50)
      : [];

    const { data: resume } = await client
      .from('resumes')
      .select('id, profile')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!resume) {
      return NextResponse.json({ error: '未找到简历' }, { status: 404 });
    }
    const currentProfile = (resume.profile || {}) as Record<string, unknown>;
    const current = (currentProfile.networkingProgress || defaultProgress()) as NetworkingProgress;
    const next: NetworkingProgress = {
      ...current,
      stage,
      completedMilestones: milestones,
      updatedAt: new Date().toISOString(),
    };
    const nextProfile = {
      ...currentProfile,
      networkingProgress: next,
    };
    const { error } = await client
      .from('resumes')
      .update({ profile: nextProfile, updated_at: new Date().toISOString() })
      .eq('id', resume.id)
      .eq('user_id', auth.user.id);
    if (error) throw new Error(`保存 Networking 进度失败: ${error.message}`);
    return NextResponse.json({ progress: next, resumeId: resume.id });
  } catch (error) {
    console.error('Error saving networking progress:', error);
    return NextResponse.json({ error: '保存 Networking 进度失败' }, { status: 500 });
  }
}

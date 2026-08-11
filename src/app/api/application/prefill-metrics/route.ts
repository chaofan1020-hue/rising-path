import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;

    const { data: feedback } = await client
      .from('prefill_feedback')
      .select('action')
      .eq('user_id', auth.user.id);

    const total = feedback?.length || 0;
    const confirmed = feedback?.filter((f) => f.action === 'confirmed').length || 0;
    const edited = feedback?.filter((f) => f.action === 'edited').length || 0;
    const ignored = feedback?.filter((f) => f.action === 'ignored').length || 0;

    const { data: edits } = await client
      .from('profile_field_edits')
      .select('id')
      .eq('user_id', auth.user.id);

    const { data: profileRow } = await client
      .from('application_profiles')
      .select('source')
      .eq('user_id', auth.user.id)
      .maybeSingle();

    const source = (profileRow?.source || {}) as Record<string, { source?: string }>;
    const activeFields = Object.values(source).filter((s) => s.source === 'manual' || s.source === 'resume').length;
    const decided = confirmed + edited;

    return NextResponse.json({
      totalFeedback: total,
      confirmed,
      edited,
      ignored,
      confirmationRate: decided > 0 ? Math.round((confirmed / decided) * 100) : 0,
      correctionRate: decided > 0 ? Math.round((edited / decided) * 100) : 0,
      editHistoryCount: edits?.length || 0,
      activeFields,
    });
  } catch (error) {
    console.error('Prefill metrics error:', error);
    return NextResponse.json({ error: '获取预填学习指标失败' }, { status: 500 });
  }
}

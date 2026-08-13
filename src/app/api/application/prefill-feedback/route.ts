import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import {
  bumpFieldStats,
  DEFAULT_PROFILE,
  setProfileValueBySemanticKey,
  type ApplicationProfile,
  type ProfileSourceMap,
} from '@/lib/application-profile';
import { prefillFeedbackRequestSchema } from '@/lib/application-contracts';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const parsed = prefillFeedbackRequestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: '预填反馈参数无效' }, { status: 400 });
    const { fields, jobId, domain, version: expectedVersion } = parsed.data;

    const { data: profileRow } = await auth.client
      .from('application_profiles')
      .select('*')
      .eq('user_id', auth.user.id)
      .maybeSingle();

    let profile: ApplicationProfile = profileRow?.profile || DEFAULT_PROFILE;
    let source = (profileRow?.source || {}) as ProfileSourceMap;

    const feedbackRows: Array<Record<string, unknown>> = [];
    for (const field of fields) {
      const semanticKey = field.semanticKey || field.fieldKey;
      const finalValue = (field.finalValue || '').trim();
      const action = field.action === 'edited' ? 'edited' : field.action === 'ignored' ? 'ignored' : 'confirmed';

      feedbackRows.push({
        user_id: auth.user.id,
        job_id: jobId || null,
        domain: domain || null,
        field_key: field.fieldKey,
        semantic_key: semanticKey,
        suggested_value: field.suggestedValue || '',
        final_value: finalValue,
        action,
      });

      if (action !== 'ignored' && finalValue) {
        profile = setProfileValueBySemanticKey(profile, semanticKey, finalValue);
        source = bumpFieldStats(source, semanticKey, action === 'edited' ? 'edit' : 'confirm');
      } else if (action === 'ignored' && field.suggestedValue) {
        source = bumpFieldStats(source, semanticKey, 'ignore');
      }

    }

    const { data: savedVersion, error: saveError } = await auth.client.rpc('apply_prefill_feedback', {
      p_expected_version: expectedVersion,
      p_resume_id: profileRow?.resume_id || null,
      p_profile: profile,
      p_source: source,
      p_feedback: feedbackRows,
    });
    if (saveError) throw new Error(saveError.message);
    if (savedVersion === null) {
      return NextResponse.json({ error: '求职档案已更新，请刷新后重试' }, { status: 409 });
    }

    return NextResponse.json({ success: true, profile, source, fieldStats: source, version: savedVersion });
  } catch (error) {
    console.error('Prefill feedback error:', error);
    return NextResponse.json({ error: '保存预填反馈失败' }, { status: 500 });
  }
}

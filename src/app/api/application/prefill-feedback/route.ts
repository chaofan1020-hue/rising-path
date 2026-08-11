import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { getSupabaseClient as getAdminSupabaseClient } from '@/storage/database/supabase-client';
import {
  bumpFieldStats,
  DEFAULT_PROFILE,
  setProfileValueBySemanticKey,
  type ApplicationProfile,
  type ProfileSourceMap,
} from '@/lib/application-profile';

interface PrefillFeedbackField {
  fieldKey: string;
  semanticKey?: string;
  suggestedValue?: string;
  finalValue?: string;
  action: 'confirmed' | 'edited' | 'ignored';
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const body = await request.json();
    const fields = Array.isArray(body.fields) ? (body.fields as PrefillFeedbackField[]) : [];
    if (fields.length === 0) {
      return NextResponse.json({ success: true });
    }

    const { data: profileRow } = await auth.client
      .from('application_profiles')
      .select('*')
      .eq('user_id', auth.user.id)
      .maybeSingle();

    let profile: ApplicationProfile = profileRow?.profile || DEFAULT_PROFILE;
    let source = (profileRow?.source || {}) as ProfileSourceMap;

    const admin = getAdminSupabaseClient();
    for (const field of fields) {
      const semanticKey = field.semanticKey || field.fieldKey;
      const finalValue = (field.finalValue || '').trim();
      const action = field.action === 'edited' ? 'edited' : field.action === 'ignored' ? 'ignored' : 'confirmed';

      await auth.client.from('prefill_feedback').insert({
        user_id: auth.user.id,
        job_id: body.jobId || null,
        domain: body.domain || null,
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

      if (body.domain) {
        const { data: template } = await admin
          .from('form_templates')
          .select('id, usage_count, correction_count')
          .ilike('domain_pattern', `%${body.domain}%`)
          .eq('field_key', field.fieldKey)
          .maybeSingle();
        if (template) {
          await admin
            .from('form_templates')
            .update({
              usage_count: (template.usage_count || 0) + (action === 'confirmed' ? 1 : 0),
              correction_count: (template.correction_count || 0) + (action === 'edited' ? 1 : 0),
              updated_at: new Date().toISOString(),
            })
            .eq('id', template.id);
        }
      }
    }

    await auth.client
      .from('application_profiles')
      .upsert({
        user_id: auth.user.id,
        resume_id: profileRow?.resume_id || null,
        profile,
        source,
        field_stats: source,
        version: (profileRow?.version || 0) + 1,
        updated_at: new Date().toISOString(),
      });

    return NextResponse.json({ success: true, profile, source, fieldStats: source });
  } catch (error) {
    console.error('Prefill feedback error:', error);
    return NextResponse.json({ error: '保存预填反馈失败' }, { status: 500 });
  }
}

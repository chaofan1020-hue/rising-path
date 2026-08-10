import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { createAiProvider } from '@/lib/ai-provider';
import { buildProfileFromResume, DEFAULT_PROFILE, type ApplicationProfile } from '@/lib/application-profile';

interface PrefillField {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  name?: string;
  id?: string;
  placeholder?: string;
  options?: string[];
  selectorHints?: Record<string, string>;
}

interface PrefillResult {
  key: string;
  value: string;
  source: 'resume' | 'ai' | 'manual' | 'empty';
  confidence: number;
  needsReview: boolean;
  reason?: string;
}

function directProfileValue(profile: ApplicationProfile, semanticKey: string): { value: string; confidence: number } | null {
  const personalMap: Record<string, string> = {
    first_name: profile.personal.firstName || '',
    last_name: profile.personal.lastName || '',
    full_name: profile.personal.fullName || '',
    email: profile.personal.email || '',
    phone: profile.personal.phone || '',
    address: profile.personal.address || '',
    city: profile.personal.city || '',
    state: profile.personal.state || '',
    zip_code: profile.personal.zipCode || '',
    country: profile.personal.country || '',
    linkedin: profile.links.linkedin || '',
    github: profile.links.github || '',
    portfolio: profile.links.portfolio || '',
    work_authorization: profile.workAuthorization || '',
    visa_status: profile.visaStatus || '',
    summary: profile.summary || '',
  };
  if (personalMap[semanticKey]) {
    return { value: personalMap[semanticKey], confidence: 1 };
  }
  if (semanticKey === 'skills' && profile.skills.length) {
    return { value: profile.skills.join(', '), confidence: 0.95 };
  }
  if (semanticKey === 'languages' && profile.languages.length) {
    return { value: profile.languages.join(', '), confidence: 0.95 };
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const body = await request.json();
    const fields = Array.isArray(body.fields) ? (body.fields as PrefillField[]) : [];
    if (fields.length === 0) {
      return NextResponse.json({ fields: [] });
    }

    const { data: resume } = await client
      .from('resumes')
      .select('id, user_info, profile')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: profileRow } = await client
      .from('application_profiles')
      .select('profile')
      .eq('user_id', auth.user.id)
      .maybeSingle();

    let profile: ApplicationProfile = DEFAULT_PROFILE;
    if (profileRow?.profile) {
      profile = profileRow.profile as ApplicationProfile;
    } else {
      const built = buildProfileFromResume(
        resume?.user_info as Parameters<typeof buildProfileFromResume>[0],
        resume?.profile as Parameters<typeof buildProfileFromResume>[1]
      );
      profile = built.profile;
    }

    let jobContext = '';
    if (body.jobId) {
      const { data: job } = await client
        .from('jobs')
        .select('title, company, description, requirements')
        .eq('id', body.jobId)
        .maybeSingle();
      if (job) {
        jobContext = `${job.company} - ${job.title}\n${job.description || ''}\n${job.requirements || ''}`;
      }
    } else if (body.company) {
      jobContext = String(body.company);
    }

    const results: PrefillResult[] = [];
    const unresolved: PrefillField[] = [];

    for (const field of fields) {
      const semanticKey = field.selectorHints?.semanticKey || field.key;
      if (field.type === 'file') {
        results.push({
          key: field.key,
          value: '',
          source: 'empty',
          confidence: 0,
          needsReview: true,
          reason: '文件上传需要手动选择',
        });
        continue;
      }
      const direct = directProfileValue(profile, semanticKey);
      if (direct?.value) {
        results.push({
          key: field.key,
          value: direct.value,
          source: 'resume',
          confidence: direct.confidence,
          needsReview: direct.confidence < 0.9,
        });
      } else {
        unresolved.push(field);
      }
    }

    if (unresolved.length > 0) {
      const provider = createAiProvider(Object.fromEntries(request.headers.entries()));
      const aiFields = unresolved.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        required: f.required,
        placeholder: f.placeholder,
        options: f.options,
        semanticKey: f.selectorHints?.semanticKey || f.key,
      }));
      try {
        const aiResult = await provider.completeJson([
          {
            role: 'system',
            content:
              'You are an application prefill assistant. Return ONLY JSON with this shape: {"fields":{"<key>":{"value":"","confidence":0.0,"reason":""}}}. Never invent contact details that are absent. Mark uncertain values with confidence below 0.8.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              profile,
              jobContext,
              fields: aiFields,
            }),
          },
        ]);
        const aiFieldsMap = (aiResult.fields || {}) as Record<string, { value?: unknown; confidence?: number; reason?: string }>;
        for (const field of unresolved) {
          const guess = aiFieldsMap[field.key];
          const value = typeof guess?.value === 'string' ? guess.value.trim() : '';
          const confidence = typeof guess?.confidence === 'number' ? Math.min(1, Math.max(0, guess.confidence)) : 0.5;
          results.push({
            key: field.key,
            value,
            source: value ? 'ai' : 'empty',
            confidence: value ? confidence : 0,
            needsReview: true,
            reason: guess?.reason || (value ? 'AI 推测，请确认' : '未能自动填写'),
          });
        }
      } catch (error) {
        console.error('Prefill AI error:', error);
        for (const field of unresolved) {
          results.push({
            key: field.key,
            value: '',
            source: 'empty',
            confidence: 0,
            needsReview: true,
            reason: 'AI 暂不可用，请手动填写',
          });
        }
      }
    }

    return NextResponse.json({ fields: results });
  } catch (error) {
    console.error('Prefill error:', error);
    return NextResponse.json({ error: '生成预填数据失败' }, { status: 500 });
  }
}

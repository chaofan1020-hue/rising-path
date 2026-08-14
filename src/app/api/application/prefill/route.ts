import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { invokeTrackedTextGeneration } from '@/lib/ai-usage';
import { createTextProviderClient } from '@/lib/ai/text-provider';
import { extractFirstJsonObject } from '@/lib/json-extract';
import {
  buildProfileFromResume,
  DEFAULT_PROFILE,
  type ApplicationProfile,
  type ProfileSourceMap,
} from '@/lib/application-profile';
import { applicationPrefillRequestSchema } from '@/lib/application-contracts';

function decayedConfidence(fieldSource?: { source?: string; confidence?: number; updatedAt?: string }): number {
  const base = typeof fieldSource?.confidence === 'number' ? fieldSource.confidence : 0.9;
  if (fieldSource?.source !== 'manual' || !fieldSource.updatedAt) return base;
  const ageDays = (Date.now() - new Date(fieldSource.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays > 365) return 0.5;
  if (ageDays > 180) return 0.7;
  return 1;
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function directProfileValue(
  profile: ApplicationProfile,
  semanticKey: string,
  sourceMap?: ProfileSourceMap
): { value: string; confidence: number; source: 'resume' | 'manual' } | null {
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
  const sourceKeyMap: Record<string, string> = {
    first_name: 'personal.firstName',
    last_name: 'personal.lastName',
    full_name: 'personal.fullName',
    email: 'personal.email',
    phone: 'personal.phone',
    address: 'personal.address',
    city: 'personal.city',
    state: 'personal.state',
    zip_code: 'personal.zipCode',
    country: 'personal.country',
    linkedin: 'links.linkedin',
    github: 'links.github',
    portfolio: 'links.portfolio',
    work_authorization: 'workAuthorization',
    visa_status: 'visaStatus',
    summary: 'summary',
    skills: 'skills',
    languages: 'languages',
  };
  const sourceKey = sourceKeyMap[semanticKey] || semanticKey;
  const fieldSource = sourceMap?.[sourceKey] || sourceMap?.[semanticKey];
  if (personalMap[semanticKey]) {
    return {
      value: personalMap[semanticKey],
      confidence: fieldSource?.source === 'manual' ? decayedConfidence(fieldSource) : 0.95,
      source: fieldSource?.source === 'manual' ? 'manual' : 'resume',
    };
  }
  if (semanticKey === 'skills' && profile.skills.length) {
    return {
      value: profile.skills.join(', '),
      confidence: fieldSource?.source === 'manual' ? decayedConfidence(fieldSource) : 0.95,
      source: fieldSource?.source === 'manual' ? 'manual' : 'resume',
    };
  }
  if (semanticKey === 'languages' && profile.languages.length) {
    return {
      value: profile.languages.join(', '),
      confidence: fieldSource?.source === 'manual' ? decayedConfidence(fieldSource) : 0.95,
      source: fieldSource?.source === 'manual' ? 'manual' : 'resume',
    };
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const parsed = applicationPrefillRequestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: '预填参数无效' }, { status: 400 });
    const body = parsed.data;
    const fields = body.fields as PrefillField[];

    const { data: profileRow } = await client
      .from('application_profiles')
      .select('profile, resume_id, source')
      .eq('user_id', auth.user.id)
      .maybeSingle();

    const resumeQuery = client
      .from('resumes')
      .select('id, user_info, profile')
      .eq('user_id', auth.user.id);
    const selectedResumeId = body.resumeId || profileRow?.resume_id || null;
    const { data: resume } = selectedResumeId
      ? await resumeQuery.eq('id', selectedResumeId).maybeSingle()
      : await resumeQuery.order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (body.resumeId && !resume) {
      return NextResponse.json({ error: '简历不存在或无权使用' }, { status: 404 });
    }

    let profile: ApplicationProfile = DEFAULT_PROFILE;
    let sourceMap: ProfileSourceMap | undefined;
    const profileMatchesSelectedResume = profileRow
      && (profileRow.resume_id === resume?.id || (!profileRow.resume_id && !resume?.id));
    if (profileMatchesSelectedResume && profileRow.profile) {
      profile = profileRow.profile as ApplicationProfile;
      sourceMap = (profileRow.source || {}) as ProfileSourceMap;
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
      const direct = directProfileValue(profile, semanticKey, sourceMap);
      if (direct?.value) {
        results.push({
          key: field.key,
          value: direct.value,
          source: direct.source,
          confidence: direct.confidence,
          needsReview: direct.confidence < 0.9,
        });
      } else if ((sourceMap?.[semanticKey]?.ignoreCount || 0) >= 2) {
        results.push({
          key: field.key,
          value: '',
          source: 'empty',
          confidence: 0,
          needsReview: true,
          reason: '你已多次忽略该字段，请手动填写',
        });
      } else {
        unresolved.push(field);
      }
    }

    if (unresolved.length > 0) {
      const provider = createTextProviderClient({ requestHeaders: request.headers });
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
        const generated = await invokeTrackedTextGeneration(provider, [
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
        ], {
          temperature: 0.2,
          thinking: 'disabled',
          responseFormat: {
            name: 'application_prefill',
            schema: {
              type: 'object',
              properties: { fields: { type: 'object' } },
              required: ['fields'],
            },
          },
        }, {
          userId: auth.user.id,
          feature: 'application_prefill',
          jobId: typeof body.jobId === 'number' ? body.jobId : null,
          resumeId: resume?.id || null,
          metadata: { unresolved_field_count: unresolved.length },
        });
        const parsed = extractFirstJsonObject(generated.content);
        const aiFieldsMap = isRecord(parsed) && isRecord(parsed.fields) ? parsed.fields : {};
        for (const field of unresolved) {
          const rawGuess = aiFieldsMap[field.key];
          const guess = isRecord(rawGuess) ? rawGuess : null;
          const value = typeof guess?.value === 'string' ? guess.value.trim() : '';
          const confidence = typeof guess?.confidence === 'number' ? Math.min(1, Math.max(0, guess.confidence)) : 0.5;
          const reason = typeof guess?.reason === 'string' ? guess.reason : undefined;
          results.push({
            key: field.key,
            value,
            source: value ? 'ai' : 'empty',
            confidence: value ? confidence : 0,
            needsReview: true,
            reason: reason || (value ? 'AI 推测，请确认' : '未能自动填写'),
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

import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import {
  buildProfileFromResume,
  DEFAULT_PROFILE,
  mergeApplicationProfile,
  type ApplicationProfile,
  type ProfileSourceMap,
} from '@/lib/application-profile';
import { applicationProfilePatchSchema } from '@/lib/application-contracts';
import { getUserResume } from '@/lib/resume-selection';

function serializeAiJob(row: Record<string, unknown> | null) {
  if (!row) return null;
  return {
    id: Number(row.id),
    resumeId: Number(row.resume_id),
    status: row.status,
    error: row.last_error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

async function getLatestAiJob(client: SupabaseClient, userId: string, resumeId?: number | null) {
  let query = client
    .from('application_profile_jobs')
    .select('id, resume_id, status, last_error, created_at, updated_at, completed_at')
    .eq('user_id', userId);
  if (resumeId) query = query.eq('resume_id', resumeId);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) {
    console.error('[ApplicationProfile] failed to read AI job:', error.message);
    return null;
  }
  return serializeAiJob(data as Record<string, unknown> | null);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;

    const resume = await getUserResume(client, auth.user.id, request.nextUrl.searchParams.get('resumeId'));
    if (request.nextUrl.searchParams.get('resumeId') && !resume) return NextResponse.json({ error: '简历不存在或无权使用' }, { status: 404 });

    const { data: existing } = await client
      .from('application_profiles')
      .select('*')
      .eq('user_id', auth.user.id)
      .maybeSingle();
    const aiJob = await getLatestAiJob(client, auth.user.id, resume?.id ?? null);

    const profileMatchesSelectedResume = existing
      && (existing.resume_id === resume?.id || (!existing.resume_id && !resume?.id));
    if (existing && profileMatchesSelectedResume) {
      return NextResponse.json({
        profile: existing.profile || DEFAULT_PROFILE,
        source: existing.source || {},
        fieldStats: existing.field_stats || existing.source || {},
        version: existing.version,
        resumeId: existing.resume_id,
        aiJob,
      });
    }

    const built = buildProfileFromResume(
      resume?.user_info as Parameters<typeof buildProfileFromResume>[0],
      resume?.profile as Parameters<typeof buildProfileFromResume>[1]
    );
    const { data: inserted, error } = existing
      ? await client
        .from('application_profiles')
        .update({
          resume_id: resume?.id || null,
          profile: built.profile,
          source: built.source,
          field_stats: built.source,
          version: Number(existing.version || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', auth.user.id)
        .select()
        .maybeSingle()
      : await client
      .from('application_profiles')
      .insert({
        user_id: auth.user.id,
        resume_id: resume?.id || null,
        profile: built.profile,
        source: built.source,
        version: 1,
      })
      .select()
      .maybeSingle();

    if (error?.code === '23505') {
      const { data: raced } = await client
        .from('application_profiles')
        .select('*')
        .eq('user_id', auth.user.id)
        .maybeSingle();
      if (raced) {
        return NextResponse.json({
          profile: raced.profile || DEFAULT_PROFILE,
          source: raced.source || {},
          fieldStats: raced.field_stats || raced.source || {},
          version: raced.version,
          resumeId: raced.resume_id,
          aiJob,
        });
      }
    }
    if (error) throw new Error(`创建求职档案失败: ${error.message}`);

    return NextResponse.json({
      profile: built.profile,
      source: built.source,
      fieldStats: built.source,
      version: inserted?.version || 1,
      resumeId: resume?.id || null,
      aiJob,
    });
  } catch (error) {
    console.error('Error fetching application profile:', error);
    return NextResponse.json({ error: '获取求职档案失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const parsed = applicationProfilePatchSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: '无效的档案数据' }, { status: 400 });
    const { profile: updates, version: expectedVersion, resumeId } = parsed.data as {
      profile: Partial<ApplicationProfile>;
      version: number;
      resumeId?: number;
    };

    const targetResume = await getUserResume(client, auth.user.id, resumeId);
    if (resumeId && !targetResume) return NextResponse.json({ error: '简历不存在或无权访问' }, { status: 404 });

    const { data: existing } = await client
      .from('application_profiles')
      .select('*')
      .eq('user_id', auth.user.id)
      .maybeSingle();

    const existingMatchesResume = existing
      && (existing.resume_id === targetResume?.id || (!existing.resume_id && !targetResume?.id));
    const targetBuilt = targetResume
      ? buildProfileFromResume(
        targetResume.user_info as Parameters<typeof buildProfileFromResume>[0],
        targetResume.profile as Parameters<typeof buildProfileFromResume>[1],
      )
      : null;
    const base = existingMatchesResume ? (existing?.profile || DEFAULT_PROFILE) : (targetBuilt?.profile || DEFAULT_PROFILE);
    const baseSource = (existingMatchesResume ? existing?.source : targetBuilt?.source || {}) as ProfileSourceMap;
    const merged = mergeApplicationProfile(base, updates, baseSource);
    if (existingMatchesResume && existing.version !== expectedVersion) {
      return NextResponse.json({ error: '求职档案已更新，请刷新后重试' }, { status: 409 });
    }
    if (!existing && expectedVersion !== 0) {
      return NextResponse.json({ error: '求职档案已更新，请刷新后重试' }, { status: 409 });
    }
    const version = (existingMatchesResume ? existing?.version || 0 : 0) + 1;
    const profileWrite = {
      user_id: auth.user.id,
      resume_id: targetResume?.id || existing?.resume_id || null,
      profile: merged.profile,
      source: merged.source,
      field_stats: merged.source,
      version,
      updated_at: new Date().toISOString(),
    };
    let writeQuery = existing
      ? client.from('application_profiles').update(profileWrite).eq('user_id', auth.user.id)
      : client.from('application_profiles').insert(profileWrite);
    if (existingMatchesResume) writeQuery = writeQuery.eq('version', expectedVersion);
    const { data, error } = await writeQuery.select().maybeSingle();

    if (error?.code === '23505') {
      return NextResponse.json({ error: '求职档案已更新，请刷新后重试' }, { status: 409 });
    }
    if (error) throw new Error(`保存求职档案失败: ${error.message}`);
    if (!data) return NextResponse.json({ error: '求职档案已更新，请刷新后重试' }, { status: 409 });

    if (merged.changes.length > 0 && data?.id) {
      const editRows = merged.changes.map((change) => ({
        user_id: auth.user.id,
        profile_id: data.id,
        field_key: change.fieldKey,
        old_value: change.oldValue,
        new_value: change.newValue,
        source: 'manual',
      }));
      const { error: editError } = await client.from('profile_field_edits').insert(editRows);
      if (editError) console.error('Failed to save profile edit history:', editError.message);
    }

    return NextResponse.json({
      profile: data?.profile || merged.profile,
      source: data?.source || merged.source,
      fieldStats: data?.field_stats || data?.source || merged.source,
      version: data?.version || version,
      resumeId: data?.resume_id || null,
    });
  } catch (error) {
    console.error('Error saving application profile:', error);
    return NextResponse.json({ error: '保存求职档案失败' }, { status: 500 });
  }
}

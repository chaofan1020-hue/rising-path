import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { deriveMajorMatch, deriveSegmentation, type SegmentationOverrides } from '@/lib/user-segmentation';
import { resolveRegionKey } from '@/lib/region-dna';
import { isRecord } from '@/lib/resume-parser';
import type { ResumeProfile } from '@/lib/resume-types';
import { deleteResumeFile } from '@/lib/resume-storage';
import { hasValidAdminSession } from '@/lib/admin-auth';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';

// PATCH /api/resume/[id] —— 用户手动修正画像并选择是否确认
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const { id } = await params;

    const body = await request.json();
    const { overrides, profile, confirm, targetRole } = body as {
      overrides?: SegmentationOverrides;
      profile?: Pick<ResumeProfile, 'intention'>;
      confirm?: boolean;
      targetRole?: string;
    };

    if (confirm !== undefined && typeof confirm !== 'boolean') {
      return NextResponse.json({ error: 'confirm 必须是布尔值' }, { status: 400 });
    }
    const confirmRequested = confirm === true;

    if ((!overrides || typeof overrides !== 'object') && (!profile || typeof profile !== 'object')) {
      return NextResponse.json({ error: '缺少画像修正内容' }, { status: 400 });
    }

    const normalizedOverrides: SegmentationOverrides = overrides && typeof overrides === 'object' ? overrides : {};
    const profileIntention = profile?.intention;
    if (profileIntention) {
      const intentionFields = ['roles', 'locations', 'industries', 'targetCompanies'] as const;
      for (const field of intentionFields) {
        const value = profileIntention[field];
        if (value !== undefined && (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length > 120))) {
          return NextResponse.json({ error: `无效的求职意向字段: ${field}` }, { status: 400 });
        }
      }
      if (profileIntention.visaByRegion !== undefined) {
        const visaByRegion = profileIntention.visaByRegion as unknown;
        if (!isRecord(visaByRegion) || Object.entries(visaByRegion).some(([region, value]) => (
          !resolveRegionKey(region) || typeof value !== 'string' || value.trim().length === 0
        ))) {
          return NextResponse.json({ error: '无效的地区身份状态' }, { status: 400 });
        }
      }
      for (const field of ['workAuthorization', 'availableFrom', 'salaryExpectation'] as const) {
        const value = profileIntention[field];
        if (value !== undefined && (typeof value !== 'string' || value.length > 200)) {
          return NextResponse.json({ error: `无效的求职意向字段: ${field}` }, { status: 400 });
        }
      }
    }

    const validStages = ['junior', 'senior', 'experienced', 'returning_intern'];
    if (normalizedOverrides.careerStage && !validStages.includes(normalizedOverrides.careerStage)) {
      return NextResponse.json({ error: '无效的求职阶段' }, { status: 400 });
    }
    if (normalizedOverrides.schoolTier && ![1, 2, 3].includes(normalizedOverrides.schoolTier)) {
      return NextResponse.json({ error: '无效的院校层级' }, { status: 400 });
    }
    if (normalizedOverrides.majorMatch && !['aligned', 'related', 'unrelated'].includes(normalizedOverrides.majorMatch)) {
      return NextResponse.json({ error: '无效的专业匹配度' }, { status: 400 });
    }
    if (normalizedOverrides.regions) {
      if (!Array.isArray(normalizedOverrides.regions) || normalizedOverrides.regions.some((region) => (
        !resolveRegionKey(region) && !['us', 'uk', 'sg', 'cn_t1', 'cn_t2'].includes(region)
      ))) {
        return NextResponse.json({ error: '无效的地区' }, { status: 400 });
      }
      normalizedOverrides.regions = normalizedOverrides.regions
        .map((region) => (['us', 'uk', 'sg', 'cn_t1', 'cn_t2'].includes(region) ? region : resolveRegionKey(region)))
        .filter((region): region is NonNullable<typeof region> => !!region) as SegmentationOverrides['regions'];
    }

    const { data: resume, error: fetchError } = await client
      .from('resumes')
      .select('id, segmentation, profile, profile_version, profile_evidence, profile_confidence')
      .eq('id', id)
      .eq('user_id', auth.user.id)
      .single();

    if (fetchError || !resume) {
      return NextResponse.json({ error: '简历不存在或无权访问' }, { status: 404 });
    }

    const currentProfile = resume.profile as ResumeProfile | null;
    const currentVersion = Math.max(0, Number(resume.profile_version || 0));
    if (!currentProfile || currentVersion < 1) {
      return NextResponse.json({ error: '简历画像版本尚未生成，暂时不能确认' }, { status: 409 });
    }

    const { data: currentVersionRecord, error: currentVersionError } = await client
      .from('resume_profile_versions')
      .select('id, overrides')
      .eq('resume_id', id)
      .eq('user_id', auth.user.id)
      .eq('version', currentVersion)
      .maybeSingle();

    if (currentVersionError) {
      throw new Error(`读取当前画像版本失败: ${currentVersionError.message}`);
    }
    if (!currentVersionRecord) {
      return NextResponse.json({ error: '当前画像版本记录不存在，请重新解析简历' }, { status: 409 });
    }

    const currentOverrides: SegmentationOverrides = isRecord(currentVersionRecord.overrides)
      ? currentVersionRecord.overrides as SegmentationOverrides
      : {};
    const nextOverrides: SegmentationOverrides = {
      ...currentOverrides,
      ...normalizedOverrides,
    };
    const nextProfile: ResumeProfile = currentProfile && profileIntention
      ? {
          ...currentProfile,
          intention: {
            ...currentProfile.intention,
            ...profileIntention,
          },
          ...((normalizedOverrides.regions || profileIntention) ? { planRefinement: undefined } : {}),
        }
      : currentProfile;

    const current = profileIntention ? deriveSegmentation(nextProfile) : resume.segmentation;
    const next = current ? { ...current } : null;
    if (!next) {
      return NextResponse.json({ error: '简历画像尚未生成，暂时不能确认' }, { status: 409 });
    }
    if (normalizedOverrides.careerStage) {
      next.careerStage = normalizedOverrides.careerStage;
      next.careerStageReason = '用户手动修正';
    }
    if (normalizedOverrides.schoolTier) next.schoolTier = normalizedOverrides.schoolTier;
    if (normalizedOverrides.majorMatch) next.majorMatch = normalizedOverrides.majorMatch;
    if (normalizedOverrides.regions && normalizedOverrides.regions.length > 0) {
      next.regions = normalizedOverrides.regions;
      next.regionSource = 'intention';
    }
    if (targetRole && nextProfile.education?.[0]?.major) {
      const match = deriveMajorMatch(nextProfile.education[0].major, targetRole);
      if (match) {
        next.majorMatch = match.match;
        next.majorMatchNote = match.note;
      }
    }

    const stageLabel: Record<string, string> = {
      junior: '低年级（实习预备）',
      senior: '高年级（校招全职）',
      experienced: '社招（在职跳槽）',
      returning_intern: '实习转正',
    };
    next.summary = `${stageLabel[next.careerStage] || next.careerStage} × Tier${next.schoolTier}院校 × ${(next.regions || []).length}个目标地区${next.experienceQuality?.internshipCount ? ` × ${next.experienceQuality.internshipCount}段实习` : ''}${confirmRequested ? '（已确认）' : '（待确认）'}`;

    const now = new Date().toISOString();
    const version = currentVersion + 1;
    const { data: createdVersion, error: versionError } = await client
      .from('resume_profile_versions')
      .insert({
        resume_id: id,
        user_id: auth.user.id,
        version,
        source: 'user_edit',
        profile: nextProfile,
        segmentation: next,
        overrides: nextOverrides,
        evidence: resume.profile_evidence || {},
        confidence: resume.profile_confidence || {},
        status: confirmRequested ? 'confirmed' : 'draft',
        confirmed_at: confirmRequested ? now : null,
        confirmed_by: confirmRequested ? auth.user.id : null,
      })
      .select('id')
      .single();

    if (versionError || !createdVersion) {
      throw new Error(`创建画像版本失败: ${versionError?.message || '未返回版本记录'}`);
    }

    const { error: updateError } = await client
      .from('resumes')
      .update({
        profile: nextProfile,
        segmentation: next,
        segmentation_overrides: nextOverrides,
        segmentation_confirmed: confirmRequested,
        processing_status: confirmRequested ? 'ready' : 'needs_confirmation',
        processing_stage: confirmRequested ? 'complete' : 'confirmation',
        processing_error: null,
        profile_version: version,
        profile_confirmed_at: confirmRequested ? now : null,
        profile_confirmed_by: confirmRequested ? auth.user.id : null,
        updated_at: now,
      })
      .eq('id', id)
      .eq('user_id', auth.user.id);

    if (updateError) {
      throw new Error(`更新分层失败: ${updateError.message}`);
    }

    if (confirmRequested && next?.regions?.length) {
      const { error: profileError } = await client
        .from('profiles')
        .upsert({
          id: auth.user.id,
          preferred_region: next.regions[0],
          updated_at: now,
        }, { onConflict: 'id' });
      if (profileError) {
        console.error('[Resume] Failed to sync preferred region:', profileError);
      }
    }

    const { error: supersedeError } = await client
      .from('resume_profile_versions')
      .update({ status: 'superseded' })
      .eq('resume_id', id)
      .eq('user_id', auth.user.id)
      .eq('version', currentVersion);
    if (supersedeError) {
      console.error('[Resume] failed to mark previous profile version superseded:', supersedeError);
    }

    return NextResponse.json({
      success: true,
      profile: nextProfile,
      segmentation: next,
      profile_version: version,
      segmentation_confirmed: confirmRequested,
      processing_status: confirmRequested ? 'ready' : 'needs_confirmation',
      profile_confirmed_at: confirmRequested ? now : null,
    });
  } catch (error) {
    console.error('Error updating resume profile:', error);
    return NextResponse.json({ error: '更新画像失败' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const isAdminRequest = hasValidAdminSession(request);
  if (isAdminRequest) {
    const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.configWrite);
    if (permissionError) return permissionError;
  }
  try {
    const auth = isAdminRequest ? null : await getAuthContext(request);
    if (!isAdminRequest && !auth) return unauthorizedResponse();
    const client = isAdminRequest
      ? (await import('@/storage/database/supabase-client')).getSupabaseClient()
      : auth!.client;
    const { id } = await params;

    const { data: resumeToDelete } = await client
      .from('resumes')
      .select('id,file_key,file_name,user_id')
      .eq('id', id)
      .maybeSingle();
    if (!resumeToDelete) return NextResponse.json({ error: '简历不存在或无权访问' }, { status: 404 });

    let matchDelete = client
      .from('ai_matches')
      .delete()
      .eq('resume_id', id);
    if (!isAdminRequest) matchDelete = matchDelete.eq('user_id', auth!.user.id);
    const { error: matchError } = await matchDelete;
    if (matchError) console.error('Error deleting ai_matches:', matchError);

    let applicationDelete = client
      .from('applications')
      .delete()
      .eq('resume_id', id);
    if (!isAdminRequest) applicationDelete = applicationDelete.eq('user_id', auth!.user.id);
    const { error: appError } = await applicationDelete;
    if (appError) console.error('Error deleting applications:', appError);

    let resumeDelete = client
      .from('resumes')
      .delete()
      .eq('id', id);
    if (!isAdminRequest) resumeDelete = resumeDelete.eq('user_id', auth!.user.id);
    const { error } = await resumeDelete;
    if (error) throw new Error(`删除简历失败: ${error.message}`);

    if (typeof resumeToDelete?.file_key === 'string') {
      try {
        await deleteResumeFile(resumeToDelete.file_key);
      } catch (storageError) {
        console.error('[Resume] file cleanup failed after database deletion:', storageError);
      }
    }

    if (isAdminRequest) {
      await recordAdminAuditEvent({
        request,
        action: 'resume.delete',
        resourceType: 'resume',
        resourceId: id,
        subjectUserId: typeof resumeToDelete.user_id === 'string' ? resumeToDelete.user_id : null,
        beforeData: { id: resumeToDelete.id, file_name: resumeToDelete.file_name, user_id: resumeToDelete.user_id },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting resume:', error);
    if (isAdminRequest) {
      await recordAdminAuditFailure({ request, action: 'resume.delete', resourceType: 'resume', error });
    }
    return NextResponse.json({ error: '删除简历失败' }, { status: 500 });
  }
}

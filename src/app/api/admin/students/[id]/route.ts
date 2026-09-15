import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';
import { adminMigrationUnavailable } from '@/lib/admin-dependency-status';
import { resolveStudentDisplayName, studentEmailHandle, studentPublicCode } from '@/lib/admin-student-identity';
import { deleteResumeFile } from '@/lib/resume-storage';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CountResult = { count: number | null; error: { message: string } | null };

function countRows(table: string, userId: string): Promise<CountResult> {
  return getSupabaseClient().from(table).select('id', { count: 'exact', head: true }).eq('user_id', userId) as unknown as Promise<CountResult>;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const permissionError = await requireAdminPermission(request, ADMIN_PERMISSIONS.usersRead);
  if (permissionError) return permissionError;

  const { id: userId } = await params;
  if (!UUID_PATTERN.test(userId)) {
    return NextResponse.json({ data: null, error: { code: 'INVALID_STUDENT_ID', message: '学生 ID 无效' } }, { status: 400 });
  }

  try {
    const client = getSupabaseClient();
    const [profileResult, resumeIdentityResult, emailResult, usageResult, featureResult, eventsResult, resumesResult, applicationsResult, interviewsResult, matchesResult] = await Promise.all([
      client.from('profiles').select('id,display_name,avatar_url,preferred_region,created_at,updated_at').eq('id', userId).maybeSingle(),
      client.from('resumes').select('profile,segmentation,user_info,updated_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(1),
      client.rpc('get_auth_user_email_parts', { p_user_id: userId }),
      client.rpc('get_ai_usage_summary_v3', { p_user_id: userId, p_feature: null, p_provider: null, p_status: null, p_usage_source: null, p_from: null, p_to: null }),
      client.rpc('get_ai_usage_feature_summary_v3', { p_user_id: userId, p_feature: null, p_provider: null, p_status: null, p_usage_source: null, p_from: null, p_to: null }),
      client.from('ai_usage_events').select('id,request_id,feature,provider,model,status,usage_source,modality,input_tokens,output_tokens,total_tokens,input_audio_seconds,output_audio_seconds,estimated_cost,currency,cost_source,duration_ms,error_code,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
      countRows('resumes', userId),
      countRows('applications', userId),
      countRows('interview_sessions', userId),
      countRows('ai_matches', userId),
    ]);
    if (profileResult.error || resumeIdentityResult.error || usageResult.error || featureResult.error || eventsResult.error || resumesResult.error || applicationsResult.error || interviewsResult.error || matchesResult.error) {
      throw new Error(profileResult.error?.message || resumeIdentityResult.error?.message || usageResult.error?.message || featureResult.error?.message || eventsResult.error?.message || resumesResult.error?.message || applicationsResult.error?.message || interviewsResult.error?.message || matchesResult.error?.message);
    }

    const latestResume = Array.isArray(resumeIdentityResult.data) ? resumeIdentityResult.data[0] : null;
    const profileJson = latestResume?.profile as { education?: Array<{ school?: string }> } | null;
    const segmentationJson = latestResume?.segmentation as { careerStage?: string } | null;
    const userInfo = latestResume?.user_info as { name?: string } | null;
    const emailData = emailResult.error ? null : emailResult.data;
    const emailRow = (Array.isArray(emailData) ? emailData[0] : emailData) as { email_local?: string | null; email_domain?: string | null } | null;
    const emailLocal = typeof emailRow?.email_local === 'string' ? emailRow.email_local : null;
    const emailDomain = typeof emailRow?.email_domain === 'string' ? emailRow.email_domain : null;
    const publicCode = studentPublicCode(userId);
    const resolved = resolveStudentDisplayName({
      displayName: profileResult.data?.display_name,
      resumeName: userInfo?.name,
      emailLocal,
      publicCode,
    });

    return NextResponse.json({
      data: {
        student: {
          id: userId,
          publicCode,
          displayName: resolved.name,
          nameSource: resolved.source,
          emailHandle: studentEmailHandle(emailLocal, emailDomain),
          avatarUrl: profileResult.data?.avatar_url || null,
          schoolName: profileJson?.education?.[0]?.school || null,
          preferredRegion: profileResult.data?.preferred_region || null,
          careerStage: segmentationJson?.careerStage || null,
          createdAt: profileResult.data?.created_at || null,
          updatedAt: profileResult.data?.updated_at || null,
        },
        business: {
          resumes: resumesResult.count || 0,
          applications: applicationsResult.count || 0,
          interviews: interviewsResult.count || 0,
          aiMatches: matchesResult.count || 0,
        },
        usage: usageResult.data?.[0] || null,
        features: featureResult.data || [],
        recentEvents: eventsResult.data || [],
      },
      error: null,
    });
  } catch (error) {
    console.error('[Admin Student Detail] query failed:', error);
    const migrationResponse = adminMigrationUnavailable(error, ['0017_ai_usage_events.sql', '0018_ai_usage_admin_aggregates.sql', '0019_audio_ai_usage_metrics.sql', '0023_ai_model_prices.sql'], '学生用量详情依赖数据库迁移，当前环境尚未部署');
    if (migrationResponse) return migrationResponse;
    return NextResponse.json({ data: null, error: { code: 'ADMIN_STUDENT_QUERY_FAILED', message: '获取学生用量详情失败' } }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const permissionError = await requireAdminPermission(request, ADMIN_PERMISSIONS.usersWrite);
  if (permissionError) return permissionError;

  const { id: userId } = await params;
  if (!UUID_PATTERN.test(userId)) {
    return NextResponse.json({ data: null, error: { code: 'INVALID_STUDENT_ID', message: '学生 ID 无效' } }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => ({})) as { confirmCode?: unknown };
    const confirmCode = typeof body.confirmCode === 'string' ? body.confirmCode.trim() : '';
    const publicCode = studentPublicCode(userId);
    if (confirmCode.toUpperCase() !== publicCode.toUpperCase()) {
      return NextResponse.json({ data: null, error: { code: 'CONFIRM_CODE_REQUIRED', message: '请输入该学员短码以确认删除' } }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { data: adminBinding, error: adminError } = await client
      .from('admin_users')
      .select('id,status')
      .eq('auth_user_id', userId)
      .maybeSingle();
    if (adminError) throw new Error(adminError.message);
    if (adminBinding) {
      return NextResponse.json({
        data: null,
        error: { code: 'STUDENT_IS_ADMIN', message: '该账号仍绑定管理员权限，请先在管理员页解除绑定' },
      }, { status: 409 });
    }

    const { data: authUser, error: authError } = await client.auth.admin.getUserById(userId);
    if (authError || !authUser.user) {
      return NextResponse.json({ data: null, error: { code: 'STUDENT_NOT_FOUND', message: '学员账号不存在' } }, { status: 404 });
    }

    const { data: resumes, error: resumeError } = await client
      .from('resumes')
      .select('file_key')
      .eq('user_id', userId);
    if (resumeError) throw new Error(resumeError.message);

    const { error: deleteError } = await client.auth.admin.deleteUser(userId);
    if (deleteError) throw new Error(deleteError.message);

    for (const resume of resumes || []) {
      if (typeof resume.file_key === 'string' && resume.file_key) {
        try {
          await deleteResumeFile(resume.file_key);
        } catch (storageError) {
          console.error('[Admin Student] resume file cleanup failed:', storageError);
        }
      }
    }

    await recordAdminAuditEvent({
      request,
      action: 'student.delete',
      resourceType: 'student',
      resourceId: publicCode,
      subjectUserId: userId,
      metadata: { resume_files: (resumes || []).length },
    });
    return NextResponse.json({ data: { id: userId, publicCode }, error: null });
  } catch (error) {
    await recordAdminAuditFailure({ request, action: 'student.delete', resourceType: 'student', resourceId: userId, error });
    console.error('[Admin Student] delete failed:', error);
    return NextResponse.json({ data: null, error: { code: 'ADMIN_STUDENT_DELETE_FAILED', message: '删除学员账号失败' } }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { adminMigrationUnavailable } from '@/lib/admin-dependency-status';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CountResult = { count: number | null; error: { message: string } | null };

function countRows(table: string, userId: string): Promise<CountResult> {
  return getSupabaseClient().from(table).select('id', { count: 'exact', head: true }).eq('user_id', userId) as unknown as Promise<CountResult>;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.usersRead);
  if (permissionError) return permissionError;

  const { id: userId } = await params;
  if (!UUID_PATTERN.test(userId)) {
    return NextResponse.json({ data: null, error: { code: 'INVALID_STUDENT_ID', message: '学生 ID 无效' } }, { status: 400 });
  }

  try {
    const client = getSupabaseClient();
    const [profileResult, usageResult, featureResult, eventsResult, resumesResult, applicationsResult, interviewsResult, matchesResult] = await Promise.all([
      client.from('profiles').select('id,display_name,created_at,updated_at').eq('id', userId).maybeSingle(),
      client.rpc('get_ai_usage_summary_v3', { p_user_id: userId, p_feature: null, p_provider: null, p_status: null, p_usage_source: null, p_from: null, p_to: null }),
      client.rpc('get_ai_usage_feature_summary_v3', { p_user_id: userId, p_feature: null, p_provider: null, p_status: null, p_usage_source: null, p_from: null, p_to: null }),
      client.from('ai_usage_events').select('id,request_id,feature,provider,model,status,usage_source,modality,input_tokens,output_tokens,total_tokens,input_audio_seconds,output_audio_seconds,estimated_cost,currency,cost_source,duration_ms,error_code,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
      countRows('resumes', userId),
      countRows('applications', userId),
      countRows('interview_sessions', userId),
      countRows('ai_matches', userId),
    ]);
    if (profileResult.error || usageResult.error || featureResult.error || eventsResult.error || resumesResult.error || applicationsResult.error || interviewsResult.error || matchesResult.error) {
      throw new Error(profileResult.error?.message || usageResult.error?.message || featureResult.error?.message || eventsResult.error?.message || resumesResult.error?.message || applicationsResult.error?.message || interviewsResult.error?.message || matchesResult.error?.message);
    }

    return NextResponse.json({
      data: {
        student: {
          id: userId,
          displayName: profileResult.data?.display_name || '未命名用户',
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

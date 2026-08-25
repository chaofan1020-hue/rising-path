import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';

interface FavoriteRow {
  jobs?: Array<{ updated_at?: string | null }> | { updated_at?: string | null } | null;
}

export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorizedResponse();

  // These cards are below the first viewport. Keeping them separate lets the
  // dashboard become usable as soon as its phase, metrics, and plan are ready.
  const [{ data: favorites, error: favoritesError }, { data: evaluations, error: evaluationsError }] = await Promise.all([
    auth.client
      .from('favorites')
      .select('jobs!inner(updated_at)')
      .eq('user_id', auth.user.id),
    auth.client
      .from('interview_sessions')
      .select('id, target_company, interview_type, overall_score, report_grade, updated_at, created_at')
      .eq('user_id', auth.user.id)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  if (favoritesError || evaluationsError) {
    console.error('[Dashboard activity] Failed to load deferred data:', favoritesError || evaluationsError);
    return NextResponse.json({ error: 'Unable to load dashboard activity' }, { status: 500 });
  }

  const recentlyUpdatedFavorites = (favorites as FavoriteRow[] | null | undefined ?? []).filter((favorite) => {
    const job = Array.isArray(favorite.jobs) ? favorite.jobs[0] : favorite.jobs;
    return Date.now() - new Date(job?.updated_at || 0).getTime() < 7 * 24 * 60 * 60 * 1000;
  }).length;

  return NextResponse.json({
    recentlyUpdatedFavorites,
    interviewEvaluations: (evaluations ?? [])
      .filter((evaluation) => evaluation.overall_score != null || evaluation.report_grade != null)
      .map((evaluation) => ({
      id: evaluation.id,
      targetCompany: evaluation.target_company ?? '',
      interviewType: evaluation.interview_type ?? '',
      overallScore: evaluation.overall_score,
      reportGrade: evaluation.report_grade,
      completedAt: evaluation.updated_at ?? evaluation.created_at,
      })),
  });
}

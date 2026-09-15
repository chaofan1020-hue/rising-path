import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { sanitizeJobContent } from '@/lib/job-content';

// Return only the signed-in user's active, open favorites. This endpoint is
// intentionally separate from the public interview catalog so no user's
// private job history can be exposed through a cacheable response.
export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorizedResponse();

  try {
    const { data, error } = await auth.client
      .from('favorites')
      .select('job_id, created_at, jobs!inner(id, title, company, region, is_active, is_closed)')
      .eq('user_id', auth.user.id)
      .eq('jobs.is_active', true)
      .eq('jobs.is_closed', false)
      .order('created_at', { ascending: false })
      .limit(80);
    if (error) throw error;

    const favorites = (data || []).flatMap((row) => {
      const job = Array.isArray(row.jobs) ? row.jobs[0] : row.jobs;
      if (!job) return [];
      const safe = sanitizeJobContent(job);
      return [{
        id: job.id,
        title: safe.title,
        company: job.company,
        region: job.region,
        created_at: row.created_at,
      }];
    });
    return NextResponse.json({ favorites }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    console.error('[Interview favorites] Failed to load:', error);
    return NextResponse.json({ error: '读取收藏岗位失败', favorites: [] }, { status: 500 });
  }
}

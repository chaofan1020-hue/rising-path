import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';

type JobOption = {
  id: number;
  title: string;
  company: string;
  region: string;
  source: 'favorite' | 'application';
};

export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorizedResponse();

  try {
    const client = auth.client;
    const [{ data: favoriteRows, error: favoritesError }, { data: applicationRows, error: applicationsError }] = await Promise.all([
      client
        .from('favorites')
        .select('job_id, created_at, jobs!inner(id, title, company, region, is_active, is_closed)')
        .eq('user_id', auth.user.id)
        .eq('jobs.is_active', true)
        .eq('jobs.is_closed', false)
        .order('created_at', { ascending: false })
        .limit(80),
      client
        .from('applications')
        .select('job_id, created_at, jobs!inner(id, title, company, region, is_active, is_closed)')
        .eq('user_id', auth.user.id)
        .eq('jobs.is_active', true)
        .eq('jobs.is_closed', false)
        .order('created_at', { ascending: false })
        .limit(80),
    ]);

    if (favoritesError || applicationsError) {
      throw new Error(favoritesError?.message || applicationsError?.message || '读取岗位失败');
    }

    const favorites = (favoriteRows || []).flatMap((row) => {
      const job = Array.isArray(row.jobs) ? row.jobs[0] : row.jobs;
      if (!job) return [];
      return [{ id: job.id, title: job.title, company: job.company, region: job.region, source: 'favorite' as const }];
    });
    const applications = (applicationRows || []).flatMap((row) => {
      const job = Array.isArray(row.jobs) ? row.jobs[0] : row.jobs;
      if (!job) return [];
      return [{ id: job.id, title: job.title, company: job.company, region: job.region, source: 'application' as const }];
    });
    const seen = new Set<number>();
    const unique = (items: JobOption[]) => items.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });

    return NextResponse.json({
      favorites: unique(favorites),
      applications: unique(applications),
    });
  } catch (error) {
    console.error('[Optimize job options] Failed to load:', error);
    return NextResponse.json({ error: '读取常用岗位失败' }, { status: 500 });
  }
}

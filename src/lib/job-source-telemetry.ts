import { getSupabaseClient } from '@/storage/database/supabase-client';

type UpstreamCompany = {
  id?: unknown;
  name?: unknown;
  open_jobs?: unknown;
  active_jobs?: unknown;
  job_count?: unknown;
  last_crawl_at?: unknown;
  latest_run_status?: unknown;
  last_crawl_expected?: unknown;
  last_crawl_discovered?: unknown;
  official_open_jobs?: unknown;
  official_count_status?: unknown;
  official_count_source?: unknown;
  official_count_observed_at?: unknown;
  official_count_lower_bound?: unknown;
  last_crawled_at?: unknown;
  last_crawl_status?: unknown;
};

function sourceBase(value: string): string {
  const endpoint = new URL(value);
  endpoint.pathname = endpoint.pathname.replace(/\/integrations\/v1\/jobs\/?$/, '');
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString().replace(/\/$/, '');
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function count(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
  const parsed = Number(value);
  // 9999/99999 are connector placeholders used by older upstream runs, not
  // real company job totals. Never persist them as an observed count.
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 1_000_000 && parsed !== 9999 && parsed !== 99999 ? parsed : null;
}

export async function refreshUpstreamCompanySnapshots(client = getSupabaseClient()): Promise<{ updated: number; available: boolean }> {
  const feedUrl = process.env.JOBS_FEED_URL;
  const apiKey = process.env.JOBS_FEED_API_KEY || process.env.INTEGRATION_API_KEY;
  if (!feedUrl || !apiKey) return { updated: 0, available: false };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${sourceBase(feedUrl)}/dashboard/company-directory`, {
      headers: { Accept: 'application/json', 'X-Integration-Key': apiKey },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`上游公司目录返回 HTTP ${response.status}`);
    const rows = await response.json() as unknown;
    if (!Array.isArray(rows)) throw new Error('上游公司目录格式无效');
    let updated = 0;
    for (const row of rows as UpstreamCompany[]) {
      const id = text(row.id);
      const name = text(row.name);
      if (!id || !name) continue;
      const upstreamJobs = count(row.open_jobs ?? row.active_jobs ?? row.job_count);
      const officialExpectedJobs = count(row.official_open_jobs ?? row.last_crawl_expected);
      const upstreamDiscoveredJobs = count(row.last_crawl_discovered);
      const officialCountStatus = text(row.official_count_status);
      const officialCountSource = text(row.official_count_source);
      const officialCountObservedAt = text(row.official_count_observed_at);
      const officialCountLowerBound = count(row.official_count_lower_bound);
      const patch: Record<string, unknown> = {
        upstream_last_observed_at: new Date().toISOString(),
        upstream_snapshot_error: null,
      };
      if (upstreamJobs !== null) patch.upstream_active_jobs = upstreamJobs;
      if (officialExpectedJobs !== null) {
        patch.official_expected_jobs = officialExpectedJobs;
        patch.official_count_observed_at = officialCountObservedAt || new Date().toISOString();
      } else if (officialCountStatus === 'capped_unavailable') {
        // A provider ceiling is an auditable lower bound, not an exact total.
        // Keep the previous exact count untouched and store the bound/status.
        patch.official_count_observed_at = officialCountObservedAt || new Date().toISOString();
      }
      if (upstreamDiscoveredJobs !== null) {
        patch.upstream_discovered_jobs = upstreamDiscoveredJobs;
        patch.official_count_observed_at = new Date().toISOString();
      }
      const crawlAt = text(row.last_crawl_at ?? row.last_crawled_at);
      if (crawlAt) patch.upstream_last_crawl_at = crawlAt;
      const runStatus = text(row.latest_run_status ?? row.last_crawl_status);
      if (runStatus) patch.upstream_latest_run_status = runStatus;
      if (officialCountStatus) patch.official_count_status = officialCountStatus;
      if (officialCountSource) patch.official_count_source = officialCountSource;
      if (officialCountLowerBound !== null) patch.official_count_lower_bound = officialCountLowerBound;
      else if (officialCountStatus !== 'capped_unavailable') patch.official_count_lower_bound = null;
      const result = await client.from('job_company_sources').update(patch).eq('upstream_company_id', id);
      if (!result.error) updated += result.count || 0;
      else console.error('[Job Source Telemetry] company snapshot write failed:', result.error.message);
    }
    return { updated, available: true };
  } catch (error) {
    console.error('[Job Source Telemetry] upstream snapshot failed:', error instanceof Error ? error.message : error);
    return { updated: 0, available: false };
  } finally {
    clearTimeout(timeout);
  }
}

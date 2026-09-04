import { PHASE2_COMPANY_PROFILES, fetchConnectorBoard } from '../src/lib/job-connectors';
import type { ConnectorJob } from '../src/lib/job-connectors/types';

function hostOf(url: string | null | undefined): string {
  try { return new URL(url || '').hostname.toLowerCase(); } catch { return ''; }
}

function hostMatches(hostname: string, allowed: string[]): boolean {
  return allowed.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function coverage(jobs: ConnectorJob[], field: 'location' | 'workplace_type' | 'employment_category' | 'experience' | 'salary_range' | 'deadline'): number {
  return jobs.filter((job) => {
    if (field === 'location') return Boolean(job.location);
    if (field === 'workplace_type') return Boolean(job.workplace_type);
    if (field === 'employment_category') return Boolean(job.employment_category && job.employment_category !== '未知');
    if (field === 'experience') return job.experience_min_years != null || Boolean(job.experience_text);
    if (field === 'salary_range') return Boolean(job.salary_range);
    return Boolean(job.valid_through);
  }).length;
}

async function main(): Promise<void> {
  const results = await Promise.all(PHASE2_COMPANY_PROFILES.map(async (profile) => {
    try {
      const result = await fetchConnectorBoard(profile, { timeoutMs: 15_000 });
      const officialUrlCount = result.jobs.filter((job) => hostMatches(hostOf(job.source_url), profile.officialHosts)).length;
      return {
        company: profile.company,
        connector: profile.connector,
        board: profile.board,
        status: result.received > 0 && result.dropped === 0 ? 'ready_for_sample' : result.received > 0 ? 'needs_mapping' : 'empty_source',
        received: result.received,
        parsed: result.jobs.length,
        dropped: result.dropped,
        official_url_coverage: result.jobs.length ? Number((officialUrlCount / result.jobs.length).toFixed(4)) : 0,
        field_coverage: Object.fromEntries((['location', 'workplace_type', 'employment_category', 'experience', 'salary_range', 'deadline'] as const)
          .map((field) => [field, result.jobs.length ? Number((coverage(result.jobs, field) / result.jobs.length).toFixed(4)) : 0])),
      };
    } catch (error) {
      return {
        company: profile.company,
        connector: profile.connector,
        board: profile.board,
        status: 'source_error',
        received: 0,
        parsed: 0,
        dropped: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }));
  console.log(JSON.stringify({ generated_at: new Date().toISOString(), companies: results }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { JOBS_FEED_SOURCE } from '@/lib/jobs-feed';

loadDotenv({ path: '.env.local' });

const FIELDS = [
  'valid_through',
  'salary_range',
  'employment_type',
  'workplace_type',
  'employment_category',
  'experience_min_years',
  'experience_text',
  'location_source',
] as const;

function tally(rows: Array<Record<string, unknown>>, field: string): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = typeof row[field] === 'string' && row[field] ? row[field] as string : 'unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}

async function withRetry<T>(operation: () => PromiseLike<T>, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw new Error(`${label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function main() {
  const client = getSupabaseClient();
  const output: Record<string, unknown> = {};
  for (const field of FIELDS) {
    const { count, error } = await withRetry(
      () => Promise.resolve(client
        .from('jobs')
        .select('*', { count: 'exact', head: true })
        .eq('source_system', JOBS_FEED_SOURCE)
        .eq('is_active', true)
        .not(field, 'is', null)),
      `统计 ${field}`,
    );
    if (error) throw new Error(`${field}: ${error.message}`);
    output[field] = count || 0;
  }

  const data: Array<Record<string, unknown>> = [];
  const pageSize = 1_000;
  for (let offset = 0; ; offset += pageSize) {
    const { data: page, error } = await withRetry(
      () => Promise.resolve(client
        .from('jobs')
        .select('deadline_source, salary_source, location_source, employment_category, experience_min_years, experience_text')
        .eq('source_system', JOBS_FEED_SOURCE)
        .eq('is_active', true)
        .range(offset, offset + pageSize - 1)),
      `读取字段来源第 ${Math.floor(offset / pageSize) + 1} 页`,
    );
    if (error) throw new Error(`读取字段来源失败: ${error.message}`);
    data.push(...(page || []) as Array<Record<string, unknown>>);
    if (!page || page.length < pageSize) break;
  }
  output.sampled_active_jobs = data.length;
  for (const field of ['deadline_source', 'salary_source', 'location_source', 'employment_category']) {
    output[`${field}_distribution`] = tally(data, field);
  }

  const feedUrl = process.env.JOBS_FEED_URL;
  const apiKey = process.env.JOBS_FEED_API_KEY || process.env.INTEGRATION_API_KEY;
  if (!feedUrl || !apiKey) throw new Error('缺少上游岗位接口配置');
  const endpoint = new URL(feedUrl);
  // This is a health sample, not a replication pass. Feed items include long
  // descriptions, so a small page keeps the audit quick and non-intrusive.
  endpoint.searchParams.set('limit', '100');
  endpoint.searchParams.set('include_closed', 'false');
  const response = await fetch(endpoint, {
    headers: { Accept: 'application/json', 'X-Integration-Key': apiKey },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`读取上游字段来源失败: HTTP ${response.status}`);
  const payload = await response.json() as {
    items?: Array<{
      valid_through?: unknown;
      application_deadline?: unknown;
      salary_range?: unknown;
      compensation?: unknown;
      location?: unknown;
      source_evidence?: { structured_field_sources?: Record<string, unknown> };
    }>;
  };
  const upstream = {
    sampled_jobs: payload.items?.length || 0,
    deadline_sources: new Map<string, number>(),
    salary_sources: new Map<string, number>(),
    location_present: 0,
  };
  for (const item of payload.items || []) {
    const sources = item.source_evidence?.structured_field_sources || {};
    if (item.valid_through || item.application_deadline) {
      const source = String(sources.application_deadline || sources.valid_through || 'unknown');
      upstream.deadline_sources.set(source, (upstream.deadline_sources.get(source) || 0) + 1);
    }
    if (item.salary_range || item.compensation) {
      const source = String(sources.salary_range || sources.compensation || 'unknown');
      upstream.salary_sources.set(source, (upstream.salary_sources.get(source) || 0) + 1);
    }
    if (item.location) upstream.location_present += 1;
  }
  output.upstream_sample = {
    sampled_jobs: upstream.sampled_jobs,
    deadline_sources: [...upstream.deadline_sources.entries()].sort((left, right) => right[1] - left[1]),
    salary_sources: [...upstream.salary_sources.entries()].sort((left, right) => right[1] - left[1]),
    location_present: upstream.location_present,
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

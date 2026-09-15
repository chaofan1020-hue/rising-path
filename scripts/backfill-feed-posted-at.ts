import { config as loadDotenv } from 'dotenv';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseFeedPostedAt } from '@/lib/jobs-feed';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: '.env.production.local', override: true });

const write = process.argv.includes('--write');
const inputPath = process.argv.find((item) => item.startsWith('--input='))?.slice('--input='.length)
  || 'output/posted-date-export.jsonl';
const FUTURE_SLACK_MS = 2 * 24 * 60 * 60 * 1000;
const now = Date.now();
const PAGE_SIZE = 1000;
const CHUNK_SIZE = 40;
const MAX_ATTEMPTS = 4;

type ExportRow = {
  company?: string;
  external_job_id?: string | null;
  date_posted?: string | null;
};

function jobKey(company: string, externalJobId: string): string {
  return `${company}\u0000${externalJobId}`;
}

async function countWhere(client: ReturnType<typeof getSupabaseClient>, extra?: (q: any) => any) {
  let query = client.from('jobs').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('source_system', 'collector_feed');
  if (extra) query = extra(query);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count || 0;
}

async function readExport(path: string): Promise<ExportRow[]> {
  const rows: ExportRow[] = [];
  const reader = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of reader) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line) as ExportRow);
  }
  return rows;
}

async function withRetry<T>(label: string, operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === MAX_ATTEMPTS || !/abort|fetch failed|timeout|network/i.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function loadUsJobs(client: ReturnType<typeof getSupabaseClient>) {
  const jobs = new Map<string, { id: number; posted_at: string | null }>();
  let offset = 0;
  while (true) {
    const { data, error } = await withRetry(`load-us-jobs-${offset}`, async () => {
      const result = await client
        .from('jobs')
        .select('id,company,external_job_id,posted_at')
        .eq('is_active', true)
        .eq('source_system', 'collector_feed')
        .range(offset, offset + PAGE_SIZE - 1);
      if (result.error) throw new Error(result.error.message);
      return result;
    });
    const rows = data || [];
    for (const row of rows) {
      const company = String(row.company || '').trim();
      const externalJobId = String(row.external_job_id || '').trim();
      if (!company || !externalJobId) continue;
      jobs.set(jobKey(company, externalJobId), { id: Number(row.id), posted_at: row.posted_at || null });
    }
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return jobs;
}

async function main() {
  const client = getSupabaseClient();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const ref = url.match(/https?:\/\/([^.]+)/)?.[1] || url;
  const active = await countWhere(client);
  const withPosted = await countWhere(client, (q) => q.not('posted_at', 'is', null));
  const futurePosted = await countWhere(client, (q) => q.gt('posted_at', new Date(now + FUTURE_SLACK_MS).toISOString()));
  const rows = await readExport(inputPath);
  const parsed = rows.map((row) => ({
    company: String(row.company || '').trim(),
    external_job_id: String(row.external_job_id || '').trim(),
    raw: String(row.date_posted || '').trim(),
    posted_at: parseFeedPostedAt(row.date_posted, now),
  })).filter((row) => row.company && row.external_job_id);
  const parseOk = parsed.filter((row) => row.posted_at);
  const usJobs = await loadUsJobs(client);
  const pending = parseOk.flatMap((row) => {
    const existing = usJobs.get(jobKey(row.company, row.external_job_id));
    if (!existing || !row.posted_at || existing.posted_at === row.posted_at) return [];
    return [{ id: existing.id, posted_at: row.posted_at, company: row.company }];
  });
  const futureIds = [...usJobs.values()]
    .filter((row) => row.posted_at && Date.parse(row.posted_at) > now + FUTURE_SLACK_MS)
    .map((row) => row.id);

  console.log(JSON.stringify({
    env: write ? 'production-write' : 'production-dry-run',
    supabase_ref: ref,
    active,
    with_posted_at_before: withPosted,
    future_posted_at_before: futurePosted,
    export_rows: rows.length,
    parse_ok: parseOk.length,
    parse_fail: parsed.length - parseOk.length,
    us_jobs: usJobs.size,
    pending_updates: pending.length,
    future_clear: futureIds.length,
    samples: parseOk.slice(0, 5).map((row) => ({ company: row.company, raw: row.raw, posted_at: row.posted_at })),
    fail_samples: parsed.filter((row) => !row.posted_at).slice(0, 8).map((row) => ({ company: row.company, raw: row.raw })),
  }, null, 2));

  if (!write) return;

  let updated = 0;
  for (let index = 0; index < pending.length; index += CHUNK_SIZE) {
    const chunk = pending.slice(index, index + CHUNK_SIZE);
    const results = await Promise.all(chunk.map((row) => withRetry(`update-${row.id}`, async () => {
      const { error, data } = await client
        .from('jobs')
        .update({ posted_at: row.posted_at })
        .eq('id', row.id)
        .eq('is_active', true)
        .select('id');
      if (error) throw new Error(`${row.company} ${row.id}: ${error.message}`);
      return data?.length || 0;
    })));
    updated += results.reduce((sum, value) => sum + value, 0);
    if (index % 400 === 0) console.log(JSON.stringify({ progress: index, updated, pending: pending.length }));
  }

  let cleared = 0;
  for (const id of futureIds) {
    await withRetry(`clear-${id}`, async () => {
      const { error } = await client.from('jobs').update({ posted_at: null }).eq('id', id).eq('is_active', true);
      if (error) throw new Error(error.message);
    });
    cleared += 1;
  }

  const withPostedAfter = await countWhere(client, (q) => q.not('posted_at', 'is', null));
  console.log(JSON.stringify({
    env: 'production-write',
    supabase_ref: ref,
    updated,
    cleared_future: cleared,
    with_posted_at_after: withPostedAfter,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

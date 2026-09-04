import { config as loadDotenv } from 'dotenv';
import { fetchSafeExternalPage, ExternalFetchError } from '@/lib/safe-external-fetch';
import { resolveJobDeadline } from '@/lib/job-deadline';
import { looksLikeBlockedPage, looksLikeClosedJobPage } from '@/lib/job-maintenance';
import { JOBS_FEED_SOURCE } from '@/lib/jobs-feed';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { hasMatchingPhenomDetailPayload, isRegisteredPhenomJobUrl } from '@/lib/job-connectors';

loadDotenv({ path: '.env.local' });

type ClosedJob = {
  id: number;
  title: string;
  company: string;
  job_url: string | null;
  valid_through: string | null;
};

type LinkState = {
  job_id: number;
  link_check_failures: number | null;
};

type RecoveryResult = {
  checked: number;
  restored: number;
  expired: number;
  closed_confirmed: number;
  blocked: number;
  inconclusive: number;
  failed: number;
};

function numberEnv(name: string, fallback: number, max: number): number {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback;
}

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() || null : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function looksLikeJobPage(job: ClosedJob, title: string, content: string, url: string): boolean {
  // A valid Phenom detail envelope is stronger than visible copy. Some
  // tenants include a dormant expired-job panel in every large HTML page.
  if (hasMatchingPhenomDetailPayload(url, content)) return true;
  const sample = `${title} ${content}`.toLowerCase();
  const titleTokens = job.title
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 4)
    .slice(0, 12);
  const titleMatches = titleTokens.filter((token) => sample.includes(token)).length;
  const companyTokens = job.company
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 4);
  const companyMatches = companyTokens.filter((token) => sample.includes(token)).length;
  let hasJobPath = false;
  try {
    hasJobPath = /(?:job|jobs|position|requisition|candidateexperience|careers?)/i.test(new URL(url).pathname)
      || /\/\d{4,}(?:\/|$)/.test(new URL(url).pathname);
  } catch {
    hasJobPath = false;
  }
  return (titleMatches >= 2 && companyMatches >= 1)
    || (hasJobPath && companyMatches >= 1 && content.length >= 500);
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function main() {
  const client = getSupabaseClient();
  const maxJobs = numberEnv('JOBS_RECOVERY_MAX', 2000, 5000);
  const concurrency = numberEnv('JOBS_RECOVERY_CONCURRENCY', 8, 20);
  const jobIdValue = argument('job-id');
  const jobId = jobIdValue == null ? null : Number(jobIdValue);
  const company = argument('company');
  const allowRegisteredPhenom = hasFlag('allow-registered-phenom');
  if (jobIdValue != null && (!Number.isInteger(jobId) || jobId == null || jobId < 1)) {
    throw new Error('--job-id 必须是正整数');
  }
  if (allowRegisteredPhenom && jobId == null) {
    throw new Error('--allow-registered-phenom 只能与单个 --job-id 一起使用');
  }
  const result: RecoveryResult = {
    checked: 0,
    restored: 0,
    expired: 0,
    closed_confirmed: 0,
    blocked: 0,
    inconclusive: 0,
    failed: 0,
  };

  let query = client
    .from('jobs')
    .select('id,title,company,job_url,valid_through')
    .eq('source_system', JOBS_FEED_SOURCE)
    .eq('is_active', false)
    .not('job_url', 'is', null)
    .order('updated_at', { ascending: true });
  if (jobId != null) query = query.eq('id', jobId);
  if (company) query = query.eq('company', company);
  const { data, error } = await query.limit(jobId != null ? 1 : maxJobs);
  if (error) throw new Error(`读取待恢复岗位失败: ${error.message}`);
  const jobs = (data || []) as ClosedJob[];
  const ids = jobs.map((job) => job.id);
  const states = new Map<number, LinkState>();
  for (const batch of chunks(ids, 500)) {
    const { data: stateRows, error: stateError } = await client
      .from('job_sync_records')
      .select('job_id,link_check_failures')
      .in('job_id', batch);
    if (stateError) throw new Error(`读取待恢复岗位状态失败: ${stateError.message}`);
    for (const row of (stateRows || []) as LinkState[]) states.set(row.job_id, row);
  }

  for (const batch of chunks(jobs, concurrency)) {
    await Promise.all(batch.map(async (job) => {
      result.checked += 1;
      const checkedAt = new Date().toISOString();
      if (!job.job_url) {
        result.inconclusive += 1;
        return;
      }
      try {
        const page = await fetchSafeExternalPage(job.job_url);
        const trustedRegisteredPhenom = allowRegisteredPhenom && isRegisteredPhenomJobUrl(job.company, job.job_url);
        if (looksLikeClosedJobPage(page.title, page.content)
          && !trustedRegisteredPhenom
          && !hasMatchingPhenomDetailPayload(job.job_url, page.content)) {
          await client.from('job_sync_records').update({
            last_link_checked_at: checkedAt,
            last_link_status: page.httpStatus,
            last_link_http_status: page.httpStatus,
            last_link_error: '复核确认官网页面显示岗位已关闭',
            availability_status: 'closed',
            link_health: 'closed',
            availability_checked_at: checkedAt,
            updated_at: checkedAt,
          }).eq('job_id', job.id);
          result.closed_confirmed += 1;
          return;
        }
        if (looksLikeBlockedPage(page.title, page.content)) {
          result.blocked += 1;
          await client.from('job_sync_records').update({
            last_link_checked_at: checkedAt,
            last_link_status: page.httpStatus,
            last_link_http_status: page.httpStatus,
            last_link_error: '复核遇到验证码/访问验证，保留关闭状态等待浏览器核验',
            availability_status: 'blocked',
            link_health: 'blocked',
            availability_checked_at: checkedAt,
            updated_at: checkedAt,
          }).eq('job_id', job.id);
          return;
        }
        if (!trustedRegisteredPhenom && !looksLikeJobPage(job, page.title, page.content, page.url)) {
          result.inconclusive += 1;
          await client.from('job_sync_records').update({
            last_link_checked_at: checkedAt,
            last_link_status: page.httpStatus,
            last_link_http_status: page.httpStatus,
            last_link_error: '官网可访问但未能确认对应岗位内容，保留关闭状态',
            availability_status: 'unknown',
            link_health: 'unknown',
            availability_checked_at: checkedAt,
            updated_at: checkedAt,
          }).eq('job_id', job.id);
          return;
        }

        const deadline = resolveJobDeadline({
          description: page.content,
          raw_payload: page.metadata,
          source_evidence: { structured_field_sources: { deadline: 'official_payload', description: 'official_description' } },
        });

        const { error: restoreError } = await client
          .from('jobs')
          .update({
            is_active: true,
            is_closed: false,
            ...(deadline ? { valid_through: deadline.value } : {}),
            updated_at: checkedAt,
          })
          .eq('id', job.id)
          .eq('is_active', false);
        if (restoreError) throw restoreError;
        const { error: stateError } = await client.from('job_sync_records').update({
          last_link_checked_at: checkedAt,
          last_link_status: page.httpStatus,
          last_link_http_status: page.httpStatus,
          link_check_failures: 0,
          last_link_error: null,
          availability_status: 'valid',
          link_health: 'healthy',
          availability_checked_at: checkedAt,
          missing_from_feed_at: null,
          missing_feed_checks: 0,
          updated_at: checkedAt,
        }).eq('job_id', job.id);
        if (stateError) throw stateError;
        result.restored += 1;
      } catch (error) {
        const status = error instanceof ExternalFetchError ? error.upstreamStatus : undefined;
        const isNotFound = status === 404 || status === 410;
        if (status === 404 || status === 410) {
          const previous = states.get(job.id)?.link_check_failures || 0;
          const failures = previous + 1;
          await client.from('job_sync_records').update({
            last_link_checked_at: checkedAt,
            last_link_status: status,
            last_link_http_status: status,
            link_check_failures: failures,
            last_link_error: status === 410 || failures >= 2 ? '复核确认官网链接失效' : '首次 404，等待第二次核验',
            availability_status: status === 410 || failures >= 2 ? 'closed' : 'unknown',
            link_health: status === 410 || failures >= 2 ? 'closed' : 'unknown',
            availability_checked_at: checkedAt,
            updated_at: checkedAt,
          }).eq('job_id', job.id);
          if (isNotFound) result.closed_confirmed += 1;
        } else {
          result.failed += 1;
        }
      }
    }));
    console.log(JSON.stringify({ phase: 'recovery', ...result }));
  }

  console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

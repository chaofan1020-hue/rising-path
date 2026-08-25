import type { SupabaseClient } from '@supabase/supabase-js';
import { ExternalFetchError, fetchSafeExternalPage } from '@/lib/safe-external-fetch';
import { JOBS_FEED_SOURCE } from '@/lib/jobs-feed';
import { isJobDeadlineExpired, resolveJobDeadline } from '@/lib/job-deadline';
import { nextLinkFailureCount, shouldCloseAfterLinkFailure, type JobAvailabilityStatus, type JobLinkHealth } from '@/lib/job-link-health';
import { getSupabaseClient } from '@/storage/database/supabase-client';

interface LinkCandidate {
  id: number;
  job_url: string;
  valid_through: string | null;
  link_check_failures: number | null;
}

interface LinkCheckState {
  job_id: number;
  link_check_failures: number | null;
  availability_status: JobAvailabilityStatus | null;
  link_health: JobLinkHealth | null;
}

export function looksLikeClosedJobPage(title: string, content: string): boolean {
  const sample = `${title} ${content.slice(0, 2_000)}`.replace(/\s+/g, ' ').toLowerCase();
  return /(?:job|position|role|opening|vacancy|requisition|opportunity|职位|岗位).{0,100}(?:no longer available|has been filled|is closed|was closed|expired|removed|not found|no longer accepting|不再提供|已关闭|已过期|已下架|不存在)/i.test(sample)
    || /(?:no longer available|has been filled|position filled|job expired|job not found|opening closed|requisition closed|no longer accepting applications|posting has been removed|this role is no longer|职位已关闭|岗位已下架|申请已结束)/i.test(sample);
}

export function looksLikeBlockedPage(title: string, content: string): boolean {
  const sample = `${title} ${content.slice(0, 1_500)}`.replace(/\s+/g, ' ').toLowerCase();
  return /(?:access denied|forbidden|captcha|verify you are human|unusual traffic|enable javascript to continue|checking your browser|security verification)/i.test(sample);
}

function classifyFetchFailure(error: unknown): {
  availabilityStatus: JobAvailabilityStatus;
  linkHealth: JobLinkHealth;
} {
  const externalError = error instanceof ExternalFetchError ? error : null;
  const status = externalError?.upstreamStatus;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (status === 404 || status === 410 || /岗位已关闭|job.*closed|not found|expired/.test(message)) {
    return { availabilityStatus: 'closed', linkHealth: 'closed' };
  }
  if (status === 401 || status === 403 || status === 429 || /captcha|verify|验证|forbidden|access denied|challenge/.test(message)) {
    return { availabilityStatus: 'blocked', linkHealth: 'blocked' };
  }
  if (/timeout|timed out|超时/.test(message)) {
    return { availabilityStatus: 'timeout', linkHealth: 'timeout' };
  }
  return { availabilityStatus: 'unknown', linkHealth: 'unknown' };
}

function shouldPersistRedirect(fromUrl: string, toUrl: string): boolean {
  try {
    const from = new URL(fromUrl);
    const to = new URL(toUrl);
    if (from.origin !== to.origin || from.pathname === to.pathname) return false;
    // Do not replace a job URL with a generic careers/home page.
    const path = to.pathname.replace(/\/+$/, '').toLowerCase();
    return path.length > 1 && !/^\/(careers?|jobs?|opportunities?)$/.test(path);
  } catch {
    return false;
  }
}

export interface JobMaintenanceResult {
  expired: number;
  deadlines_found: number;
  links_checked: number;
  links_healthy: number;
  links_not_found: number;
  links_closed: number;
  links_inconclusive: number;
}

function chunks<T>(values: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

export async function maintainJobLifecycle(options: {
  client?: SupabaseClient;
  linkBatchSize?: number;
  concurrency?: number;
} = {}): Promise<JobMaintenanceResult> {
  const client = options.client || getSupabaseClient();
  const now = new Date().toISOString();
  const result: JobMaintenanceResult = {
    expired: 0,
    deadlines_found: 0,
    links_checked: 0,
    links_healthy: 0,
    links_not_found: 0,
    links_closed: 0,
    links_inconclusive: 0,
  };

  const { data: expiredRows, error: expireError } = await client
    .from('jobs')
    .update({ is_active: false, is_closed: true, updated_at: now })
    // Collector lifecycle comes from the upstream feed. A stale deadline
    // field alone must not hide a role that the official portal still lists.
    .neq('source_system', JOBS_FEED_SOURCE)
    .eq('is_active', true)
    .lt('valid_through', now)
    .select('id');
  if (expireError) throw new Error(`关闭过期岗位失败: ${expireError.message}`);
  result.expired = expiredRows?.length || 0;
  if (expiredRows && expiredRows.length > 0) {
    const { error: expiryStateError } = await client
      .from('job_sync_records')
      .update({
        availability_status: 'closed',
        link_health: 'closed',
        last_link_error: '截止日期已过',
        availability_checked_at: now,
        updated_at: now,
      })
      .in('job_id', expiredRows.map((row) => row.id));
    if (expiryStateError) throw new Error(`保存过期岗位状态失败: ${expiryStateError.message}`);
  }

  const checkIntervalHours = Math.min(Math.max(Number(process.env.JOBS_LINK_CHECK_INTERVAL_HOURS) || 6, 1), 168);
  const threshold = new Date(Date.now() - checkIntervalHours * 60 * 60 * 1000).toISOString();
  const batchSize = Math.min(Math.max(options.linkBatchSize ?? (Number(process.env.JOBS_LINK_CHECK_BATCH) || 300), 1), 500);
  const concurrency = Math.min(Math.max(options.concurrency ?? (Number(process.env.JOBS_LINK_CHECK_CONCURRENCY) || 10), 1), 20);
  const { data: stateRows, error: stateError } = await client
      .from('job_sync_records')
    .select('job_id,link_check_failures,availability_status,link_health')
    .eq('source_system', JOBS_FEED_SOURCE)
    .or(`last_link_checked_at.is.null,last_link_checked_at.lt.${threshold}`)
    .order('last_link_checked_at', { ascending: true, nullsFirst: true })
    .limit(batchSize);
  if (stateError) throw new Error(`读取待核验岗位链接失败: ${stateError.message}`);
  const states = (stateRows || []) as LinkCheckState[];
  const stateByJobId = new Map(states.map((state) => [state.job_id, state]));
  const jobIds = states.map((state) => state.job_id);
  const { data: jobs, error: jobsError } = jobIds.length === 0
    ? { data: [], error: null }
    : await client
      .from('jobs')
      .select('id,job_url,valid_through')
      .in('id', jobIds)
      .eq('is_active', true)
      .not('job_url', 'is', null);
  if (jobsError) throw new Error(`读取待核验岗位链接失败: ${jobsError.message}`);
  const candidates = (jobs || []).map((job) => ({
    id: job.id,
    job_url: job.job_url,
    valid_through: job.valid_through,
    link_check_failures: stateByJobId.get(job.id)?.link_check_failures || 0,
  })) as LinkCandidate[];

  for (const batch of chunks(candidates, concurrency)) {
    await Promise.all(batch.map(async (job) => {
      result.links_checked += 1;
      try {
        const page = await fetchSafeExternalPage(job.job_url);
        if (looksLikeClosedJobPage(page.title, page.content)) {
          throw new ExternalFetchError('目标页面显示岗位已关闭', 422, 410);
        }
        if (looksLikeBlockedPage(page.title, page.content)) {
          throw new ExternalFetchError('目标页面需要浏览器验证，暂不判定岗位状态', 422);
        }
        const jobPatch: Record<string, unknown> = {};
        if (shouldPersistRedirect(job.job_url, page.url)) {
          jobPatch.job_url = page.url;
          jobPatch.source_url = page.url;
        }
        if (!job.valid_through) {
          const resolvedDeadline = resolveJobDeadline({
            description: page.content,
            raw_payload: page.metadata,
          });
          if (resolvedDeadline) {
            const expired = isJobDeadlineExpired(resolvedDeadline.value);
            jobPatch.valid_through = resolvedDeadline.value;
            jobPatch.is_active = !expired;
            jobPatch.is_closed = expired;
            result.deadlines_found += 1;
            if (expired) result.expired += 1;
          }
        }
        if (Object.keys(jobPatch).length > 0) {
          jobPatch.updated_at = new Date().toISOString();
          const { error: jobUpdateError } = await client
            .from('jobs')
            .update(jobPatch)
            .eq('id', job.id)
            .eq('is_active', true);
          if (jobUpdateError) throw jobUpdateError;
        }
        const { error: updateError } = await client
          .from('job_sync_records')
          .update({
            last_link_checked_at: new Date().toISOString(),
            last_link_status: page.httpStatus,
            last_link_http_status: page.httpStatus,
            link_check_failures: 0,
            last_link_error: null,
            availability_status: 'valid',
            link_health: 'healthy',
            availability_checked_at: new Date().toISOString(),
          })
          .eq('job_id', job.id);
        if (updateError) throw updateError;
        result.links_healthy += 1;
      } catch (requestError) {
        const upstreamStatus = requestError instanceof ExternalFetchError ? requestError.upstreamStatus : undefined;
        const classification = classifyFetchFailure(requestError);
        const isNotFound = upstreamStatus === 404 || upstreamStatus === 410;
        const failures = nextLinkFailureCount(upstreamStatus, job.link_check_failures);
        // 410 and a page-level "closed" signal are definitive. A bare 404 is
        // retried once to avoid closing jobs during a transient ATS outage.
        const shouldClose = shouldCloseAfterLinkFailure({
          httpStatus: upstreamStatus,
          previousFailures: job.link_check_failures,
        });
        const persistedClassification = isNotFound && !shouldClose
          ? { availabilityStatus: 'unknown' as const, linkHealth: 'unknown' as const }
          : classification;
        const { error: updateError } = await client
          .from('job_sync_records')
          .update({
            last_link_checked_at: new Date().toISOString(),
            last_link_status: upstreamStatus || null,
            last_link_http_status: upstreamStatus || null,
            link_check_failures: failures,
            last_link_error: requestError instanceof Error ? requestError.message.slice(0, 2_000) : String(requestError).slice(0, 2_000),
            availability_status: persistedClassification.availabilityStatus,
            link_health: persistedClassification.linkHealth,
            availability_checked_at: new Date().toISOString(),
          })
          .eq('job_id', job.id);
        if (updateError) throw updateError;
        if (shouldClose) {
          const { error: closeError } = await client
            .from('jobs')
            .update({ is_active: false, is_closed: true, updated_at: new Date().toISOString() })
            .eq('id', job.id)
            .eq('is_active', true);
          if (closeError) throw closeError;
        }
        if (isNotFound) result.links_not_found += 1;
        else result.links_inconclusive += 1;
        if (shouldClose) result.links_closed += 1;
      }
    }));
  }

  return result;
}

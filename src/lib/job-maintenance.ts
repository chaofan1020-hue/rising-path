import type { SupabaseClient } from '@supabase/supabase-js';
import { ExternalFetchError, fetchSafeExternalPage } from '@/lib/safe-external-fetch';
import { JOBS_FEED_SOURCE } from '@/lib/jobs-feed';
import { getSupabaseClient } from '@/storage/database/supabase-client';

interface LinkCandidate {
  id: number;
  job_url: string;
  link_check_failures: number | null;
}

interface LinkCheckState {
  job_id: number;
  link_check_failures: number | null;
}

export interface JobMaintenanceResult {
  expired: number;
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
    links_checked: 0,
    links_healthy: 0,
    links_not_found: 0,
    links_closed: 0,
    links_inconclusive: 0,
  };

  const { data: expiredRows, error: expireError } = await client
    .from('jobs')
    .update({ is_active: false, is_closed: true, updated_at: now })
    .eq('source_system', JOBS_FEED_SOURCE)
    .eq('is_active', true)
    .lt('valid_through', now)
    .select('id');
  if (expireError) throw new Error(`关闭过期岗位失败: ${expireError.message}`);
  result.expired = expiredRows?.length || 0;

  const threshold = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const batchSize = Math.min(Math.max(options.linkBatchSize ?? (Number(process.env.JOBS_LINK_CHECK_BATCH) || 100), 1), 500);
  const concurrency = Math.min(Math.max(options.concurrency ?? (Number(process.env.JOBS_LINK_CHECK_CONCURRENCY) || 5), 1), 20);
  const { data: stateRows, error: stateError } = await client
    .from('job_sync_records')
    .select('job_id,link_check_failures')
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
      .select('id,job_url')
      .in('id', jobIds)
      .eq('is_active', true)
      .not('job_url', 'is', null);
  if (jobsError) throw new Error(`读取待核验岗位链接失败: ${jobsError.message}`);
  const candidates = (jobs || []).map((job) => ({
    id: job.id,
    job_url: job.job_url,
    link_check_failures: stateByJobId.get(job.id)?.link_check_failures || 0,
  })) as LinkCandidate[];

  for (const batch of chunks(candidates, concurrency)) {
    await Promise.all(batch.map(async (job) => {
      result.links_checked += 1;
      try {
        const page = await fetchSafeExternalPage(job.job_url);
        const { error: updateError } = await client
          .from('job_sync_records')
          .update({
            last_link_checked_at: new Date().toISOString(),
            last_link_status: page.httpStatus,
            link_check_failures: 0,
          })
          .eq('job_id', job.id);
        if (updateError) throw updateError;
        result.links_healthy += 1;
      } catch (requestError) {
        const upstreamStatus = requestError instanceof ExternalFetchError ? requestError.upstreamStatus : undefined;
        const isNotFound = upstreamStatus === 404 || upstreamStatus === 410;
        const failures = isNotFound ? (job.link_check_failures || 0) + 1 : (job.link_check_failures || 0);
        const shouldClose = isNotFound && failures >= 2;
        const { error: updateError } = await client
          .from('job_sync_records')
          .update({
            last_link_checked_at: new Date().toISOString(),
            last_link_status: upstreamStatus || null,
            link_check_failures: failures,
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

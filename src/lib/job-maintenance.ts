import type { SupabaseClient } from '@supabase/supabase-js';
import { ExternalFetchError, fetchSafeExternalPage } from '@/lib/safe-external-fetch';
import { JOBS_FEED_SOURCE } from '@/lib/jobs-feed';
import { isJobDeadlineExpired, resolveJobDeadline } from '@/lib/job-deadline';
import { parseExperience } from '@/lib/job-connectors/utils';
import { nextLinkFailureCount, shouldCloseAfterLinkFailure, type JobAvailabilityStatus, type JobLinkHealth } from '@/lib/job-link-health';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { extractOfficialJobDetails, isJobContentShell } from '@/lib/job-official-detail';
import { hasMatchingPhenomDetailPayload } from '@/lib/job-connectors/fetch';
import { isRegisteredPhenomJobUrl } from '@/lib/job-connectors/company-profiles';

interface LinkCandidate {
  id: number;
  company: string;
  job_url: string;
  valid_through: string | null;
  source_system: string | null;
  field_evidence: Record<string, unknown> | null;
  link_check_failures: number | null;
  description: string | null;
  requirements: string | null;
  experience_min_years: number | null;
  experience_max_years: number | null;
  experience_text: string | null;
  region: string | null;
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
  // A normal ATS page often loads reCAPTCHA scripts even when the job body is
  // public. Only classify an actual challenge/access page as blocked; the
  // bare word "captcha" is not evidence of a failed fetch.
  return /(?:access denied|forbidden|verify you are human|unusual traffic|enable javascript to continue|checking your browser|security verification|captcha\s+(?:verification|challenge|required))/i.test(sample);
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

export function usableOfficialContent(value: string): string | null {
  const content = value.replace(/\s+/g, ' ').trim();
  if (content.length < 160) return null;
  // Some TAL/ATS pages include the application's serialized theme/search
  // configuration in the server-rendered shell. It is not a job description.
  if (/(?:themeOptions|customTheme|varTheme|pcsjoblevel|position_profile_locations|locationSearch)/i.test(content)
    || (content.match(/(?:&#34;|&quot;|"|\{)/g) || []).length > 12) return null;
  if (/^(?:job|career|opportunities?)\s*(?:search|home)?$/i.test(content)) return null;
  return content.slice(0, 50_000);
}

export function extractOfficialJobRequirements(content: string): string | null {
  const normalized = content.replace(/\s+/g, ' ').trim();
  const startPattern = /(?:basic qualifications|minimum qualifications|preferred qualifications|qualifications|requirements|what you(?:'|’)ll bring|skills(?: and experience)?|任职要求|岗位要求)\s*:?/i;
  const start = startPattern.exec(normalized);
  if (!start) return null;
  const remainder = normalized.slice((start.index || 0) + start[0].length).trim();
  const end = remainder.search(/\b(?:responsibilities|what you(?:'|’)ll do|about the role|about the job|benefits|compensation|our team|about us|application process|equal opportunity)\s*:?/i);
  const section = (end >= 0 ? remainder.slice(0, end) : remainder).trim();
  return section.length >= 40 ? section.slice(0, 20_000) : null;
}

function pendingDeadlineEvidence(previous: Record<string, unknown> | null): Record<string, unknown> {
  const fields = previous?.fields && typeof previous.fields === 'object' && !Array.isArray(previous.fields)
    ? previous.fields as Record<string, unknown>
    : {};
  return {
    ...(previous || {}),
    version: 1,
    fields: {
      ...fields,
      deadline: {
        status: 'pending_recheck',
        source: null,
        evidence_url: null,
        evidence_kind: null,
        verified_at: null,
        rejected_reason: '当前官网页面未找到明确截止日期',
      },
    },
  };
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
      .select('id,company,job_url,valid_through,source_system,field_evidence,description,requirements,experience_min_years,experience_max_years,experience_text,region')
      .in('id', jobIds)
      .eq('is_active', true)
      .not('job_url', 'is', null);
  if (jobsError) throw new Error(`读取待核验岗位链接失败: ${jobsError.message}`);
  const candidates = (jobs || []).map((job) => ({
    id: job.id,
    company: job.company,
    job_url: job.job_url,
    valid_through: job.valid_through,
    link_check_failures: stateByJobId.get(job.id)?.link_check_failures || 0,
    description: job.description,
    requirements: job.requirements,
    experience_min_years: job.experience_min_years,
    experience_max_years: job.experience_max_years,
    experience_text: job.experience_text,
    region: job.region,
    source_system: job.source_system,
    field_evidence: job.field_evidence,
  })) as LinkCandidate[];

  for (const batch of chunks(candidates, concurrency)) {
    await Promise.all(batch.map(async (job) => {
      result.links_checked += 1;
      try {
        const page = await fetchSafeExternalPage(job.job_url);
        const officialDetails = extractOfficialJobDetails(page);
        if (looksLikeClosedJobPage(page.title, page.content)
          && !isRegisteredPhenomJobUrl(job.company, job.job_url)
          && !hasMatchingPhenomDetailPayload(job.job_url, page.content)) {
          throw new ExternalFetchError('目标页面显示岗位已关闭', 422, 410);
        }
        if (looksLikeBlockedPage(page.title, page.content) && officialDetails?.source !== 'official_structured_data') {
          throw new ExternalFetchError('目标页面需要浏览器验证，暂不判定岗位状态', 422);
        }
        const jobPatch: Record<string, unknown> = {};
        const officialContent = officialDetails?.description || usableOfficialContent(page.content);
        if (officialContent && (!job.description || job.description.trim().length < 160 || isJobContentShell(job.description))) {
          jobPatch.description = officialContent;
        }
        if (officialDetails?.responsibilities && !job.requirements) {
          jobPatch.responsibilities = officialDetails.responsibilities;
        }
        if (officialDetails?.requirements && !job.requirements) {
          jobPatch.requirements = officialDetails.requirements;
        } else if (officialContent && !job.requirements) {
          const requirements = extractOfficialJobRequirements(officialContent);
          if (requirements) jobPatch.requirements = requirements;
        }
        if (officialContent && job.experience_min_years == null && job.experience_max_years == null && !job.experience_text) {
          const experience = parseExperience([officialDetails?.experience || '', officialContent, officialDetails?.requirements || '']);
          if (experience.min != null || experience.max != null || experience.text) {
            jobPatch.experience_min_years = experience.min;
            jobPatch.experience_max_years = experience.max;
            jobPatch.experience_text = experience.text;
          }
        }
        if (officialDetails?.location && (!job.region || job.region === '未注明')) {
          jobPatch.region = officialDetails.location.slice(0, 100);
          jobPatch.location_source = 'official_link_structured_field';
        }
        if (shouldPersistRedirect(job.job_url, page.url)) {
          jobPatch.job_url = page.url;
          jobPatch.source_url = page.url;
        }
        const resolvedDeadline = resolveJobDeadline({
            description: page.content,
            source_evidence: {
              structured_field_sources: {
                description: 'official_description',
              },
            },
          });
        if (resolvedDeadline) {
            const expired = isJobDeadlineExpired(resolvedDeadline.value);
            jobPatch.valid_through = resolvedDeadline.value;
            jobPatch.deadline_source = `official_link_${resolvedDeadline.source}`;
            jobPatch.field_evidence = {
              ...(job.field_evidence || {}),
              fields: {
                ...((job.field_evidence?.fields as Record<string, unknown> | undefined) || {}),
                deadline: {
                  status: 'verified',
                  source: `official_link_${resolvedDeadline.source}`,
                  evidence_url: page.url,
                  evidence_kind: 'official_detail_page',
                  verified_at: new Date().toISOString(),
                },
              },
            };
            // A date rendered on a public job page is valuable to candidates,
            // but it is not enough to close collector-fed roles. Employers
            // frequently leave stale end dates on a still-open or rolling
            // application page. Those records close only through an explicit
            // upstream event or definitive official-link availability check.
            if (job.source_system !== JOBS_FEED_SOURCE) {
              jobPatch.is_active = !expired;
              jobPatch.is_closed = expired;
            }
            result.deadlines_found += 1;
            if (expired && job.source_system !== JOBS_FEED_SOURCE) result.expired += 1;
        } else if (job.source_system === JOBS_FEED_SOURCE && job.valid_through) {
          // A successful official page recheck without an explicit deadline
          // invalidates stale collector dates. Keep the job active; deadline
          // data is informational and must not control lifecycle state.
          jobPatch.valid_through = null;
          jobPatch.deadline_source = null;
          jobPatch.field_evidence = pendingDeadlineEvidence(job.field_evidence);
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

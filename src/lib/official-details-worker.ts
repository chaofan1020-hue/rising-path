import { randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getJobFeedState, type JobFeedState } from '@/lib/job-feed-orchestrator';
import { PHASE2_COMPANY_PROFILES } from '@/lib/job-connectors/company-profiles';
import { recordJobSyncRunFinish, recordJobSyncRunProgress, recordJobSyncRunStart } from '@/lib/job-sync-dashboard';

const execFile = promisify(execFileCallback);
const WORKDAY_HOST = /(?:^|\.)myworkdayjobs\.com$/i;
const COMPANY_PAGE_SIZE = 1_000;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_COMPANIES_PER_CYCLE = 3;
const DEFAULT_CHILD_TIMEOUT_MS = 240_000;
const STATE_PREFIX = 'official:';
// A company with no currently eligible fields should not be rescanned every
// scheduler tick. Recheck it periodically so newly inserted jobs are still
// picked up without turning a completed pass into a full historical scan.
const COMPLETION_RECHECK_MS = 10 * 60_000;

type BackfillResult = {
  candidate_jobs?: number;
  fetched?: number;
  updated?: number;
  skipped?: number;
  failed?: number;
  selected_candidate_jobs?: number;
  last_processed_job_id?: number | null;
};

type SourceFamily = 'workday' | 'registered_connector' | 'official_generic';
export type SourceTarget = { family: SourceFamily; company: string; first_seen_id: number; host_keys?: string[] };
export type OfficialDetailsScheduleState = Pick<JobFeedState, 'source_system' | 'cursor' | 'last_attempted_at' | 'last_success_at' | 'next_retry_at' | 'priority' | 'lease_expires_at' | 'consecutive_failures'>;

let companyCache: { expiresAt: number; targets: SourceTarget[] } | null = null;

const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

function positiveInteger(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function stateSource(target: SourceTarget): string {
  return `${STATE_PREFIX}${target.family}:${target.company.trim()}`.slice(0, 50);
}

const GENERIC_OFFICIAL_SOURCE_TYPES = new Set(['amazon_jobs', 'apple_official_api', 'google_careers', 'microsoft_careers', 'meta_careers', 'deloitte_careers', 'morgan_stanley_eightfold', 'goldman_sachs_careers']);
const GENERIC_OFFICIAL_WRITE_ENV = 'JOBS_GENERIC_OFFICIAL_BACKFILL_WRITE_ENABLED';
const GENERIC_OFFICIAL_COMPANIES_ENV = 'JOBS_GENERIC_OFFICIAL_BACKFILL_COMPANIES';

function genericOfficialWriteEnabled(company: string): boolean {
  if (process.env[GENERIC_OFFICIAL_WRITE_ENV] !== 'true') return false;
  const configured = (process.env[GENERIC_OFFICIAL_COMPANIES_ENV] || '').split(',').map((value) => value.trim().toLocaleLowerCase()).filter(Boolean);
  return configured.length === 0 || configured.includes(company.trim().toLocaleLowerCase());
}

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getOfficialDetailsRetryDelayMs(consecutiveFailures: number): number {
  const failureNumber = Number.isInteger(consecutiveFailures) && consecutiveFailures > 0 ? consecutiveFailures : 1;
  return RETRY_BACKOFF_MS[Math.min(failureNumber, RETRY_BACKOFF_MS.length) - 1];
}

function defaultScheduleState(source: string): OfficialDetailsScheduleState {
  return {
    source_system: source,
    cursor: null,
    last_attempted_at: null,
    last_success_at: null,
    next_retry_at: null,
    priority: 0,
    lease_expires_at: null,
    consecutive_failures: 0,
  };
}

function isDue(state: OfficialDetailsScheduleState, now: number): boolean {
  const retryAt = timestamp(state.next_retry_at);
  const leaseExpiresAt = timestamp(state.lease_expires_at);
  return (retryAt === null || retryAt <= now) && (leaseExpiresAt === null || leaseExpiresAt <= now);
}

/**
 * Select due companies in a deterministic order. The database lease remains
 * the final authority, so this helper is intentionally only a fair picker.
 */
export function selectFairOfficialDetailsTargets(
  targets: SourceTarget[],
  states: Map<string, OfficialDetailsScheduleState>,
  now = Date.now(),
  limit = DEFAULT_COMPANIES_PER_CYCLE,
): SourceTarget[] {
  return targets
    .map((target) => ({ target, state: states.get(stateSource(target)) || defaultScheduleState(stateSource(target)) }))
    .filter(({ state }) => isDue(state, now))
    .sort((left, right) => {
      const leftAttempt = timestamp(left.state.last_attempted_at);
      const rightAttempt = timestamp(right.state.last_attempted_at);
      if ((leftAttempt === null) !== (rightAttempt === null)) return leftAttempt === null ? -1 : 1;
      if (leftAttempt !== null && rightAttempt !== null && leftAttempt !== rightAttempt) return leftAttempt - rightAttempt;
      const leftPriority = Number.isFinite(left.state.priority) ? left.state.priority : 0;
      const rightPriority = Number.isFinite(right.state.priority) ? right.state.priority : 0;
      if (leftPriority !== rightPriority) return rightPriority - leftPriority;
      if (left.target.first_seen_id !== right.target.first_seen_id) return left.target.first_seen_id - right.target.first_seen_id;
      return left.target.company.localeCompare(right.target.company);
    })
    .slice(0, Math.max(0, limit))
    .map(({ target }) => target);
}

/**
 * Optionally keep one explicitly selected in-progress company at the front
 * of each cycle. Once it reaches the current job tail, normal fair rotation
 * resumes after the completion cooldown.
 */
export function selectOfficialDetailsTargets(
  targets: SourceTarget[],
  states: Map<string, OfficialDetailsScheduleState>,
  now = Date.now(),
  limit = DEFAULT_COMPANIES_PER_CYCLE,
  focusCompany?: string | null,
): SourceTarget[] {
  const fair = selectFairOfficialDetailsTargets(targets, states, now, limit);
  const focus = focusCompany?.trim().toLocaleLowerCase();
  if (!focus || limit <= 0) return fair;
  const focusTarget = targets.find((target) => target.company.trim().toLocaleLowerCase() === focus);
  if (!focusTarget) return fair;
  const focusState = states.get(stateSource(focusTarget)) || defaultScheduleState(stateSource(focusTarget));
  if (!focusState.cursor || !isDue(focusState, now)) return fair;
  return [focusTarget, ...fair.filter((target) => target !== focusTarget)].slice(0, limit);
}

export function parseBackfillOutput(stdout: string): BackfillResult {
  const start = Math.max(stdout.lastIndexOf('\n{'), stdout.startsWith('{') ? 0 : -1);
  if (start < 0) throw new Error('官方字段任务没有返回 JSON 结果');
  const value = JSON.parse(stdout.slice(start === 0 ? 0 : start + 1)) as BackfillResult;
  if (!value || typeof value !== 'object') throw new Error('官方字段任务返回格式无效');
  return value;
}

function companyFromRow(row: { company?: unknown; job_url?: unknown; id?: unknown }): { company: string; id: number; isWorkday: boolean; host: string } | null {
  const company = typeof row.company === 'string' ? row.company.trim() : '';
  const jobUrl = typeof row.job_url === 'string' ? row.job_url.trim() : '';
  if (!company || !jobUrl) return null;
  try {
    const url = new URL(jobUrl);
    if (url.protocol !== 'https:') return null;
    return {
      company,
      id: typeof row.id === 'number' ? row.id : Number.MAX_SAFE_INTEGER,
      isWorkday: WORKDAY_HOST.test(url.hostname),
      host: url.hostname.toLocaleLowerCase(),
    };
  } catch {
    return null;
  }
}

async function discoverTargets(client: SupabaseClient): Promise<SourceTarget[]> {
  if (companyCache && companyCache.expiresAt > Date.now()) return companyCache.targets;
  const activeCompanies = new Map<string, number>();
  const workdayCompanies = new Map<string, SourceTarget>();
  const { data: sourceRows, error: sourceError } = await client
    .from('job_company_sources')
    .select('company_name,source_type,is_active')
    .eq('is_active', true);
  if (sourceError && sourceError.code !== '42P01') throw new Error(`发现来源台账公司失败: ${sourceError.message}`);
  for (const row of (sourceRows || []) as Array<{ company_name?: unknown; source_type?: unknown; is_active?: boolean }>) {
    const company = typeof row.company_name === 'string' ? row.company_name.trim() : '';
    if (!company || row.is_active === false) continue;
    const key = company.toLocaleLowerCase();
    activeCompanies.set(key, Math.min(activeCompanies.get(key) ?? Number.MAX_SAFE_INTEGER, 0));
    if (String(row.source_type || '').toLowerCase() === 'workday') {
      workdayCompanies.set(key, { family: 'workday', company, first_seen_id: 0 });
    } else if (GENERIC_OFFICIAL_SOURCE_TYPES.has(String(row.source_type || '').toLowerCase())) {
      workdayCompanies.set(key, { family: 'official_generic', company, first_seen_id: 0 });
    }
  }
  for (let offset = 0; ; offset += COMPANY_PAGE_SIZE) {
    const { data, error } = await client
      .from('jobs')
      .select('id,company,job_url')
      .eq('source_system', 'collector_feed')
      .eq('is_active', true)
      .not('job_url', 'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + COMPANY_PAGE_SIZE - 1);
    if (error) throw new Error(`发现 Workday 公司失败: ${error.message}`);
    for (const row of (data || []) as Array<{ id?: number; company?: unknown; job_url?: unknown }>) {
      const match = companyFromRow(row);
      if (!match) continue;
      const key = match.company.toLocaleLowerCase();
      activeCompanies.set(key, Math.min(activeCompanies.get(key) ?? Number.MAX_SAFE_INTEGER, match.id));
      if (match.isWorkday) {
        const existing = workdayCompanies.get(key);
        if (!existing) {
          workdayCompanies.set(key, {
            family: 'workday',
            company: match.company,
            first_seen_id: match.id,
            host_keys: [match.host],
          });
        } else {
          if (match.id < existing.first_seen_id) existing.first_seen_id = match.id;
          if (!existing.host_keys?.includes(match.host)) existing.host_keys = [...(existing.host_keys || []), match.host];
        }
      }
    }
    if (!data || data.length < COMPANY_PAGE_SIZE) break;
  }
  const connectorTargets = PHASE2_COMPANY_PROFILES
    .filter((profile) => activeCompanies.has(profile.company.toLocaleLowerCase()))
    .map((profile) => ({
      family: 'registered_connector' as const,
      company: profile.company,
      first_seen_id: activeCompanies.get(profile.company.toLocaleLowerCase()) || Number.MAX_SAFE_INTEGER,
    }));
  const result = [...workdayCompanies.values(), ...connectorTargets]
    .sort((left, right) => left.first_seen_id - right.first_seen_id || left.company.localeCompare(right.company));
  companyCache = { expiresAt: Date.now() + 30 * 60_000, targets: result };
  return result;
}

async function claim(client: SupabaseClient, source: string, owner: string): Promise<boolean> {
  const { data, error } = await client.rpc('claim_job_sync', { p_source_system: source, p_owner: owner, p_ttl_seconds: 900 });
  if (error) throw new Error(`申请官方字段任务租约失败: ${error.message}`);
  return data === true;
}

async function release(client: SupabaseClient, source: string, owner: string): Promise<void> {
  const { error } = await client.rpc('release_job_sync', { p_source_system: source, p_owner: owner });
  if (error) console.error('[Official Details] release lease failed:', error.message);
}

async function getActiveCompanyMaxJobId(client: SupabaseClient, company: string): Promise<number | null> {
  const { data, error } = await client
    .from('jobs')
    .select('id')
    .eq('source_system', 'collector_feed')
    .eq('company', company)
    .eq('is_active', true)
    .order('id', { ascending: false })
    .limit(1);
  if (error) throw new Error(`读取 ${company} 最新岗位 ID 失败: ${error.message}`);
  const id = Number(data?.[0]?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function saveState(client: SupabaseClient, source: string, patch: Partial<JobFeedState>): Promise<void> {
  const { error } = await client.from('job_sync_state')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('source_system', source);
  if (error) throw new Error(`保存官方字段任务进度失败: ${error.message}`);
}

async function syncSourceRegistry(
  client: SupabaseClient,
  target: SourceTarget,
  patch: Partial<Pick<JobFeedState, 'last_attempted_at' | 'last_success_at' | 'next_retry_at' | 'consecutive_failures' | 'last_error'>>,
): Promise<void> {
  const { error } = await client
    .from('job_company_sources')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('company_name', target.company);
  if (error && error.code !== '42P01') {
    console.error('[Official Details] source registry update failed', { company: target.company, error: error.message });
  }
}

async function recordFailure(client: SupabaseClient, source: string, state: JobFeedState, message: string): Promise<void> {
  const consecutiveFailures = (Number(state.consecutive_failures) || 0) + 1;
  await saveState(client, source, {
    last_error: message.slice(0, 2_000),
    consecutive_failures: consecutiveFailures,
    next_retry_at: new Date(Date.now() + getOfficialDetailsRetryDelayMs(consecutiveFailures)).toISOString(),
  });
}

async function runCompany(client: SupabaseClient, target: SourceTarget, batchSize: number): Promise<BackfillResult | null> {
  const source = stateSource(target);
  const state = await getJobFeedState(client, source);
  const owner = randomUUID();
  if (!(await claim(client, source, owner))) return null;
  const runId = await recordJobSyncRunStart(client, {
    source_system: source,
    company_name: target.company,
    mode: 'official_details',
    cursor_before: state.cursor,
    current_stage: 'fetching',
  });
  try {
    const attemptedAt = new Date().toISOString();
    await saveState(client, source, { last_attempted_at: attemptedAt });
    await syncSourceRegistry(client, target, { last_attempted_at: attemptedAt });
    const activeMaxJobId = await getActiveCompanyMaxJobId(client, target.company);
    const cursor = state.cursor && /^\d+$/.test(state.cursor) ? Number(state.cursor) : null;

    // A numeric cursor at (or beyond) the current active-job tail means the
    // previous pass already examined every newer job. Do not spawn a child
    // process (especially a connector board fetch) just to rediscover zero
    // candidates on every six-second scheduler tick.
    if (cursor != null && (activeMaxJobId == null || cursor >= activeMaxJobId)) {
      const completedAt = new Date().toISOString();
      const nextRetryAt = new Date(Date.now() + COMPLETION_RECHECK_MS).toISOString();
      await recordJobSyncRunProgress(client, runId, {
        current_stage: 'finished',
        current_company_name: target.company,
        current_cursor: String(cursor),
        current_page: 1,
        has_more: false,
      });
      await recordJobSyncRunFinish(client, runId, {
        status: 'success',
        cursor_after: String(cursor),
        pages: 1,
        received: 0,
        upserted: 0,
        skipped: 0,
        row_failures: 0,
        stop_reason: 'no_new_jobs',
      });
      await saveState(client, source, {
        cursor: String(cursor),
        last_incremental_success_at: completedAt,
        last_success_at: completedAt,
        next_retry_at: nextRetryAt,
        last_error: null,
        consecutive_failures: 0,
      });
      await syncSourceRegistry(client, target, {
        last_success_at: completedAt,
        next_retry_at: nextRetryAt,
        last_error: null,
        consecutive_failures: 0,
      });
      return { candidate_jobs: 0, fetched: 0, updated: 0, skipped: 0, failed: 0, last_processed_job_id: cursor };
    }
    // The web service must not ask Corepack to download a package manager on
    // every cycle. Invoke the project-local tsx with the already running Node
    // binary; pnpm remains the package manager used for install/build.
    const tsxPath = resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs');
    const script = target.family === 'registered_connector'
      ? 'scripts/backfill-connector-fields.ts'
      : 'scripts/backfill-official-job-details.ts';
    const args = [tsxPath, script, `--company=${target.company}`, `--limit=${batchSize}`, `--run-id=${runId || ''}`, '--write'];
    if (cursor != null) args.push(`--after-id=${cursor}`);
    await recordJobSyncRunProgress(client, runId, {
      current_stage: 'processing_company',
      current_company_name: target.company,
      current_cursor: state.cursor,
      current_page: 1,
    });
    const timeoutMs = positiveInteger(process.env.JOBS_OFFICIAL_DETAILS_CHILD_TIMEOUT_MS, DEFAULT_CHILD_TIMEOUT_MS, 900_000);
    // The connector backfill is an external child process and may take several
    // minutes before it prints its final JSON. Keep the dashboard run alive so
    // concurrent companies each show a moving heartbeat instead of appearing
    // frozen at page 1 / zero writes.
    const heartbeat = setInterval(() => {
      void recordJobSyncRunProgress(client, runId, {
        current_stage: 'processing_company',
        current_company_name: target.company,
        current_cursor: state.cursor,
        current_page: 1,
      });
    }, 15_000);
    let stdout: string;
    let stderr: string;
    try {
      ({ stdout, stderr } = await execFile(process.execPath, args, {
        cwd: process.cwd(), env: process.env, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
      }));
    } finally {
      clearInterval(heartbeat);
    }
    const result = parseBackfillOutput(stdout);
    const failed = Number(result.failed) || 0;
    const resultLastId = Number(result.last_processed_job_id);
    const resultCursor = Number.isInteger(resultLastId) && resultLastId > 0
      ? String(resultLastId)
      : activeMaxJobId != null
        ? String(activeMaxJobId)
        : state.cursor;
    await recordJobSyncRunProgress(client, runId, {
      current_stage: 'writing',
      current_company_name: target.company,
      current_cursor: resultCursor,
      current_page: 1,
      received: Number(result.fetched) || Number(result.candidate_jobs) || 0,
      upserted: Number(result.updated) || 0,
      skipped: Number(result.skipped) || 0,
      row_failures: failed,
      has_more: Number(result.candidate_jobs) > 0 && Number(result.last_processed_job_id) > 0,
      total_candidates: Number(result.candidate_jobs) || 0,
      processed_candidates: Number(result.selected_candidate_jobs) || (Number(result.fetched) || 0) + (Number(result.skipped) || 0) + failed,
      remaining_candidates: Math.max(0, (Number(result.candidate_jobs) || 0) - (Number(result.selected_candidate_jobs) || (Number(result.fetched) || 0) + (Number(result.skipped) || 0) + failed)),
    });
    await recordJobSyncRunFinish(client, runId, {
      status: failed > 0 ? 'partial' : 'success',
      cursor_after: resultCursor,
      pages: 1,
      received: Number(result.fetched) || Number(result.candidate_jobs) || 0,
      upserted: Number(result.updated) || 0,
      skipped: Number(result.skipped) || 0,
      row_failures: failed,
      error_message: failed > 0 ? `官方字段批次有 ${failed} 条失败` : null,
      stop_reason: failed > 0 ? 'row_failures' : null,
    });
    if (failed > 0) {
      const message = `官方字段批次有 ${failed} 条失败，保留游标等待重试`;
      await recordFailure(client, source, state, message);
      const consecutiveFailures = (Number(state.consecutive_failures) || 0) + 1;
      await syncSourceRegistry(client, target, {
        last_error: message,
        consecutive_failures: consecutiveFailures,
        next_retry_at: new Date(Date.now() + getOfficialDetailsRetryDelayMs(consecutiveFailures)).toISOString(),
      });
    } else if ((Number(result.candidate_jobs) || 0) === 0) {
      const completedAt = new Date().toISOString();
      const nextRetryAt = new Date(Date.now() + COMPLETION_RECHECK_MS).toISOString();
      const successPatch = {
        cursor: resultCursor,
        last_incremental_success_at: completedAt,
        last_success_at: completedAt,
        next_retry_at: nextRetryAt,
        last_error: null,
        consecutive_failures: 0,
      } satisfies Partial<JobFeedState>;
      await saveState(client, source, successPatch);
      await syncSourceRegistry(client, target, {
        last_success_at: completedAt,
        next_retry_at: nextRetryAt,
        last_error: null,
        consecutive_failures: 0,
      });
    } else {
      const completedAt = new Date().toISOString();
      const successPatch = {
        cursor: resultCursor,
        last_incremental_success_at: completedAt,
        last_success_at: completedAt,
        next_retry_at: null,
        last_error: null,
        consecutive_failures: 0,
      } satisfies Partial<JobFeedState>;
      await saveState(client, source, successPatch);
      await syncSourceRegistry(client, target, {
        last_success_at: completedAt,
        next_retry_at: null,
        last_error: null,
        consecutive_failures: 0,
      });
    }
    if (stderr.trim()) console.info('[Official Details] child stderr', stderr.trim().slice(-500));
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordJobSyncRunFinish(client, runId, { status: 'failed', cursor_after: state.cursor, error_message: message, stop_reason: 'error' });
    await recordFailure(client, source, state, message).catch((stateError) => {
      console.error('[Official Details] failed to persist company backoff', { company: target.company, error: stateError instanceof Error ? stateError.message : String(stateError) });
    });
    const consecutiveFailures = (Number(state.consecutive_failures) || 0) + 1;
    await syncSourceRegistry(client, target, {
      last_error: message,
      consecutive_failures: consecutiveFailures,
      next_retry_at: new Date(Date.now() + getOfficialDetailsRetryDelayMs(consecutiveFailures)).toISOString(),
    });
    throw error;
  } finally {
    await release(client, source, owner);
  }
}

export async function runOfficialDetailsForCompany(
  companyName: string,
  options: { client?: SupabaseClient; batchSize?: number } = {},
): Promise<BackfillResult | null> {
  const client = options.client || getSupabaseClient();
  const targets = await discoverTargets(client);
  const target = targets.find((entry) => entry.company.toLocaleLowerCase() === companyName.trim().toLocaleLowerCase());
  if (!target) throw new Error('该公司没有可用的官方字段连接器');
  const enabled = target.family === 'workday'
    ? process.env.JOB_BACKFILL_WRITE_ENABLED === 'true'
    : target.family === 'official_generic'
      ? genericOfficialWriteEnabled(target.company)
      : process.env.JOBS_CONNECTOR_BACKFILL_WRITE_ENABLED === 'true';
  if (!enabled) throw new Error('该公司的官方字段写入开关未启用');
  const batchSize = positiveInteger(process.env.JOBS_OFFICIAL_DETAILS_BATCH_SIZE, options.batchSize || DEFAULT_BATCH_SIZE, 100);
  return runCompany(client, target, batchSize);
}

export interface OfficialDetailsCycleResult {
  enabled: boolean;
  companies: number;
  processed: string[];
  results: BackfillResult[];
}

export async function runOfficialDetailsCycle(options: { client?: SupabaseClient; companiesPerCycle?: number; batchSize?: number } = {}): Promise<OfficialDetailsCycleResult> {
  const enabled = process.env.JOBS_OFFICIAL_DETAILS_AUTO_SYNC === 'true';
  if (!enabled) return { enabled: false, companies: 0, processed: [], results: [] };
  const client = options.client || getSupabaseClient();
  const targets = await discoverTargets(client);
  if (targets.length === 0) return { enabled: true, companies: 0, processed: [], results: [] };
  const count = positiveInteger(process.env.JOBS_OFFICIAL_DETAILS_COMPANIES_PER_CYCLE, options.companiesPerCycle || DEFAULT_COMPANIES_PER_CYCLE, 5);
  const batchSize = positiveInteger(process.env.JOBS_OFFICIAL_DETAILS_BATCH_SIZE, options.batchSize || DEFAULT_BATCH_SIZE, 100);
  const writableTargets = targets.filter((target) => target.family === 'workday'
    ? process.env.JOB_BACKFILL_WRITE_ENABLED === 'true'
    : target.family === 'official_generic'
      ? genericOfficialWriteEnabled(target.company)
      : process.env.JOBS_CONNECTOR_BACKFILL_WRITE_ENABLED === 'true');
  const stateSources = writableTargets.map(stateSource);
  const { data: stateRows, error: stateError } = stateSources.length === 0
    ? { data: [], error: null }
    : await client.from('job_sync_state').select('*').in('source_system', stateSources);
  if (stateError) throw new Error(`读取官方字段调度状态失败: ${stateError.message}`);
  const states = new Map<string, OfficialDetailsScheduleState>((stateRows || []).map((row) => [row.source_system, row as OfficialDetailsScheduleState]));
  for (const source of stateSources) {
    if (!states.has(source)) states.set(source, await getJobFeedState(client, source));
  }
  const selectedTargets = selectOfficialDetailsTargets(
    writableTargets,
    states,
    Date.now(),
    count,
    process.env.JOBS_OFFICIAL_DETAILS_FOCUS_COMPANY,
  );
  const processed: string[] = [];
  const results: BackfillResult[] = [];
  const groups: SourceTarget[][] = [];
  for (const target of selectedTargets) {
    const keys = target.host_keys?.length ? target.host_keys : [`company:${target.company.toLocaleLowerCase()}`];
    const group = groups.find((items) => items.every((item) => {
      const itemKeys = item.host_keys?.length ? item.host_keys : [`company:${item.company.toLocaleLowerCase()}`];
      return !keys.some((key) => itemKeys.includes(key));
    }));
    if (group) group.push(target);
    else groups.push([target]);
  }
  for (const group of groups) {
    await Promise.all(group.map(async (target) => {
      try {
        const result = await runCompany(client, target, batchSize);
        if (!result) return;
        processed.push(target.company);
        results.push(result);
        console.info('[Official Details] company batch completed', { company: target.company, family: target.family, candidate_jobs: result.candidate_jobs, updated: result.updated, skipped: result.skipped, failed: result.failed });
      } catch (error) {
        console.error('[Official Details] company batch failed', { company: target.company, family: target.family, error: error instanceof Error ? error.message : String(error) });
      }
    }));
  }
  return { enabled: true, companies: targets.length, processed, results };
}

export function resetOfficialDetailsCompanyCache(): void {
  companyCache = null;
}

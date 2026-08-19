import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { JOBS_FEED_SOURCE, syncJobsFeed, type JobsFeedSyncResult } from '@/lib/jobs-feed';

export type JobFeedSyncMode = 'incremental' | 'reconcile';

export interface JobFeedState {
  source_system: string;
  cursor: string | null;
  reconcile_cursor: string | null;
  reconcile_started_at: string | null;
  reconcile_pages: number;
  reconcile_open_seen: number;
  last_incremental_success_at: string | null;
  last_reconcile_success_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  updated_at: string;
}

export interface JobFeedRunResult extends JobsFeedSyncResult {
  mode: JobFeedSyncMode;
  completed: boolean;
  reconciliation?: { missing: number; closed: number };
}

function subtractMinutes(value: string, minutes: number): string {
  const timestamp = Date.parse(value);
  return new Date((Number.isFinite(timestamp) ? timestamp : Date.now()) - minutes * 60_000).toISOString();
}

async function readLegacyCursor(client: SupabaseClient): Promise<string | null> {
  const { data, error } = await client
    .from('job_configs')
    .select('config_value')
    .eq('config_type', 'jobs_feed_cursor')
    .order('id', { ascending: true })
    .limit(1);
  if (error) throw new Error(`读取旧同步进度失败: ${error.message}`);
  return data?.[0]?.config_value || null;
}

export async function getJobFeedState(client = getSupabaseClient()): Promise<JobFeedState> {
  const { data, error } = await client
    .from('job_sync_state')
    .select('*')
    .eq('source_system', JOBS_FEED_SOURCE)
    .maybeSingle();
  if (error) throw new Error(`读取岗位同步状态失败: ${error.message}`);
  if (data) return data as JobFeedState;

  const legacyCursor = await readLegacyCursor(client);
  const { data: inserted, error: insertError } = await client
    .from('job_sync_state')
    .insert({ source_system: JOBS_FEED_SOURCE, cursor: legacyCursor })
    .select('*')
    .single();
  if (insertError) throw new Error(`初始化岗位同步状态失败: ${insertError.message}`);
  return inserted as JobFeedState;
}

async function updateState(client: SupabaseClient, patch: Partial<JobFeedState>) {
  const { error } = await client
    .from('job_sync_state')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('source_system', JOBS_FEED_SOURCE);
  if (error) throw new Error(`保存岗位同步状态失败: ${error.message}`);
}

async function claimLease(client: SupabaseClient, owner: string) {
  const { data, error } = await client.rpc('claim_job_sync', {
    p_source_system: JOBS_FEED_SOURCE,
    p_owner: owner,
    p_ttl_seconds: 900,
  });
  if (error) throw new Error(`申请岗位同步租约失败: ${error.message}`);
  if (data !== true) throw new Error('另一个岗位同步任务正在运行，请稍后再试');
}

async function releaseLease(client: SupabaseClient, owner: string) {
  const { error } = await client.rpc('release_job_sync', {
    p_source_system: JOBS_FEED_SOURCE,
    p_owner: owner,
  });
  if (error) console.error(`释放岗位同步租约失败: ${error.message}`);
}

function emptyResult(mode: JobFeedSyncMode): JobFeedRunResult {
  return {
    mode,
    completed: false,
    pages: 0,
    received: 0,
    upserted: 0,
    closed: 0,
    skipped: 0,
    failed: 0,
    next_cursor: null,
    has_more: false,
    open_seen: 0,
  };
}

export async function runJobFeedSync(options: {
  mode?: JobFeedSyncMode;
  maxPages?: number;
  client?: SupabaseClient;
} = {}): Promise<JobFeedRunResult> {
  const client = options.client || getSupabaseClient();
  const mode = options.mode || 'incremental';
  const maxPages = Math.min(Math.max(options.maxPages ?? (mode === 'reconcile' ? 1000 : 100), 1), 1000);
  const owner = randomUUID();
  const state = await getJobFeedState(client);
  await claimLease(client, owner);
  const aggregate = emptyResult(mode);

  try {
    let cursor: string | undefined;
    let since: string | undefined;
    let reconcileStartedAt: string | undefined;

    if (mode === 'reconcile') {
      reconcileStartedAt = state.reconcile_started_at || new Date().toISOString();
      cursor = state.reconcile_cursor || undefined;
      if (!state.reconcile_started_at) {
        await updateState(client, {
          reconcile_started_at: reconcileStartedAt,
          reconcile_cursor: null,
          reconcile_pages: 0,
          reconcile_open_seen: 0,
          last_error: null,
        });
      }
    } else {
      cursor = state.cursor || undefined;
      if (!cursor && state.last_incremental_success_at) {
        const overlapMinutes = Math.min(Math.max(Number(process.env.JOBS_FEED_OVERLAP_MINUTES) || 10, 1), 1440);
        since = subtractMinutes(state.last_incremental_success_at, overlapMinutes);
      }
    }

    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      await claimLease(client, owner);
      const page = await syncJobsFeed(client, {
        cursor,
        since,
        maxPages: 1,
        verifiedAt: reconcileStartedAt,
        includeClosed: mode !== 'reconcile',
      });
      since = undefined;
      aggregate.pages += page.pages;
      aggregate.received += page.received;
      aggregate.upserted += page.upserted;
      aggregate.closed += page.closed;
      aggregate.skipped += page.skipped;
      aggregate.failed += page.failed;
      aggregate.open_seen += page.open_seen;
      aggregate.next_cursor = page.next_cursor;
      aggregate.has_more = page.has_more;
      cursor = page.next_cursor || undefined;

      if (mode === 'reconcile') {
        await updateState(client, {
          reconcile_cursor: page.has_more ? page.next_cursor : null,
          reconcile_pages: state.reconcile_pages + aggregate.pages,
          reconcile_open_seen: state.reconcile_open_seen + aggregate.open_seen,
          last_error: null,
          consecutive_failures: 0,
        });
      } else {
        await updateState(client, {
          cursor: page.has_more ? page.next_cursor : null,
          last_error: null,
          consecutive_failures: 0,
          ...(page.has_more ? {} : { last_incremental_success_at: new Date().toISOString() }),
        });
      }

      console.log(JSON.stringify({ phase: mode, page: aggregate.pages, ...page }));
      if (!page.has_more) {
        aggregate.completed = true;
        break;
      }
    }

    if (mode === 'reconcile' && aggregate.completed && reconcileStartedAt) {
      const { data, error } = await client.rpc('finalize_job_feed_reconcile', {
        p_source_system: JOBS_FEED_SOURCE,
        p_started_at: reconcileStartedAt,
      });
      if (error) throw new Error(`完成岗位全量对账失败: ${error.message}`);
      aggregate.reconciliation = (data || { missing: 0, closed: 0 }) as { missing: number; closed: number };
      aggregate.closed += aggregate.reconciliation.closed;
      await updateState(client, {
        // A completed full pass is a new synchronization baseline. Start the
        // next incremental run with its overlap window instead of replaying
        // from an obsolete cursor that predates this reconciliation.
        cursor: null,
        reconcile_cursor: null,
        reconcile_started_at: null,
        reconcile_pages: 0,
        reconcile_open_seen: 0,
        last_incremental_success_at: reconcileStartedAt,
        last_reconcile_success_at: new Date().toISOString(),
        last_error: null,
        consecutive_failures: 0,
      });
    }

    return aggregate;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateState(client, {
      last_error: message.slice(0, 2000),
      consecutive_failures: state.consecutive_failures + 1,
    }).catch((stateError) => console.error(stateError));
    throw error;
  } finally {
    await releaseLease(client, owner);
  }
}

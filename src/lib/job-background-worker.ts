import { maintainJobLifecycle } from '@/lib/job-maintenance';
import { getIncrementalSyncPolicy, runJobFeedSync } from '@/lib/job-feed-orchestrator';
import { runOfficialDetailsCycle } from '@/lib/official-details-worker';
import { runJobSyncFailureCycle } from '@/lib/job-sync-failure-worker';
import { refreshUpstreamCompanySnapshots } from '@/lib/job-source-telemetry';
import { runHistoricalFieldReviewCycle } from '@/lib/job-historical-field-review-worker';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { recoverStaleJobSyncRuns } from '@/lib/job-sync-dashboard';

const DEFAULT_SYNC_INTERVAL_MINUTES = 10;
const DEFAULT_OFFICIAL_DETAILS_INTERVAL_MINUTES = 2;
const DEFAULT_START_DELAY_SECONDS = 15;

let started = false;
let running = false;
let officialRunning = false;
let timer: NodeJS.Timeout | null = null;
let officialTimer: NodeJS.Timeout | null = null;
let historicalRunning = false;
let historicalTimer: NodeJS.Timeout | null = null;

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function feedConfigured(): boolean {
  return Boolean(process.env.JOBS_FEED_API_KEY || process.env.INTEGRATION_API_KEY);
}

async function runCycle(): Promise<void> {
  if (running) return;
  running = true;

  try {
    await recoverStaleJobSyncRuns(getSupabaseClient());
  } catch (error) {
    console.error('[Job Worker] stale run recovery failed:', error instanceof Error ? error.message : error);
  }

  try {
    if (feedConfigured()) {
      // Incremental updates are the freshness path. Always run them first so a
      // long reconciliation can never starve newly changed jobs.
      const incremental = await runJobFeedSync({
        mode: 'incremental',
        maxPages: getIncrementalSyncPolicy().maxPages,
      });
      console.info('[Job Worker] incremental sync completed', {
        pages: incremental.pages,
        completed: incremental.completed,
        received: incremental.received,
        upserted: incremental.upserted,
        closed: incremental.closed,
        skipped: incremental.skipped,
        skipped_by_reason: incremental.skipped_by_reason,
        failed: incremental.failed,
        row_failures: incremental.row_failures,
        fatal_failures: incremental.fatal_failures,
        write_batches: incremental.write_batches,
        write_batch_failures: incremental.write_batch_failures,
        write_fallback_rows: incremental.write_fallback_rows,
        write_duration_ms: incremental.write_duration_ms,
        duration_ms: incremental.duration_ms,
        stop_reason: incremental.stop_reason,
      });

      // Full reconciliation is an explicit recovery operation. The upstream
      // feed emits close events, so a recurring full scan adds load without
      // improving freshness and can magnify a partial upstream outage.
    } else {
      console.info('[Job Worker] feed sync skipped: JOBS_FEED_API_KEY is not configured');
    }
  } catch (error) {
    console.error('[Job Worker] feed sync failed:', error instanceof Error ? error.message : error);
  }

  try {
    // Failure retries have their own database lease and row claims. A broken
    // retry source must not hold the primary feed cursor or official queues.
    const failures = await runJobSyncFailureCycle();
    console.info('[Job Worker] failure queue cycle completed', failures);
  } catch (error) {
    console.error('[Job Worker] failure queue cycle failed:', error instanceof Error ? error.message : error);
  }

  try {
    // The dashboard reads persisted snapshots; an upstream outage must not
    // block the primary feed or change any job lifecycle state.
    await refreshUpstreamCompanySnapshots();
  } catch (error) {
    console.error('[Job Worker] upstream company telemetry failed:', error instanceof Error ? error.message : error);
  }

  try {
    const result = await maintainJobLifecycle();
      console.info('[Job Worker] lifecycle maintenance completed', result);
  } catch (error) {
    console.error('[Job Worker] lifecycle maintenance failed:', error instanceof Error ? error.message : error);
  } finally {
    running = false;
  }
}

async function runOfficialDetailsCycleInBackground(): Promise<void> {
  if (officialRunning) return;
  officialRunning = true;
  try {
    // Official details use an independent rotating cursor and lease. Keeping
    // this loop separate from the 10-minute feed loop lets field enrichment
    // continue without delaying freshness or waiting for the next feed cycle.
    const result = await runOfficialDetailsCycle();
    console.info('[Job Worker] official detail cycle completed', {
      enabled: result.enabled,
      companies: result.companies,
      processed: result.processed,
      batches: result.results.length,
      updated: result.results.reduce((sum, item) => sum + (Number(item.updated) || 0), 0),
      failed: result.results.reduce((sum, item) => sum + (Number(item.failed) || 0), 0),
    });
  } catch (error) {
    console.error('[Job Worker] official detail enrichment failed:', error instanceof Error ? error.message : error);
  } finally {
    officialRunning = false;
  }
}

async function runHistoricalFieldReviewCycleInBackground(): Promise<void> {
  if (historicalRunning) return;
  historicalRunning = true;
  try {
    const result = await runHistoricalFieldReviewCycle();
    if (result.enabled || result.claimed > 0) {
      console.info('[Job Worker] historical field review cycle completed', result);
    }
  } catch (error) {
    // Historical review is strictly best-effort. Never let a queue/database
    // problem affect the primary feed or official incremental scheduler.
    console.error('[Job Worker] historical field review cycle failed:', error instanceof Error ? error.message : error);
  } finally {
    historicalRunning = false;
  }
}

/**
 * Starts one bounded background loop for the custom Node server. The database
 * lease still prevents concurrent feed syncs when more than one app instance
 * is running, while link checks remain cheap and retryable.
 */
export function startJobBackgroundWorker(): void {
  if (started || process.env.JOBS_AUTO_WORKER === 'false') return;
  started = true;

  const intervalMs = positiveNumber(
    process.env.JOBS_SYNC_INTERVAL_MINUTES,
    DEFAULT_SYNC_INTERVAL_MINUTES,
  ) * 60_000;
  const officialIntervalMs = positiveNumber(
    process.env.JOBS_OFFICIAL_DETAILS_INTERVAL_MINUTES,
    DEFAULT_OFFICIAL_DETAILS_INTERVAL_MINUTES,
  ) * 60_000;
  const historicalIntervalMs = positiveNumber(
    process.env.JOBS_HISTORICAL_FIELD_REVIEW_INTERVAL_MINUTES,
    1,
  ) * 60_000;
  const delayMs = positiveNumber(
    process.env.JOBS_WORKER_START_DELAY_SECONDS,
    DEFAULT_START_DELAY_SECONDS,
  ) * 1_000;

  const schedule = () => {
    timer = setInterval(() => {
      void runCycle();
    }, intervalMs);
    timer.unref?.();
  };

  const scheduleOfficialDetails = () => {
    officialTimer = setInterval(() => {
      void runOfficialDetailsCycleInBackground();
    }, officialIntervalMs);
    officialTimer.unref?.();
  };

  const scheduleHistoricalReview = () => {
    historicalTimer = setInterval(() => {
      void runHistoricalFieldReviewCycleInBackground();
    }, historicalIntervalMs);
    historicalTimer.unref?.();
  };

  setTimeout(() => {
    void runCycle().finally(schedule);
  }, delayMs).unref?.();
  setTimeout(() => {
    void runOfficialDetailsCycleInBackground().finally(scheduleOfficialDetails);
  }, delayMs + 5_000).unref?.();
  setTimeout(() => {
    void runHistoricalFieldReviewCycleInBackground().finally(scheduleHistoricalReview);
  }, delayMs + 10_000).unref?.();
}

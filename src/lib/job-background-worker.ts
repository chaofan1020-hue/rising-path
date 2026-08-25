import { maintainJobLifecycle } from '@/lib/job-maintenance';
import { getJobFeedState, runJobFeedSync } from '@/lib/job-feed-orchestrator';

const DEFAULT_SYNC_INTERVAL_MINUTES = 10;
const DEFAULT_RECONCILE_INTERVAL_HOURS = 6;
const DEFAULT_START_DELAY_SECONDS = 15;
const DEFAULT_INCREMENTAL_MAX_PAGES = 10;
const DEFAULT_RECONCILE_MAX_PAGES = 3;

let started = false;
let running = false;
let timer: NodeJS.Timeout | null = null;

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function boundedPositiveInteger(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function feedConfigured(): boolean {
  return Boolean(process.env.JOBS_FEED_API_KEY || process.env.INTEGRATION_API_KEY);
}

async function runCycle(): Promise<void> {
  if (running) return;
  running = true;

  try {
    if (feedConfigured()) {
      // Incremental updates are the freshness path. Always run them first so a
      // long reconciliation can never starve newly changed jobs.
      const incremental = await runJobFeedSync({
        mode: 'incremental',
        maxPages: boundedPositiveInteger(
          process.env.JOBS_INCREMENTAL_MAX_PAGES,
          DEFAULT_INCREMENTAL_MAX_PAGES,
          100,
        ),
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
      });

      // Reconciliation is resumable. Process only a small batch per cycle so
      // it releases the lease regularly and cannot block the next increment.
      const state = await getJobFeedState();
      const reconcileIntervalMs = positiveNumber(
        process.env.JOBS_RECONCILE_INTERVAL_HOURS,
        DEFAULT_RECONCILE_INTERVAL_HOURS,
      ) * 3_600_000;
      const lastReconcile = state.last_reconcile_success_at ? Date.parse(state.last_reconcile_success_at) : NaN;
      const shouldReconcile = Boolean(state.reconcile_started_at)
        || !Number.isFinite(lastReconcile)
        || Date.now() - lastReconcile >= reconcileIntervalMs;
      if (shouldReconcile) {
        const reconcile = await runJobFeedSync({
          mode: 'reconcile',
          maxPages: boundedPositiveInteger(
            process.env.JOBS_RECONCILE_MAX_PAGES,
            DEFAULT_RECONCILE_MAX_PAGES,
            50,
          ),
        });
        console.info('[Job Worker] reconcile batch completed', {
          pages: reconcile.pages,
          completed: reconcile.completed,
          received: reconcile.received,
          upserted: reconcile.upserted,
          closed: reconcile.closed,
          skipped: reconcile.skipped,
          skipped_by_reason: reconcile.skipped_by_reason,
          failed: reconcile.failed,
        });
      }
    } else {
      console.info('[Job Worker] feed sync skipped: JOBS_FEED_API_KEY is not configured');
    }
  } catch (error) {
    console.error('[Job Worker] feed sync failed:', error instanceof Error ? error.message : error);
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

  setTimeout(() => {
    void runCycle().finally(schedule);
  }, delayMs).unref?.();
}

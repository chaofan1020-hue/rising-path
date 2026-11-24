import { config as loadDotenv } from 'dotenv';
import { maintainJobLifecycle, type JobMaintenanceResult } from '@/lib/job-maintenance';

loadDotenv({ path: '.env.local' });

/**
 * One-off backlog drain for link verification.
 *
 * The scheduled worker only runs one maintenance batch per sync cycle (a few
 * hundred links every five minutes), which is sized for steady state, not for
 * catching up after the checker has been idle for weeks. This script calls the
 * same lifecycle routine back-to-back until the due queue is empty, with a
 * configurable batch/concurrency and hard run cap.
 *
 * It only uses the sanctioned link-health rules: 410 or an explicit closed-page
 * marker closes immediately, a bare 404 needs two observations, and
 * 403/429/timeout/blocked pages never change lifecycle state. Re-running it is
 * safe; progress lives in `job_sync_records`.
 */
async function main() {
  const maxRuns = Math.min(Math.max(Number(process.env.DRAIN_MAX_RUNS) || 500, 1), 5000);
  const batch = Math.min(Math.max(Number(process.env.DRAIN_BATCH) || 500, 1), 500);
  const concurrency = Math.min(Math.max(Number(process.env.DRAIN_CONCURRENCY) || 20, 1), 20);
  const stopAfterIdle = Math.min(Math.max(Number(process.env.DRAIN_IDLE_ROUNDS) || 3, 1), 20);
  let total: JobMaintenanceResult = { expired: 0, deadlines_found: 0, links_checked: 0, links_healthy: 0, links_not_found: 0, links_closed: 0, links_inconclusive: 0 };
  let idleRounds = 0;

  console.log(`drain start batch=${batch} concurrency=${concurrency} maxRuns=${maxRuns} stopAfterIdle=${stopAfterIdle}`);
  for (let run = 1; run <= maxRuns; run += 1) {
    const startedAt = Date.now();
    const result = await maintainJobLifecycle({ linkBatchSize: batch, concurrency });
    total = {
      expired: total.expired + result.expired,
      deadlines_found: total.deadlines_found + result.deadlines_found,
      links_checked: total.links_checked + result.links_checked,
      links_healthy: total.links_healthy + result.links_healthy,
      links_not_found: total.links_not_found + result.links_not_found,
      links_closed: total.links_closed + result.links_closed,
      links_inconclusive: total.links_inconclusive + result.links_inconclusive,
    };
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `[${new Date().toISOString()}] run=${run} checked=${result.links_checked} closed=${result.links_closed} ` +
      `notfound=${result.links_not_found} healthy=${result.links_healthy} inconclusive=${result.links_inconclusive} ` +
      `deadlines=${result.deadlines_found} secs=${seconds}`,
    );
    if (result.links_checked < Math.max(10, batch / 10)) {
      idleRounds += 1;
      if (idleRounds >= stopAfterIdle) {
        console.log(`drain finished: no more due links, ${JSON.stringify(total)}`);
        return;
      }
    } else {
      idleRounds = 0;
    }
  }
  console.log(`drain stopped at maxRuns=${maxRuns}, ${JSON.stringify(total)}`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
export const JOB_FEED_MAX_SUCCESS_AGE_MS = 15 * 60_000;
export const JOB_FEED_HEARTBEAT_ACTIVE_MS = 20 * 60_000;

export interface JobFeedFreshnessState {
  last_incremental_success_at: string | null;
  updated_at: string;
  consecutive_failures: number;
}

export interface JobFeedFreshness {
  lag_minutes: number | null;
  heartbeat_age_minutes: number | null;
  stale: boolean;
  catching_up: boolean;
  healthy: boolean;
}

function ageMinutes(value: string | null | undefined, now: number): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.round(((now - timestamp) / 60_000) * 10) / 10);
}

/**
 * `last_incremental_success_at` proves that a complete round finished.
 * `updated_at` only proves that the worker touched its cursor recently. A
 * catch-up run can keep `updated_at` fresh for hours without ever committing a
 * successful round, so liveness and freshness must be reported separately.
 */
export function describeJobFeedFreshness(
  state: JobFeedFreshnessState,
  now = Date.now(),
): JobFeedFreshness {
  const lagMinutes = ageMinutes(state.last_incremental_success_at, now);
  const heartbeatAgeMinutes = ageMinutes(state.updated_at, now);
  const stale = lagMinutes === null || lagMinutes * 60_000 > JOB_FEED_MAX_SUCCESS_AGE_MS;
  const catchingUp = heartbeatAgeMinutes !== null
    && heartbeatAgeMinutes * 60_000 < JOB_FEED_HEARTBEAT_ACTIVE_MS;
  return {
    lag_minutes: lagMinutes,
    heartbeat_age_minutes: heartbeatAgeMinutes,
    stale,
    catching_up: catchingUp,
    healthy: state.consecutive_failures === 0 && !stale,
  };
}
export type JobAvailabilityStatus = 'valid' | 'closed' | 'blocked' | 'timeout' | 'unknown';
export type JobLinkHealth = 'healthy' | 'closed' | 'blocked' | 'timeout' | 'unknown';

export interface JobLinkHealthObservation {
  availabilityStatus: JobAvailabilityStatus | null;
  linkHealth: JobLinkHealth | null;
  httpStatus: number | null;
  error: string | null;
  checkedAt: string | null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function number(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 100 && parsed <= 599 ? parsed : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function normalizeAvailabilityStatus(value: unknown): JobAvailabilityStatus | null {
  const normalized = text(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized) return null;
  if (['valid', 'open', 'active', 'available', 'healthy', 'ok', 'success'].includes(normalized)) return 'valid';
  if (['closed', 'close', 'inactive', 'expired', 'removed', 'not_found', 'unavailable'].includes(normalized)) return 'closed';
  if (['blocked', 'open_unverified', 'unverified', 'verification', 'captcha', 'challenged', 'forbidden'].includes(normalized)) return 'blocked';
  if (['timeout', 'timed_out', 'request_timeout'].includes(normalized)) return 'timeout';
  if (['unknown', 'error', 'failed', 'inconclusive'].includes(normalized)) return 'unknown';
  return null;
}

export function normalizeLinkHealth(value: unknown): JobLinkHealth | null {
  const status = normalizeAvailabilityStatus(value);
  if (!status) return null;
  return status === 'valid' ? 'healthy' : status;
}

export function observeJobLinkHealth(sourceEvidence: unknown): JobLinkHealthObservation {
  const evidence = record(sourceEvidence);
  const rawAvailability = evidence.availability_status ?? evidence.availabilityStatus;
  const rawLinkHealth = evidence.link_health ?? evidence.linkHealth;
  const httpStatus = number(
    evidence.link_check_http_status
      ?? evidence.link_http_status
      ?? evidence.last_link_status,
  );
  const availabilityFromStatus = normalizeAvailabilityStatus(rawAvailability);
  const linkHealthFromStatus = normalizeLinkHealth(rawLinkHealth);
  const httpAvailability = httpStatus === 404 || httpStatus === 410
    ? 'closed'
    : httpStatus === 401 || httpStatus === 403 || httpStatus === 429
      ? 'blocked'
      : httpStatus === 408 || httpStatus === 524
        ? 'timeout'
        : httpStatus !== null && httpStatus >= 500
          ? 'unknown'
          : null;
  const availabilityStatus = availabilityFromStatus || (
    linkHealthFromStatus === 'healthy' ? 'valid' : linkHealthFromStatus
  ) || httpAvailability;
  const linkHealth = linkHealthFromStatus || (
    availabilityStatus === 'valid' ? 'healthy' : availabilityStatus
  );

  const errorValue = evidence.link_check_error ?? evidence.link_error ?? evidence.error;
  const checkedValue = evidence.availability_checked_at ?? evidence.link_checked_at ?? evidence.checked_at;
  return {
    availabilityStatus,
    linkHealth,
    httpStatus,
    error: text(errorValue) || null,
    checkedAt: text(checkedValue) || null,
  };
}

export function isDefinitivelyClosed(observation: JobLinkHealthObservation): boolean {
  return observation.availabilityStatus === 'closed' || observation.linkHealth === 'closed';
}

/**
 * A single 404 is not enough evidence to remove a job. ATS providers
 * intermittently return 404 while deploying, rate limiting, or rotating a
 * requisition URL. HTTP 410 and an explicit closed-page signal are definitive;
 * a bare 404 requires two observations.
 */
export function shouldCloseAfterLinkFailure(options: {
  httpStatus: number | null | undefined;
  previousFailures?: number | null;
  explicitClosed?: boolean;
}): boolean {
  if (options.explicitClosed) return true;
  if (options.httpStatus === 410) return true;
  return options.httpStatus === 404 && (options.previousFailures || 0) + 1 >= 2;
}

export function nextLinkFailureCount(
  httpStatus: number | null | undefined,
  previousFailures?: number | null,
): number {
  if (httpStatus === 404 || httpStatus === 410) return (previousFailures || 0) + 1;
  return previousFailures || 0;
}

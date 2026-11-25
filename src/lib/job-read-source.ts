/**
 * Read-path switch for the v3 shadow validation.
 *
 * `jobs` is the default and the rollback. `JOBS_READ_SOURCE=v3` is opt-in:
 * only callers that explicitly use this helper move to `jobs_v3`, so the
 * current production read path is unchanged until the cutover step.
 */
export function jobReadTable(env: Record<string, string | undefined> = process.env): 'jobs' | 'jobs_v3' {
  const value = (env.JOBS_READ_SOURCE || 'jobs').trim().toLowerCase();
  return value === 'v3' || value === 'jobs_v3' ? 'jobs_v3' : 'jobs';
}

export function jobListingReadTable(env: Record<string, string | undefined> = process.env): 'jobs_listing' | 'jobs_listing_v3' {
  const value = (env.JOBS_READ_SOURCE || 'jobs').trim().toLowerCase();
  return value === 'v3' || value === 'jobs_v3' ? 'jobs_listing_v3' : 'jobs_listing';
}
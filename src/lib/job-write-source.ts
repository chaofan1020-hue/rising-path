/**
 * Write-path switch for the v3 cutover (plan C3/C5).
 *
 * Read and write are two separate switches on purpose:
 *
 *   JOBS_READ_SOURCE=v3   — already live. The catalogue is served from
 *                           `jobs_v3`; this is the user-visible table.
 *   JOBS_WRITE_SOURCE=v3  — opt-in, still off. Redirects inserts/updates to
 *                           `jobs_v3` so the write path stops paying for the
 *                           shadow copy.
 *
 * Defaults are the rollback on both switches: `jobs`. Removing the env var and
 * restarting is the whole rollback for C5, because 0163 keeps `public.jobs`
 * current through the reverse shadow trigger (`jobs_v3_shadow_to_jobs`).
 *
 * Every write of job rows must go through this helper and *never* through
 * `jobReadTable()`: a flipped read flag must not redirect an upsert into the
 * table the caller only meant to read from.
 */

export type JobWriteTable = 'jobs' | 'jobs_v3';

function writeTarget(env: Record<string, string | undefined>): JobWriteTable {
  const value = (env.JOBS_WRITE_SOURCE || 'jobs').trim().toLowerCase();
  return value === 'v3' || value === 'jobs_v3' ? 'jobs_v3' : 'jobs';
}

export function jobWriteTable(env: Record<string, string | undefined> = process.env): JobWriteTable {
  return writeTarget(env);
}

export function jobWriteIsV3(env: Record<string, string | undefined> = process.env): boolean {
  return writeTarget(env) === 'jobs_v3';
}

/**
 * Tables a hard DELETE has to touch.
 *
 * The forward shadow trigger already mirrors `jobs` -> `jobs_v3` deletes, but
 * the reverse direction deliberately does not mirror them: a v3 delete must not
 * be able to wipe a row from the archive table by accident. While both tables
 * exist, an application-level delete therefore has to be issued to both, which
 * is what this helper returns (write table first).
 */
export function jobDeleteTables(env: Record<string, string | undefined> = process.env): JobWriteTable[] {
  return writeTarget(env) === 'jobs_v3' ? ['jobs_v3', 'jobs'] : ['jobs'];
}
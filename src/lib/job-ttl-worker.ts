import type { SupabaseClient } from '@supabase/supabase-js';
import { jobWriteTable } from '@/lib/job-write-source';

export const TTL_BATCH_SIZE = 5_000;
export const TTL_SA_MS = 24 * 60 * 60 * 1000;
export const TTL_BC_MS = 7 * 24 * 60 * 60 * 1000;

export interface TtlCandidate {
  id: number;
  last_seen_at: string | null;
  source_tier: string | null;
  display_status: string | null;
  valid_through?: string | null;
  is_active?: boolean | null;
  is_closed?: boolean | null;
}

export interface TtlRunResult {
  enabled: boolean;
  dry_run: boolean;
  scanned: number;
  stale: number;
  skipped_manual_hold: number;
  skipped_valid_through: number;
  written: number;
  batches: number;
}

/**
 * TTL is display-only. It must never call is_closed/is_active: an incomplete
 * snapshot or a transport error is not proof that a role was removed.
 */
export function shouldMarkStale(candidate: TtlCandidate, now = Date.now()): boolean {
  if (candidate.is_active === false || candidate.is_closed === true) return false;
  if (candidate.display_status !== 'listed' && candidate.display_status !== 'enriched') return false;
  if (candidate.valid_through) {
    const validThrough = new Date(candidate.valid_through).getTime();
    if (Number.isFinite(validThrough) && validThrough > now) return false;
  }
  if (!candidate.last_seen_at) return false;
  const lastSeen = new Date(candidate.last_seen_at).getTime();
  if (!Number.isFinite(lastSeen)) return false;
  const tier = (candidate.source_tier || 'B').toUpperCase();
  const ttl = tier === 'S' || tier === 'A' ? TTL_SA_MS : TTL_BC_MS;
  return now - lastSeen > ttl;
}

export async function runJobTtlCycle(
  client: SupabaseClient,
  options: {
    apply?: boolean;
    enabled?: boolean;
    now?: Date;
    batchSize?: number;
    maxBatches?: number;
  } = {},
): Promise<TtlRunResult> {
  const enabled = options.enabled ?? process.env.JOB_TTL_ENABLED === 'true';
  const dryRun = !options.apply;
  const now = (options.now || new Date()).getTime();
  const batchSize = Math.min(Math.max(options.batchSize ?? TTL_BATCH_SIZE, 1), 5_000);
  const maxBatches = Math.max(options.maxBatches ?? 100, 1);
  const result: TtlRunResult = {
    enabled,
    dry_run: dryRun,
    scanned: 0,
    stale: 0,
    skipped_manual_hold: 0,
    skipped_valid_through: 0,
    written: 0,
    batches: 0,
  };
  if (!enabled) return result;

  const staleCutoff = new Date(now - TTL_BC_MS).toISOString();
  const ids: number[] = [];
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const { data, error } = await client
      .from('jobs')
      .select('id, last_seen_at, source_tier, display_status, valid_through, is_active, is_closed')
      .eq('is_active', true)
      .eq('is_closed', false)
      .in('display_status', ['listed', 'enriched'])
      .lt('last_seen_at', staleCutoff)
      .order('id', { ascending: true })
      .range(batch * batchSize, (batch + 1) * batchSize - 1);
    if (error) throw new Error(`读取 TTL 候选失败: ${error.message}`);
    const rows = (data ?? []) as TtlCandidate[];
    result.batches += 1;
    result.scanned += rows.length;
    for (const row of rows) {
      if (shouldMarkStale(row, now)) ids.push(row.id);
      else if (row.display_status === 'manual_hold') result.skipped_manual_hold += 1;
      else result.skipped_valid_through += 1;
    }
    if (rows.length < batchSize) break;
  }
  result.stale = ids.length;
  if (dryRun || ids.length === 0) return result;

  for (let index = 0; index < ids.length; index += 1_000) {
    const chunk = ids.slice(index, index + 1_000);
    const { error, count } = await client
      .from(jobWriteTable())
      .update({ display_status: 'stale' }, { count: 'exact' })
      .in('id', chunk)
      .eq('is_active', true)
      .eq('is_closed', false)
      .in('display_status', ['listed', 'enriched']);
    if (error) throw new Error(`写 stale 失败: ${error.message}`);
    result.written += count ?? chunk.length;
  }
  return result;
}
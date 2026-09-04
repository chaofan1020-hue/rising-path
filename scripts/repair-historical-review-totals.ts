import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: '.env.local' });

/**
 * Repairs dashboard-only denominators after a worker restart or an older
 * batch-local counter wrote processed_candidates ahead of total_candidates.
 * It never changes jobs, field values, statuses, cursors, or leases.
 */
async function main(): Promise<void> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('job_historical_field_reviews')
    .select('id,company_name,total_candidates,processed_candidates');
  if (error) throw new Error(`读取历史复核总数失败: ${error.message}`);
  const changed: Array<{ id: number; company: string; from: number; to: number }> = [];
  for (const row of data || []) {
    const total = Number(row.total_candidates) || 0;
    const processed = Number(row.processed_candidates) || 0;
    if (processed <= total) continue;
    const { error: updateError } = await client
      .from('job_historical_field_reviews')
      .update({ total_candidates: processed, remaining_candidates: 0, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('processed_candidates', processed);
    if (updateError) throw new Error(`修正 ${row.company_name} 总数失败: ${updateError.message}`);
    changed.push({ id: row.id, company: row.company_name, from: total, to: processed });
  }
  console.log(JSON.stringify({ changed }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

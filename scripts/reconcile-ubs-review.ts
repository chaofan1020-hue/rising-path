import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: process.env.ENV_FILE || process.env.DOTENV_CONFIG_PATH || '.env.local', override: true, quiet: true });

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  const repairCompleted = process.argv.includes('--repair-completed');
  const { getSupabaseClient } = await import('@/storage/database/supabase-client');
  const client = getSupabaseClient();
  const { data, error } = await client.from('job_historical_field_reviews')
    .select('id,company_name,status,source_family,source_system,last_error,cursor_job_id,total_candidates,processed_candidates,remaining_candidates,updated_jobs')
    .eq('company_name', 'UBS').maybeSingle();
  if (error) throw new Error(`读取 UBS 历史复核队列失败: ${error.message}`);
  if (!data) throw new Error('未找到 UBS 历史复核队列');
  const expected = repairCompleted
    ? data.source_family === 'discovery_required' && data.status === 'completed' && Number(data.processed_candidates) === 20 && Number(data.updated_jobs) === 20
    : data.source_family === 'discovery_required' && data.last_error === '来源待探测';
  if (!expected) throw new Error(`UBS 队列状态已变化，拒绝覆盖: ${data.source_family}/${data.status}/${data.last_error}`);
  const patch = {
    source_family: 'official_generic',
    source_system: 'historical:official_generic:UBS',
    status: 'queued',
    last_error: null,
    lease_owner: null,
    lease_expires_at: null,
    next_run_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    remaining_candidates: repairCompleted ? Math.max(0, Number(data.total_candidates) - Number(data.processed_candidates)) : data.remaining_candidates,
    completed_at: null,
  };
  if (!write) { console.log(JSON.stringify({ write, current: data, patch }, null, 2)); return; }
  const { data: updated, error: updateError } = await client.from('job_historical_field_reviews')
    .update(patch).eq('id', data.id).eq('source_family', 'discovery_required')
    .eq(repairCompleted ? 'status' : 'last_error', repairCompleted ? 'completed' : '来源待探测')
    .select('company_name,status,source_family,source_system,cursor_job_id,total_candidates,processed_candidates,remaining_candidates,updated_jobs,last_error')
    .single();
  if (updateError) throw new Error(`更新 UBS 历史复核队列失败: ${updateError.message}`);
  console.log(JSON.stringify({ write, current: data, updated }, null, 2));
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; });

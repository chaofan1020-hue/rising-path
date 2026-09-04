import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: process.argv.find((value) => value.startsWith('--env-file='))?.slice('--env-file='.length) || '.env.local' });

function arg(name: string): string {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3).trim() || '';
}

function integer(name: string): number {
  const value = Number(arg(name));
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${name} must be a non-negative integer`);
  return value;
}

async function main(): Promise<void> {
  const company = arg('company');
  if (!company) throw new Error('需要 --company=公司名');
  const total = integer('total');
  const processed = integer('processed');
  const remaining = integer('remaining');
  const updated = integer('updated');
  const unavailable = arg('unavailable') ? integer('unavailable') : 0;
  const status = arg('status') || 'paused';
  const lastError = arg('last-error') || null;
  if (!['queued', 'running', 'paused', 'completed', 'failed'].includes(status)) throw new Error('status 无效');
  if (processed + remaining > total) throw new Error('processed + remaining 不能超过 total');
  const client = getSupabaseClient();
  const now = new Date().toISOString();
  const { data, error } = await client.from('job_historical_field_reviews').update({
    status,
    total_candidates: total,
    processed_candidates: processed,
    remaining_candidates: remaining,
    updated_jobs: updated,
    unavailable_fields: unavailable,
    last_error: lastError,
    lease_owner: null,
    lease_expires_at: null,
    updated_at: now,
  }).eq('company_name', company).select('company_name,status,total_candidates,processed_candidates,remaining_candidates,updated_jobs,unavailable_fields,last_error').single();
  if (error) throw new Error(`更新历史复核进度失败: ${error.message}`);
  console.log(JSON.stringify(data, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

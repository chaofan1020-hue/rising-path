import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: '.env.local' });

function arg(name: string): string {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3).trim() || '';
}

async function main(): Promise<void> {
  const company = arg('company');
  const processed = Number(arg('processed'));
  const updated = Number(arg('updated'));
  if (!company || !Number.isInteger(processed) || processed < 0 || !Number.isInteger(updated) || updated < 0) throw new Error('需要 --company=公司名 --processed=非负整数 --updated=非负整数');
  const client = getSupabaseClient();
  const now = new Date().toISOString();
  const { data, error } = await client.from('job_historical_field_reviews').update({
    status: 'completed',
    total_candidates: processed,
    processed_candidates: processed,
    remaining_candidates: 0,
    updated_jobs: updated,
    last_error: null,
    completed_at: now,
    lease_owner: null,
    lease_expires_at: null,
    updated_at: now,
  }).eq('company_name', company).eq('status', 'paused').eq('last_error', '连接器历史复核未启用写入开关').select('company_name,status,total_candidates,processed_candidates,remaining_candidates,updated_jobs').maybeSingle();
  if (error) throw new Error(`更新历史复核状态失败: ${error.message}`);
  if (!data) throw new Error(`未更新 ${company}：队列状态或暂停原因已变化`);
  console.log(JSON.stringify(data, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

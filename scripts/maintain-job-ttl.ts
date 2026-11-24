import { runJobTtlCycle } from '@/lib/job-ttl-worker';
import { getSupabaseClient } from '@/storage/database/supabase-client';

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const enabled = process.env.JOB_TTL_ENABLED === 'true';
  const result = await runJobTtlCycle(getSupabaseClient(), { apply, enabled });
  console.log(JSON.stringify({ ...result, apply, JOB_TTL_ENABLED: enabled }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
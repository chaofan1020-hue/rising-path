import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: '.env.local' });

function argument(name: string): string | null {
  return process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || null;
}

async function main() {
  const source = argument('--source');
  const owner = argument('--owner');
  if (!source || !owner) throw new Error('必须同时提供 --source 和 --owner');

  const client = getSupabaseClient();
  const { data, error } = await client.from('job_sync_state')
    .select('source_system,lease_owner,lease_expires_at')
    .eq('source_system', source)
    .maybeSingle();
  if (error) throw new Error(`读取同步租约失败: ${error.message}`);
  if (!data || data.lease_owner !== owner) throw new Error('当前租约 owner 与指定 owner 不一致，未执行释放');

  const { error: releaseError } = await client.from('job_sync_state')
    .update({ lease_owner: null, lease_expires_at: null, updated_at: new Date().toISOString() })
    .eq('source_system', source)
    .eq('lease_owner', owner);
  if (releaseError) throw new Error(`释放同步租约失败: ${releaseError.message}`);
  console.log(JSON.stringify({ released: true, source, lease_expires_at: data.lease_expires_at }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

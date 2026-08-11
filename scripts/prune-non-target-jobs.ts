import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { isTargetRegion } from '@/lib/job-region-scope';

loadDotenv({ path: '.env.local' });

async function main() {
  const client = getSupabaseClient();
  const idsToDeactivate: number[] = [];
  let offset = 0;
  let scanned = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await client
      .from('jobs')
      .select('id, region')
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`读取岗位失败: ${error.message}`);
    scanned += data?.length || 0;
    for (const job of data || []) {
      if (!isTargetRegion(job.region)) idsToDeactivate.push(job.id);
    }
    if (!data || data.length < pageSize) break;
    offset += pageSize;
  }

  for (let index = 0; index < idsToDeactivate.length; index += 200) {
    const ids = idsToDeactivate.slice(index, index + 200);
    const { error } = await client
      .from('jobs')
      .update({ is_active: false, is_closed: true, updated_at: new Date().toISOString() })
      .in('id', ids);
    if (error) throw new Error(`停用非目标地区岗位失败: ${error.message}`);
  }

  console.log(JSON.stringify({ scanned, deactivated: idsToDeactivate.length }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : '清理非目标地区岗位失败');
  process.exitCode = 1;
});

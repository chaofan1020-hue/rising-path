import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: process.env.ENV_FILE || '.env.local' });

async function main(): Promise<void> {
  if (process.env.APPLE_SOURCE_PROMOTION_WRITE_ENABLED !== 'true') {
    throw new Error('Set APPLE_SOURCE_PROMOTION_WRITE_ENABLED=true for the explicit metadata update.');
  }
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('job_company_sources')
    .update({
      source_type: 'apple_official_api',
      source_basis: 'official_api',
      official_hosts: ['jobs.apple.com'],
      connector_name: 'apple_official_api',
      detail_required: true,
      status: 'configured_connector',
      notes: 'Apple 官方 jobDetails API 已完成 20 条生产 dry-run；等待独立通用官方写入开关和首批生产验收。',
      updated_at: new Date().toISOString(),
    })
    .eq('company_name', 'Apple')
    .eq('source_type', 'apple_official_api')
    .select('company_name,source_type,source_basis,official_hosts,connector_name,status,detail_required')
    .maybeSingle();
  if (error) throw new Error(`更新 Apple 来源台账失败: ${error.message}`);
  if (!data) throw new Error('未找到 source_type=apple_official_api 的 Apple 台账行，未执行更新。');
  console.log(JSON.stringify(data, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

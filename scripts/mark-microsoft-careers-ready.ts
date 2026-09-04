import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: process.env.ENV_FILE || '.env.local' });

async function main(): Promise<void> {
  if (process.env.MICROSOFT_SOURCE_PROMOTION_WRITE_ENABLED !== 'true') {
    throw new Error('Set MICROSOFT_SOURCE_PROMOTION_WRITE_ENABLED=true for the explicit metadata update.');
  }
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('job_company_sources')
    .update({
      source_type: 'microsoft_careers',
      source_basis: 'official_careers',
      official_careers_url: 'https://careers.microsoft.com',
      official_hosts: ['apply.careers.microsoft.com'],
      connector_name: 'microsoft_careers',
      detail_required: true,
      status: 'configured_connector',
      notes: 'Microsoft Careers 详情页 JSON-LD JobPosting 已完成 dry-run；生产写入必须先完成 20 条真实 dry-run 与独立 canary。',
      updated_at: new Date().toISOString(),
    })
    .eq('company_name', 'Microsoft')
    .eq('is_active', true)
    .select('company_name,source_type,source_basis,official_careers_url,official_hosts,connector_name,status,detail_required')
    .maybeSingle();
  if (error) throw new Error(`更新 Microsoft 来源台账失败: ${error.message}`);
  if (!data) throw new Error('未找到 active Microsoft 来源台账行，未执行更新。');
  console.log(JSON.stringify(data, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

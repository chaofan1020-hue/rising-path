import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: process.env.ENV_FILE || '.env.local' });

async function main(): Promise<void> {
  if (process.env.GOOGLE_SOURCE_PROMOTION_WRITE_ENABLED !== 'true') {
    throw new Error('Set GOOGLE_SOURCE_PROMOTION_WRITE_ENABLED=true for the explicit metadata update.');
  }
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('job_company_sources')
    .update({
      source_type: 'google_careers',
      source_basis: 'official_careers',
      official_careers_url: 'https://careers.google.com/jobs',
      official_hosts: ['www.google.com', 'careers.google.com'],
      connector_name: 'google_careers',
      detail_required: true,
      status: 'configured_connector',
      notes: 'Google Careers 详情页已完成受控响应适配和本地 fixture 验证；生产写入必须先完成 20 条真实 dry-run 与独立 canary。',
      updated_at: new Date().toISOString(),
    })
    .eq('company_name', 'Google')
    .eq('is_active', true)
    .select('company_name,source_type,source_basis,official_careers_url,official_hosts,connector_name,status,detail_required')
    .maybeSingle();
  if (error) throw new Error(`更新 Google 来源台账失败: ${error.message}`);
  if (!data) throw new Error('未找到 active Google 来源台账行，未执行更新。');
  console.log(JSON.stringify(data, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

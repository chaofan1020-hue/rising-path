import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: process.env.ENV_FILE || process.env.DOTENV_CONFIG_PATH || '.env.local', override: true, quiet: true });

const COMPANY = 'UBS';
const PATCH = {
  source_type: 'ubs_brassring',
  source_basis: 'official_careers',
  official_hosts: ['jobs.ubs.com', 'www.ubs.com'],
  official_careers_url: 'https://www.ubs.com/global/en/careers.html',
  connector_name: 'official_generic',
  detail_required: true,
  detail_url_rule: 'https://jobs.ubs.com/TGnewUI/Search/home/HomeWithPreLoad?partnerid=25008&siteid=5012&PageType=JobDetails&jobid={external_job_id}',
  status: 'configured_connector',
  notes: 'BrassRing JobDetailQuestions 官方嵌入数据已通过 20 条生产 dry-run 和 20 条 canary（地点/工作类型 20/20，经验 11/20，未改变岗位生命周期；2026-09-09）。官方未提供截止日期时保持为空。',
};

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  const { getSupabaseClient } = await import('@/storage/database/supabase-client');
  const client = getSupabaseClient();
  const { data: row, error } = await client.from('job_company_sources')
    .select('company_name,status,source_type,source_basis,official_hosts,active_jobs')
    .eq('company_name', COMPANY).eq('is_active', true).maybeSingle();
  if (error) throw new Error(`读取 UBS 来源台账失败: ${error.message}`);
  if (!row) throw new Error('未找到 active UBS 来源台账行');
  if (row.status !== 'discovery_required' || row.source_type !== 'official_custom_or_unclassified') {
    throw new Error(`UBS 当前状态不是预期的 discovery_required/official_custom_or_unclassified: ${row.status}/${row.source_type}`);
  }
  const preview = { company: COMPANY, write, current: row, patch: PATCH, environment: new URL(process.env.SUPABASE_URL || '').hostname.split('.')[0] };
  if (!write) { console.log(JSON.stringify(preview, null, 2)); return; }
  const { data, error: updateError } = await client.from('job_company_sources')
    .update({ ...PATCH, updated_at: new Date().toISOString() })
    .eq('company_name', COMPANY).eq('is_active', true).eq('status', 'discovery_required')
    .select('company_name,status,source_type,source_basis,connector_name,detail_required,official_hosts,notes')
    .single();
  if (updateError) throw new Error(`提升 UBS 来源台账失败: ${updateError.message}`);
  console.log(JSON.stringify({ ...preview, updated: data }, null, 2));
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; });

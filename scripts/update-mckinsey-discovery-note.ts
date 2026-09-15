import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: process.env.ENV_FILE || process.env.DOTENV_CONFIG_PATH || '.env.local', override: true, quiet: true });

const NOTE = '主 Feed 已接入 McKinsey 官方 gateway JSON（source_type=mckinsey）：2026-09-09 生产首轮同步接收 764 条、目标地区写入 144 条，144/144 地点证据为 official_payload/verified，岗位生命周期保持不变。Avature ApplicationMethods?folderId={id} 仍 302 到 jobs.mckinsey.com/en_US/careers/ApplicationMethods，最终为登录/申请流程壳（Choose how you\'d like to proceed、I am a new applicant、Login Username），详情字段不可公开获取；历史详情队列保持 discovery_required，不写入申请壳。';

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  const { getSupabaseClient } = await import('@/storage/database/supabase-client');
  const client = getSupabaseClient();
  const { data, error } = await client.from('job_company_sources')
    .select('company_name,status,source_type,notes')
    .eq('company_name', 'McKinsey & Company').eq('is_active', true).maybeSingle();
  if (error) throw new Error(`读取 McKinsey 来源台账失败: ${error.message}`);
  if (!data) throw new Error('未找到 active McKinsey 来源台账行');
  if (data.status !== 'discovery_required') throw new Error(`McKinsey 状态已变化，拒绝覆盖: ${data.status}`);
  const preview = { write, environment: new URL(process.env.SUPABASE_URL || '').hostname.split('.')[0], current: data, patch: { status: data.status, notes: NOTE } };
  if (!write) { console.log(JSON.stringify(preview, null, 2)); return; }
  const { data: updated, error: updateError } = await client.from('job_company_sources')
    .update({ notes: NOTE, updated_at: new Date().toISOString() })
    .eq('company_name', 'McKinsey & Company').eq('is_active', true).eq('status', 'discovery_required')
    .select('company_name,status,source_type,notes').single();
  if (updateError) throw new Error(`更新 McKinsey 来源台账失败: ${updateError.message}`);
  console.log(JSON.stringify({ ...preview, updated }, null, 2));
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; });

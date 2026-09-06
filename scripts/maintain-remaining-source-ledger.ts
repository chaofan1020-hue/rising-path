import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: process.env.ENV_FILE || '.env.local' });

/**
 * Ledger maintenance for the remaining discovery_required companies:
 *  - Rothschild & Co: promoted to configured_connector (Workday official
 *    detail auto-backfill already verified on production).
 *  - McKinsey / UBS / Citadel: keep discovery_required, write blocker notes
 *    so the admin dashboard shows an honest "blocked / needs auth" state
 *    instead of an idle/unclassified one.
 *
 * Guarded by OFFICIAL_DETAIL_PROMOTION_WRITE_ENABLED=true.
 */
interface LedgerUpdate {
  companyName: string;
  patch: Record<string, unknown>;
}

const UPDATES: LedgerUpdate[] = [
  {
    companyName: 'Rothschild & Co',
    patch: {
      source_type: 'workday',
      source_basis: 'official_careers',
      official_hosts: ['rothschildandco.wd3.myworkdayjobs.com', 'www.rothschildandco.com'],
      connector_name: 'workday',
      detail_required: true,
      status: 'configured_connector',
      notes: 'Rothschild & Co 由 Workday 官方详情自动追平（official_ats 证据、official_link_structured_field 地点）；生产字段覆盖已验证（2026-09-05）。',
    },
  },
  {
    companyName: 'McKinsey & Company',
    patch: {
      status: 'discovery_required',
      notes: '官方源受限：mckinsey.avature.net ApplicationMethods 全部 302 到登录页；www.mckinsey.com/careers/search-jobs 反爬超时。详情与结构化字段在登录后的申请页内，公开访问不可得。不写入、不改生命周期（2026-09-05 记录）。恢复条件：官方公开 API / 导出接口 / 正式 allowlist。',
    },
  },
  {
    companyName: 'UBS',
    patch: {
      status: 'discovery_required',
      notes: '官方 BrassRing 页面 AJAX 403 且 1.3MB 响应超过当前安全大小限制，无写入（2026-09-05 记录）。恢复条件：官方公开 API 或受控响应适配通过 20 条 dry-run。',
    },
  },
  {
    companyName: 'Citadel',
    patch: {
      status: 'discovery_required',
      notes: '官方页面 403 反爬，无写入（2026-09-05 记录）。恢复条件：官方公开 API 或生产出口 allowlist。',
    },
  },
];

async function main(): Promise<void> {
  if (process.env.OFFICIAL_DETAIL_PROMOTION_WRITE_ENABLED !== 'true') {
    throw new Error('Set OFFICIAL_DETAIL_PROMOTION_WRITE_ENABLED=true for the explicit metadata update.');
  }
  const client = getSupabaseClient();
  const now = new Date().toISOString();
  for (const u of UPDATES) {
    const { data, error } = await client
      .from('job_company_sources')
      .update({ ...u.patch, updated_at: now })
      .eq('company_name', u.companyName)
      .eq('is_active', true)
      .select('company_name,source_type,status,connector_name,notes')
      .maybeSingle();
    if (error) throw new Error(`更新 ${u.companyName} 来源台账失败: ${error.message}`);
    if (!data) throw new Error(`未找到 active ${u.companyName} 来源台账行，未执行更新。`);
    console.log(JSON.stringify(data, null, 2));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
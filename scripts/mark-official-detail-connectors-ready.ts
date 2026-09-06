import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: process.env.ENV_FILE || '.env.local' });

/**
 * Promote the four official detail/JSON connectors that completed production
 * backfill + verification on 2026-09-05 (Deutsche Bank / Bain & Company /
 * Two Sigma / Evercore) from `discovery_required` to `configured_connector`
 * so the admin sync dashboard and source matrix treat them as configured.
 *
 * Guarded by OFFICIAL_DETAIL_PROMOTION_WRITE_ENABLED=true like the existing
 * mark-*-ready.ts scripts. Writes only the metadata row; no job rows change.
 */
interface Promotion {
  companyName: string;
  sourceType: string;
  careersUrl: string;
  hosts: string[];
  connector: string;
  note: string;
}

const PROMOTIONS: Promotion[] = [
  {
    companyName: 'Deutsche Bank',
    sourceType: 'deutsche_bank_beesite',
    careersUrl: 'https://careers.db.com/professionals/search-roles/',
    hosts: ['careers.db.com'],
    connector: 'deutsche_bank_beesite',
    note: 'Deutsche Bank 官方 beesite JSON API（jobhtml/{PositionID}.json）已完成生产回填与验收（220 条，2026-09-05）；DB 专用 fetch 分支已部署。',
  },
  {
    companyName: 'Bain & Company',
    sourceType: 'bain_careers',
    careersUrl: 'https://careers.bain.com/jobs',
    hosts: ['careers.bain.com'],
    connector: 'bain_careers',
    note: 'Bain & Company 官方详情页正文解析已完成生产回填与验收（79 条，2026-09-05）。',
  },
  {
    companyName: 'Two Sigma',
    sourceType: 'two_sigma_careers',
    careersUrl: 'https://careers.twosigma.com/careers',
    hosts: ['careers.twosigma.com'],
    connector: 'two_sigma_careers',
    note: 'Two Sigma 官方详情页正文解析已完成生产回填与验收（45 条，2026-09-05）。',
  },
  {
    companyName: 'Evercore',
    sourceType: 'evercore_taleo',
    careersUrl: 'https://evercore.tal.net/vx/mobile-0/appcentre-ext/brand-4/candidate/so/pm/1/pl/3/',
    hosts: ['evercore.tal.net'],
    connector: 'evercore_taleo',
    note: 'Evercore Taleo 裸详情页（去 ?instant=apply）已完成生产回填与验收（49 条，2026-09-05）。',
  },
  {
    companyName: 'Accenture',
    sourceType: 'workday',
    careersUrl: 'https://www.accenture.com/us-en/careers/jobsearch',
    hosts: ['www.accenture.com', 'accenture.wd103.myworkdayjobs.com'],
    connector: 'accenture_careers',
    note: 'Accenture 双源完成：Workday 官方详情自动追平 + www.accenture.com 官网 JSON-LD（jobdetails）字段回填。生产 1011 条 accenture.com 岗位回填：location/deadline 831 verified、employment 918 verified、experience 817，180 条官网已 302 下架不猜测（2026-09-06）。',
  },
];

async function main(): Promise<void> {
  if (process.env.OFFICIAL_DETAIL_PROMOTION_WRITE_ENABLED !== 'true') {
    throw new Error('Set OFFICIAL_DETAIL_PROMOTION_WRITE_ENABLED=true for the explicit metadata update.');
  }
  const client = getSupabaseClient();
  const now = new Date().toISOString();
  for (const p of PROMOTIONS) {
    const { data, error } = await client
      .from('job_company_sources')
      .update({
        source_type: p.sourceType,
        source_basis: 'official_careers',
        official_careers_url: p.careersUrl,
        official_hosts: p.hosts,
        connector_name: p.connector,
        detail_required: true,
        status: 'configured_connector',
        notes: p.note,
        updated_at: now,
      })
      .eq('company_name', p.companyName)
      .eq('is_active', true)
      .select('company_name,source_type,source_basis,official_careers_url,official_hosts,connector_name,status,detail_required')
      .maybeSingle();
    if (error) throw new Error(`更新 ${p.companyName} 来源台账失败: ${error.message}`);
    if (!data) throw new Error(`未找到 active ${p.companyName} 来源台账行，未执行更新。`);
    console.log(JSON.stringify(data, null, 2));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
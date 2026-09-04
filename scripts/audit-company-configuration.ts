import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: process.env.DOTENV_CONFIG_PATH || '.env.local' });

type SourceRow = {
  company_name: string;
  is_active: boolean;
  status: string | null;
  source_type: string | null;
  source_basis: string | null;
  connector_name: string | null;
  connector_board: string | null;
  upstream_company_id: string | null;
  official_careers_url: string | null;
  official_hosts: string[] | null;
  active_jobs: number | null;
};

type ReviewRow = {
  company_name: string;
  status: string | null;
  source_family: string | null;
  total_candidates: number | null;
  processed_candidates: number | null;
  remaining_candidates: number | null;
};

const EXECUTABLE_SOURCE_TYPES = new Set([
  'workday',
  'amazon_jobs',
  'apple_official_api',
  'google_careers',
  'microsoft_careers',
  'meta_careers',
]);

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function configurationState(row: SourceRow): 'configured_connector' | 'source_family_identified' | 'discovery_required' {
  if (row.status === 'configured_connector') return 'configured_connector';
  if (row.status === 'source_family_identified') return 'source_family_identified';
  return 'discovery_required';
}

async function main(): Promise<void> {
  const client = getSupabaseClient();
  const [{ data: sourceRows, error: sourceError }, { data: reviewRows, error: reviewError }] = await Promise.all([
    client.from('job_company_sources')
      // Keep this audit compatible with databases that predate the optional
      // upstream-count telemetry migration. Configuration status only needs
      // the source registry's base columns.
      .select('company_name,is_active,status,source_type,source_basis,connector_name,connector_board,upstream_company_id,official_careers_url,official_hosts,active_jobs')
      .eq('is_active', true)
      .order('company_name'),
    client.from('job_historical_field_reviews')
      .select('company_name,status,source_family,total_candidates,processed_candidates,remaining_candidates'),
  ]);
  if (sourceError) throw new Error(`读取来源台账失败: ${sourceError.message}`);
  const reviewTableMissing = reviewError && (
    reviewError.code === '42P01'
    || reviewError.code === 'PGRST205'
    || reviewError.message.toLowerCase().includes('could not find the table')
  );
  if (reviewError && !reviewTableMissing) throw new Error(`读取历史复核队列失败: ${reviewError.message}`);

  const reviews = new Map<string, ReviewRow>((reviewRows || []).map((row) => [row.company_name, row as ReviewRow]));
  const companies = (sourceRows || []).map((raw) => {
    const row = raw as SourceRow;
    const state = configurationState(row);
    const review = reviews.get(row.company_name) || null;
    const sourceType = row.source_type || 'unknown';
    return {
      company: row.company_name,
      active_jobs: asNumber(row.active_jobs),
      state,
      source_type: sourceType,
      source_basis: row.source_basis,
      connector_name: row.connector_name,
      connector_board: row.connector_board,
      executable_source: state !== 'discovery_required' && (Boolean(row.connector_name) || EXECUTABLE_SOURCE_TYPES.has(sourceType)),
      official_metadata_complete: Boolean(row.official_careers_url && row.official_hosts?.length),
      upstream_company_id: row.upstream_company_id,
      official_careers_url: row.official_careers_url,
      official_hosts: row.official_hosts || [],
      review: review ? {
        status: review.status,
        source_family: review.source_family,
        total_candidates: asNumber(review.total_candidates),
        processed_candidates: asNumber(review.processed_candidates),
        remaining_candidates: asNumber(review.remaining_candidates),
      } : null,
      next_action: state === 'discovery_required'
        ? '确认官方 careers URL、ATS/接口、外部岗位 ID 和六项字段，再登记连接器'
        : state === 'source_family_identified' && !row.connector_name
          ? '来源已确认；补齐连接器元数据并完成真实样本 dry-run'
          : '按现有连接器做 dry-run、canary 和周期观察',
    };
  });

  const byState = Object.fromEntries(['configured_connector', 'source_family_identified', 'discovery_required']
    .map((state) => [state, companies.filter((company) => company.state === state).length]));
  console.log(JSON.stringify({
    generated_at: new Date().toISOString(),
    active_companies: companies.length,
    by_state: byState,
    companies,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

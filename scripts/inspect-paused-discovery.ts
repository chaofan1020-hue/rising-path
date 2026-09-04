import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: '.env.local' });

async function main(): Promise<void> {
  const client = getSupabaseClient();
  const [{ data: sources, error: sourceError }, { data: reviews, error: reviewError }] = await Promise.all([
    client.from('job_company_sources').select('company_name,status,source_type,source_basis,connector_name,upstream_company_id,official_careers_url,official_hosts,detail_required,active_jobs,last_error,last_attempted_at,last_success_at,next_retry_at').eq('is_active', true).order('company_name'),
    client.from('job_historical_field_reviews').select('company_name,status,source_family,last_error,total_candidates,processed_candidates,remaining_candidates,next_run_at,lease_expires_at').order('company_name'),
  ]);
  if (sourceError) throw new Error(`读取来源台账失败: ${sourceError.message}`);
  if (reviewError && reviewError.code !== '42P01') throw new Error(`读取历史复核队列失败: ${reviewError.message}`);
  const reviewMap = new Map((reviews || []).map((row) => [row.company_name, row]));
  const rows = (sources || []).filter((row) => row.status === 'discovery_required' || reviewMap.get(row.company_name)?.status === 'paused').map((row) => ({
    company: row.company_name,
    source_status: row.status,
    source_type: row.source_type,
    source_basis: row.source_basis,
    connector: row.connector_name,
    upstream_id: row.upstream_company_id,
    careers_url: row.official_careers_url,
    hosts: row.official_hosts,
    detail_required: row.detail_required,
    active_jobs: row.active_jobs,
    source_error: row.last_error,
    review: reviewMap.get(row.company_name) || null,
  }));
  const groups = new Map<string, string[]>();
  const statusGroups = new Map<string, string[]>();
  for (const row of rows) {
    const reason = row.review?.last_error || row.source_status;
    const list = groups.get(reason) || [];
    list.push(`${row.company} (${row.active_jobs})`);
    groups.set(reason, list);
    const statusKey = `${row.source_status} / ${row.review?.status || '无复核队列'}`;
    const statusList = statusGroups.get(statusKey) || [];
    statusList.push(row.company);
    statusGroups.set(statusKey, statusList);
  }
  console.log(JSON.stringify({ count: rows.length, by_reason: Object.fromEntries(groups), by_status: Object.fromEntries(statusGroups) }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: process.env.ENV_FILE || '.env.local', override: true });

type Repair = {
  company: string;
  sourceSystem: string;
  status: 'completed' | 'paused';
  reason: string | null;
  total?: number;
  processed?: number;
  remaining?: number;
  updated?: number;
  skipped?: number;
};

const repairs: Repair[] = [
  {
    company: 'Lazard',
    sourceSystem: 'historical:registered_connector:Lazard',
    status: 'completed',
    reason: null,
    total: 36,
    processed: 36,
    remaining: 0,
    updated: 36,
    skipped: 0,
  },
  {
    company: 'Jefferies',
    sourceSystem: 'historical:registered_connector:Jefferies',
    status: 'completed',
    reason: null,
    total: 158,
    processed: 105,
    remaining: 0,
    updated: 105,
    skipped: 53,
  },
  {
    company: 'Oliver Wyman',
    sourceSystem: 'historical:registered_connector:Oliver Wyman',
    status: 'completed',
    reason: null,
    total: 189,
    processed: 160,
    remaining: 0,
    updated: 160,
    skipped: 29,
  },
  {
    company: 'JPMorgan Chase',
    sourceSystem: 'historical:registered_connector:JPMorgan Chase',
    status: 'paused',
    reason: 'Oracle HCM 全量对账尚未完成，暂不启动历史字段回填',
  },
];

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('job_historical_field_reviews')
    .select('id,company_name,status,source_family,source_system,cursor_job_id,total_candidates,processed_candidates,remaining_candidates,updated_jobs,skipped_jobs,last_error')
    .in('company_name', repairs.map((repair) => repair.company));
  if (error) throw new Error(`读取历史复核队列失败: ${error.message}`);

  const byCompany = new Map((data || []).map((row) => [row.company_name, row]));
  const results: unknown[] = [];
  for (const repair of repairs) {
    const current = byCompany.get(repair.company);
    if (!current) {
      results.push({ company: repair.company, action: 'skipped', reason: '未找到队列记录' });
      continue;
    }
    const isExpectedStale = current.status === 'paused'
      && ((current.last_error === '来源待探测' && current.source_family === 'discovery_required')
        || (repair.company === 'Oliver Wyman'
          && repair.status === 'completed'
          && current.last_error === '官方详情复核未启用写入开关'
          && current.source_family === 'registered_connector'
          && Number(current.remaining_candidates) === 0));
    if (!isExpectedStale) {
      results.push({ company: repair.company, action: 'skipped', reason: '当前状态已变化，未覆盖', current });
      continue;
    }

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      source_family: 'registered_connector',
      source_system: repair.sourceSystem,
      status: repair.status,
      last_error: repair.reason,
      lease_owner: null,
      lease_expires_at: null,
      updated_at: now,
    };
    if (repair.status === 'completed') {
      Object.assign(patch, {
        total_candidates: repair.total,
        processed_candidates: repair.processed,
        remaining_candidates: repair.remaining,
        updated_jobs: repair.updated,
        skipped_jobs: repair.skipped,
        failed_jobs: 0,
        completed_at: now,
      });
    } else {
      patch.next_run_at = now;
    }
    if (write) {
      const { data: updated, error: updateError } = await client
        .from('job_historical_field_reviews')
        .update(patch)
        .eq('id', current.id)
        .eq('status', 'paused')
        .select('company_name,status,source_family,source_system,total_candidates,processed_candidates,remaining_candidates,updated_jobs,skipped_jobs,last_error')
        .maybeSingle();
      if (updateError) throw new Error(`${repair.company}: 更新队列失败: ${updateError.message}`);
      results.push({ company: repair.company, action: updated ? 'updated' : 'race_skipped', row: updated });
    } else {
      results.push({ company: repair.company, action: 'would_update', patch });
    }
  }
  console.log(JSON.stringify({ write, results }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

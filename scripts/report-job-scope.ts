import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getTargetRegion } from '@/lib/job-region-scope';

loadDotenv({ path: '.env.local' });

const PAGE_SIZE = 1000;
const CONTENT_FIELDS = ['description', 'overview', 'responsibilities', 'requirements', 'nice_to_have'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function main() {
  const client = getSupabaseClient();
  const allRows: Array<Record<string, unknown>> = [];
  let offset = 0;
  while (true) {
    const { data, error } = await client
      .from('jobs')
      .select(`id,region,is_active,${CONTENT_FIELDS.join(',')}`)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows: Array<Record<string, unknown>> = Array.isArray(data)
      ? (data as unknown[]).filter(isRecord)
      : [];
    allRows.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const byRegion = new Map<string, number>();
  const activeByRegion = new Map<string, number>();
  const residual: Array<{ id: unknown; fields: string[] }> = [];
  const tagPattern = /<\/?(?:b|strong|p|div|br|li|ul|ol|h[1-6]|span|script|style)\b|&(?:lt|gt|amp|quot|nbsp);/i;
  for (const row of allRows) {
    const region = String(row.region || '未注明');
    byRegion.set(region, (byRegion.get(region) || 0) + 1);
    if (row.is_active === true) activeByRegion.set(region, (activeByRegion.get(region) || 0) + 1);
    const fields = CONTENT_FIELDS.filter((field) => typeof row[field] === 'string' && tagPattern.test(row[field] as string));
    if (fields.length) residual.push({ id: row.id, fields });
  }

  const targetRows = allRows.filter((row) => getTargetRegion(String(row.region || ''), '') !== null);
  const activeTargetRows = targetRows.filter((row) => row.is_active === true);
  console.log(JSON.stringify({
    total: allRows.length,
    active: allRows.filter((row) => row.is_active === true).length,
    target_total: targetRows.length,
    target_active: activeTargetRows.length,
    by_region: Object.fromEntries([...byRegion.entries()].sort((a, b) => b[1] - a[1])),
    active_by_region: Object.fromEntries([...activeByRegion.entries()].sort((a, b) => b[1] - a[1])),
    residual_html_count: residual.length,
    residual_html_sample: residual.slice(0, 20),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

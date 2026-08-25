import { config as loadDotenv } from 'dotenv';
import { jobHtmlToPlainText } from '@/lib/job-content';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: '.env.local' });

const CONTENT_FIELDS = ['description', 'overview', 'responsibilities', 'requirements', 'nice_to_have'] as const;
const PAGE_SIZE = 1000;
const UPDATE_CONCURRENCY = 25;

function cleanField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = jobHtmlToPlainText(value);
  return cleaned === value ? null : cleaned;
}

async function main() {
  const client = getSupabaseClient();
  let offset = 0;
  let scanned = 0;
  let updated = 0;

  while (true) {
    const { data, error } = await client
      .from('jobs')
      .select(`id, ${CONTENT_FIELDS.join(', ')}`)
      // Existing feed rows are already plain text in the normal path. Limit
      // the backfill to common UTF-8/Windows-1252 mojibake markers so a
      // 40k-row catalog does not needlessly re-read every long description.
      .or(CONTENT_FIELDS.flatMap((field) => (
        ['Ã', 'Â', 'â', 'æ', 'ð', '�'].map((marker) => `${field}.ilike.%${marker}%`)
      )).join(','))
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`读取岗位内容失败: ${error.message}`);

    const jobs = (data || []) as unknown as Array<{ id: number } & Record<string, unknown>>;
    scanned += jobs.length;
    console.log(JSON.stringify({ phase: 'scan', offset, batch: jobs.length, scanned, updated }));
    const updates = jobs.map((job) => {
      const changes: Record<string, string> = {};
      for (const field of CONTENT_FIELDS) {
        const cleaned = cleanField(job[field]);
        if (cleaned !== null) changes[field] = cleaned;
      }
      if (Object.keys(changes).length === 0) return null;
      return { id: job.id, changes };
    }).filter((update): update is { id: number; changes: Record<string, string> } => update !== null);

    for (let index = 0; index < updates.length; index += UPDATE_CONCURRENCY) {
      const batch = updates.slice(index, index + UPDATE_CONCURRENCY);
      await Promise.all(batch.map(async ({ id, changes }) => {
        const { error: updateError } = await client
          .from('jobs')
          .update({ ...changes, updated_at: new Date().toISOString() })
          .eq('id', id);
        if (updateError) throw new Error(`清理岗位 ${id} 失败: ${updateError.message}`);
      }));
      updated += batch.length;
      console.log(JSON.stringify({ phase: 'update', offset, batchUpdated: batch.length, scanned, updated }));
    }

    if (jobs.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  console.log(JSON.stringify({ scanned, updated }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : '岗位 HTML 清理失败');
  process.exitCode = 1;
});

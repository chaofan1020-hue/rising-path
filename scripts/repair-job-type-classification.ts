import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '../src/storage/database/supabase-client';

loadDotenv({ path: process.env.NODE_ENV === 'production' ? '.env.local' : '.env.local' });

type JobRow = {
  id: number;
  title: string | null;
  employment_type: string | null;
  description: string | null;
  requirements: string | null;
  job_type: string | null;
  employment_category: string | null;
};

function classify(row: JobRow): '实习' | '校招' | '社招' | null {
  const value = [row.title, row.employment_type].filter(Boolean).join(' ').toLowerCase();
  // Boundaries are required: international/internal are not internships.
  const internship = /\b(?:intern|internship|co-?op)\b|\bsummer\s+(?:analyst|associate|intern)\b/.test(value);
  const campus = /\b(?:graduate|new\s+grad(?:uate)?|entry[- ]?level|campus|early\s+career|full[- ]?time\s+analyst(?:\s+program)?)\b/.test(value);
  const experienced = /\b(?:experienced|professional|senior|manager|director|full[- ]?time|vice\s+president|vp|associate|lead|principal|recruiter|auditor)\b/.test(value);
  if (internship) return '实习';
  // A campus/early-career program with no seniority marker is a valid
  // entry-level role even when its title contains "full-time".
  if (campus && !/\b(?:senior|sr\.?|manager|director|vice\s+president|vp|head\s+of|chief|recruiter)\b/.test(value)) return '校招';
  if (experienced) return '社招';
  if (campus) return '校招';
  return null;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const client = getSupabaseClient();
  const rows: JobRow[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client
      .from('jobs')
      .select('id,title,employment_type,description,requirements,job_type,employment_category')
      .eq('is_active', true)
      .in('job_type', ['实习', '校招'])
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`读取岗位失败: ${error.message}`);
    rows.push(...((data || []) as JobRow[]));
    if (!data || data.length < pageSize) break;
  }

  const changes = rows
    .map((row) => ({ row, next: classify(row) }))
    // Only repair the high-confidence false-positive path that caused the
    // incident: rows labelled internship but carrying an experienced title.
    // Campus/early-career labels can be legitimate programs and remain for a
    // later company-specific review.
    .filter(({ row, next }) => row.job_type === '实习' && next === '社招');

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', scanned: rows.length, changes: changes.length,
    sample: changes.slice(0, 30).map(({ row, next }) => ({ id: row.id, company: row.title, from: row.job_type, to: next })) }, null, 2));

  if (!apply) return;
  // All current repairs are the same high-confidence transition (internship
  // false-positive -> social). Batch them to avoid a long sequence of HTTP
  // requests being interrupted by the deployment command timeout.
  for (let index = 0; index < changes.length; index += 100) {
    const batch = changes.slice(index, index + 100);
    const { error } = await client
      .from('jobs')
      .update({ job_type: '社招', employment_category: '社招' })
      .in('id', batch.map(({ row }) => row.id));
    if (error) throw new Error(`批量更新岗位失败: ${error.message}`);
  }
  console.log(`已修复 ${changes.length} 条岗位分类，未修改 is_active 或岗位内容`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

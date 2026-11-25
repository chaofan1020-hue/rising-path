import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { isDisplayableJobDescription, jobHtmlToPlainText } from '@/lib/job-content';
import { jobReadTable } from '@/lib/job-read-source';

// 岗位描述检索：只查站内岗位库，不依赖任何外部搜索服务。
// 站内 23 万岗位中 98% 自带完整 JD，比联网搜索更稳定、零成本、零延迟。
//
// POST { jobId }                       → 取该岗位的 JD（选中站内岗位时用）
// POST { company, position, region? }  → 按公司 + 岗位检索站内最匹配的 JD（手动模式用）
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const JD_COLUMNS = 'id,title,company,region,description,requirements,job_url';
const MIN_JD_LENGTH = 120;
const MAX_JD_LENGTH = 12000;
const MATCH_LIMIT = 5;

type JobRow = {
  id: number;
  title: string | null;
  company: string | null;
  region: string | null;
  description: string | null;
  requirements: string | null;
  job_url: string | null;
};

type MatchQuality = 'exact' | 'company' | 'position' | 'none';

type JdPayload = {
  success: boolean;
  jdContent: string;
  length: number;
  source: {
    kind: 'internal';
    jobId: number;
    title: string;
    company: string;
    region: string;
    url: string | null;
  } | null;
  matchQuality: MatchQuality;
  matches: Array<{ id: number; title: string; company: string; region: string }>;
  error?: string;
};

/** PostgREST `ilike` 模式里的保留字符必须转义，否则 ( ) , % _ 会被当成语法。 */
function escapePostgrestSearchTerm(value: string): string {
  return value
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/[(),]/g, (character) => `\\${character}`)
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

function cleanText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  // description 可能是 HTML；jobHtmlToPlainText 对纯文本是幂等的。
  return jobHtmlToPlainText(trimmed).trim();
}

/** 把 description + requirements 合成一段可直接喂给模型的 JD 文本。 */
function composeJd(job: JobRow): string {
  const description = cleanText(job.description);
  const requirements = cleanText(job.requirements);
  const parts: string[] = [];
  if (description) parts.push(description);
  if (requirements && !description.includes(requirements)) {
    parts.push(`【任职要求】\n${requirements}`);
  }
  return parts.join('\n\n').trim().slice(0, MAX_JD_LENGTH);
}

function toSource(job: JobRow) {
  return {
    kind: 'internal' as const,
    jobId: job.id,
    title: (job.title || '').trim(),
    company: (job.company || '').trim(),
    region: (job.region || '').trim(),
    url: job.job_url || null,
  };
}

async function loadJobById(jobId: number): Promise<JobRow | null> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from(jobReadTable())
    .select(JD_COLUMNS)
    .eq('id', jobId)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw new Error(`查询岗位失败: ${error.message}`);
  return (data as JobRow | null) ?? null;
}

async function searchJobs(
  filters: { company?: string; title?: string },
  limit: number,
): Promise<JobRow[]> {
  const client = getSupabaseClient();
  let query = client
    .from(jobReadTable())
    .select(JD_COLUMNS)
    .eq('is_active', true)
    .eq('is_closed', false);

  if (filters.company) {
    query = query.ilike('company', `%${escapePostgrestSearchTerm(filters.company)}%`);
  }
  if (filters.title) {
    query = query.ilike('title', `%${escapePostgrestSearchTerm(filters.title)}%`);
  }

  // 优先取描述更完整的行（trgm 索引已覆盖 company / title）
  const { data, error } = await query.limit(limit * 6);
  if (error) throw new Error(`检索岗位失败: ${error.message}`);
  return (data as JobRow[] | null) ?? [];
}

/** 从候选里挑 JD 最完整的一条，并给出匹配质量。 */
function pickBest(rows: JobRow[]): { job: JobRow; jd: string } | null {
  const scored = rows
    .map((row) => ({ row, jd: composeJd(row) }))
    .filter((item) => item.jd.length >= MIN_JD_LENGTH && isDisplayableJobDescription(item.jd))
    .sort((a, b) => b.jd.length - a.jd.length);
  return scored.length > 0 ? { job: scored[0].row, jd: scored[0].jd } : null;
}

function emptyPayload(error: string, matchQuality: MatchQuality = 'none'): JdPayload {
  return {
    success: false,
    jdContent: '',
    length: 0,
    source: null,
    matchQuality,
    matches: [],
    error,
  };
}

export async function POST(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorizedResponse();

  let body: { jobId?: unknown; company?: unknown; position?: unknown; region?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(emptyPayload('请求格式不正确'), { status: 400 });
  }

  const jobIdRaw = body.jobId;
  const jobId = typeof jobIdRaw === 'number'
    ? jobIdRaw
    : typeof jobIdRaw === 'string' && /^\d+$/.test(jobIdRaw.trim())
      ? Number(jobIdRaw.trim())
      : null;
  const company = typeof body.company === 'string' ? body.company.trim() : '';
  const position = typeof body.position === 'string' ? body.position.trim() : '';

  try {
    // ---- 模式 A：按 jobId 取指定岗位的 JD ----
    if (jobId !== null && Number.isInteger(jobId) && jobId > 0) {
      const job = await loadJobById(jobId);
      if (!job) {
        return NextResponse.json(emptyPayload('该岗位不存在或已下架，已转为手动填写'));
      }
      const jd = composeJd(job);
      if (jd.length < MIN_JD_LENGTH) {
        return NextResponse.json({
          ...emptyPayload('该岗位暂无完整岗位描述，可手动粘贴 JD'),
          source: toSource(job),
        });
      }
      return NextResponse.json({
        success: true,
        jdContent: jd,
        length: jd.length,
        source: toSource(job),
        matchQuality: 'exact' as MatchQuality,
        matches: [],
      } satisfies JdPayload);
    }

    // ---- 模式 B：按公司 + 岗位检索站内 JD ----
    if (!company && !position) {
      return NextResponse.json(emptyPayload('请先填写目标公司与目标岗位'), { status: 400 });
    }

    const attempts: Array<{ filters: { company?: string; title?: string }; quality: MatchQuality }> = [];
    if (company && position) {
      attempts.push({ filters: { company, title: position }, quality: 'exact' });
      attempts.push({ filters: { company }, quality: 'company' });
      attempts.push({ filters: { title: position }, quality: 'position' });
    } else if (company) {
      attempts.push({ filters: { company }, quality: 'company' });
    } else {
      attempts.push({ filters: { title: position }, quality: 'position' });
    }

    const seen = new Set<number>();
    const collected: JobRow[] = [];

    for (const attempt of attempts) {
      const rows = await searchJobs(attempt.filters, MATCH_LIMIT);
      if (rows.length === 0) continue;
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        collected.push(row);
      }
      const best = pickBest(rows);
      if (best) {
        const matches = rows
          .filter((row) => row.id !== best.job.id)
          .slice(0, MATCH_LIMIT - 1)
          .map((row) => ({
            id: row.id,
            title: (row.title || '').trim(),
            company: (row.company || '').trim(),
            region: (row.region || '').trim(),
          }));
        return NextResponse.json({
          success: true,
          jdContent: best.jd,
          length: best.jd.length,
          source: toSource(best.job),
          matchQuality: attempt.quality,
          matches,
        } satisfies JdPayload);
      }
    }

    const label = [company, position].filter(Boolean).join(' · ');
    return NextResponse.json(
      emptyPayload(
        seen.size > 0
          ? `站内找到了 ${label} 的岗位，但都没有可用的完整 JD，请手动粘贴`
          : `站内暂未收录「${label}」的岗位描述，请手动粘贴 JD`,
      ),
    );
  } catch (error) {
    console.error('[search-jd] failed:', error);
    return NextResponse.json(emptyPayload('检索岗位描述失败，请稍后重试'), { status: 500 });
  }
}

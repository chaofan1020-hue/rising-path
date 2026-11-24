import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { parseExperience, text } from '@/lib/job-connectors/utils';

const envFile = process.env.ENV_FILE || process.env.DOTENV_CONFIG_PATH || '.env.local';
loadDotenv({ path: envFile, override: true });

type JobRow = {
  id: number;
  title: string;
  company: string;
  job_url: string | null;
  description: string | null;
  requirements: string | null;
  employment_category: string | null;
  experience_min_years: number | null;
  experience_max_years: number | null;
  experience_text: string | null;
  is_active: boolean | null;
  is_closed: boolean | null;
  field_evidence: Record<string, unknown> | null;
};

const PAGE_SIZE = 200;
const WRITE_BATCH = 20;
const EXPECTED_PRODUCTION_REF = process.env.EXPECTED_SUPABASE_PROJECT_REF || 'weqvdtdjdzmqflhwobec';
// Self-hosted instances have no `<ref>.supabase.co` hostname, so writes must
// state their expected host explicitly instead of relying on the managed ref.
const EXPECTED_PRODUCTION_HOST = process.env.EXPECTED_SUPABASE_HOST
  || `${EXPECTED_PRODUCTION_REF}.supabase.co`;

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() || null : null;
}

function sameNumber(left: number | null, right: number | null): boolean {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return Number(left) === Number(right);
}

function isCampusJob(job: JobRow): boolean {
  return job.employment_category === '实习'
    || job.employment_category === '校招'
    || /\bintern|co-?op|new\s+grad/i.test(job.title || '');
}

function parsedExperience(job: JobRow): { min: number | null; max: number | null; text: string | null } {
  const official = parseExperience([job.title, job.requirements, job.description]);
  if (official.min != null || official.max != null) return official;
  if (!looksLikeCompanyHistory(job.experience_text)) {
    const fromStored = parseExperience([job.title, job.experience_text]);
    if (fromStored.min != null || fromStored.max != null) return fromStored;
  }
  return official;
}

function shouldRewrite(job: JobRow, parsed: { min: number | null; max: number | null; text: string | null }): boolean {
  const yearsChanged = !sameNumber(job.experience_min_years, parsed.min)
    || !sameNumber(job.experience_max_years, parsed.max);
  if (!yearsChanged) return false;
  const storedHigh = Math.max(job.experience_min_years ?? 0, job.experience_max_years ?? 0);
  const storedHistory = looksLikeCompanyHistory(job.experience_text)
    || looksLikeCompanyHistory(job.requirements)
    || looksLikeCompanyHistory(job.description)
    || job.experience_min_years === 40
    || job.experience_max_years === 40;
  if (isCampusJob(job) && storedHigh >= 8) return true;
  if (storedHistory && storedHigh >= 20) return true;
  return false;
}

function looksLikeCompanyHistory(textValue: string | null): boolean {
  const snippet = text(textValue);
  if (!snippet) return false;
  return /\bwe(?:['’]ve| have)\s+been\b/i.test(snippet) && /\bfor\s+\d+(?:\.\d+)?\s+years?\b/i.test(snippet)
    || /\binnovating\b.{0,80}\bfor\s+\d+(?:\.\d+)?\s+years?\b/i.test(snippet)
    || /\bfor\s+\d+(?:\.\d+)?\s+years?\s+to\s+(?:create|build|deliver|help|power)\b/i.test(snippet)
    || /\b(?:more than|over)\s+\d+(?:\.\d+)?\s+years?\s+of\s+(?:investing|investment|operating|industry|company|firm|business|financial)\s+experience\b/i.test(snippet);
}

function experienceEvidence(job: JobRow, parsed: { min: number | null; max: number | null; text: string | null }, now: string): Record<string, unknown> {
  const current = job.field_evidence && typeof job.field_evidence === 'object' ? job.field_evidence : {};
  const fields = current.fields && typeof current.fields === 'object' && !Array.isArray(current.fields)
    ? current.fields as Record<string, unknown>
    : {};
  const hasValue = parsed.min != null || parsed.max != null || Boolean(text(parsed.text));
  return {
    ...current,
    version: typeof current.version === 'number' ? current.version : 1,
    source_url: job.job_url || current.source_url || null,
    fields: {
      ...fields,
      experience: hasValue
        ? {
            status: 'verified',
            source: 'official_link_description',
            evidence_url: job.job_url,
            evidence_kind: 'official_detail_page',
            verified_at: now,
          }
        : {
            status: 'unavailable_on_official_source',
            source: 'official_link_description',
            evidence_url: job.job_url,
            evidence_kind: 'official_detail_page',
            verified_at: now,
            rejected_reason: '官网正文是公司历史年限，不是候选人经验要求',
          },
    },
  };
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  if (write && process.env.CISCO_EXPERIENCE_REPARSE_WRITE_ENABLED !== 'true') {
    throw new Error('写入默认关闭；请同时设置 CISCO_EXPERIENCE_REPARSE_WRITE_ENABLED=true 和 --write');
  }

  const company = argument('company') || 'Cisco';
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const host = (() => { try { return new URL(supabaseUrl).hostname || 'unknown'; } catch { return 'unknown'; } })();
  if (write && host !== EXPECTED_PRODUCTION_HOST) {
    throw new Error(`refusing write to non-production host: ${host} (expected ${EXPECTED_PRODUCTION_HOST})`);
  }

  const limit = Number.parseInt(argument('limit') || '', 10);
  const client = getSupabaseClient();
  const rows: JobRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = client
      .from('jobs')
      .select('id,title,company,job_url,description,requirements,employment_category,experience_min_years,experience_max_years,experience_text,is_active,is_closed,field_evidence')
      .eq('company', company)
      .eq('is_active', true)
      .or('experience_min_years.not.is.null,experience_max_years.not.is.null,experience_text.not.is.null')
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    const { data, error } = await query;
    if (error) throw error;
    const batch = (data || []) as JobRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    if (Number.isFinite(limit) && rows.length >= limit) break;
  }

  const now = new Date().toISOString();
  const candidates = rows.flatMap((job) => {
    const parsed = parsedExperience(job);
    const storedHistory = looksLikeCompanyHistory(job.experience_text)
      || looksLikeCompanyHistory(job.requirements)
      || looksLikeCompanyHistory(job.description);
    if (!shouldRewrite(job, parsed)) {
      return [];
    }
    return [{
      id: job.id,
      title: job.title,
      employment_category: job.employment_category,
      is_active: job.is_active,
      is_closed: job.is_closed,
      before: {
        min: job.experience_min_years,
        max: job.experience_max_years,
        text: text(job.experience_text).slice(0, 180) || null,
      },
      after: {
        min: parsed.min,
        max: parsed.max,
        text: text(parsed.text).slice(0, 180) || null,
      },
      company_history: storedHistory,
      row: job,
      parsed,
    }];
  });

  const result = {
    env_file: envFile,
    supabase_host: host,
    company,
    scanned: rows.length,
    candidates: candidates.length,
    intern_or_campus: candidates.filter((item) => item.employment_category === '实习' || item.employment_category === '校招' || /\bintern|co-?op|new grad/i.test(item.title)).length,
    clear_to_null: candidates.filter((item) => item.after.min == null && item.after.max == null).length,
    replace_with_other_years: candidates.filter((item) => item.after.min != null || item.after.max != null).length,
    samples: candidates.slice(0, 12).map(({ row, parsed, ...sample }) => sample),
    dry_run: !write,
    updated: 0,
  };

  if (!write) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  for (let index = 0; index < candidates.length; index += WRITE_BATCH) {
    const batch = candidates.slice(index, index + WRITE_BATCH);
    await Promise.all(batch.map(async (candidate) => {
      const { error } = await client
        .from('jobs')
        .update({
          experience_min_years: candidate.parsed.min,
          experience_max_years: candidate.parsed.max,
          experience_text: candidate.parsed.text,
          field_evidence: experienceEvidence(candidate.row, candidate.parsed, now),
          updated_at: now,
        })
        .eq('id', candidate.id)
        .eq('company', company)
        .eq('is_active', true);
      if (error) throw new Error(`更新岗位 ${candidate.id} 失败: ${error.message}`);
      result.updated += 1;
    }));
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});

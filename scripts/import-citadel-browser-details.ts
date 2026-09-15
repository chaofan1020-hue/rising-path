import { config as loadDotenv } from 'dotenv';
import { readFile } from 'node:fs/promises';

import { jobHtmlToPlainText, isDisplayableJobDescription } from '@/lib/job-content';
import { getSupabaseClient } from '@/storage/database/supabase-client';

type BrowserDetail = {
  id?: number;
  job_url: string;
  title?: string;
  description: string;
  requirements?: string | null;
  responsibilities?: string | null;
  captured_at?: string;
};

type JobRow = {
  id: number;
  title: string;
  company: string;
  job_url: string | null;
  description: string | null;
  requirements: string | null;
  responsibilities: string | null;
  field_evidence: Record<string, unknown> | null;
};

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() || null : null;
}

function isCitadelCareerUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname.toLowerCase() === 'www.citadel.com'
      && /^\/careers\/details\/[^/]+\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function normalized(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = jobHtmlToPlainText(value);
  return text.trim() || null;
}

function evidence(
  row: JobRow,
  capturedAt: string,
  sourceUrl: string,
  importedFields: string[],
): Record<string, unknown> {
  const current = row.field_evidence && typeof row.field_evidence === 'object' ? row.field_evidence : {};
  const fields = current.fields && typeof current.fields === 'object' && !Array.isArray(current.fields)
    ? current.fields as Record<string, unknown>
    : {};
  const verifiedField = () => ({
    source: 'official_browser_detail',
    status: 'verified',
    verified_at: capturedAt,
    evidence_url: sourceUrl,
    evidence_kind: 'official_detail_page',
    capture_method: 'normal_browser',
  });
  const nextFields = { ...fields } as Record<string, unknown>;
  for (const field of importedFields) nextFields[field] = verifiedField();
  return {
    ...current,
    version: typeof current.version === 'number' ? current.version : 1,
    source_type: 'official_ats',
    source_url: sourceUrl,
    fields: nextFields,
  };
}

async function main(): Promise<void> {
  loadDotenv({ path: process.env.DOTENV_CONFIG_PATH || process.env.ENV_FILE || '.env.local' });
  const inputPath = argument('input');
  if (!inputPath) throw new Error('请指定 --input=<browser-export.json>');
  const write = process.argv.includes('--write');
  if (write && process.env.CITADEL_BROWSER_DETAIL_WRITE_ENABLED !== 'true') {
    throw new Error('写入默认关闭；请同时设置 CITADEL_BROWSER_DETAIL_WRITE_ENABLED=true 和 --write');
  }

  const payload = JSON.parse(await readFile(inputPath, 'utf8')) as unknown;
  const items = Array.isArray(payload) ? payload : (payload && typeof payload === 'object' && Array.isArray((payload as { jobs?: unknown }).jobs)
    ? (payload as { jobs: unknown[] }).jobs
    : []);
  if (items.length === 0) throw new Error('输入文件必须是数组，或包含 jobs 数组');

  const details = items.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`第 ${index + 1} 条不是对象`);
    const row = item as BrowserDetail;
    const description = normalized(row.description);
    if (!isCitadelCareerUrl(row.job_url)) throw new Error(`第 ${index + 1} 条不是 Citadel 官方详情 URL`);
    if (!description || description.length < 160 || description.length > 100_000 || !isDisplayableJobDescription(description)) {
      throw new Error(`第 ${index + 1} 条正文过短或不可展示`);
    }
    if (/cloudflare|checking your browser|enable javascript to continue|security verification/i.test(description)) {
      throw new Error(`第 ${index + 1} 条包含反爬验证内容，拒绝导入`);
    }
    const capturedAt = row.captured_at || new Date().toISOString();
    if (!Number.isFinite(Date.parse(capturedAt))) throw new Error(`第 ${index + 1} 条 captured_at 不是有效时间`);
    return {
      ...row,
      description,
      requirements: normalized(row.requirements),
      responsibilities: normalized(row.responsibilities),
      captured_at: capturedAt,
    } satisfies BrowserDetail;
  });

  const client = getSupabaseClient();
  const urls = details.map((item) => item.job_url);
  const { data, error } = await client
    .from('jobs')
    .select('id,title,company,job_url,description,requirements,responsibilities,field_evidence')
    .eq('company', 'Citadel')
    .eq('is_active', true)
    .in('job_url', urls);
  if (error) throw new Error(`读取 Citadel 岗位失败: ${error.message}`);
  const jobs = (data || []) as JobRow[];
  const byUrl = new Map(jobs.map((job) => [job.job_url, job]));
  const result = { mode: write ? 'write' : 'dry_run', input_count: details.length, matched: 0, would_update: 0, updated: 0, skipped: [] as Array<{ job_url: string; reason: string }> };

  for (const item of details) {
    const job = byUrl.get(item.job_url);
    if (!job) {
      result.skipped.push({ job_url: item.job_url, reason: 'active Citadel 岗位不存在' });
      continue;
    }
    result.matched += 1;
    if (job.description && isDisplayableJobDescription(job.description) && job.description.trim().length >= 160) {
      result.skipped.push({ job_url: item.job_url, reason: '已有可展示正文，默认不覆盖' });
      continue;
    }
    const capturedAt = item.captured_at!;
    const importedFields = ['description'];
    const patch: Record<string, unknown> = {
      description: item.description,
      updated_at: capturedAt,
    };
    if (!job.requirements && item.requirements) {
      patch.requirements = item.requirements;
      importedFields.push('requirements');
    }
    if (!job.responsibilities && item.responsibilities) {
      patch.responsibilities = item.responsibilities;
      importedFields.push('responsibilities');
    }
    patch.field_evidence = evidence(job, capturedAt, item.job_url, importedFields);
    result.would_update += 1;
    if (!write) continue;
    const { data: updated, error: updateError } = await client
      .from('jobs')
      .update(patch)
      .eq('id', job.id)
      .eq('company', 'Citadel')
      .eq('is_active', true)
      .select('id');
    if (updateError) throw new Error(`更新 Citadel 岗位 ${job.id} 失败: ${updateError.message}`);
    if (updated?.length) result.updated += 1;
  }

  console.log(JSON.stringify({ generated_at: new Date().toISOString(), ...result }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

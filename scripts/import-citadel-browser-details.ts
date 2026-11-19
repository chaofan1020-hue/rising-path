import { config as loadDotenv } from 'dotenv';
import { readFile } from 'node:fs/promises';

import { citadelExternalId, citadelSlugTitle, normalizeCitadelCareerUrl } from '@/lib/citadel-official';
import { jobHtmlToPlainText, isDisplayableJobDescription } from '@/lib/job-content';
import { JOBS_FEED_SOURCE, normalizeFeedItem } from '@/lib/jobs-feed';
import { isTargetRegion } from '@/lib/job-region-scope';
import { getSupabaseClient } from '@/storage/database/supabase-client';

type BrowserDetail = {
  id?: number;
  job_url: string;
  title?: string;
  description: string;
  location?: string | null;
  region?: string | null;
  requirements?: string | null;
  responsibilities?: string | null;
  captured_at?: string;
};

type JobRow = {
  id: number;
  title: string;
  company: string;
  job_url: string | null;
  source_url: string | null;
  description: string | null;
  requirements: string | null;
  responsibilities: string | null;
  region: string | null;
  is_active: boolean | null;
  is_closed: boolean | null;
  field_evidence: Record<string, unknown> | null;
};

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() || null : null;
}

function normalized(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = jobHtmlToPlainText(value);
  return text.trim() || null;
}

function canonicalKey(value: string | null | undefined): string | null {
  return normalizeCitadelCareerUrl(value);
}

function evidence(
  row: JobRow | null,
  capturedAt: string,
  sourceUrl: string,
  importedFields: string[],
): Record<string, unknown> {
  const current = row?.field_evidence && typeof row.field_evidence === 'object' ? row.field_evidence : {};
  const fields = current.fields && typeof current.fields === 'object' && !Array.isArray(current.fields)
    ? current.fields as Record<string, unknown>
    : {};
  const verifiedField = () => ({
    source: 'official_detail_page',
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
    source_type: 'official_browser_detail',
    source_url: sourceUrl,
    fields: nextFields,
  };
}

function parseItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object' && Array.isArray((payload as { jobs?: unknown }).jobs)) {
    return (payload as { jobs: unknown[] }).jobs;
  }
  return [];
}

async function main(): Promise<void> {
  loadDotenv({ path: process.env.DOTENV_CONFIG_PATH || process.env.ENV_FILE || '.env.local' });
  const inputPath = argument('input');
  if (!inputPath) throw new Error('请指定 --input=<browser-export.json>');
  const write = process.argv.includes('--write');
  const allowCreate = process.argv.includes('--create-missing');
  if (write && process.env.CITADEL_BROWSER_DETAIL_WRITE_ENABLED !== 'true') {
    throw new Error('写入默认关闭；请同时设置 CITADEL_BROWSER_DETAIL_WRITE_ENABLED=true 和 --write');
  }

  const payload = JSON.parse(await readFile(inputPath, 'utf8')) as unknown;
  const items = parseItems(payload);
  if (items.length === 0) throw new Error('输入文件必须是数组，或包含 jobs 数组');

  const details = items.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`第 ${index + 1} 条不是对象`);
    const row = item as BrowserDetail;
    const jobUrl = normalizeCitadelCareerUrl(row.job_url);
    const description = normalized(row.description);
    if (!jobUrl) throw new Error(`第 ${index + 1} 条不是 Citadel 官方详情 URL`);
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
      job_url: jobUrl,
      title: normalized(row.title) || citadelSlugTitle(jobUrl),
      description,
      location: normalized(row.location) || normalized(row.region),
      requirements: normalized(row.requirements),
      responsibilities: normalized(row.responsibilities),
      captured_at: capturedAt,
    } satisfies BrowserDetail & { job_url: string; title: string; description: string; captured_at: string };
  });

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('jobs')
    .select('id,title,company,job_url,source_url,description,requirements,responsibilities,region,is_active,is_closed,field_evidence')
    .eq('company', 'Citadel');
  if (error) throw new Error(`读取 Citadel 岗位失败: ${error.message}`);
  const jobs = (data || []) as JobRow[];
  const byUrl = new Map<string, JobRow>();
  for (const job of jobs) {
    const key = canonicalKey(job.job_url) || canonicalKey(job.source_url);
    if (key && !byUrl.has(key)) byUrl.set(key, job);
  }

  const result = {
    mode: write ? 'write' : 'dry_run',
    allow_create: allowCreate,
    input_count: details.length,
    matched: 0,
    would_update: 0,
    updated: 0,
    would_create: 0,
    created: 0,
    skipped: [] as Array<{ job_url: string; reason: string }>,
  };

  for (const item of details) {
    const job = byUrl.get(item.job_url);
    if (job) {
      result.matched += 1;
      if (job.is_closed === true || job.is_active === false) {
        result.skipped.push({ job_url: item.job_url, reason: '岗位已关闭，导入不会重开' });
        continue;
      }
      const importedFields = [] as string[];
      const patch: Record<string, unknown> = { updated_at: item.captured_at };
      if (!(job.description && isDisplayableJobDescription(job.description) && job.description.trim().length >= 160)) {
        patch.description = item.description;
        importedFields.push('description');
      }
      if (!job.requirements && item.requirements) {
        patch.requirements = item.requirements;
        importedFields.push('requirements');
      }
      if (!job.responsibilities && item.responsibilities) {
        patch.responsibilities = item.responsibilities;
        importedFields.push('responsibilities');
      }
      if (importedFields.length === 0) {
        result.skipped.push({ job_url: item.job_url, reason: '已有可展示正文，默认不覆盖' });
        continue;
      }
      patch.field_evidence = evidence(job, item.captured_at!, item.job_url, importedFields);
      result.would_update += 1;
      if (!write) continue;
      const { data: updated, error: updateError } = await client
        .from('jobs')
        .update(patch)
        .eq('id', job.id)
        .eq('company', 'Citadel')
        .eq('is_active', true)
        .eq('is_closed', false)
        .select('id');
      if (updateError) throw new Error(`更新 Citadel 岗位 ${job.id} 失败: ${updateError.message}`);
      if (updated?.length) result.updated += 1;
      continue;
    }

    if (!allowCreate) {
      result.skipped.push({ job_url: item.job_url, reason: 'active Citadel 岗位不存在；需要建岗时加 --create-missing' });
      continue;
    }
    if (!item.location) {
      result.skipped.push({ job_url: item.job_url, reason: '新建岗位缺少官方地点，拒绝猜测' });
      continue;
    }
    if (!isTargetRegion(item.location, null)) {
      result.skipped.push({ job_url: item.job_url, reason: '官方地点不在目标地区，跳过建岗' });
      continue;
    }
    const record = normalizeFeedItem({
      id: citadelExternalId(item.job_url) || item.job_url,
      external_job_id: citadelExternalId(item.job_url),
      company_name: 'Citadel',
      title: item.title,
      description: item.description,
      source_url: item.job_url,
      location: item.location,
      required_skills: item.requirements ? [item.requirements] : null,
      source_evidence: {
        source_type: 'official_browser_detail',
        source_url: item.job_url,
        metadata_quality: 'official_browser_detail',
        detail_status: 'fetched_html',
        structured_field_sources: {
          location: 'official_detail_page',
          description: 'official_detail_page',
        },
      },
    });
    if (!record) {
      result.skipped.push({ job_url: item.job_url, reason: '标准化后不在目标地区，跳过建岗' });
      continue;
    }
    const {
      availability_status: _availabilityStatus,
      link_health: _linkHealth,
      last_link_error: _lastLinkError,
      last_link_http_status: _lastLinkHttpStatus,
      availability_checked_at: _availabilityCheckedAt,
      feed_has_date_posted: _feedHasDatePosted,
      ...payload
    } = record;
    payload.responsibilities = item.responsibilities || payload.responsibilities;
    payload.field_evidence = evidence(null, item.captured_at!, item.job_url, [
      'description',
      'location',
      ...(item.requirements ? ['requirements'] : []),
      ...(item.responsibilities ? ['responsibilities'] : []),
    ]);
    payload.source_system = JOBS_FEED_SOURCE;
    result.would_create += 1;
    if (!write) continue;
    const { data: created, error: createError } = await client
      .from('jobs')
      .insert({ ...payload, last_verified_at: item.captured_at })
      .select('id,job_url');
    if (createError) throw new Error(`创建 Citadel 岗位 ${item.job_url} 失败: ${createError.message}`);
    if (created?.length) {
      result.created += 1;
      byUrl.set(item.job_url, {
        id: created[0].id as number,
        title: item.title!,
        company: 'Citadel',
        job_url: item.job_url,
        source_url: item.job_url,
        description: item.description,
        requirements: item.requirements || null,
        responsibilities: item.responsibilities || null,
        region: item.location || null,
        is_active: true,
        is_closed: false,
        field_evidence: payload.field_evidence as Record<string, unknown>,
      });
    }
  }

  console.log(JSON.stringify({ generated_at: new Date().toISOString(), ...result }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: process.env.DOTENV_CONFIG_PATH || '.env.local' });

type UpstreamCompany = {
  id?: unknown;
  name?: unknown;
  career_url?: unknown;
};

type SourceRow = {
  company_name: string;
  upstream_company_id: string | null;
  official_careers_url: string | null;
  official_hosts: unknown;
  source_hosts: unknown;
  status: string | null;
};

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() || null : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim().toLowerCase());
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).map((item) => item.trim().toLowerCase()).filter(Boolean);
  }
  return [];
}

function sourceBase(value: string): string {
  const endpoint = new URL(value);
  endpoint.pathname = endpoint.pathname.replace(/\/integrations\/v1\/jobs\/?$/, '');
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString().replace(/\/$/, '');
}

function hostOf(value: string | null): string | null {
  if (!value) return null;
  try { return new URL(value).hostname.toLowerCase(); } catch { return null; }
}

async function readUpstreamDirectory(): Promise<UpstreamCompany[]> {
  const feedUrl = process.env.JOBS_FEED_URL;
  const apiKey = process.env.JOBS_FEED_API_KEY || process.env.INTEGRATION_API_KEY;
  if (!feedUrl || !apiKey) throw new Error('缺少 JOBS_FEED_URL 或 JOBS_FEED_API_KEY');
  const response = await fetch(`${sourceBase(feedUrl)}/dashboard/company-directory`, {
    headers: { Accept: 'application/json', 'X-Integration-Key': apiKey },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`上游公司目录返回 HTTP ${response.status}`);
  const value = await response.json() as unknown;
  if (!Array.isArray(value)) throw new Error('上游公司目录必须返回数组');
  return value as UpstreamCompany[];
}

async function main(): Promise<void> {
  const write = hasFlag('write');
  if (write && process.env.SOURCE_MATRIX_WRITE_ENABLED !== 'true') {
    throw new Error('写入默认关闭；请同时设置 SOURCE_MATRIX_WRITE_ENABLED=true 和 --write');
  }
  const target = argument('company')?.toLocaleLowerCase() || null;
  const client = getSupabaseClient();
  const [{ data: sourceRows, error: sourceError }, upstream] = await Promise.all([
    client.from('job_company_sources')
      .select('company_name,upstream_company_id,official_careers_url,official_hosts,source_hosts,status')
      .eq('is_active', true)
      .order('company_name'),
    readUpstreamDirectory(),
  ]);
  if (sourceError) throw new Error(`读取来源台账失败: ${sourceError.message}`);

  const byId = new Map(upstream.map((row) => [text(row.id), row]).filter(([id]) => Boolean(id)) as Array<[string, UpstreamCompany]>);
  const changes: Array<{ company: string; status: string | null; careers_url: string; official_hosts: string[] }> = [];
  const skipped: Array<{ company: string; reason: string }> = [];
  for (const raw of (sourceRows || []) as SourceRow[]) {
    if (target && raw.company_name.toLocaleLowerCase() !== target) continue;
    const upstreamRow = raw.upstream_company_id ? byId.get(raw.upstream_company_id) : null;
    if (!upstreamRow) {
      skipped.push({ company: raw.company_name, reason: '上游目录没有匹配的 company ID' });
      continue;
    }
    const careersUrl = text(upstreamRow.career_url);
    const currentUrl = text(raw.official_careers_url);
    const hosts = new Set([...stringArray(raw.official_hosts), ...stringArray(raw.source_hosts)]);
    const careersHost = hostOf(careersUrl);
    if (careersHost) hosts.add(careersHost);
    if (!careersUrl && hosts.size === 0) {
      skipped.push({ company: raw.company_name, reason: '上游没有 careers URL 或可观测 host' });
      continue;
    }
    const nextUrl = currentUrl || careersUrl;
    const nextHosts = [...hosts].sort();
    const currentHosts = stringArray(raw.official_hosts).sort();
    if ((nextUrl && nextUrl !== currentUrl) || JSON.stringify(nextHosts) !== JSON.stringify(currentHosts)) {
      changes.push({ company: raw.company_name, status: raw.status, careers_url: nextUrl || '', official_hosts: nextHosts });
    }
  }

  const written: string[] = [];
  if (write) {
    for (const change of changes) {
      const { error } = await client.from('job_company_sources').update({
        official_careers_url: change.careers_url || null,
        official_hosts: change.official_hosts,
        updated_at: new Date().toISOString(),
      }).eq('company_name', change.company);
      if (error) throw new Error(`${change.company}: 写入来源元数据失败: ${error.message}`);
      written.push(change.company);
    }
  }

  console.log(JSON.stringify({
    generated_at: new Date().toISOString(),
    mode: write ? 'write' : 'dry_run',
    target: target || 'all_active_companies',
    upstream_companies: upstream.length,
    candidate_changes: changes,
    skipped,
    written,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

import { config as loadDotenv } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isTargetRegion } from '@/lib/job-region-scope';
import { normalizeFeedLocation } from '@/lib/jobs-feed';

loadDotenv({ path: '.env.local' });

const TARGETS: Record<string, string> = {
  Coinbase: 'ed64b120-af7d-4d14-ad94-ce1c479619d7',
  Asana: '8b35aed2-a251-491c-a4b1-ab6bd0ce5cf8',
  Brex: 'bc0e332b-3685-4271-bcd0-60afc955eada',
  Databricks: 'e9997c37-87a5-4cb0-beee-e422b450d3ff',
  Figma: '22c68dc5-5a57-4f21-b9d2-a24146b74aa6',
  GitLab: '58abe230-5fdd-4660-b830-9e423dd04e88',
};

type Item = {
  id?: unknown;
  external_job_id?: unknown;
  company_name?: unknown;
  title?: unknown;
  location?: unknown;
  offices?: unknown;
  official_location?: unknown;
  country?: unknown;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function itemLocation(item: Item): string {
  return [item.location, item.offices, item.official_location].map((value) => normalizeFeedLocation(value)).filter(Boolean).join(', ');
}

async function fetchCompany(feedUrl: string, apiKey: string, companyId: string): Promise<Item[]> {
  const output: Item[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page += 1) {
    const url = new URL(feedUrl);
    url.searchParams.set('limit', '500');
    url.searchParams.set('include_closed', 'false');
    url.searchParams.set('company_id', companyId);
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await fetch(url, { headers: { Accept: 'application/json', 'X-Integration-Key': apiKey }, cache: 'no-store' });
    if (!response.ok) throw new Error(`feed HTTP ${response.status}`);
    const payload = await response.json() as { items?: Item[]; next_cursor?: string | null; has_more?: boolean };
    const items = Array.isArray(payload.items) ? payload.items : [];
    output.push(...items);
    cursor = payload.next_cursor || null;
    if (!payload.has_more || !cursor) break;
  }
  return output;
}

async function siteActiveCount(client: SupabaseClient, company: string): Promise<number> {
  let total = 0;
  for (let offset = 0; ; offset += 1_000) {
    const { data, error } = await client.from('jobs').select('id').eq('source_system', 'collector_feed').eq('company', company).eq('is_active', true).eq('is_closed', false).range(offset, offset + 999);
    if (error) throw new Error(`${company}: ${error.message}`);
    total += data?.length || 0;
    if (!data || data.length < 1_000) break;
  }
  return total;
}

async function main() {
  const feedUrl = process.env.JOBS_FEED_URL || 'https://hfscareer.com/collector-api/integrations/v1/jobs';
  const apiKey = process.env.JOBS_FEED_API_KEY || process.env.INTEGRATION_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!apiKey || !supabaseUrl || !supabaseKey) throw new Error('缺少 feed 或 Supabase 凭据');
  const client = createClient(supabaseUrl, supabaseKey, { db: { timeout: 120_000 }, auth: { persistSession: false, autoRefreshToken: false } });
  await Promise.all(Object.entries(TARGETS).map(async ([company, companyId]) => {
    const items = await fetchCompany(feedUrl, apiKey, companyId);
    const target = items.filter((item) => isTargetRegion(itemLocation(item), text(item.country)));
    const unknown = items.filter((item) => !itemLocation(item) && !text(item.country));
    const site = await siteActiveCount(client, company);
    console.log(JSON.stringify({ company, upstream_open: items.length, upstream_target_region: target.length, upstream_outside_or_unmatched: items.length - target.length, upstream_unknown_location: unknown.length, site_active: site, target_minus_site: target.length - site }));
  }));
}

main().catch((error) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; });

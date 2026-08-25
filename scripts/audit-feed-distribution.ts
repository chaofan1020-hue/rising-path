import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: '.env.local' });

type FeedItem = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

async function fetchFeed(limit: number, includeClosed: boolean): Promise<Record<string, unknown>> {
  const url = new URL(process.env.JOBS_FEED_URL || 'https://hfscareer.com/collector-api/integrations/v1/jobs');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('include_closed', String(includeClosed));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'X-Integration-Key': process.env.JOBS_FEED_API_KEY || '',
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    const body = await response.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(body); } catch { parsed = { raw: body.slice(0, 500) }; }
    return {
      http_status: response.status,
      response_bytes: Buffer.byteLength(body, 'utf8'),
      ...(parsed && typeof parsed === 'object' ? parsed : { body: parsed }),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const client = getSupabaseClient();
  try {
    const { data: companies, error: companiesError } = await client.rpc('list_active_company_options');
    if (companiesError) throw new Error(`读取公司聚合失败: ${companiesError.message}`);
    const companyRows = (companies || []) as Array<{ company_name?: unknown; job_count?: unknown }>;
    const cloudflare = companyRows.find((row) => text(row.company_name).toLowerCase() === 'cloudflare');
    const { count: activeCount, error: activeError } = await client
      .from('jobs')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
      .eq('source_system', 'collector_feed');
    if (activeError) throw new Error(`读取 active 数量失败: ${activeError.message}`);
    const { data: cloudflareJobs, error: jobsError } = await client
      .from('jobs')
      .select('id,title,company,region,job_url,is_active,is_closed,valid_through,updated_at')
      .ilike('company', '%Cloudflare%')
      .order('updated_at', { ascending: false })
      .limit(100);
    if (jobsError) throw new Error(`读取 Cloudflare 岗位失败: ${jobsError.message}`);

    console.log(JSON.stringify({
      database: {
        active_feed_jobs: activeCount,
        active_companies: companyRows.length,
        cloudflare_company_option: cloudflare || null,
        cloudflare_jobs: cloudflareJobs || [],
        top_companies: companyRows.slice(0, 30),
      },
    }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ database: { error: error instanceof Error ? error.message : String(error) } }, null, 2));
  }

  for (const limit of [1, 10, 100]) {
    try {
      const feed = await fetchFeed(limit, false);
      const items = Array.isArray(feed.items) ? feed.items as FeedItem[] : [];
      const companiesInPage = new Map<string, number>();
      for (const item of items) {
        const company = text(item.company_name || item.company || item.employer);
        if (company) companiesInPage.set(company, (companiesInPage.get(company) || 0) + 1);
      }
      console.log(JSON.stringify({
        upstream_probe: {
          requested_limit: limit,
          http_status: feed.http_status,
          received: items.length,
          has_more: feed.has_more,
          next_cursor: feed.next_cursor || null,
          contract_version: feed.contract_version || null,
          cloudflare_count: items.filter((item) => text(item.company_name || item.company || item.employer).toLowerCase().includes('cloudflare')).length,
          top_companies_in_page: [...companiesInPage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20),
        },
      }, null, 2));
    } catch (error) {
      console.log(JSON.stringify({ upstream_probe: { requested_limit: limit, error: error instanceof Error ? error.message : String(error) } }));
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

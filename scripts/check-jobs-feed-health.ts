import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: '.env.local' });

const DEFAULT_FEED_URL = 'https://hfscareer.com/collector-api/integrations/v1/jobs';

async function main() {
  const url = process.env.JOBS_FEED_URL || DEFAULT_FEED_URL;
  const apiKey = process.env.JOBS_FEED_API_KEY || process.env.INTEGRATION_API_KEY;
  if (!apiKey) throw new Error('未配置岗位上游 API 密钥');

  const endpoint = new URL(url);
  endpoint.searchParams.set('limit', '1');
  endpoint.searchParams.set('include_closed', 'true');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(endpoint, {
      headers: { Accept: 'application/json', 'X-Integration-Key': apiKey },
      cache: 'no-store',
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as {
      contract_version?: string;
      items?: Array<{ id?: string; company_name?: string; title?: string; source_url?: string }>;
      has_more?: boolean;
      next_cursor?: string | null;
    } | null;
    console.log(JSON.stringify({
      reachable: response.ok,
      http_status: response.status,
      contract_version: payload?.contract_version || null,
      item_count: Array.isArray(payload?.items) ? payload.items.length : null,
      has_more: payload?.has_more ?? null,
      next_cursor_present: Boolean(payload?.next_cursor),
      first_item_valid: Boolean(
        payload?.items?.[0]?.id
        && payload.items[0].company_name
        && payload.items[0].title
        && payload.items[0].source_url,
      ),
    }));
    if (!response.ok) process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

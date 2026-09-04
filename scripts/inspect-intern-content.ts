import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { jobHtmlToPlainText } from '@/lib/job-content';

loadDotenv({ path: '.env.local' });

type Row = Record<string, unknown>;

async function main() {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('jobs')
    .select('id,title,company,job_url,external_job_id,description,requirements,source_system,source_url,updated_at,field_evidence')
    .eq('job_type', '实习')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(5000);
  if (error) throw error;
  const rows = ((data || []) as Row[]).filter((row) => {
    const description = typeof row.description === 'string' ? row.description.trim() : '';
    return description.length < 20;
  });
  const known = ((data || []) as Row[]).filter((row) => [56714, 56858, 56884, 56580, 56067, 55825].includes(Number(row.id))).map((row) => ({
    id: row.id,
    title: row.title,
    company: row.company,
    description_type: typeof row.description,
    description_length: typeof row.description === 'string' ? row.description.length : null,
    description_start: typeof row.description === 'string' ? row.description.slice(0, 350) : row.description,
    description_json: (() => {
      if (typeof row.description !== 'string') return null;
      try {
        const parsed = JSON.parse(row.description) as Row;
        return { keys: Object.keys(parsed), values: Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== 'raw_payload' && key !== 'source_evidence').map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 240) : value])) };
      } catch { return null; }
    })(),
    requirements_length: typeof row.requirements === 'string' ? row.requirements.length : null,
    field_evidence: row.field_evidence,
  }));
  const byCompany = new Map<string, { total: number; examples: Row[] }>();
  for (const row of rows) {
    const company = String(row.company || '未知');
    const entry = byCompany.get(company) || { total: 0, examples: [] };
    entry.total += 1;
    if (entry.examples.length < 8) entry.examples.push(row);
    byCompany.set(company, entry);
  }
  const feedUrl = process.env.JOBS_FEED_URL || 'https://hfscareer.com/collector-api/integrations/v1/jobs';
  const apiKey = process.env.JOBS_FEED_API_KEY || process.env.INTEGRATION_API_KEY;
  let feedMatches: Row[] = [];
  let feedPages = 0;
  if (apiKey && process.env.INSPECT_DB_ONLY !== '1') {
    let cursor: string | null = null;
    for (let page = 0; page < 150; page += 1) {
      const url = new URL(feedUrl);
      url.searchParams.set('limit', '500');
      url.searchParams.set('include_closed', 'true');
      if (cursor) url.searchParams.set('cursor', cursor);
      const response = await fetch(url, { headers: { Accept: 'application/json', 'X-Integration-Key': apiKey } });
      if (!response.ok) throw new Error(`feed HTTP ${response.status}`);
      const payload = await response.json() as { items?: Row[]; next_cursor?: string | null; has_more?: boolean };
      feedPages += 1;
      feedMatches.push(...(payload.items || []).filter((item) => {
        const text = `${item.company_name || ''} ${item.title || ''}`.toLowerCase();
        return /morgan stanley|citigroup|accenture|intern|internship/.test(text);
      }).map((item) => ({
      id: item.id,
      external_job_id: item.external_job_id,
      company_name: item.company_name,
      title: item.title,
      source_url: item.source_url,
      description_length: jobHtmlToPlainText(item.description).length,
      description_sample: jobHtmlToPlainText(item.description).slice(0, 180),
      qualifications_length: jobHtmlToPlainText(item.qualifications).length,
      raw_keys: Object.keys(item),
      source_evidence: item.source_evidence,
      detail_status: item.detail_status,
      })));
      cursor = payload.next_cursor || null;
      if (!payload.has_more || !cursor) break;
    }
  }
  console.log(JSON.stringify({
    fetched_rows: (data || []).length,
    empty_rows: rows.length,
    known,
    feed_pages: feedPages,
    by_company: [...byCompany.entries()].map(([company, value]) => ({ company, total: value.total, examples: value.examples })),
    feed_matches: feedMatches,
  }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

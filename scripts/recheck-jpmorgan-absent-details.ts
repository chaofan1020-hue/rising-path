import { config as loadDotenv } from 'dotenv';
import { readFile } from 'node:fs/promises';

loadDotenv({ path: process.env.AUDIT_ENV_FILE || '.env.production.local', override: true, quiet: true });

type Check = { job_id: number; external_job_id: string; title: string | null; source_url: string | null; result: { status: string } };
type Result = { status: 'present' | 'absent' | 'error'; httpStatus?: number; detailId?: string; reason?: string };

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim(); }
function wait(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function fetchDetail(externalId: string): Promise<Result> {
  const url = new URL('https://jpmc.fa.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails');
  url.searchParams.set('onlyData', 'true');
  url.searchParams.set('expand', 'all');
  url.searchParams.set('finder', `ById;Id=\"${externalId}\",siteNumber=CX_1001`);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Liorvix read-only audit' }, cache: 'no-store', signal: controller.signal });
      if (!response.ok) return { status: 'error', httpStatus: response.status, reason: `HTTP ${response.status}` };
      const payload = await response.json() as { items?: Array<{ Id?: unknown }> };
      const detailId = text(payload.items?.[0]?.Id);
      return detailId === externalId ? { status: 'present', detailId, httpStatus: response.status } : { status: 'absent', httpStatus: response.status };
    } catch (error) {
      if (attempt === 2) return { status: 'error', reason: error instanceof Error ? error.message : String(error) };
      await wait(1_000);
    } finally {
      clearTimeout(timeout);
    }
  }
  return { status: 'error', reason: 'unreachable' };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, action: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const current = index++;
      if (current >= items.length) return;
      results[current] = await action(items[current]);
    }
  }));
  return results;
}

async function main(): Promise<void> {
  const raw = await readFile('output/jpmorgan-unmatched-full-audit.json', 'utf8');
  const report = JSON.parse(raw.slice(raw.indexOf('{'))) as { checks?: Check[] };
  const candidates = (report.checks || []).filter((check) => check.result?.status === 'absent');
  const rechecked = await mapWithConcurrency(candidates, 8, async (check) => ({
    job_id: check.job_id,
    external_job_id: check.external_job_id,
    title: check.title,
    source_url: check.source_url,
    result: await fetchDetail(check.external_job_id),
  }));
  const counts = rechecked.reduce<Record<string, number>>((result, row) => {
    result[row.result.status] = (result[row.result.status] || 0) + 1;
    return result;
  }, {});
  console.log(JSON.stringify({
    generated_at: new Date().toISOString(),
    company: 'JPMorgan Chase',
    previous_absent_candidates: candidates.length,
    second_check_counts: counts,
    confirmed_absent_twice: rechecked.filter((row) => row.result.status === 'absent').length,
    checks: rechecked,
    note: '只读二次核验；未写入岗位、对账记录或生命周期。',
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

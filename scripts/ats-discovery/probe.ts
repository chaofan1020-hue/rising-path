import fs from 'node:fs';
import path from 'node:path';
import { checkRobots, type RobotsCheck } from '@/lib/ats-discovery/robots';
import {
  apiUrlFor,
  isVendor,
  parseProviderPayload,
  summarizeBoard,
  VENDOR_RATE_LIMIT_MS,
  type ProbeResult,
  type Vendor,
} from '@/lib/ats-discovery/providers';

type Row = Record<string, string>;

function parseCsv(text: string): Row[] {
  const input = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) return [];
  const header = rows[0].map((value) => value.trim());
  return rows.slice(1)
    .filter((cells) => cells.some((cell) => cell.trim() !== ''))
    .map((cells) => Object.fromEntries(header.map((h, idx) => [h, (cells[idx] ?? '').trim()])));
}

function arg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class VendorRateLimiter {
  private nextAt = new Map<Vendor, number>();

  async wait(vendor: Vendor): Promise<void> {
    const now = Date.now();
    const interval = VENDOR_RATE_LIMIT_MS[vendor];
    const at = Math.max(now, this.nextAt.get(vendor) ?? 0);
    this.nextAt.set(vendor, at + interval);
    if (at > now) await sleep(at - now);
  }

  noteCrawlDelay(vendor: Vendor, crawlDelayMs: number | null): void {
    if (!crawlDelayMs) return;
    const current = this.nextAt.get(vendor) ?? 0;
    this.nextAt.set(vendor, Math.max(current, Date.now() + crawlDelayMs));
  }
}

const USER_AGENT = 'LiorvixBot/1.0 (+https://liorvix.com/bot; contact: data@liorvix.com)';
const inputPath = path.resolve(arg('input', 'tmp/boards/candidates.csv'));
const outputPath = path.resolve(arg('output', 'tmp/boards/probe-results.jsonl'));
const limit = Number.parseInt(arg('limit', '0'), 10);
const concurrency = Math.max(1, Math.min(12, Number.parseInt(arg('concurrency', '6'), 10)));
const timeoutMs = Math.max(5000, Number.parseInt(arg('timeout-ms', '30000'), 10));
const vendorsArg = arg('vendors', '');
const allowedVendors = new Set(
  vendorsArg
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(isVendor),
);
const resume = !hasFlag('no-resume');

const rows = parseCsv(fs.readFileSync(inputPath, 'utf8'))
  .filter((row) => isVendor(row.vendor.toLowerCase()) && row.token)
  .filter((row) => allowedVendors.size === 0 || allowedVendors.has(row.vendor.toLowerCase() as Vendor))
  .slice(0, limit > 0 ? limit : undefined);

if (rows.length === 0) {
  console.error(`No rows to probe from ${inputPath}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const seen = new Set<string>();
if (resume && fs.existsSync(outputPath)) {
  for (const line of fs.readFileSync(outputPath, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line) as { vendor?: string; token?: string };
      if (item.vendor && item.token) seen.add(`${item.vendor}:${item.token}`);
    } catch {
      // Keep going; a truncated tail is expected after an interrupted run.
    }
  }
}
if (!resume) fs.writeFileSync(outputPath, '');

const queue = rows.filter((row) => !seen.has(`${row.vendor.toLowerCase()}:${row.token}`));
const robotsCache = new Map<string, Promise<RobotsCheck>>();
const limiter = new VendorRateLimiter();
const summary = {
  total: queue.length,
  active: 0,
  quarantined: 0,
  error: 0,
  skippedResume: rows.length - queue.length,
  byReason: {} as Record<string, number>,
  byVendor: {} as Record<string, number>,
};

async function fetchWithRetry(url: string): Promise<{ status: number; body: string; error: string | null }> {
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json,text/plain,*/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await response.text();
      if (response.status === 429 || response.status >= 500) {
        lastError = `http_${response.status}`;
        if (attempt < 2) {
          const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
          await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30_000) : 2000 * (attempt + 1));
          continue;
        }
      }
      return { status: response.status, body, error: null };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < 2) await sleep(2000 * (attempt + 1));
    }
  }
  return { status: 0, body: '', error: lastError ?? 'fetch_failed' };
}

async function getRobots(vendor: Vendor, apiUrl: string): Promise<RobotsCheck> {
  const origin = new URL(apiUrl).origin;
  const cached = robotsCache.get(origin);
  if (cached) return cached;
  const promise = checkRobots(apiUrl, {
    userAgent: USER_AGENT,
    timeoutMs,
    allowUnauthorized: vendor === 'ashby',
  }).catch((error: unknown): RobotsCheck => ({
    verdict: 'unknown',
    reason: error instanceof Error ? `robots_error:${error.message}` : 'robots_error',
    robotsUrl: `${origin}/robots.txt`,
    httpStatus: null,
    checkedAt: new Date().toISOString(),
    sha256: null,
    crawlDelayMs: null,
    path: '/',
  }));
  robotsCache.set(origin, promise);
  return promise;
}

async function probeOne(row: Row): Promise<ProbeResult> {
  const vendor = row.vendor.toLowerCase() as Vendor;
  const token = row.token;
  const startedAt = Date.now();
  const apiUrl = apiUrlFor(vendor, token);
  const robots = await getRobots(vendor, apiUrl);
  limiter.noteCrawlDelay(vendor, robots.crawlDelayMs);

  if (robots.verdict === 'disallow') {
    return {
      vendor,
      token,
      status: 'quarantined',
      reason: 'robots_disallowed',
      httpStatus: null,
      postingCount: 0,
      postingCountIsLowerBound: false,
      sampleCount: 0,
      targetCount: 0,
      targetRatio: 0,
      robots,
      sample: [],
      error: null,
      durationMs: Date.now() - startedAt,
      fetchedAt: new Date().toISOString(),
      listOnly: true,
    };
  }
  if (robots.verdict === 'unknown') {
    return {
      vendor,
      token,
      status: 'quarantined',
      reason: `robots_unknown:${robots.reason}`,
      httpStatus: null,
      postingCount: 0,
      postingCountIsLowerBound: false,
      sampleCount: 0,
      targetCount: 0,
      targetRatio: 0,
      robots,
      sample: [],
      error: null,
      durationMs: Date.now() - startedAt,
      fetchedAt: new Date().toISOString(),
      listOnly: true,
    };
  }

  await limiter.wait(vendor);
  const response = await fetchWithRetry(apiUrl);
  const fetchedAt = new Date().toISOString();
  if (response.error || response.status !== 200) {
    return {
      vendor,
      token,
      status: 'error',
      reason: response.status === 404 ? 'not_found' : response.status >= 400 ? `http_${response.status}` : 'fetch_failed',
      httpStatus: response.status || null,
      postingCount: 0,
      postingCountIsLowerBound: false,
      sampleCount: 0,
      targetCount: 0,
      targetRatio: 0,
      robots,
      sample: [],
      error: response.error ?? `http_${response.status}`,
      durationMs: Date.now() - startedAt,
      fetchedAt,
      listOnly: true,
    };
  }

  try {
    const payload = JSON.parse(response.body) as unknown;
    const parsed = parseProviderPayload(vendor, payload, token);
    const result = summarizeBoard(vendor, token, parsed, response.status, robots);
    result.durationMs = Date.now() - startedAt;
    result.fetchedAt = fetchedAt;
    return result;
  } catch (error) {
    return {
      vendor,
      token,
      status: 'error',
      reason: 'parse_failed',
      httpStatus: response.status,
      postingCount: 0,
      postingCountIsLowerBound: false,
      sampleCount: 0,
      targetCount: 0,
      targetRatio: 0,
      robots,
      sample: [],
      error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
      durationMs: Date.now() - startedAt,
      fetchedAt,
      listOnly: true,
    };
  }
}

async function run(): Promise<void> {
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < queue.length) {
      const row = queue[cursor];
      cursor += 1;
      const result = await probeOne(row);
      fs.appendFileSync(outputPath, `${JSON.stringify(result)}\n`, 'utf8');
      summary[result.status] += 1;
      summary.byReason[result.reason] = (summary.byReason[result.reason] ?? 0) + 1;
      summary.byVendor[result.vendor] = (summary.byVendor[result.vendor] ?? 0) + 1;
      if ((summary.active + summary.quarantined + summary.error) % 50 === 0) {
        console.error(`progress ${summary.active + summary.quarantined + summary.error}/${queue.length} active=${summary.active} quarantined=${summary.quarantined} error=${summary.error}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

run()
  .then(() => {
    console.log(JSON.stringify({ output: outputPath, ...summary }, null, 2));
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
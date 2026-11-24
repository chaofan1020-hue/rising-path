import fs from 'node:fs';
import path from 'node:path';
import { checkRobots, type RobotsCheck } from '@/lib/ats-discovery/robots';

type Row = Record<string, string>;
type Probe = {
  vendor: string;
  token: string;
  status: string;
  sample?: Array<{ url?: string | null }>;
};

const ATS_HOSTS = ['greenhouse.io', 'ashbyhq.com', 'lever.co'];
const SOCIAL_HOSTS = [
  'facebook.com', 'linkedin.com', 'twitter.com', 'x.com', 'instagram.com', 'youtube.com',
  'glassdoor.com', 'indeed.com', 'tiktok.com', 'pinterest.com',
];
const FALSE_HOSTS = [
  'greenhouse.com', 'googleapis.com', 'gstatic.com', 'google.com', 'fonts.googleapis.com',
  'smartafs.my.site.com', 'my.site.com', 'salesforce.com', 'force.com', 'workday.com',
  'myworkdayjobs.com', 'icims.com', 'taleo.net', 'successfactors.com', 'jobvite.com',
  'smartrecruiters.com', 'employinc.com', 'amazonaws.com', 'cloudfront.net', 'cdnjs.com',
  'w3.org', 'schema.org',
];

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
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class HostLimiter {
  private nextAt = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly intervalMs: number) {}

  acquire(): Promise<void> {
    const result = this.queue.then(async () => {
      const wait = this.nextAt - Date.now();
      if (wait > 0) await sleep(wait);
      this.nextAt = Date.now() + this.intervalMs;
    });
    this.queue = result;
    return result;
  }
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function decodeEntities(value: string): string {
  return value
    .replaceAll('&amp;', '&').replaceAll('&#39;', "'").replaceAll('&apos;', "'")
    .replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>')
    .replaceAll('&nbsp;', ' ');
}

function genericName(value: string): boolean {
  return /^(careers?|jobs?|job openings?|open roles?|hiring|recruiting|browse.*|current job openings?|current openings?|search( for| page)?|home|apply|job search|find jobs|open positions?|careers list|join our team|join us|careers homepage|work with us)$/i.test(value.trim());
}

export function normalizeCompanyName(rawTitle: string): { name: string | null; source: string } {
  let title = decodeEntities(rawTitle).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!title) return { name: null, source: 'none' };
  const parts = title.split(/\s*[|–—]\s*/).map((part) => part.trim()).filter(Boolean);
  const usable = parts.filter((part) => !genericName(part));
  if (usable.length > 0) {
    // ATS titles usually put the employer after the pipe: "Jobs | Acme".
    title = usable[usable.length - 1];
  } else {
    title = parts[0] ?? title;
  }
  title = title
    .replace(/^(careers?|jobs?|job openings?|open roles?)\s+(at|@)\s+/i, '')
    .replace(/^.*?\bcareers?\s+at\s+/i, '')
    .replace(/^find your future at\s+/i, '')
    .replace(/^current job openings at\s+/i, '')
    .replace(/^browse .*? jobs at\s+/i, '')
    .replace(/\s*[-–—]\s*(careers?|jobs?|browse.*|open roles?|job listings?).*$/i, '')
    .replace(/\s+(careers?|jobs?|job board|open roles?|hiring)$/i, '')
    .trim();
  if (!title || genericName(title) || title.length < 2) return { name: null, source: 'none' };
  return { name: title, source: 'page_title' };
}

function hostOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

function blockedHost(host: string): boolean {
  return [...ATS_HOSTS, ...SOCIAL_HOSTS, ...FALSE_HOSTS].some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function validDomain(host: string): boolean {
  return !blockedHost(host) && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) && !host.includes('..');
}

function nameMatchesHost(name: string, host: string): boolean {
  const nameSlug = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const labels = host.split('.');
  const root = (labels[labels.length - 2] ?? '').replace(/[^a-z0-9]/g, '');
  return root.length >= 4 && nameSlug.includes(root);
}

function titleFromToken(token: string): string {
  return token
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .trim();
}

function extractHtml(html: string, boardUrl: string) {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
  const ogTitle = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ?? '';
  const ogUrl = /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ?? '';
  const jsonLdUrls: string[] = [];
  for (const match of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(match[1]) as unknown;
      const queue = Array.isArray(data) ? data : [data];
      for (const item of queue) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        const org = record.hiringOrganization;
        if (org && typeof org === 'object' && typeof (org as Record<string, unknown>).url === 'string') {
          jsonLdUrls.push((org as Record<string, unknown>).url as string);
        }
        if (typeof record.url === 'string') jsonLdUrls.push(record.url);
      }
    } catch {
      // Ignore malformed JSON-LD.
    }
  }
  const links: Array<{ href: string; text: string }> = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = decodeEntities(match[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (match[1].startsWith('http')) links.push({ href: match[1], text });
  }
  return { title, ogTitle, ogUrl, jsonLdUrls, links, finalUrl: boardUrl };
}

async function main(): Promise<void> {
  const activePath = path.resolve(arg('active', 'tmp/boards/active.csv'));
  const probePath = path.resolve(arg('probe', 'tmp/boards/probe-results-gh-lever.jsonl'));
  const overridePath = path.resolve(arg('overrides', 'data/board-company-overrides.csv'));
  const outPath = path.resolve(arg('out', 'tmp/boards/companies.csv'));
  const limit = Number.parseInt(arg('limit', '0'), 10);
  const concurrency = Math.max(1, Math.min(8, Number.parseInt(arg('concurrency', '5'), 10)));

  const rows = parseCsv(fs.readFileSync(activePath, 'utf8'));
  const selected = limit > 0 ? rows.slice(0, limit) : rows;
  const probeByKey = new Map<string, Probe>();
  if (fs.existsSync(probePath)) {
    for (const line of fs.readFileSync(probePath, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      const item = JSON.parse(line) as Probe;
      probeByKey.set(`${item.vendor}:${item.token}`, item);
    }
  }
  const overrides = new Map<string, Row>();
  if (fs.existsSync(overridePath)) {
    for (const row of parseCsv(fs.readFileSync(overridePath, 'utf8'))) {
      if (row.token) overrides.set(`${row.vendor}:${row.token}`, row);
    }
  }

  const resume = hasFlag('resume') && fs.existsSync(outPath);
  const previous = new Map<string, Row>();
  if (resume) {
    for (const row of parseCsv(fs.readFileSync(outPath, 'utf8'))) {
      previous.set(`${row.vendor}:${row.token}`, row);
    }
  }

  const limiters = new Map<string, HostLimiter>();
  function limiterFor(url: string): HostLimiter {
    const host = new URL(url).hostname;
    const existing = limiters.get(host);
    if (existing) return existing;
    const interval = host.includes('greenhouse') ? 900 : 500;
    const limiter = new HostLimiter(interval);
    limiters.set(host, limiter);
    return limiter;
  }

  const robotsCache = new Map<string, Promise<RobotsCheck>>();
  function robotsFor(url: string): Promise<RobotsCheck> {
    const origin = new URL(url).origin;
    const cached = robotsCache.get(origin);
    if (cached) return cached;
    const promise = checkRobots(url, {
      userAgent: 'LiorvixBot/1.0 (+https://liorvix.com/bot; contact: data@liorvix.com)',
      timeoutMs: 15000,
    }).catch((): RobotsCheck => ({
      verdict: 'unknown', reason: 'robots_error', robotsUrl: `${origin}/robots.txt`,
      httpStatus: null, checkedAt: new Date().toISOString(), sha256: null, crawlDelayMs: null, path: '/',
    }));
    robotsCache.set(origin, promise);
    return promise;
  }

  const results: Row[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < selected.length) {
      const row = selected[cursor];
      cursor += 1;
      const key = `${row.vendor}:${row.token}`;
      const previousRow = previous.get(key);
      if (resume && previousRow && previousRow.http_status === '200' && previousRow.company_name && previousRow.name_source !== 'token_fallback') {
        results.push(previousRow);
        continue;
      }
      const override = overrides.get(key);
      const probe = probeByKey.get(key);
      let robots: RobotsCheck;
      try {
        robots = await robotsFor(row.board_url);
      } catch {
        robots = {
          verdict: 'unknown', reason: 'robots_error', robotsUrl: `${row.board_url}/robots.txt`,
          httpStatus: null, checkedAt: new Date().toISOString(), sha256: null, crawlDelayMs: null, path: '/',
        };
      }

      let page: ReturnType<typeof extractHtml> | null = null;
      let httpStatus: number | null = null;
      let error: string | null = null;
      if (robots.verdict === 'allow') {
        try {
          await limiterFor(row.board_url).acquire();
          const response = await fetch(row.board_url, {
            headers: { 'user-agent': 'LiorvixBot/1.0 (+https://liorvix.com/bot; contact: data@liorvix.com)', accept: 'text/html,*/*' },
            redirect: 'follow',
            signal: AbortSignal.timeout(20000),
          });
          httpStatus = response.status;
          if (response.ok) {
            const html = await response.text();
            page = extractHtml(html.slice(0, 700_000), response.url);
            page.finalUrl = response.url;
          } else {
            error = `http_${response.status}`;
          }
        } catch (err) {
          error = err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
        }
      } else {
        error = `robots_${robots.verdict}:${robots.reason}`;
      }

      const nameFromTitle = page ? normalizeCompanyName(page.ogTitle || page.title) : { name: null, source: 'none' };
      const tokenName = titleFromToken(row.token);
      const companyName = override?.company_name || nameFromTitle.name || tokenName;
      const nameSource = override?.company_name ? 'manual_override' : nameFromTitle.name ? nameFromTitle.source : 'token_fallback';

      const candidates: Array<{ domain: string; source: string; confidence: string }> = [];
      if (override?.company_domain) candidates.push({ domain: override.company_domain, source: 'manual_override', confidence: 'high' });
      if (page) {
        for (const sample of probe?.sample ?? []) {
          const host = sample.url ? hostOf(sample.url) : null;
          if (host && validDomain(host)) candidates.push({ domain: host, source: 'sample_job_url', confidence: 'high' });
        }
        const finalHost = hostOf(page.finalUrl);
        if (finalHost && validDomain(finalHost)) candidates.push({ domain: finalHost, source: 'final_url', confidence: 'high' });
        const ogHost = page.ogUrl ? hostOf(page.ogUrl) : null;
        if (ogHost && validDomain(ogHost)) candidates.push({ domain: ogHost, source: 'og_url', confidence: 'high' });
        for (const url of page.jsonLdUrls) {
          const host = hostOf(url);
          if (host && validDomain(host)) candidates.push({ domain: host, source: 'jsonld', confidence: 'high' });
        }
        for (const link of page.links) {
          const host = hostOf(link.href);
          if (!host || !validDomain(host)) continue;
          const textMatch = /(website|company|home|visit|learn more|about)/i.test(link.text);
          if (!textMatch && !nameMatchesHost(companyName, host)) continue;
          candidates.push({ domain: host, source: 'website_link', confidence: textMatch ? 'medium' : 'low' });
        }
      }
      const best = candidates[0] ?? null;

      results.push({
        vendor: row.vendor,
        token: row.token,
        board_url: row.board_url,
        company_name: companyName,
        company_domain: best?.domain ?? '',
        confidence: best?.confidence ?? 'low',
        domain_source: best?.source ?? 'none',
        name_source: nameSource,
        careers_url: page?.finalUrl || row.board_url,
        robots_verdict: robots.verdict,
        robots_evidence_url: robots.robotsUrl,
        robots_checked_at: robots.checkedAt,
        http_status: String(httpStatus ?? ''),
        error: error ?? '',
      });
      if (results.length % 50 === 0) {
        console.error(`resolved ${results.length}/${selected.length}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const header = ['vendor', 'token', 'board_url', 'company_name', 'company_domain', 'confidence', 'domain_source', 'name_source', 'careers_url', 'robots_verdict', 'robots_evidence_url', 'robots_checked_at', 'http_status', 'error'];
  const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${[header.join(','), ...results.map((row) => header.map((h) => escape(row[h] ?? '')).join(','))].join('\n')}\n`, 'utf8');
  const named = results.filter((row) => row.name_source !== 'token_fallback').length;
  const domained = results.filter((row) => row.company_domain).length;
  console.log(JSON.stringify({
    out: outPath,
    rows: results.length,
    named,
    namedRatio: results.length ? Math.round((named / results.length) * 10000) / 100 : 0,
    domained,
    domainRatio: results.length ? Math.round((domained / results.length) * 10000) / 100 : 0,
    domainSources: results.reduce<Record<string, number>>((acc, row) => {
      acc[row.domain_source] = (acc[row.domain_source] ?? 0) + 1;
      return acc;
    }, {}),
    robots: results.reduce<Record<string, number>>((acc, row) => {
      acc[row.robots_verdict] = (acc[row.robots_verdict] ?? 0) + 1;
      return acc;
    }, {}),
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
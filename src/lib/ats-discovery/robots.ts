import { createHash } from 'node:crypto';

export type RobotsVerdict = 'allow' | 'disallow' | 'unknown';

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsPolicy {
  rules: RobotsRule[];
  crawlDelayMs: number | null;
  groups: number;
}

export interface RobotsCheck {
  verdict: RobotsVerdict;
  reason: string;
  robotsUrl: string;
  httpStatus: number | null;
  checkedAt: string;
  sha256: string | null;
  crawlDelayMs: number | null;
  path: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_ROBOTS_BYTES = 512 * 1024;
const BOT_TOKEN = 'liorvixbot';

function toMs(seconds: string | undefined): number | null {
  if (!seconds) return null;
  const value = Number.parseFloat(seconds);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 1000);
}

function escapeRegex(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body.split('*').map(escapeRegex).join('.*');
  return new RegExp(`^${source}${anchored ? '$' : '.*'}`, 'i');
}

export function parseRobots(text: string, userAgent = BOT_TOKEN): RobotsPolicy {
  const groups: Array<{ agents: string[]; rules: RobotsRule[]; crawlDelay: string | null }> = [];
  let current: { agents: string[]; rules: RobotsRule[]; crawlDelay: string | null } | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }

    lastWasAgent = false;
    if (!current) continue;
    if (key === 'allow' || key === 'disallow') {
      if (value) current.rules.push({ allow: key === 'allow', pattern: value });
    } else if (key === 'crawl-delay') {
      current.crawlDelay = value;
    }
  }

  const ua = userAgent.toLowerCase();
  const specific = groups.filter((group) => group.agents.some((agent) => agent !== '*' && ua.includes(agent)));
  const selected = specific.length > 0 ? specific : groups.filter((group) => group.agents.includes('*'));
  const rules = selected.flatMap((group) => group.rules);
  const crawlDelay = selected
    .map((group) => toMs(group.crawlDelay ?? undefined))
    .filter((value): value is number => value !== null)
    .sort((a, b) => b - a)[0] ?? null;

  return { rules, crawlDelayMs: crawlDelay, groups: selected.length };
}

export function isPathAllowed(path: string, rules: RobotsRule[]): boolean {
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of rules) {
    if (!patternToRegex(rule.pattern).test(path)) continue;
    if (!best || rule.pattern.length > best.length || (rule.pattern.length === best.length && rule.allow)) {
      best = { allow: rule.allow, length: rule.pattern.length };
    }
  }
  return best ? best.allow : true;
}

export async function checkRobots(
  url: string,
  options: {
    userAgent?: string;
    timeoutMs?: number;
    allowUnauthorized?: boolean;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<RobotsCheck> {
  const target = new URL(url);
  const robotsUrl = `${target.origin}/robots.txt`;
  const path = `${target.pathname}${target.search}`;
  const checkedAt = new Date().toISOString();
  const userAgent = options.userAgent ?? `LiorvixBot/1.0 (+https://liorvix.com/bot; contact: data@liorvix.com)`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const response = await fetchImpl(robotsUrl, {
    headers: { 'user-agent': userAgent, accept: 'text/plain,*/*;q=0.5' },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => null);

  if (!response) {
    return { verdict: 'unknown', reason: 'robots_fetch_failed', robotsUrl, httpStatus: null, checkedAt, sha256: null, crawlDelayMs: null, path };
  }

  if (response.status === 401 || response.status === 403) {
    if (options.allowUnauthorized) {
      return { verdict: 'allow', reason: 'public_api_documented_robots_unavailable', robotsUrl, httpStatus: response.status, checkedAt, sha256: null, crawlDelayMs: null, path };
    }
    return { verdict: 'unknown', reason: `robots_${response.status}`, robotsUrl, httpStatus: response.status, checkedAt, sha256: null, crawlDelayMs: null, path };
  }

  if (response.status === 404) {
    return { verdict: 'allow', reason: 'robots_404_no_policy', robotsUrl, httpStatus: 404, checkedAt, sha256: null, crawlDelayMs: null, path };
  }

  if (!response.ok) {
    return { verdict: 'unknown', reason: `robots_http_${response.status}`, robotsUrl, httpStatus: response.status, checkedAt, sha256: null, crawlDelayMs: null, path };
  }

  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_ROBOTS_BYTES) {
    return { verdict: 'unknown', reason: 'robots_too_large', robotsUrl, httpStatus: response.status, checkedAt, sha256: null, crawlDelayMs: null, path };
  }

  const policy = parseRobots(body, userAgent);
  const allowed = isPathAllowed(path, policy.rules);
  return {
    verdict: allowed ? 'allow' : 'disallow',
    reason: allowed ? 'robots_allowed' : 'robots_disallowed',
    robotsUrl,
    httpStatus: response.status,
    checkedAt,
    sha256: createHash('sha256').update(body).digest('hex'),
    crawlDelayMs: policy.crawlDelayMs,
    path,
  };
}
import { lookup } from 'node:dns/promises';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { isIP } from 'node:net';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_000_000;
// Google Careers embeds the server-rendered job detail after a large app shell.
// Keep the default limit for every other host and allow only this exact public
// host a bounded 2 MB response so the detail evidence is not truncated.
const GOOGLE_MAX_RESPONSE_BYTES = 2_000_000;
const MAX_REDIRECTS = 3;

export class ExternalFetchError extends Error {
  constructor(message: string, readonly status: number, readonly upstreamStatus?: number) {
    super(message);
    this.name = 'ExternalFetchError';
  }
}

export interface ExternalPageContent {
  title: string;
  content: string;
  url: string;
  httpStatus: number;
  metadata?: Record<string, unknown>;
}

interface ResolvedExternalUrl {
  url: URL;
  addresses: Array<{ address: string; family: 4 | 6 }>;
}

function isForbiddenIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [first, second, third] = parts;
  return first === 0
    || first === 10
    || first === 127
    || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 192 && second === 0)
    || (first === 192 && second === 2)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113);
}

function isForbiddenIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('::')
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || /^fe[89ab]/.test(normalized)
    || normalized.startsWith('ff')
    || normalized.startsWith('2001:db8');
}

export function isForbiddenExternalAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isForbiddenIpv4(address);
  if (family === 6) return isForbiddenIpv6(address);
  return true;
}

async function resolveExternalUrl(rawUrl: string): Promise<ResolvedExternalUrl> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ExternalFetchError('URL 格式无效', 400);
  }

  if (url.protocol !== 'https:') {
    throw new ExternalFetchError('仅支持 HTTPS 链接', 400);
  }
  if (url.username || url.password || (url.port && url.port !== '443')) {
    throw new ExternalFetchError('URL 包含不允许的凭据或端口', 400);
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new ExternalFetchError('不允许访问本地地址', 400);
  }

  let addresses: Array<{ address: string; family: 4 | 6 }>;
  try {
    const resolved = await lookup(hostname, { all: true, verbatim: true });
    addresses = resolved
      .filter((item) => item.family === 4 || item.family === 6)
      .map((item) => ({ address: item.address, family: item.family as 4 | 6 }))
      .sort((left, right) => left.family - right.family);
  } catch {
    throw new ExternalFetchError('无法解析目标域名', 422);
  }

  if (!addresses.length || addresses.some(({ address }) => isForbiddenExternalAddress(address))) {
    throw new ExternalFetchError('目标地址不允许访问', 400);
  }

  return { url, addresses };
}

function requestPinnedHttps(
  url: URL,
  address: { address: string; family: 4 | 6 },
  extraHeaders: Record<string, string> = {},
  allowNonTextBody = false,
  maxResponseBytes = MAX_RESPONSE_BYTES,
): Promise<{
  statusCode: number;
  headers: Headers;
  body: Buffer;
}> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };

    const request = httpsRequest(url, {
      method: 'GET',
      headers: {
        accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.1',
        'accept-encoding': 'identity',
        'accept-language': 'en-US,en;q=0.9',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'upgrade-insecure-requests': '1',
        // Workday and several modern ATS portals return an SPA redirect shell
        // to generic bot UAs but render their public job detail to browsers.
        // This remains a plain read-only GET with the same DNS pinning and
        // response limits; it only requests the candidate-visible variant.
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        ...extraHeaders,
      },
      // We deliberately pin this request to a single DNS-validated address
      // to prevent DNS rebinding. Node's multi-address auto-selection expects
      // an array from `lookup`, which conflicts with that pinned callback.
      autoSelectFamily: false,
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
    } as RequestOptions, (response) => {
      const statusCode = response.statusCode || 0;
      const contentType = response.headers['content-type'] || '';
      const isRedirect = [301, 302, 303, 307, 308].includes(statusCode);
      if (!isRedirect && statusCode >= 200 && statusCode < 300 && !allowNonTextBody && !/^(text\/|application\/(json|xml|xhtml\+xml))/i.test(contentType)) {
        response.resume();
        finish(() => reject(new ExternalFetchError('目标内容不是可读取的文本页面', 422)));
        return;
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;
      response.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > maxResponseBytes) {
          response.destroy();
          finish(() => reject(new ExternalFetchError(`目标响应超过 ${Math.round(maxResponseBytes / 1_000_000)}MB 限制`, 413)));
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', (error: NodeJS.ErrnoException) => {
        const reason = error.code || 'response_error';
        finish(() => reject(new ExternalFetchError(`读取目标响应失败 (${reason})`, 422)));
      });
      response.on('end', () => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) headers.set(name, value.join(', '));
          else if (value !== undefined) headers.set(name, value);
        }
        finish(() => resolve({ statusCode, headers, body: Buffer.concat(chunks) }));
      });
    });

    request.setTimeout(FETCH_TIMEOUT_MS, () => {
      request.destroy(new Error('request timeout'));
    });
    request.on('error', (error: NodeJS.ErrnoException) => {
      // Persist a stable transport code so the lifecycle worker can distinguish
      // a portal challenge from a production egress or TLS configuration issue.
      const reason = error.code || 'request_error';
      finish(() => reject(new ExternalFetchError(`请求目标页面失败 (${reason})`, 422)));
    });
    request.end();
  });
}

function htmlToText(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/(?:p|div|section|article|header|footer|h[1-6]|li|tr|blockquote)\s*>/gi, '\n')
    .replace(/<\s*(?:li|tr)\b[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractTitle(value: string): string {
  const match = value.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? htmlToText(match[1]).slice(0, 500) : '';
}

function isSpaRedirectShell(value: string): boolean {
  const normalized = value.trim();
  return normalized.startsWith('{') && normalized.endsWith('}')
    && /"(?:widget|externalSpa)"\s*:/.test(normalized);
}

/** Build the public CXS detail URL for Workday paths with or without a locale segment. */
export function buildWorkdayCxsDetailUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    const jobIndex = parts.findIndex((part) => part.toLowerCase() === 'job');
    if (jobIndex < 1 || jobIndex === parts.length - 1) return null;
    const tenant = url.hostname.split('.')[0];
    const site = parts[jobIndex - 1];
    const slugParts = parts.slice(jobIndex + 1);
    if (slugParts.at(-1)?.toLowerCase() === 'apply') slugParts.pop();
    const slug = slugParts.join('/');
    return tenant && site && slug ? `${url.origin}/wday/cxs/${tenant}/${site}/job/${slug}` : null;
  } catch {
    return null;
  }
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function decodeResponseBody(body: Buffer, contentType: string | null): string {
  const declared = contentType?.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1]?.toLowerCase();
  const hasUtf8Bom = body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf;
  const hasUtf16LeBom = body.length >= 2 && body[0] === 0xff && body[1] === 0xfe;
  const hasUtf16BeBom = body.length >= 2 && body[0] === 0xfe && body[1] === 0xff;
  const label = hasUtf8Bom
    ? 'utf-8'
    : hasUtf16LeBom
      ? 'utf-16le'
      : hasUtf16BeBom
        ? 'utf-16be'
        : declared === 'gb2312' || declared === 'gbk'
          ? 'gb18030'
          : declared === 'latin1' || declared === 'iso-8859-1'
            ? 'windows-1252'
            : declared || 'utf-8';
  try {
    return new TextDecoder(label, { fatal: false }).decode(body);
  } catch {
    return body.toString('utf8');
  }
}

export function extractPageMetadata(value: string): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const metaPattern = /<meta\b[^>]*>/gi;
  for (const match of value.matchAll(metaPattern)) {
    const tag = match[0];
    const keyMatch = /(?:name|property|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag);
    const contentMatch = /content\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!keyMatch || !contentMatch) continue;
    const key = keyMatch[1].trim();
    const content = decodeHtmlAttribute(contentMatch[1].trim());
    if (/(deadline|closing|close|expire|expiration|expiry|valid.?through)/i.test(key)) {
      metadata[key] = content;
    }
  }

  const timePattern = /<time\b([^>]*)datetime\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/time>/gi;
  for (const match of value.matchAll(timePattern)) {
    const label = htmlToText(match[3]);
    if (/(deadline|closing|close|expire|expiration|expiry|截止|申请)/i.test(label)) {
      metadata.deadline = decodeHtmlAttribute(match[2].trim());
    }
  }

  const jsonLdPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  const structuredData: unknown[] = [];
  for (const match of value.matchAll(jsonLdPattern)) {
    if (!/type\s*=\s*["']application\/ld\+json["']/i.test(match[1])) continue;
    const body = match[2].trim();
    if (!body) continue;
    let parsed: unknown | null = null;
    try {
      parsed = JSON.parse(body) as unknown;
    } catch {
      // Some portals embed HTML entities (e.g. &quot; inside a nested HTML
      // attribute) that make naive JSON.parse fail on the raw body; decode
      // entities and retry before giving up on the structured data.
      try {
        parsed = JSON.parse(decodeHtmlAttribute(body)) as unknown;
      } catch {
        // Visible text remains available for these portals.
      }
    }
    if (parsed !== null) structuredData.push(parsed);
  }
  if (structuredData.length > 0) metadata.structured_data = structuredData;
  return metadata;
}

function cookieHeader(value: string | null): string | null {
  if (!value) return null;
  const cookies: string[] = [];
  const cookiePattern = /(?:^|,\s*)(jobs|jssid|AWSALBAPP-\d+)=([^;,]*)/gi;
  for (const match of value.matchAll(cookiePattern)) cookies.push(`${match[1]}=${match[2]}`);
  return cookies.length > 0 ? cookies.join('; ') : null;
}

function appleJobNumber(rawUrl: URL): string | null {
  if (rawUrl.hostname.toLowerCase() !== 'jobs.apple.com') return null;
  const match = rawUrl.pathname.match(/\/details\/(\d+)(?:\/|$)/i);
  return match?.[1] || null;
}

function hasJobPostingStructuredData(value: unknown): boolean {
  const records = Array.isArray(value) ? value : [value];
  return records.some((item) => {
    if (!item || typeof item !== 'object') return false;
    const record = item as Record<string, unknown>;
    const type = record['@type'];
    return Array.isArray(type)
      ? type.some((entry) => String(entry).toLowerCase() === 'jobposting')
      : String(type || '').toLowerCase() === 'jobposting';
  });
}

async function fetchAppleStructuredData(
  pageUrl: URL,
  address: { address: string; family: 4 | 6 },
): Promise<Record<string, unknown> | null> {
  const jobNumber = appleJobNumber(pageUrl);
  if (!jobNumber) return null;
  const commonHeaders = {
    accept: 'application/json, text/plain, */*',
    referer: pageUrl.toString(),
    origin: pageUrl.origin,
  };
  const csrf = await requestPinnedHttps(new URL('/api/v1/CSRFToken', pageUrl.origin), address, commonHeaders, true);
  const cookie = cookieHeader(csrf.headers.get('set-cookie') || csrf.headers.get('set-cookie2'));
  const csrfToken = csrf.headers.get('x-apple-csrf-token');
  const response = await requestPinnedHttps(
    new URL(`/api/v1/jobDetails/${jobNumber}`, pageUrl.origin),
    address,
    {
      ...commonHeaders,
      ...(cookie ? { cookie } : {}),
      ...(csrfToken ? { 'x-apple-csrf-token': csrfToken } : {}),
    },
  );
  if (response.statusCode < 200 || response.statusCode >= 300) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(decodeResponseBody(response.body, response.headers.get('content-type')));
  } catch {
    return null;
  }
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).res : null;
  if (!record || typeof record !== 'object') return null;
  const source = record as Record<string, unknown>;
  const locations = Array.isArray(source.locations) ? source.locations : [];
  const locationNames = locations
    .map((item) => item && typeof item === 'object' ? (item as Record<string, unknown>).name : null)
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  const description = [source.jobSummary, source.description].filter((item): item is string => typeof item === 'string' && item.trim().length > 0).join('\n\n');
  const requirements = [source.minimumQualifications, source.preferredQualifications]
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0).join('\n\n');
  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: source.postingTitle,
    description,
    qualifications: requirements || null,
    jobLocation: locationNames.length > 0 ? locationNames : null,
    employmentType: null,
    experienceRequirements: null,
    validThrough: null,
    baseSalary: null,
    source: 'apple_jobs_api',
  };
}

export async function fetchSafeExternalPage(rawUrl: string): Promise<ExternalPageContent> {
  let currentUrl = rawUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const resolved = await resolveExternalUrl(currentUrl);
    const googlePath = resolved.url.pathname.toLowerCase();
    const isGoogleCareers = /(?:^|\.)google\.com$/i.test(resolved.url.hostname)
      && (googlePath.includes('/about/careers/') || googlePath.includes('/jobs/results/'));
    const maxResponseBytes = isGoogleCareers ? GOOGLE_MAX_RESPONSE_BYTES : MAX_RESPONSE_BYTES;
    const response = await requestPinnedHttps(resolved.url, resolved.addresses[0], {}, false, maxResponseBytes);
    const location = response.headers.get('location');
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      if (!location) throw new ExternalFetchError('重定向响应缺少目标地址', 422);
      if (redirectCount === MAX_REDIRECTS) {
        throw new ExternalFetchError('重定向次数超过限制', 422);
      }
      currentUrl = new URL(location, resolved.url).toString();
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new ExternalFetchError(`目标页面返回 HTTP ${response.statusCode}`, 422, response.statusCode);
    }

    let rawContent = decodeResponseBody(response.body, response.headers.get('content-type'));
    let workdayStructuredData: Record<string, unknown> | null = null;
    // Workday's public pages occasionally return a tiny SPA redirect shell to
    // a pinned low-level HTTP client while returning the same public detail to
    // a browser-compatible fetch. Retry only this known shell on approved ATS
    // hosts; the URL was already validated above and the final host is checked
    // before accepting the fallback response.
    if (isSpaRedirectShell(rawContent) && /(?:\.myworkdayjobs\.com|\.wd\d+\.myworkdayjobs\.com)$/i.test(resolved.url.hostname)) {
      try {
        const browserResponse = await fetch(resolved.url, {
          // Do not follow an unvalidated redirect in this fallback path. The
          // pinned request above already handles safe redirects explicitly.
          redirect: 'manual',
          headers: {
            Accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.1',
            'Accept-Language': 'en-US,en;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          },
        });
        const finalUrl = new URL(browserResponse.url || resolved.url.toString());
        if (browserResponse.ok && finalUrl.hostname.toLowerCase() === resolved.url.hostname.toLowerCase()) {
          const fallbackBody = Buffer.from(await browserResponse.arrayBuffer());
          if (fallbackBody.length <= maxResponseBytes) rawContent = decodeResponseBody(fallbackBody, browserResponse.headers.get('content-type'));
        }
      } catch {
        // Keep the securely pinned shell response when the browser-compatible
        // retry is unavailable.
      }
      // The same Workday tenant exposes a public CXS JSON detail endpoint even
      // when the HTML request is reduced to an SPA shell. Derive the tenant,
      // site and posting slug from the official URL and use that read-only API.
      try {
        const detailUrl = buildWorkdayCxsDetailUrl(resolved.url.toString());
        if (detailUrl) {
          const detailResponse = await fetch(detailUrl, {
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            },
          });
          if (detailResponse.ok) {
            const detailPayload = await detailResponse.json() as Record<string, unknown>;
            const info = detailPayload.jobPostingInfo;
            if (info && typeof info === 'object') {
              const record = info as Record<string, unknown>;
              workdayStructuredData = {
                '@context': 'https://schema.org',
                '@type': 'JobPosting',
                title: record.title,
                description: record.jobDescription || record.description,
                employmentType: record.timeType || record.employmentType,
                jobLocation: record.primaryLocation || record.location,
                baseSalary: record.baseSalary || record.salary,
                validThrough: record.postingEndDate || record.validThrough,
                experienceRequirements: record.experience,
              };
            }
          }
        }
      } catch {
        // The shell remains usable as a last-resort status response.
      }
    }
    const metadata = extractPageMetadata(rawContent);
    if (!hasJobPostingStructuredData(metadata.structured_data) && resolved.url.hostname.toLowerCase() === 'jobs.apple.com') {
      try {
        const appleStructuredData = await fetchAppleStructuredData(resolved.url, resolved.addresses[0]);
        if (appleStructuredData) metadata.structured_data = [appleStructuredData];
      } catch {
        // Keep the public HTML response when the optional Apple API is unavailable.
      }
    }
    if (workdayStructuredData) metadata.structured_data = [workdayStructuredData];
    const pageContent = htmlToText(rawContent);
    return {
      title: extractTitle(rawContent),
      content: pageContent.slice(0, 20_000),
      url: resolved.url.toString(),
      httpStatus: response.statusCode,
      metadata,
    };
  }

  throw new ExternalFetchError('重定向处理失败', 422);
}

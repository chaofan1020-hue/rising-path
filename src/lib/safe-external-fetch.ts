import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_000_000;
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

function requestPinnedHttps(url: URL, address: { address: string; family: 4 | 6 }): Promise<{
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
        'user-agent': 'RisingPathExternalFetcher/1.0',
      },
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
    }, (response) => {
      const statusCode = response.statusCode || 0;
      const contentType = response.headers['content-type'] || '';
      const isRedirect = [301, 302, 303, 307, 308].includes(statusCode);
      if (!isRedirect && statusCode >= 200 && statusCode < 300 && !/^(text\/|application\/(json|xml|xhtml\+xml))/i.test(contentType)) {
        response.resume();
        finish(() => reject(new ExternalFetchError('目标内容不是可读取的文本页面', 422)));
        return;
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;
      response.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_RESPONSE_BYTES) {
          response.destroy();
          finish(() => reject(new ExternalFetchError('目标响应超过 1MB 限制', 413)));
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', () => {
        finish(() => reject(new ExternalFetchError('读取目标响应失败', 422)));
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
    request.on('error', () => {
      finish(() => reject(new ExternalFetchError('请求目标页面失败', 422)));
    });
    request.end();
  });
}

function htmlToText(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(value: string): string {
  const match = value.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? htmlToText(match[1]).slice(0, 500) : '';
}

export async function fetchSafeExternalPage(rawUrl: string): Promise<ExternalPageContent> {
  let currentUrl = rawUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const resolved = await resolveExternalUrl(currentUrl);
    const response = await requestPinnedHttps(resolved.url, resolved.addresses[0]);
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

    const rawContent = response.body.toString('utf8');
    return {
      title: extractTitle(rawContent),
      content: htmlToText(rawContent).slice(0, 5_000),
      url: resolved.url.toString(),
      httpStatus: response.statusCode,
    };
  }

  throw new ExternalFetchError('重定向处理失败', 422);
}

function parseOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function originAliases(origin: string): string[] {
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    const bare = host.startsWith('www.') ? host.slice(4) : host;
    const port = url.port ? `:${url.port}` : '';
    return Array.from(new Set([
      `${url.protocol}//${bare}${port}`,
      `${url.protocol}//www.${bare}${port}`,
    ]));
  } catch {
    return [origin];
  }
}

export function adminOriginsMatch(requestOrigin: string, allowedOrigin: string): boolean {
  const allowed = new Set(originAliases(allowedOrigin));
  return originAliases(requestOrigin).some((value) => allowed.has(value));
}

export function getAllowedAdminOrigin(): string | null {
  const configured = process.env.AUTH_SITE_URL?.trim();
  return parseOrigin(configured || null);
}

export function isAllowedAdminOrigin(request: Request): boolean {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
    return true;
  }

  const origin = parseOrigin(request.headers.get('origin'));
  const referer = parseOrigin(request.headers.get('referer'));
  const allowed = getAllowedAdminOrigin();
  const requestOrigin = origin || referer;

  if (!requestOrigin) return process.env.NODE_ENV !== 'production';
  if (allowed) return adminOriginsMatch(requestOrigin, allowed);
  if (process.env.NODE_ENV !== 'production') return true;
  return false;
}

export function rejectedAdminOriginResponse() {
  return Response.json(
    { data: null, error: { code: 'ADMIN_ORIGIN_REJECTED', message: '请求来源不被允许' } },
    { status: 403 },
  );
}

import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { getClientIp } from '@/lib/auth-server';
import { consumeAuthRateLimit } from '@/lib/auth-security';
import { ExternalFetchError, fetchSafeExternalPage } from '@/lib/safe-external-fetch';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.jobsWrite);
    if (permissionError) return permissionError;

    const rateLimit = await consumeAuthRateLimit(`admin-fetch-url:ip:${getClientIp(request)}`, 20, 300, 900);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: '请求过于频繁，请稍后再试' },
        { status: 429, headers: { 'Retry-After': String(Math.max(rateLimit.retryAfterSeconds, 30)) } },
      );
    }

    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof (body as { url?: unknown }).url !== 'string') {
      return NextResponse.json({ error: 'URL 格式无效' }, { status: 400 });
    }

    const page = await fetchSafeExternalPage((body as { url: string }).url);
    return NextResponse.json({
      success: true,
      title: page.title,
      content: page.content,
      url: page.url,
      status: `HTTP ${page.httpStatus}`,
    });
  } catch (error) {
    if (error instanceof ExternalFetchError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Fetch error:', error);
    return NextResponse.json({ error: '抓取页面失败' }, { status: 500 });
  }
}

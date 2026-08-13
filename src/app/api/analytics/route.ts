import { NextRequest, NextResponse } from 'next/server';
import { hasValidAdminSession } from '@/lib/admin-auth';

// Kept only to produce a clear response for callers that have not migrated.
// The administrator dashboard now uses /api/admin/analytics.
export async function GET(request: NextRequest) {
  if (!hasValidAdminSession(request)) {
    return NextResponse.json(
      { data: null, error: { code: 'ADMIN_UNAUTHORIZED', message: '需要管理员权限' } },
      { status: 401 },
    );
  }

  return NextResponse.json(
    { data: null, error: { code: 'ANALYTICS_ENDPOINT_RETIRED', message: '请使用 /api/admin/analytics' } },
    { status: 410 },
  );
}

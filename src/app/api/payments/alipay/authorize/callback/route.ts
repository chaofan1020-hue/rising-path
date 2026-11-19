import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * The site does not use Alipay OAuth/user authorization. Keep this callback
 * separate from the payment notification endpoint so an authorization
 * redirect can never be treated as a paid order notification.
 */
export async function GET(request: NextRequest) {
  return new NextResponse(null, {
    status: 303,
    headers: { Location: '/pay?alipay_auth=unsupported' },
  });
}

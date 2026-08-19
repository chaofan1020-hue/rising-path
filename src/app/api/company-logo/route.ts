import { NextRequest, NextResponse } from 'next/server';
import { getCompanyDomain, getCompanyFaviconUrl, getCompanyLogoUrl } from '@/lib/company-logo';

export async function GET(request: NextRequest) {
  const company = request.nextUrl.searchParams.get('company')?.trim();
  if (!company) {
    return NextResponse.json({ error: '公司名称不能为空' }, { status: 400 });
  }

  return NextResponse.json({
    company,
    domain: getCompanyDomain(company),
    logoUrl: getCompanyLogoUrl(company),
    fallbackLogoUrl: getCompanyFaviconUrl(company),
  });
}

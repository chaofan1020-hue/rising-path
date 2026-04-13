import { NextRequest, NextResponse } from 'next/server';

// 使用 Clearbit Logo API 获取企业 logo
function getLogoUrl(company: string): string {
  // 清理公司名称
  const cleanName = company
    .toLowerCase()
    .replace(/\s+(inc|corp|corporation|ltd|llc|co|com|io)\.?$/i, '')
    .trim();
  
  // Clearbit Logo API - 免费且可靠
  return `https://logo.clearbit.com/${cleanName}.com`;
}

// 公司域名映射（部分公司域名不是公司名.com）
const companyDomains: Record<string, string> = {
  'Stripe': 'stripe.com',
  'Airbnb': 'airbnb.com',
  'Uber': 'uber.com',
  'Lyft': 'lyft.com',
  'DoorDash': 'doordash.com',
  'Dropbox': 'dropbox.com',
  'Coinbase': 'coinbase.com',
  'Robinhood': 'robinhood.com',
  'Figma': 'figma.com',
  'Notion': 'notion.so',
  'Palantir': 'palantir.com',
  'Databricks': 'databricks.com',
  'Snowflake': 'snowflake.com',
  'Twilio': 'twilio.com',
  'Zoom': 'zoom.us',
  'Atlassian': 'atlassian.com',
  'Confluent': 'confluent.io',
  'MongoDB': 'mongodb.com',
  'Cloudflare': 'cloudflare.com',
  'Rubrik': 'rubrik.com',
  'Scale AI': 'scale.com',
  'OpenAI': 'openai.com',
  'Anthropic': 'anthropic.com',
  'Instacart': 'instacart.com',
  'Discord': 'discord.com',
  'Plaid': 'plaid.com',
  'Brex': 'brex.com',
  'Datadog': 'datadoghq.com',
  'GitLab': 'gitlab.com',
  'Google': 'google.com',
  'Meta': 'meta.com',
  'Apple': 'apple.com',
  'Microsoft': 'microsoft.com',
  'Amazon': 'amazon.com',
  'Netflix': 'netflix.com',
  'Tesla': 'tesla.com',
  'NVIDIA': 'nvidia.com',
  'Adobe': 'adobe.com',
  'Oracle': 'oracle.com',
  'Salesforce': 'salesforce.com',
  'Snap': 'snap.com',
  'Pinterest': 'pinterest.com',
  'LinkedIn': 'linkedin.com',
};

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const company = searchParams.get('company');
  
  if (!company) {
    return NextResponse.json({ error: '公司名称不能为空' }, { status: 400 });
  }
  
  const domain = companyDomains[company] || `${company.toLowerCase().replace(/\s+/g, '')}.com`;
  const logoUrl = `https://logo.clearbit.com/${domain}`;
  
  return NextResponse.json({
    company,
    logoUrl,
    domain,
  });
}

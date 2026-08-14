export const COMPANY_DOMAINS: Record<string, string> = {
  Accenture: 'accenture.com',
  Adobe: 'adobe.com',
  Amazon: 'amazon.com',
  'Apollo Global Management': 'apollo.com',
  'Ares Management': 'aresmgmt.com',
  Asana: 'asana.com',
  'Bain & Company': 'bain.com',
  'Bain Capital': 'baincapital.com',
  'Bank of America': 'bankofamerica.com',
  Barclays: 'barclays.com',
  BlackRock: 'blackrock.com',
  Blackstone: 'blackstone.com',
  'Boston Consulting Group': 'bcg.com',
  Brex: 'brex.com',
  'Bridgewater Associates': 'bridgewater.com',
  Brookfield: 'brookfield.com',
  Citadel: 'citadel.com',
  Citigroup: 'citigroup.com',
  Cloudflare: 'cloudflare.com',
  Coinbase: 'coinbase.com',
  Cursor: 'cursor.com',
  Databricks: 'databricks.com',
  Datadog: 'datadoghq.com',
  Deloitte: 'deloitte.com',
  'Deutsche Bank': 'db.com',
  Discord: 'discord.com',
  Duolingo: 'duolingo.com',
  Elastic: 'elastic.co',
  Evercore: 'evercore.com',
  'Fidelity Investments': 'fidelity.com',
  Figma: 'figma.com',
  'General Atlantic': 'generalatlantic.com',
  GitLab: 'gitlab.com',
  'Goldman Sachs': 'goldmansachs.com',
  Google: 'google.com',
  'Houlihan Lokey': 'hl.com',
  Intel: 'intel.com',
  'Jane Street': 'janestreet.com',
  Jefferies: 'jefferies.com',
  'JPMorgan Chase': 'jpmorganchase.com',
  KKR: 'kkr.com',
  Lazard: 'lazard.com',
  Linear: 'linear.app',
  'McKinsey & Company': 'mckinsey.com',
  Meta: 'meta.com',
  Microsoft: 'microsoft.com',
  'Millennium Management': 'mlp.com',
  MongoDB: 'mongodb.com',
  'Morgan Stanley': 'morganstanley.com',
  Notion: 'notion.so',
  NVIDIA: 'nvidia.com',
  Okta: 'okta.com',
  'Oliver Wyman': 'oliverwyman.com',
  OpenAI: 'openai.com',
  Palantir: 'palantir.com',
  Perplexity: 'perplexity.ai',
  PIMCO: 'pimco.com',
  Point72: 'point72.com',
  Ramp: 'ramp.com',
  Reddit: 'reddit.com',
  Robinhood: 'robinhood.com',
  Roblox: 'roblox.com',
  'Rothschild & Co': 'rothschildandco.com',
  Runway: 'runwayml.com',
  'State Street': 'statestreet.com',
  Stripe: 'stripe.com',
  'The Carlyle Group': 'carlyle.com',
  TPG: 'tpg.com',
  Twilio: 'twilio.com',
  'Two Sigma': 'twosigma.com',
  UBS: 'ubs.com',
  Vanguard: 'vanguard.com',
  Vanta: 'vanta.com',
  'Wells Fargo': 'wellsfargo.com',
};

const JOB_BOARD_HOSTS = new Set([
  'ashbyhq.com', 'avature.net', 'greenhouse.io', 'lever.co', 'myworkdayjobs.com',
  'oraclecloud.com', 'tal.net', 'workdayjobs.com', 'eightfold.ai', 'smartrecruiters.com',
  'icims.com', 'jobvite.com', 'bamboohr.com', 'workable.com', 'linkedin.com',
]);

const SECOND_LEVEL_COUNTRY_TLDS = new Set(['co.uk', 'org.uk', 'ac.uk', 'com.au', 'net.au', 'com.sg', 'co.nz']);

function slugifyCompanyName(company: string): string {
  return company
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(incorporated|corporation|company|limited|holdings|group)\b/g, '')
    .replace(/\b(inc|corp|co|ltd|llc)\.?\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function normalizeCompany(company: string): string {
  return company.trim().toLowerCase();
}

function companyMapDomain(company: string): string | null {
  const exact = Object.entries(COMPANY_DOMAINS).find(([name]) => normalizeCompany(name) === normalizeCompany(company));
  return exact?.[1] || null;
}

function domainFromJobUrl(jobUrl?: string | null): string | null {
  if (!jobUrl) return null;
  try {
    const hostname = new URL(jobUrl).hostname.toLowerCase().replace(/^www\./, '');
    if (!hostname || [...JOB_BOARD_HOSTS].some((host) => hostname === host || hostname.endsWith(`.${host}`))) return null;
    const labels = hostname.split('.').filter(Boolean);
    if (labels.length < 2) return null;
    const suffix = labels.slice(-2).join('.');
    return SECOND_LEVEL_COUNTRY_TLDS.has(suffix) && labels.length >= 3
      ? labels.slice(-3).join('.')
      : labels.slice(-2).join('.');
  } catch {
    return null;
  }
}

export function getCompanyDomain(company: string, jobUrl?: string | null): string | null {
  const mappedDomain = companyMapDomain(company);
  if (mappedDomain) return mappedDomain;

  const jobDomain = domainFromJobUrl(jobUrl);
  if (jobDomain) return jobDomain;

  // This is deliberately only a best-effort candidate. The UI already turns a
  // missing/invalid remote icon into an initial, so an unknown company cannot
  // produce a broken-image state.
  const inferredSlug = slugifyCompanyName(company);
  return inferredSlug ? `${inferredSlug}.com` : null;
}

export function getCompanyLogoUrl(company: string, jobUrl?: string | null): string | null {
  const domain = getCompanyDomain(company, jobUrl);
  if (!domain) return null;
  const slug = domain.split('.')[0].replace(/[^a-z0-9]/g, '');
  return slug ? `https://api.iconify.design/simple-icons:${slug}.svg` : null;
}

export function getCompanyFaviconUrl(company: string, jobUrl?: string | null): string | null {
  const domain = getCompanyDomain(company, jobUrl);
  return domain
    ? `https://favicon.im/${encodeURIComponent(domain)}`
    : null;
}

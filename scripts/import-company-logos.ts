import { config as loadDotenv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { COMPANY_DOMAINS, getCompanyDomain } from '@/lib/company-logo';

loadDotenv({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { timeout: 60_000 },
});

const SIMPLE_ICONS_DATA_URL = 'https://cdn.jsdelivr.net/npm/simple-icons@latest/_data/simple-icons.json';
const SIMPLE_ICONS_CDN = 'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons';
const STORAGE_BUCKET = 'risingpath-assets';
const STORAGE_PREFIX = 'logos/imported';
const PAGE_SIZE = 1000;
const dryRun = process.argv.includes('--dry-run');
const includeFavicons = process.argv.includes('--include-favicon');
const probeCdn = process.argv.includes('--probe-cdn');

type SimpleIconMeta = { title?: string; slug?: string };
type CompanyCandidate = { companyName: string; jobUrl: string | null };

const ICON_SLUG_ALIASES: Record<string, string[]> = {
  'Deutsche Bank': ['deutschebank', 'db'],
  'JPMorgan Chase': ['jpmorgan', 'jpmorganchase'],
  'Bank of America': ['bankofamerica'],
  'Boston Consulting Group': ['bcg'],
  'Bain & Company': ['bainandcompany', 'bain'],
  'Rothschild & Co': ['rothschildandco'],
};

const FAVICON_DOMAIN_ALIASES: Record<string, string> = {
  'State Street': 'careers.statestreet.com',
};

function normalizeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function companyNameSlugs(companyName: string, domain: string | null): string[] {
  const domainSlug = domain ? normalizeSlug(domain.split('.')[0]) : '';
  const nameSlug = normalizeSlug(companyName);
  return [...new Set([
    ...(ICON_SLUG_ALIASES[companyName] || []),
    domainSlug,
    nameSlug,
  ].filter(Boolean))];
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json() as Promise<T>;
}

async function loadSimpleIconSlugs(): Promise<Set<string>> {
  const data = await fetchJson<SimpleIconMeta[]>(SIMPLE_ICONS_DATA_URL);
  return new Set(data.flatMap((icon) => [
    icon.slug || '',
    icon.title ? normalizeSlug(icon.title) : '',
  ]).filter(Boolean));
}

async function resolveSimpleIconSlug(candidates: string[], knownSlugs: Set<string>): Promise<string | null> {
  for (const candidate of candidates) {
    if (knownSlugs.has(candidate)) return candidate;
    if (!probeCdn) continue;
    try {
      const response = await fetch(`${SIMPLE_ICONS_CDN}/${candidate}.svg`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return candidate;
    } catch {
      // Try the next candidate. A network miss must not stop the batch.
    }
  }
  return null;
}

async function loadCompanies(): Promise<CompanyCandidate[]> {
  const companies = new Map<string, string | null>();

  for (let offset = 0; offset < 50_000; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('jobs')
      .select('company, job_url')
      .eq('is_active', true)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to read jobs at ${offset}: ${error.message}`);

    for (const row of data || []) {
      const companyName = typeof row.company === 'string' ? row.company.trim() : '';
      if (!companyName) continue;
      const currentUrl = companies.get(companyName);
      if (!currentUrl && typeof row.job_url === 'string') companies.set(companyName, row.job_url);
      else if (!companies.has(companyName)) companies.set(companyName, null);
    }
    if (!data || data.length < PAGE_SIZE) break;
  }

  for (const companyName of Object.keys(COMPANY_DOMAINS)) {
    if (!companies.has(companyName)) companies.set(companyName, null);
  }

  return [...companies.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([companyName, jobUrl]) => ({ companyName, jobUrl }));
}

async function main() {
  const [simpleIconSlugs, companies, existingResult] = await Promise.all([
    loadSimpleIconSlugs(),
    loadCompanies(),
    supabase.from('company_logos').select('company_name, logo_url'),
  ]);
  if (existingResult.error) throw new Error(`Failed to read existing logos: ${existingResult.error.message}`);

  const existing = new Map((existingResult.data || []).map((row) => [row.company_name, row.logo_url]));
  const imported: Array<{ company: string; slug: string; source: string; url: string }> = [];
  const skipped: string[] = [];
  const notFound: string[] = [];

  for (const company of companies) {
    if (existing.get(company.companyName)) {
      skipped.push(company.companyName);
      continue;
    }

    const domain = getCompanyDomain(company.companyName, company.jobUrl);
    const slug = await resolveSimpleIconSlug(companyNameSlugs(company.companyName, domain), simpleIconSlugs);
    if (!slug) {
      if (!includeFavicons || !domain) {
        notFound.push(company.companyName);
        continue;
      }

      const faviconDomain = FAVICON_DOMAIN_ALIASES[company.companyName] || domain;
      const faviconUrl = `https://favicon.im/${encodeURIComponent(faviconDomain)}`;
      if (dryRun) {
        imported.push({ company: company.companyName, slug: `favicon:${faviconDomain}`, source: 'favicon', url: faviconUrl });
        continue;
      }

      const faviconResponse = await fetch(faviconUrl, { signal: AbortSignal.timeout(30_000) });
      const faviconType = faviconResponse.headers.get('content-type') || '';
      if (!faviconResponse.ok || !faviconType.startsWith('image/')) {
        notFound.push(`${company.companyName} (favicon ${faviconResponse.status})`);
        continue;
      }

      const favicon = Buffer.from(await faviconResponse.arrayBuffer());
      if (favicon.length < 256) {
        notFound.push(`${company.companyName} (favicon too small)`);
        continue;
      }

      const extension = faviconType.includes('svg') ? 'svg' : faviconType.includes('png') ? 'png' : faviconType.includes('jpeg') ? 'jpg' : 'ico';
      const storagePath = `${STORAGE_PREFIX}/${normalizeSlug(company.companyName)}.${extension}`;
      const { error: storageError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, favicon, {
          contentType: faviconType.split(';')[0],
          cacheControl: '31536000',
          upsert: true,
        });
      if (storageError) {
        notFound.push(`${company.companyName} (favicon upload failed)`);
        console.error(`Failed to upload favicon for ${company.companyName}: ${storageError.message}`);
        continue;
      }

      const { data: publicUrlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
      const logoUrl = publicUrlData.publicUrl;
      const { error: upsertError } = await supabase.from('company_logos').upsert({
        company_name: company.companyName,
        logo_url: logoUrl,
        updated_at: new Date().toISOString(),
      });
      if (upsertError) {
        notFound.push(`${company.companyName} (save failed)`);
        console.error(`Failed to save ${company.companyName}: ${upsertError.message}`);
        continue;
      }
      imported.push({ company: company.companyName, slug: `favicon:${faviconDomain}`, source: 'favicon', url: logoUrl });
      continue;
    }

    const sourceUrl = `${SIMPLE_ICONS_CDN}/${slug}.svg`;
    if (dryRun) {
      imported.push({ company: company.companyName, slug, source: 'simple-icons', url: sourceUrl });
      continue;
    }

    const sourceResponse = await fetch(sourceUrl, { signal: AbortSignal.timeout(30_000) });
    if (!sourceResponse.ok) {
      notFound.push(`${company.companyName} (${sourceResponse.status})`);
      continue;
    }

    const svg = Buffer.from(await sourceResponse.arrayBuffer());
    const storagePath = `${STORAGE_PREFIX}/${slug}.svg`;
    const { error: storageError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, svg, {
        contentType: 'image/svg+xml',
        cacheControl: '31536000',
        upsert: true,
      });

    if (storageError) {
      notFound.push(`${company.companyName} (upload failed)`);
      console.error(`Failed to upload ${company.companyName}: ${storageError.message}`);
      continue;
    }

    const { data: publicUrlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
    const logoUrl = publicUrlData.publicUrl;
    const { error: upsertError } = await supabase.from('company_logos').upsert({
      company_name: company.companyName,
      logo_url: logoUrl,
      updated_at: new Date().toISOString(),
    });
    if (upsertError) {
      notFound.push(`${company.companyName} (save failed)`);
      console.error(`Failed to save ${company.companyName}: ${upsertError.message}`);
      continue;
    }
    imported.push({ company: company.companyName, slug, source: 'simple-icons', url: logoUrl });
  }

  console.log(JSON.stringify({
    dryRun,
    totalCompanies: companies.length,
    importedCount: imported.length,
    skippedCount: skipped.length,
    notFoundCount: notFound.length,
    imported,
    notFound,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

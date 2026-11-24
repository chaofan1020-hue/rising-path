import assert from 'node:assert/strict';
import {
  getCompanyBackupFaviconUrl,
  getCompanyFaviconUrl,
  getCompanyLogoUrl,
  isMonochromeLogoUrl,
  resolveDisplayLogoUrls,
} from '@/lib/company-logo';

assert.equal(getCompanyFaviconUrl('Amazon'), 'https://favicon.im/amazon.com?larger=true');
assert.equal(getCompanyBackupFaviconUrl('Amazon'), 'https://www.google.com/s2/favicons?domain=amazon.com&sz=128');
assert.equal(getCompanyLogoUrl('Amazon'), 'https://api.iconify.design/simple-icons:amazon.svg');

const amazon = resolveDisplayLogoUrls('Amazon');
assert.equal(amazon.logo_url, 'https://favicon.im/amazon.com?larger=true');
assert.equal(amazon.logo_fallback_url, 'https://www.google.com/s2/favicons?domain=amazon.com&sz=128');

const uploaded = resolveDisplayLogoUrls('Amazon', null, 'https://cdn.example.com/amazon.png');
assert.equal(uploaded.logo_url, 'https://cdn.example.com/amazon.png');
assert.equal(uploaded.logo_fallback_url, 'https://favicon.im/amazon.com?larger=true');

assert.equal(isMonochromeLogoUrl('https://api.iconify.design/simple-icons:amazon.svg'), true);
assert.equal(isMonochromeLogoUrl('https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/amazon.svg'), true);
assert.equal(isMonochromeLogoUrl('https://example.supabase.co/storage/v1/object/public/risingpath-assets/logos/imported/amazon.svg'), true);
assert.equal(isMonochromeLogoUrl('https://cdn.example.com/amazon.png'), false);

const skippedIconify = resolveDisplayLogoUrls('Amazon', null, 'https://api.iconify.design/simple-icons:amazon.svg');
assert.equal(skippedIconify.logo_url, 'https://favicon.im/amazon.com?larger=true');
assert.equal(skippedIconify.logo_fallback_url, 'https://www.google.com/s2/favicons?domain=amazon.com&sz=128');

const evercore = resolveDisplayLogoUrls('Evercore', 'https://evercore.tal.net/vx/mobile-0/appcentre-ext/brand-4/candidate/job/3298/details?ref=rss');
assert.equal(evercore.logo_url, 'https://favicon.im/evercore.com?larger=true');

async function testCompanyOptionsRefresh() {
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

  const originalFetch = globalThis.fetch;
  const originalLogo = 'https://cdn.example.com/amazon-first.png';
  const replacementLogo = 'https://cdn.example.com/amazon-replacement.png';
  const configuredLogo = 'https://cdn.example.com/amazon-configured.png';
  let uploaded: string | null = originalLogo;
  let configured: string | null = configuredLogo;
  let aggregateReads = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.origin, 'https://supabase.test');
    switch (url.pathname) {
      case '/rest/v1/rpc/list_active_company_options':
        aggregateReads += 1;
        return Response.json([{ company_name: 'Amazon', job_count: 12, logo_url: originalLogo }]);
      case '/rest/v1/company_logos':
        return Response.json(uploaded ? [{ company_name: 'Amazon', logo_url: uploaded }] : []);
      case '/rest/v1/company_config':
        assert.equal(url.searchParams.get('is_active'), 'eq.true');
        return Response.json(configured ? [{ company_name: 'Amazon', logo_url: configured }] : []);
      default:
        throw new Error(`Unexpected Supabase request: ${url.pathname}`);
    }
  };

  try {
    const { GET } = await import('../src/app/api/jobs/companies/route');
    const read = (etag?: string) => GET(new Request('https://example.com/api/jobs/companies', {
      headers: etag ? { 'If-None-Match': etag } : undefined,
    }));

    const [first, concurrent] = await Promise.all([read(), read()]);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('cache-control'), 'private, no-cache');
    assert.equal(concurrent.headers.get('etag'), first.headers.get('etag'));
    assert.equal((await first.json()).companies[0].logo_url, originalLogo);
    const firstTag = first.headers.get('etag');
    assert.ok(firstTag);
    const unchanged = await read(firstTag);
    assert.equal(unchanged.status, 304);
    assert.equal(await unchanged.text(), '');

    uploaded = replacementLogo;
    const updated = await read(firstTag);
    assert.equal(updated.status, 200);
    assert.notEqual(updated.headers.get('etag'), firstTag);
    assert.deepEqual(await updated.json(), {
      companies: [{
        company_name: 'Amazon',
        logo_url: replacementLogo,
        fallback_logo_url: 'https://favicon.im/amazon.com?larger=true',
        job_count: 12,
      }],
      total: 1,
    });

    uploaded = null;
    assert.equal((await (await read()).json()).companies[0].logo_url, configuredLogo);
    configured = null;
    assert.equal((await (await read()).json()).companies[0].logo_url, 'https://favicon.im/amazon.com?larger=true');
    assert.equal(aggregateReads, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

testCompanyOptionsRefresh().then(() => {
  console.log('company logo and filter cache tests passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

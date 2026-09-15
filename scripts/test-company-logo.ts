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

console.log('company logo tests passed');

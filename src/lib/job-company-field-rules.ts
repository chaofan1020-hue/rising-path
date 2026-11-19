import { isTrustedJobFieldSource } from '@/lib/job-field-provenance';

export interface JobCompanyFieldRule {
  company: string;
  aliases: string[];
  officialHosts: string[];
  allowedSources: string[];
}

const RULES: JobCompanyFieldRule[] = [
  {
    company: 'Amazon',
    aliases: ['amazon'],
    officialHosts: ['www.amazon.jobs', 'amazon.jobs'],
    // Amazon search.json already publishes city/country on the listing.
    // Official detail backfill may later upgrade the same field to a page
    // evidence source; both remain candidate-safe.
    allowedSources: [
      'official_payload',
      'official_detail_page',
      'official_description',
      'official_link_description',
      'official_link_structured_field',
    ],
  },
  {
    company: 'Apple',
    aliases: ['apple'],
    officialHosts: ['jobs.apple.com'],
    // jobs.apple.com search JSON already includes locations[].name/city.
    // Detail backfill may later upgrade the same city to page evidence.
    allowedSources: [
      'official_payload',
      'official_detail_page',
      'official_link_structured_field',
    ],
  },
  {
    company: 'Citadel',
    aliases: ['citadel'],
    officialHosts: ['www.citadel.com'],
    // The public career sitemap encodes an explicit location token in the
    // canonical URL (for example `...-new-york/` or `...-us/`). Treat the
    // resulting location as official payload evidence, while leaving fields
    // absent from the sitemap unset. Browser-imported official detail pages
    // may later fill description and location that the sitemap omitted.
    allowedSources: ['official_payload', 'official_detail_page'],
  },
  {
    company: 'Morgan Stanley',
    aliases: ['morgan stanley'],
    officialHosts: ['morganstanley.tal.net'],
    allowedSources: ['official_payload', 'official_description'],
  },
  {
    company: 'Evercore',
    aliases: ['evercore'],
    officialHosts: ['evercore.tal.net'],
    // Taleo RSS has no location element. The collector fills location from the
    // official bare detail page (`detail_location`) but currently omits
    // structured_field_sources.location, so the US feed must trust the host.
    allowedSources: [
      'official_payload',
      'official_description',
      'official_detail_page',
      'official_link_description',
      'official_link_structured_field',
    ],
  },
  {
    company: 'Shopify',
    aliases: ['shopify'],
    officialHosts: ['www.shopify.com', 'shopify.com'],
    allowedSources: ['official_payload', 'official_description'],
  },
  {
    company: 'Airbnb',
    aliases: ['airbnb'],
    officialHosts: ['careers.airbnb.com', 'boards.greenhouse.io', 'job-boards.greenhouse.io'],
    allowedSources: ['official_payload', 'official_description'],
  },
  {
    company: 'Lyft',
    aliases: ['lyft'],
    officialHosts: ['app.careerpuck.com', 'www.lyft.com', 'boards.greenhouse.io', 'job-boards.greenhouse.io'],
    allowedSources: ['official_payload', 'official_description'],
  },
  {
    company: 'Uber',
    aliases: ['uber'],
    officialHosts: ['iaziqy.fa.ocs.oraclecloud.com', 'jobs.uber.com'],
    allowedSources: ['official_payload', 'official_description'],
  },
  {
    company: 'Cisco',
    aliases: ['cisco'],
    officialHosts: ['careers.cisco.com'],
    allowedSources: ['official_payload', 'official_description'],
  },
  {
    company: 'Qualcomm',
    aliases: ['qualcomm'],
    officialHosts: ['careers.qualcomm.com'],
    allowedSources: ['official_payload', 'official_description'],
  },
  {
    company: 'AMD',
    aliases: ['amd', 'advanced micro devices'],
    officialHosts: ['careers.amd.com'],
    allowedSources: ['official_payload', 'official_description'],
  },
  {
    company: 'Dell Technologies',
    aliases: ['dell technologies', 'dell'],
    officialHosts: ['iawmqy.fa.ocs.oraclecloud.com', 'enterpriseplatform.dell.com', 'jobs.dell.com'],
    allowedSources: ['official_payload', 'official_description'],
  },
  {
    company: 'Broadcom',
    aliases: ['broadcom'],
    officialHosts: ['broadcom.wd1.myworkdayjobs.com'],
    allowedSources: ['official_payload', 'official_description'],
  },
  {
    company: 'ServiceNow',
    aliases: ['servicenow'],
    officialHosts: ['jobs.smartrecruiters.com', 'careers.smartrecruiters.com', 'api.smartrecruiters.com'],
    allowedSources: ['official_payload', 'official_description'],
  },
  {
    company: 'McKinsey & Company',
    aliases: ['mckinsey & company', 'mckinsey'],
    // The upstream collector uses McKinsey's public gateway API for the
    // payload, while each record retains the canonical Avature application
    // URL as its official source URL.
    officialHosts: ['mckinsey.avature.net', 'jobs.mckinsey.com', 'gateway.mckinsey.com'],
    allowedSources: ['official_payload', 'official_description'],
  },
  {
    company: 'LinkedIn',
    aliases: ['linkedin'],
    officialHosts: ['www.linkedin.com', 'linkedin.com'],
    // Official company-job cards expose city/workplace in the list payload.
    // The collector public_feed currently omits structured_field_sources, so
    // the US feed trusts the official host the same way as Evercore RSS.
    allowedSources: ['official_payload', 'official_detail_page'],
  },
];

export function getJobCompanyFieldRule(company: string | null | undefined): JobCompanyFieldRule | null {
  const normalized = company?.trim().toLowerCase();
  return normalized ? RULES.find((rule) => rule.aliases.includes(normalized)) || null : null;
}

export function isCompanyFieldEvidenceTrusted(
  company: string | null | undefined,
  sourceUrl: string | null | undefined,
  source: string | null | undefined,
): boolean {
  if (!isTrustedJobFieldSource(source)) return false;
  const rule = getJobCompanyFieldRule(company);
  if (!rule) return true;
  if (!source || !rule.allowedSources.includes(source.trim().toLowerCase())) return false;
  try {
    return Boolean(sourceUrl && rule.officialHosts.includes(new URL(sourceUrl).hostname.toLowerCase()));
  } catch {
    return false;
  }
}

/** A narrow fallback for ATS list payloads that omit a per-field location tag. */
export function hasOfficialCompanyHost(company: string | null | undefined, sourceUrl: string | null | undefined): boolean {
  const rule = getJobCompanyFieldRule(company);
  if (!rule || !sourceUrl) return false;
  try {
    return rule.officialHosts.includes(new URL(sourceUrl).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export const JOB_COMPANY_FIELD_RULES = RULES;

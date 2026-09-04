import { isTrustedJobFieldSource } from '@/lib/job-field-provenance';

export interface JobCompanyFieldRule {
  company: string;
  aliases: string[];
  officialHosts: string[];
  allowedSources: string[];
}

const RULES: JobCompanyFieldRule[] = [
  {
    company: 'Morgan Stanley',
    aliases: ['morgan stanley'],
    officialHosts: ['morganstanley.tal.net'],
    allowedSources: ['official_payload', 'official_description'],
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

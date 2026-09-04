export type JobFieldName = 'deadline' | 'salary' | 'location' | 'employment_type' | 'employment_category' | 'workplace_type' | 'experience';
export type JobFieldStatus = 'verified' | 'pending_recheck' | 'rejected_legacy';

export interface JobFieldEvidence {
  status: JobFieldStatus;
  source: string | null;
  evidence_url: string | null;
  evidence_kind: 'official_payload' | 'official_detail_page' | 'legacy' | null;
  verified_at: string | null;
  rejected_reason?: string;
}

const TRUSTED_SOURCES = new Set([
  'official_payload',
  'official_detail_page',
  'official_description',
  'official_link_valid_through',
  'official_link_application_deadline',
  'official_link_structured_field',
  'official_link_description',
]);

export function isTrustedJobFieldSource(source: string | null | undefined): boolean {
  return Boolean(source && TRUSTED_SOURCES.has(source.trim().toLowerCase()));
}

export function fieldEvidence(
  source: string | null | undefined,
  evidenceUrl: string | null | undefined,
  now = new Date().toISOString(),
  rejectedReason = '缺少可验证的官网字段来源',
): JobFieldEvidence {
  const normalizedSource = source?.trim().toLowerCase() || null;
  const trusted = isTrustedJobFieldSource(normalizedSource);
  return {
    status: trusted ? 'verified' : 'pending_recheck',
    source: normalizedSource,
    evidence_url: evidenceUrl?.trim() || null,
    evidence_kind: trusted
      ? normalizedSource === 'official_detail_page' || normalizedSource?.startsWith('official_link_') ? 'official_detail_page' : 'official_payload'
      : null,
    verified_at: trusted ? now : null,
    ...(trusted ? {} : { rejected_reason: rejectedReason }),
  };
}

export function isVerifiedField(value: unknown, source: string | null | undefined): boolean {
  return value != null && value !== '' && isTrustedJobFieldSource(source);
}

import { resolveRegionKey, type RegionKey } from '@/lib/region-dna';

type RegionResumeLike = {
  segmentation_overrides?: { regions?: unknown } | null;
  segmentation?: { regions?: unknown } | null;
  profile?: {
    targetRegion?: unknown;
    inferredRegion?: unknown;
    intention?: { locations?: unknown } | null;
  } | null;
} | null | undefined;

function firstRegion(value: unknown): RegionKey | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const region = resolveRegionKey(item);
    if (region) return region;
  }
  return null;
}

/**
 * Resolve the user's current job-search market without changing the resume's
 * inferred profile. Explicit account preference always wins over resume data.
 */
export function resolveActiveRegion(
  preferredRegion: unknown,
  resume: RegionResumeLike,
): RegionKey | null {
  const resumeExplicit = firstRegion(resume?.segmentation_overrides?.regions)
    || (typeof resume?.profile?.targetRegion === 'string'
      ? resolveRegionKey(resume.profile.targetRegion)
      : null);
  if (resumeExplicit) return resumeExplicit;

  if (typeof preferredRegion === 'string') {
    const explicit = resolveRegionKey(preferredRegion);
    if (explicit) return explicit;
  }

  return (
    firstRegion(resume?.segmentation?.regions)
    || firstRegion(resume?.profile?.intention?.locations)
    || (typeof resume?.profile?.inferredRegion === 'string'
      ? resolveRegionKey(resume.profile.inferredRegion)
      : null)
  );
}

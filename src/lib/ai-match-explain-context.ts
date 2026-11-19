import { resolveRegionKey, buildRegionBlock, type RegionKey } from '@/lib/region-dna';
import { buildSegmentBlock } from '@/lib/user-segmentation';
import type { UserSegmentation } from '@/lib/resume-types';

type MatchLocale = 'zh-CN' | 'zh-TW' | 'en';

export function buildMatchExplainContext(input: {
  segmentation?: UserSegmentation | null;
  jobs: Array<{ region?: string | null }>;
  locale: MatchLocale;
}): { regionBlock: string; segmentBlock: string } {
  const lang = input.locale === 'en' ? 'en' : 'zh';
  const keys = new Set<RegionKey>();
  for (const region of input.segmentation?.regions || []) keys.add(region);
  for (const job of input.jobs) {
    const key = resolveRegionKey(job.region);
    if (key) keys.add(key);
  }
  const regionBlock = [...keys].slice(0, 3).map((key) => buildRegionBlock(key, lang)).join('\n\n');
  const segmentation = input.segmentation;
  const segmentBlock = segmentation?.careerStage && segmentation.experienceQuality
    ? buildSegmentBlock(segmentation, lang)
    : '';
  return { regionBlock, segmentBlock };
}

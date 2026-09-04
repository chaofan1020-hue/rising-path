import { createTextProviderClient } from '@/lib/ai/text-provider';
import { invokeTrackedTextGeneration } from '@/lib/ai-usage';
import { buildRegionBlock, type RegionKey } from '@/lib/region-dna';
import { extractFirstJsonObject } from '@/lib/json-extract';
import { buildVisaTimeline, resolveVisaStatusForRegion } from '@/lib/visa-timeline';
import type {
  LocalizedPlanText,
  PlanLocale,
  PlanRefinement,
  ResumeProfile,
  UserSegmentation,
} from '@/lib/resume-types';

export interface RefineCareerPlanInput {
  userId?: string | null;
  profile: ResumeProfile;
  segmentation: UserSegmentation;
  region: RegionKey | null;
  now?: Date;
}

const LOCALES: PlanLocale[] = ['zh-CN', 'zh-TW', 'en'];

function normalizeLocalized(value: unknown): LocalizedPlanText | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const result: LocalizedPlanText = {};
  for (const locale of LOCALES) {
    if (typeof record[locale] === 'string' && record[locale].trim()) {
      result[locale] = record[locale].trim();
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function buildPrompt(input: RefineCareerPlanInput): string {
  const now = input.now || new Date();
  const latestEducation = [...(input.profile.education || [])]
    .sort((a, b) => (b.endYear || 0) - (a.endYear || 0))[0];
  const visaTimeline = input.region
    ? buildVisaTimeline({
        region: input.region,
        visaStatus: resolveVisaStatusForRegion(input.profile.intention, input.region),
        visaDates: input.profile.intention?.visaDates,
        programEndYear: latestEducation?.endYear,
        now,
      })
    : null;
  const regionVisaStatus = input.region
    ? resolveVisaStatusForRegion(input.profile.intention, input.region)
    : null;
  const profileSummary = [
    `Education: ${(input.profile.education || []).map((item) => [item.school, item.degree, item.major, item.endYear].filter(Boolean).join(' / ')).join('; ')}`,
    `Internships: ${(input.profile.internships || []).map((item) => [item.company, item.role, item.months].filter(Boolean).join(' / ')).join('; ')}`,
    `Work: ${(input.profile.workExperience || []).map((item) => [item.company, item.role, item.months].filter(Boolean).join(' / ')).join('; ')}`,
    `Projects: ${(input.profile.projects || []).map((item) => [item.name, item.role, ...(item.techStack || []), ...(item.outcomes || [])].filter(Boolean).join(' / ')).join('; ')}`,
    `Skills: ${(input.profile.skills || []).join(', ')}`,
    `Certificates: ${(input.profile.certificates || []).join(', ')}`,
    `Languages: ${(input.profile.languages || []).join(', ')}`,
    `Target roles: ${(input.profile.intention?.roles || []).join(', ')}`,
    `Target industries: ${(input.profile.intention?.industries || []).join(', ')}`,
    `Target companies: ${(input.profile.intention?.targetCompanies || []).join(', ')}`,
    `Intention: ${JSON.stringify(input.profile.intention || {})}`,
    `Signals: ${JSON.stringify(input.profile.careerSignals || {})}`,
    `Identity/visa: ${input.profile.intention?.workAuthorization || regionVisaStatus || 'unknown'}`,
    `Visa timeline: ${JSON.stringify(visaTimeline?.entries || [])}`,
  ].join('\n');
  const regionBlock = input.region ? buildRegionBlock(input.region, 'zh') : '';
  const segmentationBlock = [
    `Stage: ${input.segmentation.careerStage}`,
    `School tier: ${input.segmentation.schoolTier}`,
    `Major match: ${input.segmentation.majorMatch || 'unknown'}`,
    `Regions: ${(input.segmentation.regions || []).join(', ')}`,
  ].join('\n');
  return [
    '你是求职规划顾问。请根据候选人的简历画像、分层信息和地区招聘逻辑，生成三语言版本的个人求职规划说明。',
    '要求：',
    '1. 明确当前招聘窗口、主线路线和备选路线。',
    '2. 必须结合毕业时间、学历、目标地区、目标行业和已有经历，不能只按专业下结论。',
    '3. 每份文本控制在 150 字以内，语气具体、可执行。',
    '4. 必须结合当前身份/签证状态判断备选路线是否可行，并说明是否需要雇主 Sponsorship。',
    '5. 涉及签证、排名、比例和截止日期时，必须提醒以最新官方信息核实。',
    '6. 只返回 JSON，格式：',
    '{"narratives":{"zh-CN":"...","zh-TW":"...","en":"..."},"backupRoutes":{"zh-CN":"...","zh-TW":"...","en":"..."},"verificationNotes":{"zh-CN":"...","zh-TW":"...","en":"..."},"visaNotes":{"zh-CN":"...","zh-TW":"...","en":"..."}}',
    '',
    `当前时间：${now.toISOString()}`,
    `地区：${input.region || '未知'}`,
    `候选分层：\n${segmentationBlock}`,
    `简历画像：\n${profileSummary}`,
    regionBlock ? `地区招聘逻辑：\n${regionBlock}` : '',
  ].filter(Boolean).join('\n');
}

export async function refineCareerPlan(
  input: RefineCareerPlanInput,
): Promise<PlanRefinement | null> {
  try {
    const client = createTextProviderClient();
    const response = await invokeTrackedTextGeneration(client, [
      { role: 'system', content: '你是一个严谨的求职规划顾问，只输出 JSON。' },
      { role: 'user', content: buildPrompt(input) },
    ], { temperature: 0.3, thinking: 'disabled' }, {
      userId: input.userId,
      feature: 'career_plan_refine',
    });

    const parsed = extractFirstJsonObject(response.content || '');
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    const narratives = normalizeLocalized(record.narratives);
    const backupRoutes = normalizeLocalized(record.backupRoutes);
    const verificationNotes = normalizeLocalized(record.verificationNotes);
    const visaNotes = normalizeLocalized(record.visaNotes);
    const refinement: PlanRefinement = {};
    if (narratives) {
      refinement.narratives = narratives;
      refinement.narrative = narratives['zh-CN'];
    }
    if (backupRoutes) {
      refinement.backupRoutes = backupRoutes;
      refinement.backupRoute = backupRoutes['zh-CN'];
    }
    if (verificationNotes) {
      refinement.verificationNotes = verificationNotes;
      refinement.verificationNote = verificationNotes['zh-CN'];
    }
    if (visaNotes) {
      refinement.visaNotes = visaNotes;
      refinement.visaNote = visaNotes['zh-CN'];
    }
    refinement.regionKey = input.region ?? undefined;
    return Object.keys(refinement).length > 0 ? refinement : null;
  } catch (error) {
    console.error('[CareerPlanRefiner] LLM refinement failed:', error);
    return null;
  }
}

import { createTextProviderClient } from '@/lib/ai/text-provider';
import { invokeTrackedTextGeneration } from '@/lib/ai-usage';
import { extractFirstJsonObject } from '@/lib/json-extract';
import type { PlanLocale } from '@/lib/resume-types';
import type { RegionKey } from '@/lib/region-dna';
import type { ResumeProfile, UserSegmentation } from '@/lib/resume-types';

export interface NetworkingPeopleType {
  title: string;
  keywords: string[];
  why: string;
}

export interface NetworkingOutreach {
  scenario: string;
  script: string;
}

export interface NetworkingSequence {
  step: string;
  action: string;
}

export interface NetworkingRecommendation {
  peopleTypes: NetworkingPeopleType[];
  searchKeywords: string[];
  outreach: NetworkingOutreach[];
  sequence: NetworkingSequence[];
  stageTips: string[];
  conversationQuestions: string[];
  maintenanceContent: Array<{ title: string; channel: string; content: string }>;
}

export interface NetworkingProgress {
  stage: number;
  completedMilestones: string[];
  recommendations: Record<string, NetworkingRecommendation>;
  region?: RegionKey | null;
  updatedAt: string;
}

export interface NetworkingStage {
  key: string;
  titleKey: string;
  milestones: string[];
}

export const NETWORKING_STAGES: NetworkingStage[] = [
  {
    key: 'research',
    titleKey: 'dashboard.networking.stage.research',
    milestones: [
      'dashboard.networking.milestone.research.list20',
      'dashboard.networking.milestone.research.prioritize5',
      'dashboard.networking.milestone.research.learnCompany',
    ],
  },
  {
    key: 'outreach',
    titleKey: 'dashboard.networking.stage.outreach',
    milestones: [
      'dashboard.networking.milestone.outreach.personalize10',
      'dashboard.networking.milestone.outreach.send5',
      'dashboard.networking.milestone.outreach.trackResponses',
    ],
  },
  {
    key: 'coffee_chat',
    titleKey: 'dashboard.networking.stage.coffeeChat',
    milestones: [
      'dashboard.networking.milestone.chat.schedule2',
      'dashboard.networking.milestone.chat.prepareQuestions',
      'dashboard.networking.milestone.chat.takeNotes',
    ],
  },
  {
    key: 'maintain',
    titleKey: 'dashboard.networking.stage.maintain',
    milestones: [
      'dashboard.networking.milestone.maintain.thankYou',
      'dashboard.networking.milestone.maintain.twoWeekFollowUp',
      'dashboard.networking.milestone.maintain.shareContent',
    ],
  },
  {
    key: 'referral',
    titleKey: 'dashboard.networking.stage.referral',
    milestones: [
      'dashboard.networking.milestone.referral.askAdvice',
      'dashboard.networking.milestone.referral.requestReferral',
      'dashboard.networking.milestone.referral.deepenRelationship',
    ],
  },
];

export interface NetworkingContext {
  school: string;
  region: string;
  role: string;
  industries: string[];
  targetCompanies: string[];
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .map((item) => item.trim())
    .slice(0, 20);
}

export function collectTargetCompanies(
  userCompanies: string[] = [],
  favoriteCompanies: string[] = [],
  interviewCompanies: string[] = [],
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const push = (value: string) => {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) return;
    seen.add(key);
    result.push(normalized);
  };
  [...userCompanies, ...favoriteCompanies, ...interviewCompanies].forEach(push);
  return result.slice(0, 20);
}

export function buildNetworkingContext(input: {
  profile: ResumeProfile | null | undefined;
  segmentation: UserSegmentation | null | undefined;
  region: RegionKey | null;
  favoriteCompanies: string[];
  interviewCompanies: string[];
}): NetworkingContext {
  const latestEducation = [...(input.profile?.education || [])]
    .sort((a, b) => (b.endYear || 0) - (a.endYear || 0))[0];
  return {
    school: latestEducation?.school || '',
    region: input.region || '',
    role: input.profile?.intention?.roles?.[0] || input.segmentation?.targetRole || '',
    industries: input.profile?.intention?.industries || [],
    targetCompanies: collectTargetCompanies(
      input.profile?.intention?.targetCompanies,
      input.favoriteCompanies,
      input.interviewCompanies,
    ),
  };
}

export function buildNetworkingPrompt(
  context: NetworkingContext,
  lang: PlanLocale,
): string {
  const languageInstruction = {
    'zh-CN': '所有生成内容使用简体中文。',
    'zh-TW': '所有生成內容使用繁體中文。',
    en: 'Generate all content in English.',
  }[lang];
  return [
    languageInstruction,
    '你是帮助低年级学生和准备期求职者建立 LinkedIn 人脉的顾问。',
    '请基于候选人的学校、目标地区、求职方向、目标行业和目标公司生成 Networking 建议。',
    '要求：',
    '1. 为 5 个阶段分别生成建议，阶段：人脉清单、发送邀请、Coffee Chat、跟进维护、内推/信息获取。',
    '2. 每个阶段必须包含 peopleTypes、searchKeywords、outreach、sequence、stageTips、conversationQuestions、maintenanceContent。',
    '3. 每个阶段的 peopleTypes 给出 3-5 类值得建立的人脉，每类包含 title、keywords 和 why。',
    '4. 每个阶段的 searchKeywords 给出 5-8 条 LinkedIn 搜索关键词组合。',
    '5. 每个阶段的 outreach 给出冷开场、约谈、跟进三类话术。',
    '6. 每个阶段的 sequence 给出未来 2 周的 4-6 个联系步骤。',
    '7. 每个阶段的 stageTips 给出 3-5 条执行要点，conversationQuestions 给出 5-8 个沟通问题，maintenanceContent 给出 3-5 条维护内容。',
    '8. 不同阶段内容必须明显不同，不能复用同一套话术。',
    '9. 如果目标公司为空，推荐值得研究的公司并说明原因。',
    '10. 只返回 JSON，格式：',
    '{"stages":{"1":{"peopleTypes":[{"title":"","keywords":[],"why":""}],"searchKeywords":[],"outreach":[{"scenario":"","script":""}],"sequence":[{"step":"","action":""}],"stageTips":[],"conversationQuestions":[],"maintenanceContent":[{"title":"","channel":"","content":""}]},"2":{},"3":{},"4":{},"5":{}}}',
    '',
    `学校：${context.school || '未知'}`,
    `目标地区：${context.region || '未知'}`,
    `求职方向：${context.role || '未知'}`,
    `目标行业：${context.industries.join(', ') || '未知'}`,
    `目标公司：${context.targetCompanies.join(', ') || '未提供'}`,
  ].join('\n');
}

export function buildStageNetworkingPrompt(
  context: NetworkingContext,
  lang: PlanLocale,
  stage: number,
): string {
  const languageInstruction = {
    'zh-CN': '所有生成内容使用简体中文。',
    'zh-TW': '所有生成內容使用繁體中文。',
    en: 'Generate all content in English.',
  }[lang];
  const stageTitle = NETWORKING_STAGES[stage - 1]?.titleKey || 'dashboard.networking.stage.research';
  return [
    languageInstruction,
    '你是帮助低年级学生和准备期求职者建立 LinkedIn 人脉的顾问。',
    '请基于候选人的学校、目标地区、求职方向、目标行业和目标公司，为当前阶段生成 Networking 建议。',
    '要求：',
    '1. peopleTypes 给出 3-5 类值得建立的人脉，每类包含 title、keywords 和 why。',
    '2. searchKeywords 给出 5-8 条 LinkedIn 搜索关键词组合。',
    '3. outreach 给出冷开场、约谈、跟进三类话术，每类 scenario 和 script。',
    '4. sequence 给出未来 2 周的 4-6 个联系步骤，每步 step 和 action。',
    '5. stageTips 给出当前阶段最重要的 3-5 条执行要点。',
    '6. conversationQuestions 给出适合当前阶段的 5-8 个沟通问题。',
    '7. maintenanceContent 给出 3-5 条维护关系内容，每条包含 title、channel 和 content。',
    '8. 如果目标公司为空，推荐值得研究的公司并说明原因。',
    '9. 只返回 JSON，格式：',
    '{"peopleTypes":[{"title":"","keywords":[],"why":""}],"searchKeywords":[],"outreach":[{"scenario":"","script":""}],"sequence":[{"step":"","action":""}],"stageTips":[],"conversationQuestions":[],"maintenanceContent":[{"title":"","channel":"","content":""}]}',
    '',
    `当前阶段：${stage}（${stageTitle}）`,
    `学校：${context.school || '未知'}`,
    `目标地区：${context.region || '未知'}`,
    `求职方向：${context.role || '未知'}`,
    `目标行业：${context.industries.join(', ') || '未知'}`,
    `目标公司：${context.targetCompanies.join(', ') || '未提供'}`,
  ].join('\n');
}

function normalizeRecommendation(raw: unknown): NetworkingRecommendation {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    peopleTypes: Array.isArray(record.peopleTypes)
      ? record.peopleTypes.slice(0, 5).map((item) => {
          const value = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
          return {
            title: typeof value.title === 'string' ? value.title : '',
            keywords: cleanStringArray(value.keywords),
            why: typeof value.why === 'string' ? value.why : '',
          };
        }).filter((item) => item.title)
      : [],
    searchKeywords: cleanStringArray(record.searchKeywords),
    outreach: Array.isArray(record.outreach)
      ? record.outreach.slice(0, 3).map((item) => {
          const value = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
          return {
            scenario: typeof value.scenario === 'string' ? value.scenario : '',
            script: typeof value.script === 'string' ? value.script : '',
          };
        }).filter((item) => item.scenario && item.script)
      : [],
    sequence: Array.isArray(record.sequence)
      ? record.sequence.slice(0, 6).map((item) => {
          const value = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
          return {
            step: typeof value.step === 'string' ? value.step : '',
            action: typeof value.action === 'string' ? value.action : '',
          };
        }).filter((item) => item.step && item.action)
      : [],
    stageTips: cleanStringArray(record.stageTips),
    conversationQuestions: cleanStringArray(record.conversationQuestions),
    maintenanceContent: Array.isArray(record.maintenanceContent)
      ? record.maintenanceContent.slice(0, 5).map((item) => {
          const value = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
          return {
            title: typeof value.title === 'string' ? value.title : '',
            channel: typeof value.channel === 'string' ? value.channel : '',
            content: typeof value.content === 'string' ? value.content : '',
          };
        }).filter((item) => item.title && item.content)
      : [],
  };
}

async function generateStageRecommendation(
  context: NetworkingContext,
  lang: PlanLocale,
  stage: number,
  userId?: string | null,
): Promise<NetworkingRecommendation> {
  const client = createTextProviderClient();
  const response = await invokeTrackedTextGeneration(client, [
    { role: 'system', content: '你是一个严谨的求职人脉顾问，只输出 JSON。' },
    { role: 'user', content: buildStageNetworkingPrompt(context, lang, stage) },
  ], { temperature: 0.4, thinking: 'disabled' }, {
    userId,
    feature: 'networking_recommendation',
    metadata: { stage, language: lang },
  });
  const parsed = extractFirstJsonObject(response.content || '');
  if (!parsed) throw new Error(`Networking 阶段 ${stage} 推荐生成失败`);
  return normalizeRecommendation(parsed);
}

export async function generateNetworkingRecommendations(
  context: NetworkingContext,
  lang: PlanLocale,
  userId?: string | null,
): Promise<Record<string, NetworkingRecommendation>> {
  const results = await Promise.all(
    NETWORKING_STAGES.map((_, index) =>
      generateStageRecommendation(context, lang, index + 1, userId)),
  );
  return Object.fromEntries(
    results.map((recommendation, index) => [String(index + 1), recommendation]),
  );
}

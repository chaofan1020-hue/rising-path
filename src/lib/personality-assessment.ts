import type { ResumeProfile } from '@/lib/resume-types';
import type { RegionKey } from '@/lib/region-dna';
import {
  classifyVisaStatus,
  getVisaFeasibility,
  type VisaFeasibility,
} from '@/lib/career-route-planner';
import { resolveVisaStatusForRegion } from '@/lib/visa-timeline';

export type PersonalityDimension =
  | 'analytical'
  | 'creative'
  | 'people'
  | 'execution'
  | 'risk';

export type PersonalityRoleKey =
  | 'frontend'
  | 'backend'
  | 'fullstack'
  | 'sde'
  | 'data_engineer'
  | 'devops'
  | 'da'
  | 'ba'
  | 'bi'
  | 'ds'
  | 'mle'
  | 'quant'
  | 'risk'
  | 'ibd'
  | 'finance_analyst'
  | 'audit'
  | 'strategy_consulting'
  | 'pm'
  | 'operations'
  | 'supply_chain'
  | 'marketing_analyst'
  | 'growth'
  | 'ux'
  | 'product_design';

export type PersonalityAnswerScore = 1 | 2 | 3 | 4 | 5;

export interface PersonalityAnswer {
  questionId: string;
  score: PersonalityAnswerScore;
}

export interface PersonalityQuestion {
  id: string;
  dimension: PersonalityDimension;
  textKey: string;
}

export interface PersonalityResult {
  dimensions: Record<PersonalityDimension, number>;
  primaryDimension: PersonalityDimension;
  summaryKey: string;
}

export interface PersonalityRecommendation {
  roleKey: PersonalityRoleKey;
  labelKey: string;
  score: number;
  personalityFit: number;
  resumeFit: number;
  marketScore: number;
  feasibilityScore: number;
  feasibilityBlocked?: boolean;
  feasibilityLabelKey?: string;
  fit: 'strong' | 'medium' | 'explore';
  reasons: string[];
  sponsorship?: PersonalitySponsorshipInfo;
}

export interface PersonalityFeasibility {
  score: number;
  blocked: boolean;
  labelKey: string;
}

export function buildPersonalityFeasibility(
  regionKey: RegionKey | null,
  intention?: ResumeProfile['intention'] | null,
): PersonalityFeasibility {
  if (!regionKey) {
    return { score: 50, blocked: false, labelKey: 'personality.feasibility.unknown' };
  }
  const visaStatusCode = resolveVisaStatusForRegion(intention, regionKey);
  const category = classifyVisaStatus(intention?.workAuthorization, visaStatusCode);
  const level = getVisaFeasibility(category, regionKey, visaStatusCode);
  const scoreMap: Record<VisaFeasibility, number> = {
    not_applicable: 100,
    likely: 90,
    conditional: 70,
    uncertain: 50,
    blocked: 0,
  };
  return {
    score: scoreMap[level],
    blocked: level === 'blocked',
    labelKey: `personality.feasibility.${level}`,
  };
}

export interface PersonalitySponsorshipInfo {
  level: 'high' | 'medium' | 'low' | 'unknown';
  sponsorJobCount: number;
  activeJobCount: number;
  noteKey: string;
}

export interface SponsorshipAggregate {
  activeJobCount: number;
  sponsorJobCount: number;
  nonSponsorJobCount: number;
  unknownJobCount: number;
}

export type SponsorshipStatsByRole = Partial<Record<PersonalityRoleKey, SponsorshipAggregate>>;

export interface PersonalityAssessment {
  id: number;
  model: 'career_fit';
  resumeId: number | null;
  answers: PersonalityAnswer[];
  result: PersonalityResult;
  recommendations: PersonalityRecommendation[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const PERSONALITY_QUESTION_BANK: PersonalityQuestion[] = [
  { id: 'analytical_1', dimension: 'analytical', textKey: 'personality.question.analytical1' },
  { id: 'analytical_2', dimension: 'analytical', textKey: 'personality.question.analytical2' },
  { id: 'analytical_3', dimension: 'analytical', textKey: 'personality.question.analytical3' },
  { id: 'analytical_4', dimension: 'analytical', textKey: 'personality.question.analytical4' },
  { id: 'analytical_5', dimension: 'analytical', textKey: 'personality.question.analytical5' },
  { id: 'analytical_6', dimension: 'analytical', textKey: 'personality.question.analytical6' },
  { id: 'creative_1', dimension: 'creative', textKey: 'personality.question.creative1' },
  { id: 'creative_2', dimension: 'creative', textKey: 'personality.question.creative2' },
  { id: 'creative_3', dimension: 'creative', textKey: 'personality.question.creative3' },
  { id: 'creative_4', dimension: 'creative', textKey: 'personality.question.creative4' },
  { id: 'creative_5', dimension: 'creative', textKey: 'personality.question.creative5' },
  { id: 'creative_6', dimension: 'creative', textKey: 'personality.question.creative6' },
  { id: 'people_1', dimension: 'people', textKey: 'personality.question.people1' },
  { id: 'people_2', dimension: 'people', textKey: 'personality.question.people2' },
  { id: 'people_3', dimension: 'people', textKey: 'personality.question.people3' },
  { id: 'people_4', dimension: 'people', textKey: 'personality.question.people4' },
  { id: 'people_5', dimension: 'people', textKey: 'personality.question.people5' },
  { id: 'people_6', dimension: 'people', textKey: 'personality.question.people6' },
  { id: 'execution_1', dimension: 'execution', textKey: 'personality.question.execution1' },
  { id: 'execution_2', dimension: 'execution', textKey: 'personality.question.execution2' },
  { id: 'execution_3', dimension: 'execution', textKey: 'personality.question.execution3' },
  { id: 'execution_4', dimension: 'execution', textKey: 'personality.question.execution4' },
  { id: 'execution_5', dimension: 'execution', textKey: 'personality.question.execution5' },
  { id: 'execution_6', dimension: 'execution', textKey: 'personality.question.execution6' },
  { id: 'risk_1', dimension: 'risk', textKey: 'personality.question.risk1' },
  { id: 'risk_2', dimension: 'risk', textKey: 'personality.question.risk2' },
  { id: 'risk_3', dimension: 'risk', textKey: 'personality.question.risk3' },
  { id: 'risk_4', dimension: 'risk', textKey: 'personality.question.risk4' },
  { id: 'risk_5', dimension: 'risk', textKey: 'personality.question.risk5' },
  { id: 'risk_6', dimension: 'risk', textKey: 'personality.question.risk6' },
];

const PERSONALITY_DIMENSIONS: PersonalityDimension[] = [
  'analytical',
  'creative',
  'people',
  'execution',
  'risk',
];

const PERSONALITY_QUESTION_QUOTAS: Record<PersonalityDimension, number> = {
  analytical: 3,
  creative: 2,
  people: 3,
  execution: 2,
  risk: 2,
};

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function getRandomPersonalityQuestions(): PersonalityQuestion[] {
  const selected: PersonalityQuestion[] = [];
  for (const dimension of PERSONALITY_DIMENSIONS) {
    const pool = PERSONALITY_QUESTION_BANK.filter((question) => question.dimension === dimension);
    const quota = PERSONALITY_QUESTION_QUOTAS[dimension];
    selected.push(...shuffle(pool).slice(0, quota));
  }
  return shuffle(selected);
}

interface RoleConfig {
  key: PersonalityRoleKey;
  weights: Record<PersonalityDimension, number>;
  majorAligned: string[];
  majorRelated: string[];
  skills: string[];
  experienceKeywords: string[];
}

const ENGINEERING = { analytical: 1, creative: 0.4, people: 0.2, execution: 0.9, risk: 0.4 };
const DATA = { analytical: 1, creative: 0.5, people: 0.5, execution: 0.8, risk: 0.4 };
const FINANCE = { analytical: 1, creative: 0.3, people: 0.5, execution: 0.8, risk: 0.8 };
const BUSINESS = { analytical: 0.8, creative: 0.7, people: 1, execution: 0.8, risk: 0.5 };
const CREATIVE = { analytical: 0.5, creative: 1, people: 0.7, execution: 0.7, risk: 0.5 };
const OPERATIONS = { analytical: 0.6, creative: 0.3, people: 0.7, execution: 1, risk: 0.2 };

const CS_MAJORS = ['computer science', 'software engineering', 'cs', '信息工程', '软件工程', '计算机'];
const MATH_MAJORS = ['mathematics', 'math', 'statistics', '数学', '统计'];
const BUSINESS_MAJORS = ['business', 'economics', 'finance', 'management', '商科', '工商管理', '经济', '金融', '管理'];
const DESIGN_MAJORS = ['design', 'interaction', 'visual', '工业设计', '设计', '交互', '视觉'];

const ROLE_CONFIGS: RoleConfig[] = [
  {
    key: 'frontend',
    weights: { ...ENGINEERING, creative: 0.6, people: 0.3 },
    majorAligned: CS_MAJORS,
    majorRelated: [...MATH_MAJORS, ...DESIGN_MAJORS],
    skills: ['react', 'vue', 'javascript', 'typescript', 'html', 'css', 'frontend', 'web'],
    experienceKeywords: ['frontend', 'front end', 'react', 'vue', 'web developer'],
  },
  {
    key: 'backend',
    weights: ENGINEERING,
    majorAligned: CS_MAJORS,
    majorRelated: MATH_MAJORS,
    skills: ['python', 'java', 'node', 'sql', 'api', 'backend', 'spring', 'go', 'c++'],
    experienceKeywords: ['backend', 'back end', 'software engineer', 'developer', 'api'],
  },
  {
    key: 'fullstack',
    weights: { ...ENGINEERING, creative: 0.5, people: 0.3 },
    majorAligned: CS_MAJORS,
    majorRelated: MATH_MAJORS,
    skills: ['react', 'javascript', 'typescript', 'node', 'python', 'java', 'sql', 'api'],
    experienceKeywords: ['fullstack', 'full stack', 'software engineer', 'developer', 'web'],
  },
  {
    key: 'sde',
    weights: ENGINEERING,
    majorAligned: CS_MAJORS,
    majorRelated: MATH_MAJORS,
    skills: ['python', 'java', 'javascript', 'typescript', 'c++', 'sql', 'git', 'aws', 'docker', 'api'],
    experienceKeywords: ['software engineer', 'sde', 'developer', 'engineering intern'],
  },
  {
    key: 'data_engineer',
    weights: { ...DATA, execution: 0.9, people: 0.2 },
    majorAligned: [...CS_MAJORS, 'data science', '数据科学'],
    majorRelated: [...MATH_MAJORS, 'physics', '物理'],
    skills: ['python', 'sql', 'etl', 'pandas', 'spark', 'airflow', 'aws', 'data pipeline', 'warehouse'],
    experienceKeywords: ['data engineer', 'data pipeline', 'etl', 'data & software engineering', 'data engineering'],
  },
  {
    key: 'devops',
    weights: { ...ENGINEERING, creative: 0.3, execution: 1, risk: 0.5 },
    majorAligned: CS_MAJORS,
    majorRelated: [...MATH_MAJORS, 'engineering', '工程'],
    skills: ['docker', 'kubernetes', 'aws', 'ci/cd', 'linux', 'terraform', 'devops'],
    experienceKeywords: ['devops', 'sre', 'cloud engineer', 'infrastructure'],
  },
  {
    key: 'da',
    weights: { ...DATA, analytical: 1, execution: 0.8 },
    majorAligned: [...MATH_MAJORS, 'data science', 'business analytics', '数据科学', '商业分析', 'economics', '经济'],
    majorRelated: [...CS_MAJORS, 'finance', '金融'],
    skills: ['sql', 'python', 'pandas', 'r', 'stata', 'tableau', 'power bi', 'excel', 'statistics', 'data visualization', 'etl'],
    experienceKeywords: ['data analyst', 'analyst', 'business intelligence', 'analytics'],
  },
  {
    key: 'ba',
    weights: { ...DATA, people: 0.8, creative: 0.5 },
    majorAligned: [...BUSINESS_MAJORS, 'information management', '信息管理', 'business analytics', '商业分析'],
    majorRelated: [...MATH_MAJORS, 'psychology', 'communication', '心理', '传播'],
    skills: ['sql', 'excel', 'tableau', 'power bi', 'business', 'requirements', 'stakeholder', 'data analysis', 'process'],
    experienceKeywords: ['business analyst', 'analyst', 'ba', 'requirements', 'consulting'],
  },
  {
    key: 'bi',
    weights: { ...DATA, people: 0.6, creative: 0.4 },
    majorAligned: [...MATH_MAJORS, 'business', 'information', '统计', '数学', '商科', '信息'],
    majorRelated: [...CS_MAJORS, 'economics', '经济'],
    skills: ['sql', 'tableau', 'power bi', 'excel', 'bi', 'dashboards', 'data visualization', 'etl'],
    experienceKeywords: ['business intelligence', 'bi', 'analyst', 'dashboards'],
  },
  {
    key: 'ds',
    weights: { ...DATA, creative: 0.7 },
    majorAligned: ['data science', ...MATH_MAJORS, ...CS_MAJORS, '数据科学'],
    majorRelated: ['physics', 'engineering', 'economics', '物理', '工程', '经济'],
    skills: ['python', 'machine learning', 'nlp', 'tensorflow', 'pytorch', 'scikit-learn', 'statistics', 'regression', 'deep learning', 'ml'],
    experienceKeywords: ['data scientist', 'data science', 'scientist', 'machine learning', 'nlp', 'research'],
  },
  {
    key: 'mle',
    weights: { ...DATA, execution: 0.9, people: 0.2 },
    majorAligned: [...CS_MAJORS, 'data science', 'ai', 'machine learning', '数据科学', '人工智能', '机器学习'],
    majorRelated: [...MATH_MAJORS, 'physics', 'engineering', '物理', '工程'],
    skills: ['python', 'machine learning', 'deep learning', 'tensorflow', 'pytorch', 'ml', 'model', 'deployment', 'docker', 'aws'],
    experienceKeywords: ['machine learning', 'ml engineer', 'data & software engineering', 'software engineer', 'ai'],
  },
  {
    key: 'quant',
    weights: { ...FINANCE, creative: 0.4, people: 0.3 },
    majorAligned: [...MATH_MAJORS, 'finance', 'economics', 'physics', '金融', '经济', '物理'],
    majorRelated: [...CS_MAJORS, 'engineering', '计算机', '工程'],
    skills: ['python', 'r', 'matlab', 'quant', 'statistics', 'financial modeling', 'time series', 'risk', 'math'],
    experienceKeywords: ['quant', 'quantitative', 'trader', 'risk'],
  },
  {
    key: 'risk',
    weights: FINANCE,
    majorAligned: ['finance', 'economics', 'risk', ...MATH_MAJORS, '金融', '经济', '风险'],
    majorRelated: [...BUSINESS_MAJORS, 'accounting', 'data science', '会计', '数据科学'],
    skills: ['risk', 'finance', 'dcf', 'valuation', 'quantitative', 'modeling', 'excel', 'sql', 'python', 'statistics'],
    experienceKeywords: ['risk', 'risk analyst', 'quantitative', 'audit', 'compliance'],
  },
  {
    key: 'ibd',
    weights: { ...FINANCE, people: 0.6, execution: 0.9 },
    majorAligned: ['finance', 'economics', 'business', '金融', '经济', '商科'],
    majorRelated: [...MATH_MAJORS, 'accounting', '数学', '统计', '会计'],
    skills: ['financial modeling', 'dcf', 'valuation', 'investment', 'banking', 'm&a', 'equity research', 'excel', 'finance'],
    experienceKeywords: ['investment banking', 'ibd', 'investment', 'equity research', 'm&a'],
  },
  {
    key: 'finance_analyst',
    weights: { ...FINANCE, risk: 0.7 },
    majorAligned: ['finance', 'economics', 'business', '金融', '经济', '商科'],
    majorRelated: [...MATH_MAJORS, 'accounting', '数学', '统计', '会计'],
    skills: ['finance', 'financial modeling', 'valuation', 'accounting', 'investment', 'excel', 'python'],
    experienceKeywords: ['finance', 'investment', 'equity research', 'accounting', 'financial'],
  },
  {
    key: 'audit',
    weights: { ...FINANCE, creative: 0.2, execution: 1, risk: 0.2 },
    majorAligned: ['accounting', 'finance', 'business', '会计', '金融', '商科'],
    majorRelated: ['economics', ...MATH_MAJORS, '经济', '数学', '统计'],
    skills: ['audit', 'accounting', 'financial statements', 'compliance', 'excel', 'risk'],
    experienceKeywords: ['audit', 'accounting', 'assurance', 'compliance'],
  },
  {
    key: 'strategy_consulting',
    weights: { ...BUSINESS, analytical: 0.9, creative: 0.6 },
    majorAligned: [...BUSINESS_MAJORS, 'mba', 'information management', '信息管理'],
    majorRelated: ['engineering', 'social science', 'psychology', '工程', '社会科学', '心理'],
    skills: ['consulting', 'strategy', 'case', 'client', 'presentation', 'market analysis', 'excel', 'powerpoint'],
    experienceKeywords: ['consulting', 'consultant', 'strategy', 'case'],
  },
  {
    key: 'pm',
    weights: { ...BUSINESS, creative: 0.8, analytical: 0.7 },
    majorAligned: [...BUSINESS_MAJORS, 'information management', ...CS_MAJORS, 'psychology', '信息管理', '心理'],
    majorRelated: ['engineering', 'design', 'communication', '工程', '设计', '传播'],
    skills: ['product', 'roadmap', 'agile', 'stakeholder', 'user research', 'analytics', 'sql'],
    experienceKeywords: ['product manager', 'product', 'pm'],
  },
  {
    key: 'operations',
    weights: OPERATIONS,
    majorAligned: ['supply chain', 'logistics', 'business', 'management', 'industrial engineering', '供应链', '物流', '工商管理', '管理', '工业工程'],
    majorRelated: ['economics', ...MATH_MAJORS, 'engineering', '经济', '统计', '工程'],
    skills: ['operations', 'process', 'project management', 'excel', 'kpi', 'supply chain', 'logistics'],
    experienceKeywords: ['operations', 'operation', 'project manager', 'program'],
  },
  {
    key: 'supply_chain',
    weights: { ...OPERATIONS, analytical: 0.7 },
    majorAligned: ['supply chain', 'logistics', 'industrial engineering', '供应链', '物流', '工业工程'],
    majorRelated: [...BUSINESS_MAJORS, ...MATH_MAJORS, '工程'],
    skills: ['supply chain', 'logistics', 'operations', 'inventory', 'procurement', 'excel'],
    experienceKeywords: ['supply chain', 'logistics', 'procurement', 'inventory'],
  },
  {
    key: 'marketing_analyst',
    weights: { ...CREATIVE, people: 0.9, risk: 0.7 },
    majorAligned: ['marketing', 'communication', 'advertising', 'business', '市场', '营销', '传播', '广告', '商科'],
    majorRelated: ['psychology', 'sociology', 'economics', 'design', '心理', '社会', '经济', '设计'],
    skills: ['marketing', 'brand', 'seo', 'content', 'campaign', 'social media', 'analytics'],
    experienceKeywords: ['marketing', 'brand', 'seo', 'social media', 'market'],
  },
  {
    key: 'growth',
    weights: { ...CREATIVE, analytical: 0.6, execution: 0.9, risk: 0.8 },
    majorAligned: ['marketing', 'business', 'data', '市场', '营销', '商科', '数据'],
    majorRelated: [...MATH_MAJORS, 'psychology', 'communication', '统计', '心理', '传播'],
    skills: ['growth', 'marketing', 'analytics', 'sql', 'a/b testing', 'seo', 'content', 'product'],
    experienceKeywords: ['growth', 'marketing', 'analytics', 'product'],
  },
  {
    key: 'ux',
    weights: { ...CREATIVE, people: 0.6, execution: 0.6 },
    majorAligned: [...DESIGN_MAJORS, 'human-computer interaction', '人机交互'],
    majorRelated: ['psychology', ...CS_MAJORS, 'art', 'communication', '心理', '计算机', '艺术', '传播'],
    skills: ['figma', 'ux', 'ui', 'design', 'prototype', 'interaction', 'user research'],
    experienceKeywords: ['ux', 'ui', 'designer', 'product design', 'interaction'],
  },
  {
    key: 'product_design',
    weights: { ...CREATIVE, execution: 0.7 },
    majorAligned: [...DESIGN_MAJORS, 'human-computer interaction', 'product design', '人机交互', '产品设计'],
    majorRelated: ['psychology', ...CS_MAJORS, 'art', '心理', '计算机', '艺术'],
    skills: ['figma', 'design', 'prototype', 'ux', 'ui', 'product', 'interaction'],
    experienceKeywords: ['product design', 'ux', 'ui', 'designer', 'prototype'],
  },
];

const PERSONALITY_ROLES = ROLE_CONFIGS.map((config) => config.key);

const ROLE_DIRECTION_MAP: Record<PersonalityRoleKey, string> = {
  frontend: 'SDE',
  backend: 'SDE',
  fullstack: 'SDE',
  sde: 'SDE',
  data_engineer: 'Data',
  devops: 'SDE',
  da: 'Data',
  ba: 'Data',
  bi: 'Data',
  ds: 'ML/AI',
  mle: 'ML/AI',
  quant: 'Quant',
  risk: 'Risk',
  ibd: 'IBD/S&T',
  finance_analyst: 'Finance',
  audit: 'Finance',
  strategy_consulting: 'Consulting',
  pm: 'PM',
  operations: 'Operations',
  supply_chain: 'Operations',
  marketing_analyst: 'MKT',
  growth: 'MKT',
  ux: 'MKT',
  product_design: 'MKT',
};

function clampScore(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function validatePersonalityAnswers(input: unknown): PersonalityAnswer[] {
  const totalQuestions = Object.values(PERSONALITY_QUESTION_QUOTAS).reduce((sum, count) => sum + count, 0);
  if (!Array.isArray(input) || input.length !== totalQuestions) {
    throw new Error('请完成全部 12 道测评题');
  }

  const seen = new Set<string>();
  const dimensionCounts: Record<PersonalityDimension, number> = {
    analytical: 0,
    creative: 0,
    people: 0,
    execution: 0,
    risk: 0,
  };
  const answers: PersonalityAnswer[] = input.map((raw) => {
    if (!raw || typeof raw !== 'object') {
      throw new Error('测评答案格式无效');
    }
    const item = raw as { questionId?: unknown; score?: unknown };
    const question = PERSONALITY_QUESTION_BANK.find((entry) => entry.id === item.questionId);
    if (
      typeof item.questionId !== 'string'
      || !question
      || seen.has(item.questionId)
    ) {
      throw new Error('测评题目不完整或重复');
    }
    const score = Number(item.score);
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      throw new Error('测评答案分数必须在 1-5 之间');
    }
    seen.add(item.questionId);
    dimensionCounts[question.dimension] += 1;
    return { questionId: item.questionId, score: score as PersonalityAnswerScore };
  });

  for (const dimension of PERSONALITY_DIMENSIONS) {
    if (dimensionCounts[dimension] !== PERSONALITY_QUESTION_QUOTAS[dimension]) {
      throw new Error('测评题目维度配额不正确');
    }
  }

  return answers;
}

export function computePersonalityResult(
  answers: PersonalityAnswer[],
): PersonalityResult {
  const selectedQuestions = PERSONALITY_QUESTION_BANK.filter((question) => (
    answers.some((answer) => answer.questionId === question.id)
  ));
  const dimensions = Object.fromEntries(
    PERSONALITY_DIMENSIONS.map((dimension) => {
      const questions = selectedQuestions.filter((question) => question.dimension === dimension);
      const sum = questions.reduce((total, question) => {
        const answer = answers.find((item) => item.questionId === question.id);
        return total + (answer?.score ?? 1);
      }, 0);
      const min = questions.length;
      const max = questions.length * 5;
      return [dimension, clampScore(((sum - min) / (max - min)) * 100)];
    }),
  ) as Record<PersonalityDimension, number>;

  const primaryDimension = PERSONALITY_DIMENSIONS
    .slice()
    .sort((left, right) => dimensions[right] - dimensions[left])[0];

  return {
    dimensions,
    primaryDimension,
    summaryKey: `personality.type.${primaryDimension}`,
  };
}

function computePersonalityFit(
  config: RoleConfig,
  dimensions: Record<PersonalityDimension, number>,
): number {
  const weighted = PERSONALITY_DIMENSIONS.reduce(
    (sum, dimension) => sum + dimensions[dimension] * config.weights[dimension],
    0,
  );
  const weightSum = PERSONALITY_DIMENSIONS.reduce(
    (sum, dimension) => sum + config.weights[dimension],
    0,
  );
  return clampScore((weighted / weightSum) * 100);
}

function hasKeyword(text: string, keywords: string[]): boolean {
  const normalized = text.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

function computeMajorScore(config: RoleConfig, major?: string): number {
  if (!major) return 50;
  if (hasKeyword(major, config.majorAligned)) return 100;
  if (hasKeyword(major, config.majorRelated)) return 75;
  return 50;
}

function computeSkillScore(config: RoleConfig, skills: string[]): number {
  const matched = config.skills.filter((keyword) => (
    skills.some((skill) => skill.toLowerCase().includes(keyword))
  )).length;
  return matched > 0
    ? clampScore((matched / Math.min(config.skills.length, 5)) * 100)
    : 0;
}

function computeExperienceScore(config: RoleConfig, profile: ResumeProfile | null | undefined): number {
  const roleTitles = [
    ...(profile?.internships || []).map((entry) => entry.role || ''),
    ...(profile?.workExperience || []).map((entry) => entry.role || ''),
  ].filter(Boolean);
  if (roleTitles.some((title) => hasKeyword(title, config.experienceKeywords))) return 100;
  return roleTitles.length > 0 ? 35 : 0;
}

function computeResumeFit(
  config: RoleConfig,
  profile: ResumeProfile | null | undefined,
): number {
  if (!profile) return 50;

  const latestEducation = [...(profile.education || [])]
    .sort((left, right) => (right.endYear || 0) - (left.endYear || 0))[0];
  const major = latestEducation?.major || profile.education?.[0]?.major;
  const majorScore = computeMajorScore(config, major);
  const skillScore = computeSkillScore(config, profile.skills || []);
  const experienceScore = computeExperienceScore(config, profile);
  return clampScore(majorScore * 0.5 + skillScore * 0.25 + experienceScore * 0.25);
}

function matchesRegion(region: string | undefined | null, regionKey?: string | null): boolean {
  if (!region || !regionKey) return true;
  const value = region.toLowerCase();
  if (regionKey === 'us') {
    return /united states|usa|u\.s\.|new york|california|washington|texas|illinois|massachusetts|remote/.test(value);
  }
  if (regionKey === 'uk') {
    return /united kingdom|\buk\b|england|london/.test(value);
  }
  if (regionKey === 'sg') {
    return /singapore/.test(value);
  }
  if (regionKey === 'hk') {
    return /hong kong/.test(value);
  }
  if (regionKey === 'au') {
    return /australia|sydney|melbourne/.test(value);
  }
  if (regionKey === 'ca') {
    return /canada|toronto|vancouver/.test(value);
  }
  if (regionKey === 'cn_t1' || regionKey === 'cn_t2') {
    return /china|beijing|shanghai|shenzhen/.test(value);
  }
  return true;
}

export function computeSponsorshipStatsByRole(
  jobs: Array<{
    direction?: string | null;
    sponsorship?: string | null;
    region?: string | null;
  }>,
  regionKey?: string | null,
): SponsorshipStatsByRole {
  const byDirection = new Map<string, SponsorshipAggregate>();
  for (const job of jobs || []) {
    const direction = job.direction?.trim();
    if (!direction || !matchesRegion(job.region, regionKey)) continue;
    const current = byDirection.get(direction) || {
      activeJobCount: 0,
      sponsorJobCount: 0,
      nonSponsorJobCount: 0,
      unknownJobCount: 0,
    };
    current.activeJobCount += 1;
    if (job.sponsorship === 'yes') current.sponsorJobCount += 1;
    else if (job.sponsorship === 'no') current.nonSponsorJobCount += 1;
    else current.unknownJobCount += 1;
    byDirection.set(direction, current);
  }

  const result: SponsorshipStatsByRole = {};
  for (const role of PERSONALITY_ROLES) {
    const direction = ROLE_DIRECTION_MAP[role];
    const stats = byDirection.get(direction);
    if (stats) result[role] = stats;
  }
  return result;
}

function buildSponsorshipInfo(
  stats?: SponsorshipAggregate,
  regionKey?: RegionKey | null,
): PersonalitySponsorshipInfo {
  if (!stats || stats.activeJobCount === 0) {
    return {
      level: 'unknown',
      sponsorJobCount: 0,
      activeJobCount: 0,
      noteKey: 'personality.sponsor.unknown',
    };
  }
  if (regionKey === 'hk') {
    const level: PersonalitySponsorshipInfo['level'] =
      stats.activeJobCount >= 20
        ? 'high'
        : stats.activeJobCount >= 8
          ? 'medium'
          : 'low';
    return {
      level,
      sponsorJobCount: stats.activeJobCount,
      activeJobCount: stats.activeJobCount,
      noteKey: `personality.sponsor.hk_${level}`,
    };
  }
  const knownTotal = stats.sponsorJobCount + stats.nonSponsorJobCount;
  if (knownTotal < 5) {
    return {
      level: 'unknown',
      sponsorJobCount: stats.sponsorJobCount,
      activeJobCount: stats.activeJobCount,
      noteKey: 'personality.sponsor.unknown',
    };
  }
  const sponsorRatio = stats.sponsorJobCount / knownTotal;
  const level: PersonalitySponsorshipInfo['level'] =
    stats.sponsorJobCount >= 20 && sponsorRatio >= 0.6
      ? 'high'
      : stats.sponsorJobCount >= 8 && sponsorRatio >= 0.3
        ? 'medium'
        : stats.sponsorJobCount > 0
          ? 'low'
          : 'low';
  return {
    level,
    sponsorJobCount: stats.sponsorJobCount,
    activeJobCount: stats.activeJobCount,
    noteKey: `personality.sponsor.${level}`,
  };
}

export function computePersonalityRecommendations(
  answers: PersonalityAnswer[],
  profile?: ResumeProfile | null,
  sponsorshipStatsByRole?: SponsorshipStatsByRole,
  regionKey?: RegionKey | null,
  feasibility?: PersonalityFeasibility,
): PersonalityRecommendation[] {
  const result = computePersonalityResult(answers);
  const resolvedFeasibility = feasibility ?? buildPersonalityFeasibility(regionKey ?? null, profile?.intention);
  const roleCounts = ROLE_CONFIGS.map((config) => ({
    key: config.key,
    count: sponsorshipStatsByRole?.[config.key]?.activeJobCount || 0,
  }));
  const totalRegionJobs = roleCounts.reduce((sum, item) => sum + item.count, 0);
  const marketScoreByRole = new Map<PersonalityRoleKey, number>();
  if (totalRegionJobs < 10) {
    ROLE_CONFIGS.forEach((config) => marketScoreByRole.set(config.key, 50));
  } else {
    const positiveCount = roleCounts.filter((item) => item.count > 0).length;
    roleCounts
      .filter((item) => item.count > 0)
      .sort((left, right) => right.count - left.count)
      .forEach((item, index) => {
        marketScoreByRole.set(
          item.key,
          clampScore(100 - (index / Math.max(1, positiveCount - 1)) * 100),
        );
      });
    roleCounts
      .filter((item) => item.count === 0)
      .forEach((item) => marketScoreByRole.set(item.key, 0));
  }
  const all = ROLE_CONFIGS
    .map((config) => {
      const personalityFit = computePersonalityFit(config, result.dimensions);
      const resumeFit = computeResumeFit(config, profile);
      const marketStats = sponsorshipStatsByRole?.[config.key];
      const marketScore = marketScoreByRole.get(config.key) ?? 50;
      const feasibilityBlocked = resolvedFeasibility.blocked;
      const score = clampScore(
        personalityFit * 0.3
        + resumeFit * 0.25
        + marketScore * 0.35
        + resolvedFeasibility.score * 0.1,
      );
      const reasons = [
        `personality.reason.role.${config.key}`,
        `personality.reason.dimension.${result.primaryDimension}`,
      ];
      if (marketScore >= 70) {
        reasons.push('personality.reason.market');
      } else if (marketStats && marketStats.activeJobCount > 0 && marketScore < 40) {
        reasons.push('personality.reason.marketLow');
      }
      if (feasibilityBlocked) {
        reasons.push('personality.reason.feasibilityBlocked');
      } else if (resolvedFeasibility.score >= 90) {
        reasons.push('personality.reason.feasibility');
      }
      if (profile && computeExperienceScore(config, profile) >= 100) {
        reasons.push('personality.reason.experience');
      }
      return {
        roleKey: config.key,
        labelKey: `personality.role.${config.key}`,
        score,
        personalityFit: Math.round(personalityFit),
        resumeFit: Math.round(resumeFit),
        marketScore: Math.round(marketScore),
        feasibilityScore: resolvedFeasibility.score,
        feasibilityBlocked,
        feasibilityLabelKey: resolvedFeasibility.labelKey,
        fit: feasibilityBlocked
          ? 'explore' as const
          : (score >= 75 ? 'strong' : score >= 60 ? 'medium' : 'explore') as PersonalityRecommendation['fit'],
        reasons: reasons.slice(0, 4),
        sponsorship: buildSponsorshipInfo(sponsorshipStatsByRole?.[config.key], regionKey),
      };
    })
    .sort((left, right) => right.score - left.score);

  const eligible = all.filter((item) => !item.feasibilityBlocked);
  const blocked = all.filter((item) => item.feasibilityBlocked);
  const core = eligible.slice(0, 3);
  const alternativesPool = [...eligible.slice(3), ...blocked].sort((left, right) => right.score - left.score);

  return [...core, ...alternativesPool.slice(0, 2)];
}

export function computePersonalityAssessment(
  answers: PersonalityAnswer[],
  profile?: ResumeProfile | null,
  sponsorshipStatsByRole?: SponsorshipStatsByRole,
  regionKey?: RegionKey | null,
  feasibility?: PersonalityFeasibility,
): {
  result: PersonalityResult;
  recommendations: PersonalityRecommendation[];
} {
  return {
    result: computePersonalityResult(answers),
    recommendations: computePersonalityRecommendations(answers, profile, sponsorshipStatsByRole, regionKey, feasibility),
  };
}

export function getPersonalityQuestionCount(): number {
  return Object.values(PERSONALITY_QUESTION_QUOTAS).reduce((sum, count) => sum + count, 0);
}

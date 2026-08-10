// 用户分层引擎（User Segmentation）
// 三个核心维度：求职阶段（低年级/高年级/社招）、学校背景（Tier + QS + 企业目标校）、专业匹配度（对口/跨/泛）
// 叠加经历质量与求职地区（地区为分层第一权重，详见 region-dna.ts）
// 输出差异化评估标尺：ATS 策略 + 面试官评估标尺

import { resolveRegionKey, type RegionKey } from './region-dna';
import type {
  CareerStage,
  MajorMatch,
  ResumeProfile,
  SchoolTier,
  SegmentationOverrides,
  UserSegmentation,
} from '@/lib/resume-types';

export type {
  CareerStage,
  EducationEntry,
  ExperienceEntry,
  MajorMatch,
  ProjectEntry,
  ResumeProfile,
  SchoolTier,
  SegmentationOverrides,
  UserSegmentation,
} from '@/lib/resume-types';

// ============ 类型定义 ============

// ============ 院校分层库 ============
// 注意：QS 排名 ≠ 企业认可度（两个数据都保留，不合并）。
// 国内大厂对部分 QS 一般的 985 认可度极高，对部分 QS 靠前的英澳院校反而一般。

interface SchoolEntry {
  names: string[];   // 中英文名/别名（小写）
  tier: SchoolTier;
  qs?: number;       // 大致 QS 排名（用于展示区间）
  tags?: string[];   // 985 / 211 / g5 / 双一流
}

const T = (names: string[], tier: SchoolTier, qs?: number, tags?: string[]): SchoolEntry =>
  ({ names: names.map((n) => n.toLowerCase()), tier, qs, tags });

// Tier 1：全球顶尖光环校（哈耶普斯麻牛剑 + 清北）
// Tier 2：区域顶尖/留学生主流（港三新二、英联邦知名、美 Top30、国内 985）
// Tier 3：一般院校
const SCHOOL_TABLE: SchoolEntry[] = [
  // ---- Tier 1 全球顶尖 ----
  T(['哈佛大学', 'harvard'], 1, 4),
  T(['耶鲁大学', 'yale'], 1, 6),
  T(['普林斯顿大学', 'princeton'], 1, 17),
  T(['麻省理工学院', 'mit', 'massachusetts institute of technology'], 1, 1),
  T(['斯坦福大学', 'stanford'], 1, 5),
  T(['牛津大学', 'oxford', 'university of oxford'], 1, 3, ['g5']),
  T(['剑桥大学', 'cambridge', 'university of cambridge'], 1, 2, ['g5']),
  T(['加州理工学院', 'caltech', 'california institute of technology'], 1, 10),
  T(['芝加哥大学', 'university of chicago', 'uchicago'], 1, 11),
  T(['宾夕法尼亚大学', 'upenn', 'university of pennsylvania', '沃顿', 'wharton'], 1, 12),
  T(['哥伦比亚大学', 'columbia'], 1, 23),
  T(['康奈尔大学', 'cornell'], 1, 13),
  T(['帝国理工学院', 'imperial college', 'imperial'], 1, 2, ['g5']),
  T(['苏黎世联邦理工', 'eth zurich', 'eth'], 1, 7),
  T(['清华大学', 'tsinghua'], 1, 20, ['985', 'c9']),
  T(['北京大学', 'peking university', 'pku', '北大'], 1, 14, ['985', 'c9']),
  T(['伦敦政治经济学院', 'lse', 'london school of economics'], 1, 45, ['g5']),
  T(['伦敦大学学院', 'ucl', 'university college london'], 1, 9, ['g5']),

  // ---- Tier 2 区域顶尖/留学生主流 ----
  T(['香港大学', 'hku', 'university of hong kong'], 2, 17),
  T(['香港中文大学', 'cuhk', 'chinese university of hong kong'], 2, 36),
  T(['香港科技大学', 'hkust'], 2, 47),
  T(['新加坡国立大学', 'nus', 'national university of singapore'], 2, 8),
  T(['南洋理工大学', 'ntu', 'nanyang technological university'], 2, 15),
  T(['新加坡管理大学', 'smu', 'singapore management university'], 2, 585),
  T(['墨尔本大学', 'university of melbourne', '墨大'], 2, 13),
  T(['悉尼大学', 'university of sydney'], 2, 18),
  T(['新南威尔士大学', 'unsw'], 2, 19),
  T(['澳大利亚国立大学', 'anu', 'australian national university'], 2, 30),
  T(['莫纳什大学', 'monash'], 2, 37),
  T(['昆士兰大学', 'university of queensland', 'uq'], 2, 40),
  T(['爱丁堡大学', 'university of edinburgh', '爱丁堡'], 2, 27),
  T(['曼彻斯特大学', 'university of manchester', '曼大'], 2, 34),
  T(['伦敦国王学院', 'kcl', "king's college london"], 2, 40),
  T(['华威大学', 'warwick'], 2, 69),
  T(['布里斯托大学', 'bristol'], 2, 54),
  T(['杜伦大学', 'durham'], 2, 89),
  T(['格拉斯哥大学', 'glasgow'], 2, 78),
  T(['伯明翰大学', 'birmingham'], 2, 80),
  T(['南安普顿大学', 'southampton'], 2, 80),
  T(['利兹大学', 'leeds'], 2, 82),
  T(['多伦多大学', 'university of toronto', 'utoronto'], 2, 21),
  T(['英属哥伦比亚大学', 'ubc', 'university of british columbia'], 2, 38),
  T(['麦吉尔大学', 'mcgill'], 2, 29),
  T(['约翰霍普金斯大学', 'jhu', 'johns hopkins'], 2, 28),
  T(['西北大学', 'northwestern'], 2, 32),
  T(['杜克大学', 'duke'], 2, 57),
  T(['加州大学伯克利分校', 'uc berkeley', 'berkeley', '伯克利'], 2, 12),
  T(['加州大学洛杉矶分校', 'ucla'], 2, 42),
  T(['密歇根大学', 'umich', 'university of michigan'], 2, 44),
  T(['纽约大学', 'nyu', 'new york university'], 2, 38),
  T(['卡内基梅隆大学', 'cmu', 'carnegie mellon'], 2, 52),
  T(['南加州大学', 'usc', 'university of southern california'], 2, 116),
  T(['加州大学圣地亚哥分校', 'ucsd', 'uc san diego'], 2, 62),
  T(['波士顿大学', 'boston university', 'bu'], 2, 108),
  T(['东京大学', 'university of tokyo'], 2, 32),
  T(['早稻田大学', 'waseda'], 2, 181),
  T(['首尔国立大学', 'snu', 'seoul national university'], 2, 41),
  T(['阿姆斯特丹大学', 'university of amsterdam'], 2, 55),
  T(['慕尼黑工业大学', 'tum', 'technical university of munich'], 2, 28),
  // 国内 985（国内企业认可度口径，独立于 QS）
  T(['复旦大学', 'fudan'], 2, 39, ['985', 'c9']),
  T(['上海交通大学', 'sjtu', 'shanghai jiao tong'], 2, 45, ['985', 'c9']),
  T(['浙江大学', 'zhejiang university', 'zju', '浙大'], 2, 47, ['985', 'c9']),
  T(['中国科学技术大学', 'ustc', '中科大'], 2, 133, ['985', 'c9']),
  T(['南京大学', 'nanjing university', 'nju'], 2, 145, ['985', 'c9']),
  T(['中国人民大学', 'ruc', '人大'], 2, undefined, ['985']),
  T(['武汉大学', 'wuhan university', 'whu'], 2, 194, ['985']),
  T(['中山大学', 'sysu', 'sun yat-sen university'], 2, undefined, ['985']),
  T(['华中科技大学', 'hust', '华科'], 2, undefined, ['985']),
  T(['哈尔滨工业大学', 'hit', '哈工大'], 2, undefined, ['985', 'c9']),
  T(['西安交通大学', 'xjtu', '西交'], 2, undefined, ['985', 'c9']),
  T(['北京航空航天大学', 'buaa', '北航'], 2, undefined, ['985']),
  T(['同济大学', 'tongji'], 2, undefined, ['985']),
  T(['南开大学', 'nankai'], 2, undefined, ['985']),
  T(['厦门大学', 'xmu', 'xiamen university'], 2, undefined, ['985']),
  T(['四川大学', 'scu', 'sichuan university'], 2, undefined, ['985']),
  T(['吉林大学', 'jlu', 'jilin university'], 2, undefined, ['985']),
  T(['大连理工大学', 'dut', 'dalian university of technology'], 2, undefined, ['985']),
  T(['电子科技大学', 'uestc', '成电'], 2, undefined, ['985']),
  T(['湖南大学', 'hnu', 'hunan university'], 2, undefined, ['985']),
  T(['重庆大学', 'cqu', 'chongqing university'], 2, undefined, ['985']),
  T(['山东大学', 'sdu', 'shandong university'], 2, undefined, ['985']),
  T(['天津大学', 'tju', 'tianjin university'], 2, undefined, ['985']),
  T(['北京师范大学', 'bnu'], 2, undefined, ['985']),
  T(['北京理工大学', 'bit'], 2, undefined, ['985']),
  T(['华南理工大学', 'scut'], 2, undefined, ['985']),
  T(['西北工业大学', 'nwpu'], 2, undefined, ['985']),
  T(['兰州大学', 'lzu'], 2, undefined, ['985']),
  T(['东北大学', 'neu china', 'northeastern university china'], 2, undefined, ['985']),
  T(['中国农业大学', 'cau'], 2, undefined, ['985']),
  T(['中央民族大学', 'muc'], 2, undefined, ['985']),
  T(['华东师范大学', 'ecnu'], 2, undefined, ['985']),
  T(['中国海洋大学', 'ouc'], 2, undefined, ['985']),
  T(['国防科技大学', 'nudt'], 2, undefined, ['985']),
  // 211/行业强校（Tier 2 尾 - Tier 3）
  T(['西安电子科技大学', 'xidian', '西电'], 3, undefined, ['211']),
  T(['北京邮电大学', 'bupt', '北邮'], 3, undefined, ['211']),
  T(['上海财经大学', 'sufe', '上财'], 2, undefined, ['211']),
  T(['中央财经大学', 'cufe'], 3, undefined, ['211']),
  T(['对外经济贸易大学', 'uibe'], 3, undefined, ['211']),
  T(['西南财经大学', 'swufe'], 3, undefined, ['211']),
  T(['中南财经政法大学', 'zuel'], 3, undefined, ['211']),
  T(['杭州电子科技大学', 'hdu', '杭电'], 3, undefined, []),
  T(['深圳大学', 'szu', '深大'], 3, undefined, []),
  T(['南方科技大学', 'sustech'], 3, undefined, []),
];

// 企业目标校 / 认可专业（隐性规则，与 company-dna 精调企业对齐）
const COMPANY_TARGET_SCHOOLS: Record<string, string[]> = {
  '阿里巴巴': ['杭州电子科技大学', '浙江大学', '杭电'],
  '腾讯': ['华中科技大学', '深圳大学', '华科', '深大'],
  '字节跳动': ['北京邮电大学', '华中科技大学', '北邮'],
  '华为': ['华中科技大学', '西安电子科技大学', '电子科技大学', '西电'],
  '美团': ['北京邮电大学', '武汉大学'],
  '高盛': ['哈佛大学', '宾夕法尼亚大学', '牛津大学', '剑桥大学', '清华大学', '北京大学'],
  '麦肯锡': ['哈佛大学', '斯坦福大学', '牛津大学', '清华大学', '北京大学', '复旦大学'],
};

// ============ 专业匹配规则 ============

type RoleCategory = 'tech' | 'product' | 'data' | 'finance' | 'consulting' | 'marketing' | 'design' | 'operations' | 'other';

const ROLE_CATEGORY_KEYWORDS: Record<RoleCategory, string[]> = {
  tech: ['工程师', 'engineer', '开发', 'developer', 'sde', '后端', '前端', '算法', 'architect', 'devops', '测试', 'qa'],
  product: ['产品经理', 'product manager', 'product owner', 'pm', '产品设计'],
  data: ['数据分析', 'data analyst', 'data scientist', '数据科学', '商业分析', 'business analyst', 'bi', '数据工程'],
  finance: ['投行', 'investment', '金融', 'finance', 'quant', '量化', '审计', 'audit', '会计', 'accounting', '风控'],
  consulting: ['咨询', 'consulting', 'consultant', '战略'],
  marketing: ['市场', 'marketing', '品牌', 'brand', '增长', 'growth', '广告'],
  design: ['设计', 'design', 'ux', 'ui', '交互', '视觉'],
  operations: ['运营', 'operation', '供应链', 'supply chain', '项目管理', 'project management'],
  other: [],
};

// 专业关键词 → 匹配类别（aligned=对口, related=跨专业相关；其余=泛专业）
const MAJOR_MATCH_RULES: Record<RoleCategory, { aligned: string[]; related: string[] }> = {
  tech: {
    aligned: ['计算机', 'computer science', 'cs', '软件工程', 'software', '信息工程', 'information', '电子工程', 'ee', 'electrical'],
    related: ['数学', 'math', '统计', 'statistics', '物理', 'physics', '数据科学', 'data science', '自动化', 'automation'],
  },
  product: {
    aligned: ['计算机', 'computer science', '软件工程', '信息管理', '工商管理', 'business', '工业设计'],
    related: ['数学', '统计', '经济', 'economics', '金融', '工程', 'engineering', '心理', 'psychology'],
  },
  data: {
    aligned: ['统计', 'statistics', '数学', 'math', '数据科学', 'data science', '计算机', 'computer science', '商业分析', 'business analytics'],
    related: ['经济', 'economics', '金融', 'finance', '物理', '工程', 'engineering', '信息管理'],
  },
  finance: {
    aligned: ['金融', 'finance', '经济', 'economics', '会计', 'accounting', '财务管理'],
    related: ['数学', 'math', '统计', 'statistics', '物理', 'physics', '计算机', '商科', 'business'],
  },
  consulting: {
    aligned: ['商科', 'business', '经济', 'economics', '管理', 'management', 'mba', '金融'],
    related: ['工程', 'engineering', '数学', '统计', '社会科学', 'social science', '心理'],
  },
  marketing: {
    aligned: ['市场营销', 'marketing', '传播', 'communication', '广告', 'advertising', '新闻', '商科', 'business'],
    related: ['心理', 'psychology', '社会学', 'sociology', '经济', '英语', '语言'],
  },
  design: {
    aligned: ['设计', 'design', '视觉传达', 'visual', '交互', 'interaction', '工业设计', '数字媒体'],
    related: ['建筑', 'architecture', '心理', '计算机', '艺术', 'art'],
  },
  operations: {
    aligned: ['供应链', 'supply chain', '物流', 'logistics', '工商管理', 'business', '管理', 'management', '工业工程'],
    related: ['经济', '统计', '工程', 'engineering', '数学'],
  },
  other: { aligned: [], related: [] },
};

// ============ 推导函数 ============

function normText(s?: string | null): string {
  return (s || '').trim().toLowerCase();
}

// 第一步：求职阶段判定
export function deriveCareerStage(profile: ResumeProfile, now = new Date()): { stage: CareerStage; reason: string } {
  const currentYear = now.getFullYear();
  const latestEdu = [...(profile.education || [])].sort((a, b) => (b.endYear || 0) - (a.endYear || 0))[0];
  const gradYear = latestEdu?.endYear;

  // 全职经历（isInternship 为 false 的工作/实习条目）
  const fulltimeMonths = (profile.workExperience || [])
    .filter((w) => !w.isInternship)
    .reduce((sum, w) => sum + (w.months || 0), 0);
  const allEntries = [...(profile.workExperience || []), ...(profile.internships || [])];
  const hasFulltime = allEntries.some((w) => !w.isInternship && (w.months || 0) >= 6);
  const internTitles = allEntries.filter((w) => w.isInternship || /实习|intern/i.test(w.role || ''));

  if (hasFulltime && fulltimeMonths >= 12) {
    return { stage: 'experienced', reason: `有全职工作经历 ${Math.round(fulltimeMonths / 12 * 10) / 10} 年（≥1年）` };
  }
  if (hasFulltime && fulltimeMonths > 0 && fulltimeMonths < 12 && internTitles.length > 0) {
    return { stage: 'returning_intern', reason: '有短期全职/转正实习经历，处于实习转正阶段' };
  }
  if (gradYear && gradYear <= currentYear + 1) {
    return { stage: 'senior', reason: `毕业时间 ${gradYear}（≤ ${currentYear + 1}），无全职工作经历` };
  }
  if (gradYear && gradYear >= currentYear + 2) {
    return { stage: 'junior', reason: `毕业时间 ${gradYear}（≥ ${currentYear + 2}），处于实习预备阶段` };
  }
  // 无毕业时间时按经历密度兜底
  if ((profile.internships || []).length === 0) {
    return { stage: 'junior', reason: '未检测到毕业时间与实习经历，按低年级实习预备处理' };
  }
  return { stage: 'senior', reason: '按实习经历密度推断为校招阶段（建议手动确认）' };
}

// 第二步：学校背景分层
export function deriveSchoolTier(
  schoolName?: string,
  qsEstimate?: number
): { tier: SchoolTier; source: UserSegmentation['schoolTierSource']; qsBand?: string } {
  const norm = normText(schoolName);
  if (norm) {
    const hit = SCHOOL_TABLE.find((s) => s.names.some((n) => norm.includes(n) || n.includes(norm)));
    if (hit) {
      return {
        tier: hit.tier,
        source: 'builtin',
        qsBand: hit.qs ? (hit.qs <= 50 ? 'QS Top 50' : hit.qs <= 100 ? 'QS 51-100' : hit.qs <= 200 ? 'QS 101-200' : `QS ${hit.qs}+`) : undefined,
      };
    }
  }
  // 内置表未命中 → 用 LLM 提取时给的 QS 估值兜底
  if (qsEstimate && qsEstimate > 0) {
    if (qsEstimate <= 60) return { tier: 1, source: 'llm_estimate', qsBand: `QS ~${qsEstimate}` };
    if (qsEstimate <= 200) return { tier: 2, source: 'llm_estimate', qsBand: `QS ~${qsEstimate}` };
    return { tier: 3, source: 'llm_estimate', qsBand: `QS ${qsEstimate}+` };
  }
  return { tier: 3, source: 'unknown' };
}

// 企业目标校命中
export function deriveTargetSchoolHits(schoolName?: string): string[] {
  const norm = normText(schoolName);
  if (!norm) return [];
  const hits: string[] = [];
  for (const [company, schools] of Object.entries(COMPANY_TARGET_SCHOOLS)) {
    if (schools.some((s) => norm.includes(normText(s)) || normText(s).includes(norm))) {
      hits.push(company);
    }
  }
  return hits;
}

// 岗位方向分类
export function classifyRole(targetRole?: string): RoleCategory {
  const norm = normText(targetRole);
  if (!norm) return 'other';
  for (const [cat, keywords] of Object.entries(ROLE_CATEGORY_KEYWORDS)) {
    if (cat !== 'other' && keywords.some((k) => norm.includes(k))) return cat as RoleCategory;
  }
  return 'other';
}

// 第三步：专业匹配度
export function deriveMajorMatch(major?: string, targetRole?: string): { match: MajorMatch; note: string } | null {
  const m = normText(major);
  if (!m || !targetRole) return null;
  const cat = classifyRole(targetRole);
  if (cat === 'other') return null;
  const rules = MAJOR_MATCH_RULES[cat];
  if (rules.aligned.some((k) => m.includes(k))) {
    return { match: 'aligned', note: `${major} → ${targetRole}（对口专业）` };
  }
  if (rules.related.some((k) => m.includes(k))) {
    return { match: 'related', note: `${major} → ${targetRole}（跨专业但相关）` };
  }
  return { match: 'unrelated', note: `${major} → ${targetRole}（泛专业，需突出可迁移能力）` };
}

// 第四步：地区判定（意向 > 推断 > 默认）
export function deriveRegions(profile: ResumeProfile): { regions: RegionKey[]; source: UserSegmentation['regionSource'] } {
  // 1. 简历中直接写明的求职意向（最高优先级）
  const intentionLocations = profile.intention?.locations || [];
  const fromIntention = intentionLocations.map(resolveRegionKey).filter((k): k is RegionKey => !!k);
  if (fromIntention.length > 0) {
    return { regions: [...new Set(fromIntention)], source: 'intention' };
  }
  // 2. 解析推断：教育地区 / 简历语言
  const eduSchool = (profile.education || [])[0]?.school || '';
  const eduHit = resolveRegionKey(eduSchool);
  if (eduHit) return { regions: [eduHit], source: 'inferred' };
  if (profile.meta?.resumeLanguage === 'en') return { regions: ['us'], source: 'inferred' };
  // 3. 默认
  return { regions: ['cn_t1'], source: 'default' };
}

// 经历质量
const BIG_NAME_HINTS = [
  '字节', 'bytedance', '腾讯', 'tencent', '阿里', 'alibaba', '美团', 'meituan', '华为', 'huawei',
  '百度', 'baidu', '京东', 'jd', '网易', 'netease', 'google', '谷歌', '微软', 'microsoft',
  'amazon', '亚马逊', 'apple', '苹果', 'meta', 'facebook', 'goldman', '高盛', 'mckinsey', '麦肯锡',
  '宝洁', 'p&g', '联合利华', 'unilever', 'pwc', '普华永道', 'deloitte', '德勤', 'kpmg', 'ey', '安永',
];

export function deriveExperienceQuality(profile: ResumeProfile): UserSegmentation['experienceQuality'] {
  const internships = profile.internships || [];
  const totalMonths = internships.reduce((s, i) => s + (i.months || 0), 0);
  const bigNameCount = internships.filter((i) =>
    BIG_NAME_HINTS.some((h) => normText(i.company).includes(h))
  ).length;
  const allOutcomes = [
    ...internships.flatMap((i) => i.highlights || []),
    ...(profile.projects || []).flatMap((p) => p.outcomes || []),
  ];
  const quantified = allOutcomes.filter((o) => /\d+%|\d+万|\d+k|\$\d|\d+\s*(users|人|次|单|笔)/i.test(o)).length;
  const density = allOutcomes.length === 0 ? 'low' : quantified / allOutcomes.length >= 0.5 ? 'high' : quantified >= 2 ? 'medium' : 'low';
  return {
    internshipCount: internships.length,
    bigNameCount,
    totalMonths,
    quantifiedDensity: density,
  };
}

// ============ 综合分层 ============

export function deriveSegmentation(profile: ResumeProfile, targetRole?: string): UserSegmentation {
  const { stage, reason } = deriveCareerStage(profile);
  const latestEdu = [...(profile.education || [])].sort((a, b) => (b.endYear || 0) - (a.endYear || 0))[0];
  const school = deriveSchoolTier(latestEdu?.school, latestEdu?.qsEstimate);
  const targetHits = deriveTargetSchoolHits(latestEdu?.school);
  const majorResult = deriveMajorMatch(latestEdu?.major, targetRole);
  const { regions, source: regionSource } = deriveRegions(profile);
  const expQuality = deriveExperienceQuality(profile);

  const stageLabel = { junior: '低年级（实习预备）', senior: '高年级（校招全职）', experienced: '社招（在职跳槽）', returning_intern: '实习转正' }[stage];
  const summary = `${stageLabel} × Tier${school.tier}院校 × ${regions.length}个目标地区${expQuality.internshipCount > 0 ? ` × ${expQuality.internshipCount}段实习` : ''}`;

  return {
    careerStage: stage,
    careerStageReason: reason,
    schoolTier: school.tier,
    schoolTierSource: school.source,
    qsBand: school.qsBand,
    targetSchoolHits: targetHits,
    majorMatch: majorResult?.match,
    majorMatchNote: majorResult?.note,
    regions,
    regionSource,
    experienceQuality: expQuality,
    summary,
  };
}

// 合并用户手动修正
export function applyOverrides(seg: UserSegmentation, overrides?: SegmentationOverrides | null): UserSegmentation {
  if (!overrides) return seg;
  return {
    ...seg,
    careerStage: overrides.careerStage ?? seg.careerStage,
    schoolTier: overrides.schoolTier ?? seg.schoolTier,
    majorMatch: overrides.majorMatch ?? seg.majorMatch,
    regions: overrides.regions && overrides.regions.length > 0 ? overrides.regions : seg.regions,
  };
}

// ============ Prompt 输出 ============

const STAGE_EVALUATION_ZH: Record<CareerStage, string> = {
  junior: `该候选人是低年级学生（实习预备阶段）。评估标尺：重潜力与基础扎实度，看学习曲线和求知欲；课程项目/竞赛/社团均可深挖；不苛求业务深度与量化业绩；追问偏"为什么这么做/学到了什么/如果重做会怎么改"。语气可以带引导性，给候选人展示思考过程的空间。`,
  senior: `该候选人是高年级应届生（校招全职）。评估标尺：标准校招标尺——实习经历的转化价值、岗位匹配度、基础扎实 + 一定业务深度；期望实习中有独立负责的模块和可量化结果；追问偏"你在其中具体负责什么/结果如何归因/遇到的最大挑战"。`,
  experienced: `该候选人是社招人士（在职跳槽）。评估标尺：重业务深度与 impact——必须有清晰的 ownership、结果归因和职级匹配度；深挖决策背后的 trade-off、跨团队协作、资源争取；追问偏"这个决策是你拍板的吗/如果资源减半你怎么排优先级/你的产出和团队其他成员如何区分"。不满足于职责描述，要求结果证据。`,
  returning_intern: `该候选人处于实习转正阶段。评估标尺：介于校招与社招之间——看实习期间是否展现出全职级别的 ownership 与交付质量；重点验证转正价值（团队依赖度、独立交付、业务理解）。`,
};

const TIER_EXPECTATION_ZH: Record<SchoolTier, string> = {
  1: 'Tier 1 顶尖院校背景：对其基础能力与视野有更高期望，提问可以直接上难度，考察其是否名副其实。',
  2: 'Tier 2 知名院校背景：按标准标尺评估，重点看实习与项目中的实际产出是否超越学历背景。',
  3: '一般院校背景：学历权重降低，重点验证实际能力与自驱力——如果经历扎实应给予同等尊重，避免学历偏见。',
};

export function buildSegmentBlock(seg: UserSegmentation, lang: 'zh' | 'en' = 'zh'): string {
  if (lang === 'en') {
    return [
      `[Candidate Segmentation — your evaluation baseline]`,
      `- Stage: ${seg.careerStage} (${seg.careerStageReason})`,
      `- School: Tier ${seg.schoolTier}${seg.qsBand ? ` / ${seg.qsBand}` : ''}${seg.targetSchoolHits.length ? ` / target school of ${seg.targetSchoolHits.join(', ')}` : ''}`,
      seg.majorMatch ? `- Major match: ${seg.majorMatch}` : '',
      `- Experience: ${seg.experienceQuality.internshipCount} internships (${seg.experienceQuality.bigNameCount} big-name), quantified density: ${seg.experienceQuality.quantifiedDensity}`,
    ].filter(Boolean).join('\n');
  }
  return [
    `【候选人分层画像 — 你的评估标尺】`,
    `- 求职阶段：${seg.careerStage}（${seg.careerStageReason}）`,
    `- 院校背景：Tier ${seg.schoolTier}${seg.qsBand ? ` / ${seg.qsBand}` : ''}${seg.targetSchoolHits.length ? ` / 目标校命中：${seg.targetSchoolHits.join('、')}` : ''}`,
    seg.majorMatchNote ? `- 专业匹配：${seg.majorMatchNote}` : '',
    `- 经历质量：${seg.experienceQuality.internshipCount} 段实习（大厂 ${seg.experienceQuality.bigNameCount} 段），量化密度 ${seg.experienceQuality.quantifiedDensity}`,
    ``,
    `评估要求：${STAGE_EVALUATION_ZH[seg.careerStage]}`,
    TIER_EXPECTATION_ZH[seg.schoolTier],
  ].filter((l) => l !== undefined).join('\n');
}

export type RoleFamily =
  | 'engineering'
  | 'data'
  | 'product'
  | 'design'
  | 'marketing'
  | 'finance'
  | 'consulting'
  | 'sales'
  | 'operations'
  | 'research'
  | 'security'
  | 'other';

export type RoleMatchLevel = 'direct' | 'adjacent' | 'unrelated';

interface RoleAliasGroup {
  family: RoleFamily;
  aliases: string[];
}

const ROLE_ALIAS_GROUPS: RoleAliasGroup[] = [
  {
    family: 'engineering',
    aliases: [
      'software engineer intern', 'software engineering intern', 'swe intern', 'sde intern',
      'software engineer', 'software engineering', 'software developer', 'software development',
      'swe', 'sde', 'sde i', 'sde ii', 'sde 1', 'sde 2',
      'backend engineer', 'back-end engineer', 'backend developer', 'back end engineer',
      'frontend engineer', 'front-end engineer', 'frontend developer', 'front end engineer',
      'full stack engineer', 'fullstack engineer', 'full-stack engineer', 'full stack developer',
      'mobile engineer', 'ios engineer', 'android engineer', 'platform engineer',
      'infrastructure engineer', 'site reliability', 'sre', 'devops engineer', 'devops',
      'web developer', 'application engineer', 'applications engineer',
      'backend', 'front-end', 'frontend', 'full stack', 'fullstack',
      '软件工程师', '软件开发工程师', '软件开发', '开发工程师',
      '后端工程师', '前端工程师', '全栈工程师', '客户端工程师',
      '后端', '前端', '全栈', '客户端',
    ],
  },
  {
    family: 'data',
    aliases: [
      'data scientist intern', 'data analyst intern', 'business analyst intern',
      'data scientist', 'data science', 'data analyst', 'data analytics',
      'business analyst', 'business analytics', 'data engineer', 'analytics engineer',
      'machine learning engineer', 'ml engineer', 'mle', 'ai engineer',
      'quantitative analyst', 'quant analyst', 'bi analyst',
      '数据分析师', '数据科学', '数据科学家', '数据分析', '商业分析',
      '数据工程师', '机器学习工程师', '算法工程师', '量化分析',
    ],
  },
  {
    family: 'product',
    aliases: [
      'associate product manager', 'product manager intern', 'apm',
      'product manager', 'product owner', 'product intern',
      'product analyst', 'product operations',
      '产品经理', '产品实习生', '产品运营', '产品分析',
    ],
  },
  {
    family: 'design',
    aliases: [
      'product designer', 'ux designer', 'ui designer', 'ux/ui designer',
      'user experience designer', 'visual designer', 'interaction designer',
      '设计实习生', '产品设计师', '交互设计师', '视觉设计师',
    ],
  },
  {
    family: 'marketing',
    aliases: [
      'marketing intern', 'growth intern',
      'marketing manager', 'growth marketing', 'digital marketing',
      'brand manager', 'content marketing', 'product marketing',
      '市场实习生', '市场营销', '增长', '品牌经理', '产品营销',
    ],
  },
  {
    family: 'finance',
    aliases: [
      'investment banking intern', 'investment banking analyst', 'ib analyst',
      'summer analyst', 'investment analyst', 'financial analyst intern',
      'financial analyst', 'finance intern', 'accounting intern',
      'audit intern', 'risk analyst', 'quant intern',
      '投行', '投资银行', '金融分析', '财务分析', '审计', '会计', '风控', '量化',
    ],
  },
  {
    family: 'consulting',
    aliases: [
      'strategy intern', 'consulting intern', 'business intern',
      'strategy consultant', 'management consultant', 'consultant',
      'strategy analyst', 'business consultant',
      '咨询', '战略咨询', '管理咨询', '商业分析实习生',
    ],
  },
  {
    family: 'sales',
    aliases: [
      'sales intern', 'business development intern', 'account executive intern',
      'sales development', 'business development', 'account executive', 'account manager',
      '销售', '商务', '客户经理',
    ],
  },
  {
    family: 'operations',
    aliases: [
      'operations intern', 'supply chain intern', 'program manager intern',
      'operations analyst', 'supply chain', 'program manager', 'project manager',
      'operations manager',
      '运营', '供应链', '项目管理', '项目经理',
    ],
  },
  {
    family: 'research',
    aliases: [
      'research intern', 'research scientist intern',
      'research scientist', 'research engineer', 'applied scientist',
      '研究科学家', '研究员', '研究工程师',
    ],
  },
  {
    family: 'security',
    aliases: [
      'security intern', 'security engineer intern',
      'security engineer', 'information security', 'cybersecurity',
      '安全工程师', '信息安全', '网络安全',
    ],
  },
];

const SORTED_ALIASES = ROLE_ALIAS_GROUPS
  .flatMap((group) => group.aliases.map((alias) => ({
    family: group.family,
    alias,
    normalized: normalizeRoleText(alias),
  })))
  .filter((item) => item.normalized.length >= 2)
  .sort((left, right) => right.normalized.length - left.normalized.length);

const FAMILY_BY_ALIAS = new Map(SORTED_ALIASES.map((item) => [item.normalized, item.family]));

export function normalizeRoleText(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function roleFamilyFromText(value: unknown): RoleFamily {
  const text = normalizeRoleText(value);
  if (!text) return 'other';
  const hit = SORTED_ALIASES.find((item) => item.normalized.length >= 3 && text.includes(item.normalized));
  return hit?.family || 'other';
}

export function expandRoleAliases(role: unknown, limit = 8): string[] {
  const normalized = normalizeRoleText(role);
  if (!normalized) return [];
  const family = FAMILY_BY_ALIAS.get(normalized) || roleFamilyFromText(normalized);
  const aliases = SORTED_ALIASES
    .filter((item) => item.family === family && (item.normalized === normalized || item.normalized.includes(normalized) || normalized.includes(item.normalized)))
    .map((item) => item.alias);
  const unique = [...new Set([normalized, ...aliases.map(normalizeRoleText)])];
  return unique.slice(0, limit);
}

export function roleMatchLevel(jobText: unknown, targetRoles: string[]): RoleMatchLevel {
  if (targetRoles.length === 0) return 'adjacent';
  const haystack = normalizeRoleText(jobText);
  if (!haystack) return 'unrelated';
  const jobFamily = roleFamilyFromText(haystack);
  for (const role of targetRoles) {
    const aliases = expandRoleAliases(role, 12);
    const direct = aliases.some((alias) => alias.length >= 3 && (haystack.includes(alias) || alias.includes(haystack)));
    if (direct) return 'direct';
    const targetFamily = roleFamilyFromText(role);
    if (targetFamily !== 'other' && targetFamily === jobFamily) return 'direct';
  }
  return 'unrelated';
}

export function roleScore(jobText: unknown, targetRoles: string[]): number {
  const level = roleMatchLevel(jobText, targetRoles);
  if (targetRoles.length === 0) return 60;
  if (level === 'direct') return 100;
  if (level === 'adjacent') return 72;
  return 28;
}

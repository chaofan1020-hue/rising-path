/**
 * 字段语义识别器：把一个真实表单控件，解析成标准问题（canonical key）+ 置信度 + 判定依据。
 *
 * 识别顺序（打分制，非短路）：
 *   1. 站点配方直接给定 canonical key        → 0.99
 *   2. 标签/占位符/aria 与别名完全一致        → 0.97
 *   3. 别名作为整词短语出现在标签里           → 0.86~0.92
 *   4. 别名出现在 name/id（camelCase/下划线）  → 0.78~0.84
 *   5. 词元重合度（Jaccard）                 → 0.45~0.75
 *   6. 结构信号（控件类型、选项列表、section）→ 加成
 *   7. 反向词（exclude）                     → 惩罚
 *
 * 所有得分与惩罚都写进 reasons，用于线上 badcase 归因与词库迭代。
 */
import {
  CANONICAL_FIELDS,
  isCanonicalKey,
  normalizeFieldText,
  type CanonicalFieldDefinition,
  type CanonicalKey,
} from './taxonomy';

export interface FieldInput {
  key: string;
  label?: string;
  name?: string;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  /** text / email / tel / url / select / radio / checkbox / date / number / file / textarea */
  type?: string;
  /** select/radio 的可选值文案 */
  options?: string[];
  required?: boolean;
  /** 最近的 fieldset legend / 小标题文案，用于消歧 */
  section?: string;
  /** 站点配方给出的 canonical key（最高优先级） */
  recipeKey?: string;
  /** 站点配方给出的转换函数名（由配方运行时处理） */
  transform?: string;
}

export type ResolutionMethod = 'recipe' | 'exact' | 'phrase' | 'attribute' | 'token' | 'none';

export interface FieldResolution {
  key: string;
  canonicalKey: CanonicalKey | null;
  confidence: number;
  method: ResolutionMethod;
  matchedAlias?: string;
  /** 与第一名很接近的候选，需要在 UI 上让用户选 */
  ambiguousWith?: CanonicalKey[];
  reasons: string[];
}

/** camelCase / snake_case / $ctl 前缀 → 可读短语，便于与别名比对。 */
export function humanizeAttribute(value: string): string {
  return String(value || '')
    .replace(/\$?ctl\d+\$?/gi, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.[\]]+/g, ' ')
    .replace(/\d+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensOf(text: string): Set<string> {
  return new Set(text.split(' ').filter((token) => token.length > 1));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

/** 整词短语匹配：boundary 用空格补齐，避免 "state" 命中 "statement"。 */
function containsPhrase(haystack: string, phrase: string): boolean {
  if (!phrase) return false;
  return ` ${haystack} `.includes(` ${phrase} `);
}

function typeBoost(definition: CanonicalFieldDefinition, field: FieldInput): number {
  const type = (field.type || '').toLowerCase();
  if (!type) return 0;
  if (definition.valueType === 'email' && type === 'email') return 0.08;
  if (definition.valueType === 'url' && type === 'url') return 0.06;
  if (definition.valueType === 'phone' && type === 'tel') return 0.08;
  if (definition.valueType === 'date' && type === 'date') return 0.06;
  if (definition.valueType === 'number' && type === 'number') return 0.05;
  if ((definition.valueType === 'enum' || definition.valueType === 'multi_enum') && (type === 'select' || type === 'radio')) return 0.05;
  if (definition.valueType === 'boolean' && (type === 'checkbox' || type === 'radio')) return 0.03;
  if (definition.valueType === 'longtext' && type === 'textarea') return 0.06;
  if (definition.valueType === 'text' && type === 'textarea') return -0.05;
  return 0;
}

function optionOverlap(definition: CanonicalFieldDefinition, field: FieldInput): number {
  if (!definition.options?.length || !field.options?.length) return 0;
  const fieldOptions = field.options.map((option) => normalizeFieldText(option)).filter(Boolean);
  let hits = 0;
  for (const option of definition.options) {
    const synonyms = [option.replace(/_/g, ' '), ...(definition.optionAliases?.[option] || [])]
      .map((item) => normalizeFieldText(item))
      .filter(Boolean);
    if (fieldOptions.some((candidate) => synonyms.some((synonym) => candidate.includes(synonym)))) hits += 1;
  }
  return hits === 0 ? 0 : Math.min(0.12, (hits / definition.options.length) * 0.2);
}

function sectionBoost(definition: CanonicalFieldDefinition, field: FieldInput): number {
  const section = normalizeFieldText(field.section || '');
  if (!section) return 0;
  const groupWords: Record<string, string[]> = {
    education: ['education', 'academic', 'school', 'university', '教育', '学历'],
    experience: ['experience', 'employment', 'work history', 'professional', '工作经历', '履历'],
    location: ['address', 'location', 'contact', 'personal information', '地址', '联系方式'],
    identity: ['personal information', 'personal details', 'about you', '个人信息'],
    work_auth: ['authorization', 'eligibility', 'immigration', '工作授权', '签证'],
    eeo: ['voluntary', 'self identification', 'eeo', 'demographic', '自愿', '多样性'],
    screening: ['screening', 'questionnaire', 'additional questions', '筛选问题'],
    compensation: ['compensation', 'salary', '薪资'],
    availability: ['availability', 'start date', '可入职'],
    essays: ['essay', 'questions', 'open questions', '开放题'],
  };
  const words = groupWords[definition.group] || [];
  return words.some((word) => section.includes(word)) ? 0.05 : 0;
}

interface Candidate {
  definition: CanonicalFieldDefinition;
  score: number;
  method: ResolutionMethod;
  alias?: string;
  reasons: string[];
}

function scoreDefinition(
  definition: CanonicalFieldDefinition,
  primary: string,
  attribute: string,
  field: FieldInput,
  primaryTokens: Set<string>,
  attributeTokens: Set<string>,
): Candidate {
  const reasons: string[] = [];
  let best: { score: number; method: ResolutionMethod; alias?: string } = { score: 0, method: 'none' };

  for (const alias of definition.aliases) {
    if (!alias) continue;

    // 1. 完全一致
    if (primary === alias) {
      if (0.97 > best.score) best = { score: 0.97, method: 'exact', alias };
      continue;
    }

    // 2. 整词短语命中主标签。短别名（to/from/date/name）在长句里误伤率极高，只允许 ≥3 字符参与短语匹配。
    if (alias.length >= 3 && containsPhrase(primary, alias)) {
      // 别名越长，越像「专门为这个问题写的一段话」，可信度越高
      const lengthBonus = Math.min(0.12, alias.length / 200);
      const score = 0.86 + lengthBonus;
      if (score > best.score) best = { score, method: 'phrase', alias };
      continue;
    }

    // 3. 命中 name/id 等属性
    if (alias.length >= 3 && attribute && containsPhrase(attribute, alias)) {
      const score = 0.78 + Math.min(0.12, alias.length / 200);
      if (score > best.score) best = { score, method: 'attribute', alias };
      continue;
    }

    // 4. 词元重合
    const overlapPrimary = jaccard(tokensOf(alias), primaryTokens);
    const overlapAttribute = jaccard(tokensOf(alias), attributeTokens);
    const overlap = Math.max(overlapPrimary, overlapAttribute);
    if (overlap >= 0.5) {
      const score = 0.45 + overlap * 0.3;
      if (score > best.score) best = { score, method: 'token', alias };
    }
  }

  if (best.score === 0) {
    return { definition, score: 0, method: 'none', reasons };
  }

  let score = best.score;
  const typeDelta = typeBoost(definition, field);
  if (typeDelta !== 0) {
    score += typeDelta;
    reasons.push(`type:${field.type}${typeDelta > 0 ? '+' : ''}${typeDelta.toFixed(2)}`);
  }
  const optionDelta = optionOverlap(definition, field);
  if (optionDelta > 0) {
    score += optionDelta;
    reasons.push(`options+${optionDelta.toFixed(2)}`);
  }
  const sectionDelta = sectionBoost(definition, field);
  if (sectionDelta > 0) {
    score += sectionDelta;
    reasons.push('section+0.05');
  }
  for (const excluded of definition.exclude || []) {
    if (containsPhrase(primary, excluded) || (attribute && containsPhrase(attribute, excluded))) {
      score -= 0.35;
      reasons.push(`exclude:${excluded}`);
      break;
    }
  }
  reasons.push(`${best.method}:${best.alias}`);

  return {
    definition,
    score: Math.max(0, Math.min(0.99, score)),
    method: best.method,
    alias: best.alias,
    reasons,
  };
}

/** 单字段解析。 */
export function resolveField(field: FieldInput): FieldResolution {
  if (field.recipeKey && isCanonicalKey(field.recipeKey)) {
    return {
      key: field.key,
      canonicalKey: field.recipeKey,
      confidence: 0.99,
      method: 'recipe',
      reasons: [`recipe:${field.recipeKey}`],
    };
  }

  const labelText = normalizeFieldText(field.label || '');
  const ariaText = normalizeFieldText(field.ariaLabel || '');
  const placeholderText = normalizeFieldText(field.placeholder || '');
  const attributeRaw = [field.name, field.id].filter(Boolean).join(' ');
  const attributeText = normalizeFieldText(
    [humanizeAttribute(field.name || ''), humanizeAttribute(field.id || '')].filter(Boolean).join(' '),
  );

  // 主文本优先级：label > aria > 占位符（占位符常是示例，权重低但仍可用）
  const primary = labelText || ariaText || placeholderText;
  const primaryTokens = tokensOf(primary);
  const attributeTokens = tokensOf(attributeText || attributeRaw);

  const candidates: Candidate[] = [];
  for (const definition of Object.values(CANONICAL_FIELDS)) {
    const candidate = scoreDefinition(definition, primary, attributeText, field, primaryTokens, attributeTokens);
    if (candidate.score > 0) candidates.push(candidate);
  }

  if (candidates.length === 0) {
    return { key: field.key, canonicalKey: null, confidence: 0, method: 'none', reasons: ['no-alias-match'] };
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0];
  const runnerUp = candidates[1];
  // 只有当两者「各自命中了不同短语」且分数接近时才算真歧义；
  // 如果冠军命中的短语本身就包含亚军的短语（"now or in the future require sponsorship" ⊃ "sponsorship"），说明是包含关系，不是歧义。
  const containment = Boolean(
    top.alias && runnerUp?.alias && top.alias !== runnerUp.alias && containsPhrase(top.alias, runnerUp.alias),
  );
  const ambiguous = Boolean(runnerUp && !containment && top.score - runnerUp.score < 0.06 && top.score < 0.9);

  return {
    key: field.key,
    canonicalKey: top.definition.key,
    confidence: ambiguous ? Math.min(top.score, 0.6) : top.score,
    method: top.method,
    matchedAlias: top.alias,
    ambiguousWith: ambiguous ? [runnerUp.definition.key] : undefined,
    reasons: ambiguous ? [...top.reasons, `ambiguous:${runnerUp.definition.key}`] : top.reasons,
  };
}

export function resolveFields(fields: FieldInput[]): FieldResolution[] {
  return fields.map(resolveField);
}

/** 站点级统计：用于判定「这套配方还准不准」。 */
export interface ResolutionSummary {
  total: number;
  resolved: number;
  highConfidence: number;
  ambiguous: number;
  unresolved: number;
  coverage: number;
}

export function summarizeResolutions(resolutions: FieldResolution[]): ResolutionSummary {
  const total = resolutions.length;
  const resolved = resolutions.filter((item) => item.canonicalKey).length;
  const highConfidence = resolutions.filter((item) => item.canonicalKey && item.confidence >= 0.85).length;
  const ambiguous = resolutions.filter((item) => item.ambiguousWith?.length).length;
  return {
    total,
    resolved,
    highConfidence,
    ambiguous,
    unresolved: total - resolved,
    coverage: total === 0 ? 0 : resolved / total,
  };
}

/** 同一 canonical key 在一页出现多次时的分组（例如「工作经历 1/2/3」）。 */
export function groupByCanonicalKey(resolutions: FieldResolution[]): Map<CanonicalKey, FieldResolution[]> {
  const groups = new Map<CanonicalKey, FieldResolution[]>();
  for (const resolution of resolutions) {
    if (!resolution.canonicalKey) continue;
    const list = groups.get(resolution.canonicalKey) || [];
    list.push(resolution);
    groups.set(resolution.canonicalKey, list);
  }
  return groups;
}

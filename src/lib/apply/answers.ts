/**
 * 答案库：标准问题 → 一份「标准答案」，以及把标准答案落到某个具体 ATS 控件上的适配逻辑。
 *
 * 关键点：同一个 canonical key 在不同站点上的「正确写法」不一样。
 *  - Greenhouse 的 Gender 是 "Decline to self-identify"
 *  - Workday 的是 "I don't wish to answer"
 *  - 日期可能是 MM/DD/YYYY、MM/YYYY、或者是三个独立下拉（月/日/年）
 * 所以答案库里存「语义值」，落到控件前经过 canonicalizeOption / formatValue 转换。
 */
import type { ApplicationProfile } from '@/lib/application-profile';
import {
  CANONICAL_FIELDS,
  normalizeFieldText,
  type CanonicalFieldDefinition,
  type CanonicalKey,
} from './taxonomy';

export type AnswerSource = 'user' | 'profile' | 'ai' | 'default';

export interface AnswerRecord {
  canonicalKey: CanonicalKey;
  /** 语义值：boolean 用 'yes'/'no'；enum 用 taxonomy 里的标准取值；日期用 ISO（YYYY-MM-DD 或 YYYY-MM）。 */
  value: string;
  /** 用户原文（可能带大量自由文本），用于开放题。 */
  rawValue?: string;
  source: AnswerSource;
  confidence: number;
  /** 站点级覆盖：同一问题在某个域名下的特殊答案。 */
  domainOverride?: string;
  updatedAt?: string;
}

export type AnswerBank = Partial<Record<CanonicalKey, AnswerRecord>>;

const YES_SYNONYMS = ['yes', 'y', 'true', '1', 'yes i am', '是', '同意', '确认', '愿意', '有'];
const NO_SYNONYMS = ['no', 'n', 'false', '0', 'no i am not', '否', '不同意', '不愿意', '没有'];
const DECLINE_SYNONYMS = [
  'decline', 'decline to answer', 'decline to self identify', 'decline to identify',
  'i do not wish to answer', 'i dont wish to answer', 'prefer not to say', 'prefer not to answer',
  'not disclosed', 'no answer', 'choose not to disclose', '不愿透露', '拒绝回答',
];

function normalizeOption(value: string): string {
  return normalizeFieldText(value)
    .replace(/\b(i|we)\s+(do\s+not|dont|don t)\b/g, 'not')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

/**
 * 把语义值映射到控件上真实存在的选项文案。
 * 返回 null 表示「这个控件里没有能承载该答案的选项」，调用方应交给人工。
 */
export function canonicalizeOption(
  definition: CanonicalFieldDefinition,
  value: string,
  options: string[],
): string | null {
  if (!options.length) return null;
  const normalizedOptions = options.map((option) => ({ raw: option, norm: normalizeOption(option) }));
  const wanted = normalizeOption(String(value ?? ''));
  if (!wanted) return null;

  // 1. 直接相等
  const exact = normalizedOptions.find((option) => option.norm === wanted);
  if (exact) return exact.raw;

  // 2. 答案本身的同义词集合
  let synonyms: string[] = [wanted];
  for (const [key, list] of Object.entries(definition.optionAliases || {})) {
    if (normalizeOption(key) === wanted || list.some((item) => normalizeOption(item) === wanted)) {
      synonyms = [normalizeOption(key), ...list.map(normalizeOption), wanted];
      break;
    }
  }
  if (definition.valueType === 'boolean') {
    if (YES_SYNONYMS.includes(wanted)) synonyms = [...YES_SYNONYMS, 'yes'];
    if (NO_SYNONYMS.includes(wanted)) synonyms = [...NO_SYNONYMS, 'no'];
  }

  for (const synonym of synonyms) {
    if (!synonym) continue;
    const hit = normalizedOptions.find((option) => option.norm === synonym);
    if (hit) return hit.raw;
  }
  for (const synonym of synonyms) {
    if (!synonym || synonym.length < 2) continue;
    const hit = normalizedOptions.find((option) => option.norm.includes(synonym));
    if (hit) return hit.raw;
  }

  // 3. 拒绝回答类：各站点文案差异极大，单独兜底
  if (wanted.includes('decline') || wanted.includes('prefer not') || wanted.includes('不愿')) {
    const hit = normalizedOptions.find((option) => includesAny(option.norm, DECLINE_SYNONYMS.map(normalizeOption)));
    if (hit) return hit.raw;
  }

  return null;
}

/** 语义值 → 控件需要的字符串格式。 */
export function formatValue(
  definition: CanonicalFieldDefinition,
  value: string,
  options?: { fieldType?: string },
): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  if (definition.valueType === 'date' || definition.valueType === 'month_year') {
    const parsed = parseLooseDate(raw);
    if (parsed) {
      const type = (options?.fieldType || '').toLowerCase();
      // <input type="date"> 只接受 yyyy-mm-dd，必须补日
      if (type === 'date') return `${parsed.year}-${pad(parsed.month)}-${pad(parsed.day || 1)}`;
      if (type === 'month') return `${parsed.year}-${pad(parsed.month)}`;
      // 文本输入：有日按美式 MM/DD/YYYY，只有年月按 MM/YYYY
      if (definition.format === 'date_ym' || !parsed.day) {
        return parsed.day ? `${pad(parsed.month)}/${pad(parsed.day)}/${parsed.year}` : `${pad(parsed.month)}/${parsed.year}`;
      }
      return `${pad(parsed.month)}/${pad(parsed.day)}/${parsed.year}`;
    }
    return raw;
  }

  if (definition.format === 'digits') {
    return raw.replace(/[^\d+]/g, '');
  }

  if (definition.valueType === 'number') {
    return raw.replace(/[^\d.]/g, '');
  }

  return raw;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function parseLooseDate(value: string): { year: number; month: number; day?: number } | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let match = raw.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?/);
  if (match) {
    return { year: Number(match[1]), month: Number(match[2]), day: match[3] ? Number(match[3]) : undefined };
  }
  match = raw.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (match) return { year: Number(match[2]), month: Number(match[1]) };
  match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) return { year: Number(match[3]), month: Number(match[1]), day: Number(match[2]) };
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  match = raw.toLowerCase().match(/^([a-z]{3,9})\s+(\d{4})$/);
  if (match) {
    const month = monthNames.findIndex((name) => match![1].startsWith(name));
    if (month >= 0) return { year: Number(match[2]), month: month + 1 };
  }
  match = raw.match(/^(\d{4})$/);
  if (match) return { year: Number(match[1]), month: 1 };
  return null;
}

function readPath(profile: unknown, path: string): string {
  const parts = path.split('.');
  let current: unknown = profile;
  for (const part of parts) {
    if (current == null) return '';
    if (Array.isArray(current)) {
      current = current[Number(part)];
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return '';
    }
  }
  if (typeof current === 'string') return current.trim();
  if (typeof current === 'number') return String(current);
  return '';
}

function pickFirst(value: unknown, keys: string[]): string {
  if (Array.isArray(value) && value.length > 0 && value[0] && typeof value[0] === 'object') {
    const record = value[0] as Record<string, unknown>;
    for (const key of keys) {
      const item = record[key];
      if (typeof item === 'string' && item.trim()) return item.trim();
    }
    if (typeof record.raw === 'string') {
      const raw = record.raw;
      const matched = raw.match(new RegExp(`(?:^|\\|)\\s*([^|]*${keys[0]}[^|]*)`, 'i'));
      if (matched) return matched[1].trim();
      return raw.split('|')[0].trim();
    }
  }
  return '';
}

function joinList(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).join(', ');
}

const INTERNATIONAL_STUDENT_PATTERN = /f-?1|j-?1|opt|cpt|i-?20|国际学生|留学生/i;
const SPONSORSHIP_YES_PATTERN = /sponsor|h-?1b|需要.*(赞助|担保)|需.*sponsor|需要抽签/i;
const SPONSORSHIP_NO_PATTERN = /不需要.*(赞助|担保)|no\s+sponsorship|citizen|green\s*card|permanent\s+resident|绿卡|公民|h-?4|dependent/i;

/** 从求职档案推导答案（答案库里没有该问题时使用）。 */
export function deriveAnswerFromProfile(profile: ApplicationProfile | null | undefined, key: CanonicalKey): AnswerRecord | null {
  if (!profile) return null;
  const definition = CANONICAL_FIELDS[key];
  const base = (value: string, confidence = 0.9): AnswerRecord | null => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return null;
    return { canonicalKey: key, value: trimmed, rawValue: trimmed, source: 'profile', confidence };
  };

  // 需要「计算」的字段先算：它们不能直接读档案字段（否则 degree_level 会拿到 "Master of Science" 原文，
  // requires_sponsorship 会拿到 "F-1 OPT" 原文，都不是表单能接受的答案）。
  const computed = computeAnswer(profile, key);
  if (computed) return base(computed.value, computed.confidence);

  if (definition.profilePath) {
    const direct = readPath(profile, definition.profilePath);
    if (direct) return base(direct);
  }

  return null;
}

function computeAnswer(profile: ApplicationProfile, key: CanonicalKey): { value: string; confidence: number } | null {
  const value = (raw: string, confidence = 0.9): { value: string; confidence: number } | null => {
    const trimmed = String(raw || '').trim();
    return trimmed ? { value: trimmed, confidence } : null;
  };
  switch (key) {
    case 'full_name': {
      const personal = profile.personal || {};
      const combined = [personal.firstName, personal.lastName].filter(Boolean).join(' ').trim();
      return value(combined || personal.fullName || '');
    }
    case 'school_name':
      return value(pickFirst(profile.education, ['school', 'schoolName', 'university']));
    case 'major':
      return value(pickFirst(profile.education, ['major', 'field', 'fieldOfStudy']));
    case 'degree_level':
      return value(normalizeDegreeLevel(pickFirst(profile.education, ['degree', 'degreeLevel', 'qualification'])), 0.82);
    case 'graduation_date':
      return value(pickFirst(profile.education, ['graduationDate', 'graduation', 'endDate']), 0.8);
    case 'company_name':
      return value(pickFirst(profile.experience, ['company', 'companyName', 'employer']));
    case 'job_title':
      return value(pickFirst(profile.experience, ['role', 'title', 'position']));
    case 'skills':
      return value(joinList(profile.skills));
    case 'languages':
      return value(joinList(profile.languages));
    case 'cover_letter':
      return value(profile.summary || '');
    case 'requires_sponsorship': {
      const signal = `${profile.visaStatus || ''} ${profile.workAuthorization || ''}`;
      if (!signal.trim()) return null;
      if (SPONSORSHIP_NO_PATTERN.test(signal)) return value('no', 0.72);
      if (SPONSORSHIP_YES_PATTERN.test(signal)) return value('yes', 0.72);
      return null;
    }
    case 'is_international_student': {
      const signal = `${profile.visaStatus || ''} ${profile.workAuthorization || ''}`;
      if (!signal.trim()) return null;
      return value(INTERNATIONAL_STUDENT_PATTERN.test(signal) ? 'yes' : 'no', 0.7);
    }
    case 'work_authorization': {
      const signal = `${profile.workAuthorization || ''} ${profile.visaStatus || ''}`;
      if (!signal.trim()) return null;
      if (SPONSORSHIP_NO_PATTERN.test(signal)) return value('authorized_no_sponsorship', 0.75);
      if (SPONSORSHIP_YES_PATTERN.test(signal)) return value('authorized_requires_sponsorship', 0.75);
      return value('authorized_no_sponsorship', 0.6);
    }
    default:
      return null;
  }
}

export function normalizeDegreeLevel(degree: string): string {
  const text = normalizeFieldText(degree);
  if (!text) return '';
  if (/phd|doctor|博士/.test(text)) return 'phd';
  if (/mba/.test(text)) return 'mba';
  if (/master|msc|m\.s|meng|m\.eng|研究生|硕士/.test(text)) return 'master';
  if (/bachelor|bsc|b\.s|ba\b|undergrad|本科|学士/.test(text)) return 'bachelor';
  if (/associate|大专|副学士/.test(text)) return 'associate';
  if (/high school|secondary|高中/.test(text)) return 'high_school';
  return 'other';
}

/** 合并「答案库 > 站点覆盖 > 档案推导」，给出最终可用答案。 */
export function lookupAnswer(
  key: CanonicalKey,
  bank: AnswerBank | null | undefined,
  profile: ApplicationProfile | null | undefined,
  domain?: string,
): AnswerRecord | null {
  const record = bank?.[key];
  if (record?.value) {
    if (record.domainOverride && domain && record.domainOverride === domain) return record;
    if (!record.domainOverride) return record;
  }
  return deriveAnswerFromProfile(profile, key);
}

export interface ResolvedFieldValue {
  fieldKey: string;
  canonicalKey: CanonicalKey | null;
  value: string;
  /** 语义值（与 value 可能不同：value 已适配控件选项/格式） */
  semanticValue: string;
  source: AnswerSource | 'empty';
  confidence: number;
  needsReview: boolean;
  reason?: string;
}

export function needsManualConfirmation(definition: CanonicalFieldDefinition | undefined): boolean {
  return Boolean(definition?.sensitive);
}

/**
 * 批量解析：给一组字段 + 答案库 + 档案，产出可直接写入页面的值。
 * 未知字段（没有 canonical key）不会调用 AI，交给上层决定是否走 LLM 兜底。
 */
export function buildFieldValues(
  fields: Array<{ key: string; canonicalKey: CanonicalKey | null; confidence: number; options?: string[]; type?: string }>,
  bank: AnswerBank | null | undefined,
  profile: ApplicationProfile | null | undefined,
  domain?: string,
): { values: ResolvedFieldValue[]; unresolvedFieldKeys: string[] } {
  const values: ResolvedFieldValue[] = [];
  const unresolvedFieldKeys: string[] = [];

  for (const field of fields) {
    if (!field.canonicalKey) {
      unresolvedFieldKeys.push(field.key);
      continue;
    }
    const definition = CANONICAL_FIELDS[field.canonicalKey];
    const answer = lookupAnswer(field.canonicalKey, bank, profile, domain);
    if (!answer || !answer.value) {
      unresolvedFieldKeys.push(field.key);
      continue;
    }

    let value = answer.value;
    let reason: string | undefined;
    let confidence = Math.min(answer.confidence, field.confidence || 1);

    if (definition.valueType === 'enum' || definition.valueType === 'boolean') {
      const mapped = canonicalizeOption(definition, answer.value, field.options || []);
      if (mapped) {
        value = mapped;
        if (definition.valueType === 'boolean') reason = '布尔问题已映射到页面选项';
      } else if (!field.options || field.options.length === 0) {
        // 自定义下拉（role=combobox）在扫描时是收起的，拿不到选项文案。
        // 这里原样下发语义值，由客户端在展开后做模糊匹配。
        value = answer.value;
        reason = '下拉选项需在页面上实时匹配';
        confidence = Math.min(confidence, 0.8);
      } else {
        unresolvedFieldKeys.push(field.key);
        continue;
      }
    } else {
      value = formatValue(definition, answer.value, { fieldType: field.type });
    }

    const sensitive = needsManualConfirmation(definition);
    if (sensitive) confidence = Math.min(confidence, 0.6);

    values.push({
      fieldKey: field.key,
      canonicalKey: field.canonicalKey,
      value,
      semanticValue: answer.value,
      source: answer.source,
      confidence,
      needsReview: sensitive || confidence < 0.85 || Boolean(answer.source === 'ai'),
      reason,
    });
  }

  return { values, unresolvedFieldKeys };
}

/** 用户确认/修改后的写回：只更新答案库，不直接改档案。 */
export function upsertAnswer(
  bank: AnswerBank,
  key: CanonicalKey,
  value: string,
  source: AnswerSource = 'user',
  domain?: string,
): AnswerBank {
  const definition = CANONICAL_FIELDS[key];
  const semantic = definition.valueType === 'boolean'
    ? (/^(yes|true|1|是|同意|y)$/i.test(value.trim()) ? 'yes' : /^(no|false|0|否|不同意|n)$/i.test(value.trim()) ? 'no' : value.trim())
    : value.trim();
  return {
    ...bank,
    [key]: {
      canonicalKey: key,
      value: semantic,
      rawValue: value,
      source,
      confidence: 1,
      domainOverride: domain,
      updatedAt: new Date().toISOString(),
    },
  };
}

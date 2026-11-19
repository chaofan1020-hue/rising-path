/**
 * 扫描结果 → 可填写值：把「配方 + 语义 + 答案」三层拼成一次解析。
 *
 * 设计约束：
 * - 纯函数，不碰数据库、不调模型，便于单元测试与在路由里自由组合；
 * - 默认零 AI：只有 canonical key 识别不出来、且调用方显式允许时才交给上层兜底；
 * - 每个字段都带 reason，方便线上归因「为什么没填」。
 */
import type { ApplicationProfile } from '@/lib/application-profile';
import { buildFieldValues, deriveAnswerFromProfile, type AnswerBank, type AnswerRecord } from './answers';
import { matchRecipe, type AtsRecipe, type RecipeFieldMap } from './recipes';
import { resolveField, type FieldInput, type ResolutionMethod } from './resolver';
import { CANONICAL_FIELDS, isCanonicalKey, normalizeFieldText, type CanonicalKey } from './taxonomy';

export interface ScanField extends FieldInput {
  /** Workday / SuccessFactors 等站点用 data-automation-id 标记控件。 */
  automationId?: string;
  /** 输入框当前值（只用于判断「站点已经填过」，不会回写）。 */
  currentValue?: string;
  /** 自定义下拉（role=combobox）展开后的候选文案。 */
  options?: string[];
  /** 控件是否有值 / 是否可见，避免覆盖用户已经手动填写的内容。 */
  disabled?: boolean;
}

export interface ScanRequest {
  url: string;
  fields: ScanField[];
  /** 页面上出现过的 data-automation-id，用于给配方做 DOM 证据匹配。 */
  automationIds?: string[];
  /** 正文片段，用于文案信号。 */
  pageText?: string;
}

export interface ResolvedScanField {
  key: string;
  canonicalKey: CanonicalKey | null;
  label: string;
  value: string;
  semanticValue: string;
  source: 'user' | 'profile' | 'ai' | 'default' | 'empty';
  confidence: number;
  needsReview: boolean;
  /** 高敏字段（EEO / 授权签名等）永远需要人工确认。 */
  sensitive: boolean;
  method: ResolutionMethod;
  reason?: string;
  reasons: string[];
  options?: string[];
  type?: string;
  required?: boolean;
}

export interface ScanResolution {
  recipe: Pick<AtsRecipe, 'id' | 'label' | 'atsType' | 'version' | 'status' | 'form' | 'uploads' | 'submit' | 'steps'> | null;
  recipeScore: number;
  fields: ResolvedScanField[];
  unresolved: Array<{ key: string; label: string; reason: string }>;
  stats: {
    total: number;
    resolved: number;
    fillable: number;
    needsReview: number;
    recipeHit: number;
    coverage: number;
  };
}

/** 从配方选择器里抽出可比较的属性值：`#id`、`[name="x"]`、`[data-automation-id="x"]`。 */
export function selectorHints(selector: string): { ids: string[]; names: string[]; automationIds: string[] } {
  const ids: string[] = [];
  const names: string[] = [];
  const automationIds: string[] = [];
  for (const part of String(selector || '').split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idMatch = trimmed.match(/#([A-Za-z0-9_-]+)/);
    if (idMatch) ids.push(idMatch[1]);
    for (const match of trimmed.matchAll(/\[\s*([A-Za-z0-9_-]+)\s*([*^$|~]?=)\s*["']([^"']+)["']\s*\]/g)) {
      const [, attribute, operator, value] = match;
      if (operator !== '=') {
        if (attribute === 'data-automation-id') automationIds.push(value);
        continue;
      }
      if (attribute === 'name') names.push(value);
      if (attribute === 'id') ids.push(value);
      if (attribute === 'data-automation-id') automationIds.push(value);
    }
  }
  return { ids, names, automationIds };
}

/** 配方 vs 扫描字段：命中则直接给出 canonical key（置信度 0.99）。 */
export function recipeKeyForField(recipe: AtsRecipe | null, field: ScanField): CanonicalKey | undefined {
  if (!recipe?.fields?.length) return undefined;
  const wanted = {
    id: String(field.id || '').trim(),
    name: String(field.name || '').trim(),
    automationId: String(field.automationId || '').trim(),
  };
  for (const mapping of recipe.fields as RecipeFieldMap[]) {
    const hints = selectorHints(mapping.selector);
    const hit = (hints.ids.includes(wanted.id) && wanted.id)
      || (hints.names.includes(wanted.name) && wanted.name)
      || (hints.automationIds.includes(wanted.automationId) && wanted.automationId);
    if (hit) return mapping.canonicalKey;
  }
  return undefined;
}

function fieldLabelForReport(field: ScanField): string {
  return String(field.label || field.ariaLabel || field.placeholder || field.name || field.id || field.key || '').trim();
}

function answerBankFromProfile(profile: ApplicationProfile | null | undefined, keys: CanonicalKey[]): AnswerBank {
  const bank: AnswerBank = {};
  for (const key of new Set(keys)) {
    const record = deriveAnswerFromProfile(profile, key);
    if (record) bank[key] = record as AnswerRecord;
  }
  return bank;
}

/**
 * 主入口：把一次扫描解析成逐字段的填写计划。
 *
 * 优先级：配方直连（0.99）> 词库识别 > 未识别。
 * 值来源：答案库（本次由档案推导） > 空。
 */
export function resolveScan(
  request: ScanRequest,
  profile: ApplicationProfile | null | undefined,
  options: { bank?: AnswerBank; domain?: string } = {},
): ScanResolution {
  const matched = matchRecipe({
    url: request.url,
    hasSelector: request.automationIds?.length
      ? (selector) => {
          const { automationIds } = selectorHints(selector);
          return automationIds.some((id) => request.automationIds!.includes(id));
        }
      : undefined,
    pageText: request.pageText,
  });
  const recipe = matched?.recipe || null;

  // 1) 语义识别
  const resolved = request.fields.map((field) => {
    const recipeKey = recipeKeyForField(recipe, field);
    return { field, resolution: resolveField({ ...field, recipeKey }) };
  });

  // 2) 档案推导：只对识别出来的键计算一次，避免 N 个字段重复解析简历
  const canonicalKeys = resolved
    .map((item) => item.resolution.canonicalKey)
    .filter((key): key is CanonicalKey => Boolean(key));
  const bank = { ...answerBankFromProfile(profile, canonicalKeys), ...(options.bank || {}) };

  // 3) 值落地（选项匹配 / 日期格式化 / 电话号码清洗）
  const { values } = buildFieldValues(
    resolved.map(({ field, resolution }) => ({
      key: field.key,
      canonicalKey: resolution.canonicalKey,
      confidence: resolution.confidence,
      options: field.options,
      type: field.type,
    })),
    bank,
    profile,
    options.domain,
  );

  const valueByKey = new Map(values.map((value) => [value.fieldKey, value]));
  const fields: ResolvedScanField[] = [];
  const unresolved: ScanResolution['unresolved'] = [];

  for (const { field, resolution } of resolved) {
    const label = fieldLabelForReport(field);
    if (!resolution.canonicalKey) {
      unresolved.push({ key: field.key, label, reason: 'semantic-unresolved' });
      fields.push({
        key: field.key,
        canonicalKey: null,
        label,
        value: '',
        semanticValue: '',
        source: 'empty',
        confidence: 0,
        needsReview: true,
        sensitive: false,
        method: resolution.method,
        reason: '没有匹配到标准问题',
        reasons: resolution.reasons,
        options: field.options,
        type: field.type,
        required: field.required,
      });
      continue;
    }

    const definition = CANONICAL_FIELDS[resolution.canonicalKey];
    const sensitive = Boolean(definition.sensitive);
    const computed = valueByKey.get(field.key);
    if (!computed) {
      unresolved.push({ key: field.key, label, reason: 'no-answer' });
      fields.push({
        key: field.key,
        canonicalKey: resolution.canonicalKey,
        label,
        value: '',
        semanticValue: '',
        source: 'empty',
        confidence: Math.min(resolution.confidence, 0.5),
        needsReview: true,
        sensitive,
        method: resolution.method,
        reason: field.options?.length ? '页面上没有匹配的选项' : '档案里缺少这项资料',
        reasons: resolution.reasons,
        options: field.options,
        type: field.type,
      });
      continue;
    }

    fields.push({
      key: field.key,
      canonicalKey: resolution.canonicalKey,
      label,
      value: computed.value,
      semanticValue: computed.semanticValue,
      source: computed.source === 'empty' ? 'empty' : computed.source,
      confidence: computed.confidence,
      needsReview: computed.needsReview,
      sensitive,
      method: resolution.method,
      reason: computed.reason,
      reasons: resolution.reasons,
      options: field.options,
      type: field.type,
      required: field.required,
    });
  }

  const fillable = fields.filter((field) => field.value && !field.sensitive).length;
  const needsReview = fields.filter((field) => field.needsReview && field.value).length;

  return {
    recipe: recipe
      ? {
          id: recipe.id,
          label: recipe.label,
          atsType: recipe.atsType,
          version: recipe.version,
          status: recipe.status,
          form: recipe.form,
          uploads: recipe.uploads,
          submit: recipe.submit,
          steps: recipe.steps,
        }
      : null,
    recipeScore: matched?.score || 0,
    fields,
    unresolved,
    stats: {
      total: fields.length,
      resolved: fields.filter((field) => field.canonicalKey).length,
      fillable,
      needsReview,
      recipeHit: resolved.filter((item) => item.resolution.method === 'recipe').length,
      coverage: fields.length === 0 ? 0 : fields.filter((field) => field.canonicalKey).length / fields.length,
    },
  };
}

/** 便于排查：把一次扫描压成一行日志。 */
export function summarizeScan(resolution: ScanResolution): string {
  const { stats, recipe } = resolution;
  return `recipe=${recipe?.id || 'none'} resolved=${stats.resolved}/${stats.total} fillable=${stats.fillable} review=${stats.needsReview}`;
}

export function isKnownCanonicalKey(value: string): boolean {
  return isCanonicalKey(value);
}

export function normalizeLabel(value: string): string {
  return normalizeFieldText(value);
}

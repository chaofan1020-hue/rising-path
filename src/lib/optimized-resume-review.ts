import type {
  OptimizationChange,
  OptimizedResumeData,
} from '@/lib/optimized-resume-contract';

const SECTION_ALIASES: Record<string, keyof OptimizedResumeData> = {
  contact: 'contact',
  summary: 'summary',
  skills: 'skills',
  experience: 'experience',
  education: 'education',
  projects: 'projects',
  certifications: 'certifications',
  '个人简介': 'summary',
  '专业技能': 'skills',
  '工作经历': 'experience',
  '教育背景': 'education',
  '项目经历': 'projects',
  '证书资质': 'certifications',
};

type ReviewMode = 'reject' | 'reapply';

export interface ReviewResult<T> {
  data: T;
  unmatched: string[];
}

type ReviewableList = Array<{
  title?: string;
  company?: string;
  location?: string;
  period?: string;
  highlights?: string[];
  description?: string;
  name?: string;
  role?: string;
  degree?: string;
  school?: string;
  major?: string;
  gpa?: string;
  [key: string]: unknown;
}>;

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function splitItems(text: string): string[] {
  return text
    .split(/\r?\n|\||；|;|、/)
    .flatMap((part) => {
      const trimmed = part.trim();
      if (!trimmed) return [];
      if (!trimmed.includes(',')) return [trimmed];
      const labeled = trimmed.match(
        /^(?:professional skills|languages|coursework highlights|skills|tools)\s*[:：]\s*(.*)$/i,
      );
      if (labeled) {
        return labeled[1].split(',').map((item) => item.trim()).filter(Boolean);
      }
      return [trimmed];
    })
    .filter(Boolean);
}

function itemsMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft === normalizedRight
    || normalizedLeft.includes(normalizedRight)
    || normalizedRight.includes(normalizedLeft);
}

function findItemIndex(items: string[], needle: string): number {
  return items.findIndex((item) => itemsMatch(item, needle));
}

function applyListItems(
  items: string[],
  before: string,
  after: string,
  mode: ReviewMode,
): boolean {
  const beforeItems = splitItems(before);
  const afterItems = splitItems(after);
  const next = [...items];
  let changed = false;

  if (mode === 'reject') {
    const afterCoversList = afterItems.length > 0
      && afterItems.every((afterItem) => next.some((item) => itemsMatch(item, afterItem)))
      && next.every((item) => afterItems.some((afterItem) => itemsMatch(item, afterItem)));
    if (afterCoversList) {
      next.splice(0, next.length, ...beforeItems);
      changed = true;
    } else {
      const protectedIndices = new Set<number>();
      const findUnprotectedIndex = (needle: string) => next.findIndex((item, index) => (
        !protectedIndices.has(index) && itemsMatch(item, needle)
      ));

      afterItems.forEach((afterItem, index) => {
        const itemIndex = findUnprotectedIndex(afterItem);
        if (itemIndex < 0) return;
        const beforeItem = beforeItems[index] ?? (beforeItems.length === 1 ? beforeItems[0] : '');
        if (beforeItem) {
          if (itemsMatch(next[itemIndex], beforeItem)) {
            protectedIndices.add(itemIndex);
            return;
          }
          next.splice(itemIndex, 1, beforeItem);
          protectedIndices.add(itemIndex);
        } else {
          next.splice(itemIndex, 1);
        }
        changed = true;
      });

      afterItems.forEach((afterItem) => {
        let itemIndex = findUnprotectedIndex(afterItem);
        while (itemIndex >= 0) {
          next.splice(itemIndex, 1);
          changed = true;
          itemIndex = findUnprotectedIndex(afterItem);
        }
      });
    }
  } else {
    beforeItems.forEach((beforeItem) => {
      const itemIndex = findItemIndex(next, beforeItem);
      if (itemIndex >= 0) {
        next.splice(itemIndex, 1);
        changed = true;
      }
    });
    afterItems.forEach((afterItem) => {
      if (!next.some((item) => itemsMatch(item, afterItem))) {
        next.push(afterItem);
        changed = true;
      }
    });
  }

  items.splice(0, items.length, ...next);
  return changed;
}

function replaceStringValue(current: string, before: string, after: string, mode: ReviewMode): string | null {
  if (mode === 'reject') {
    if (!after) return null;
    if (before === '') {
      if (current.includes(after)) {
        return current.split(after).join('');
      }
      if (normalizeText(current).includes(normalizeText(after))) {
        return '';
      }
      return null;
    }
    if (current.includes(after)) {
      return current.split(after).join(before);
    }
    if (normalizeText(current).includes(normalizeText(after))) {
      return before;
    }
    return null;
  }

  if (before && current.includes(before)) {
    return current.split(before).join(after);
  }
  if (before && normalizeText(current).includes(normalizeText(before))) {
    return after;
  }
  if (after && !current.includes(after)) {
    return current ? `${current} | ${after}` : after;
  }
  return null;
}

function applySummaryChange(data: OptimizedResumeData, change: OptimizationChange, mode: ReviewMode): boolean {
  const next = replaceStringValue(data.summary, change.before, change.after, mode);
  if (next === null) return false;
  data.summary = next;
  return true;
}

function applyContactChange(data: OptimizedResumeData, change: OptimizationChange, mode: ReviewMode): boolean {
  const fields: Array<keyof OptimizedResumeData['contact']> = [
    'email',
    'phone',
    'location',
    'linkedin',
  ];

  if (mode === 'reject') {
    for (const field of fields) {
      const current = data.contact[field] || '';
      const next = replaceStringValue(current, change.before, change.after, mode);
      if (next !== null) {
        data.contact[field] = next;
        return true;
      }
    }
    return false;
  }

  if (change.before) {
    for (const field of fields) {
      const current = data.contact[field] || '';
      if (itemsMatch(current, change.before)) {
        const next = replaceStringValue(current, change.before, change.after, mode);
        if (next !== null) {
          data.contact[field] = next;
          return true;
        }
      }
    }
  }

  const after = change.after.trim();
  if (after && !data.contact.location.includes(after)) {
    data.contact.location = data.contact.location
      ? `${data.contact.location} | ${after}`
      : after;
    return true;
  }
  return false;
}

function entryText(entry: Record<string, unknown>): string {
  const highlights = Array.isArray(entry.highlights) ? entry.highlights.join(' | ') : '';
  const description = typeof entry.description === 'string' ? entry.description : '';
  return [
    entry.title,
    entry.name,
    entry.degree,
    entry.company,
    entry.school,
    entry.location,
    entry.period,
    entry.major,
    entry.role,
    description,
    highlights,
  ].filter(Boolean).join(' | ');
}

function findBestEntry(
  list: ReviewableList,
  targetItems: string[],
): number {
  let bestIndex = -1;
  let bestScore = 0;
  list.forEach((entry, index) => {
    const text = normalizeText(entryText(entry));
    const score = targetItems.reduce((sum, item) => {
      const normalized = normalizeText(item);
      return sum + (normalized && text.includes(normalized) ? normalized.length : 0);
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function applyObjectListChange(
  list: ReviewableList,
  change: OptimizationChange,
  mode: ReviewMode,
  section: 'experience' | 'projects',
): boolean {
  const targetItems = splitItems(mode === 'reject' ? change.after : change.before);
  const entryIndex = findBestEntry(list, targetItems);
  if (entryIndex < 0) {
    if (mode === 'reapply' && change.before === '') {
      const afterItems = splitItems(change.after);
      if (afterItems.length > 0) {
        list.push(section === 'experience'
          ? { title: '', company: '', location: '', period: '', highlights: afterItems }
          : { name: '', role: '', period: '', description: '', highlights: afterItems });
        return true;
      }
    }
    return false;
  }

  const entry = list[entryIndex] as { highlights?: string[] };
  const highlights = Array.isArray(entry.highlights) ? [...entry.highlights] : [];
  const changed = applyListItems(highlights, change.before, change.after, mode);
  entry.highlights = highlights;

  if (mode === 'reject' && highlights.length === 0) {
    list.splice(entryIndex, 1);
    return true;
  }
  return changed;
}

function applyEducationChange(
  list: ReviewableList,
  change: OptimizationChange,
  mode: ReviewMode,
): boolean {
  const targetItems = splitItems(mode === 'reject' ? change.after : change.before);
  const entryIndex = findBestEntry(list, targetItems);
  if (entryIndex < 0) return false;

  const fields: Array<'degree' | 'school' | 'major' | 'period' | 'gpa'> = [
    'degree',
    'school',
    'major',
    'period',
    'gpa',
  ];
  for (const field of fields) {
    const current = list[entryIndex][field];
    if (typeof current !== 'string') continue;
    const next = replaceStringValue(current, change.before, change.after, mode);
    if (next !== null) {
      list[entryIndex][field] = next;
      return true;
    }
  }
  return false;
}

function applyChange(
  data: OptimizedResumeData,
  change: OptimizationChange,
  mode: ReviewMode,
): { changed: boolean } {
  const section = SECTION_ALIASES[change.section.trim().toLowerCase()];
  if (!section) return { changed: false };

  if (section === 'summary') {
    return { changed: applySummaryChange(data, change, mode) };
  }
  if (section === 'contact') {
    return { changed: applyContactChange(data, change, mode) };
  }
  if (section === 'skills') {
    const changed = applyListItems(data.skills, change.before, change.after, mode);
    return { changed };
  }
  if (section === 'certifications') {
    const changed = applyListItems(data.certifications, change.before, change.after, mode);
    return { changed };
  }
  if (section === 'experience' || section === 'projects') {
    const changed = applyObjectListChange(
      data[section] as unknown as ReviewableList,
      change,
      mode,
      section,
    );
    return { changed };
  }
  if (section === 'education') {
    const changed = applyEducationChange(
      data.education as unknown as ReviewableList,
      change,
      mode,
    );
    return { changed };
  }
  return { changed: false };
}

export function applyOptimizationChangeReview<T extends object>(
  base: T,
  changes: OptimizationChange[],
): ReviewResult<T> {
  const data = JSON.parse(JSON.stringify(base)) as OptimizedResumeData;
  const unmatched: string[] = [];

  for (const change of changes) {
    if (change.status !== 'rejected') continue;
    const result = applyChange(data, change, 'reject');
    if (!result.changed) unmatched.push(change.title || change.id);
  }

  return { data: data as unknown as T, unmatched };
}

export function applyOptimizationChangeReapply<T extends object>(
  base: T,
  change: OptimizationChange,
): ReviewResult<T> {
  const data = JSON.parse(JSON.stringify(base)) as OptimizedResumeData;
  const result = applyChange(data, change, 'reapply');
  return {
    data: data as unknown as T,
    unmatched: result.changed ? [] : [change.title || change.id],
  };
}

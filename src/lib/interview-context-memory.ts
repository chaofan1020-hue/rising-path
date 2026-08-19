import type { CompanyDNA } from './company-dna';
import type { UserSegmentation } from './user-segmentation';

export type InterviewContextLanguage = 'zh' | 'en';

export interface InterviewEvidence {
  id: string;
  source: 'experience' | 'project' | 'education' | 'skills' | 'resume';
  label: string;
  content: string;
  keywords: string[];
}

export interface InterviewContextDigest {
  version: 1;
  language: InterviewContextLanguage;
  role: {
    company: string;
    title: string;
    direction: string;
    description: string;
    requirements: string;
    keywords: string[];
  };
  company: {
    tagline: string;
    focusAreas: Array<{ dimension: string; probes: string[] }>;
    tone: string;
    vocabulary: string[];
    cultureKeywords: string[];
  };
  candidate: {
    baseline: string;
    skills: string[];
    evidence: InterviewEvidence[];
  };
}

export interface InterviewFactClaim {
  text: string;
  sourceTurn: number;
  topics: string[];
}

export interface InterviewFactLedger {
  version: 1;
  coveredIntents: string[];
  coveredDimensions: string[];
  candidateClaims: InterviewFactClaim[];
  openGaps: string[];
  lastQuestion: string;
  lastAnswer: string;
}

interface BuildDigestInput {
  language: InterviewContextLanguage;
  company: string;
  title?: string | null;
  direction?: string | null;
  jobDescription?: string | null;
  jobRequirements?: string | null;
  dna?: CompanyDNA | null;
  profile?: unknown;
  segmentation?: UserSegmentation | null;
  resumeText?: string | null;
}

interface BuildMemoryPromptInput {
  digest: InterviewContextDigest;
  ledger: InterviewFactLedger;
  currentIntent?: string | null;
  currentDimension?: string | null;
  currentAnswer?: string | null;
}

interface LedgerAnswerInput {
  answer?: string | null;
  answerTurnIndex?: number;
  currentIntent?: string | null;
}

interface LedgerQuestionInput {
  question?: string | null;
  intentKey?: string | null;
  dimension?: string | null;
}

const MAX_DIGEST_CHARS = 15_000;
const MAX_EVIDENCE_COUNT = 16;
const MAX_EVIDENCE_CHARS = 520;
const MAX_CLAIMS = 14;
const MAX_GAPS = 8;

const INTENT_TERMS: Record<string, string[]> = {
  conflict_resolution: ['conflict', 'disagree', 'stakeholder', '冲突', '分歧', '协作', '沟通'],
  failure_reflection: ['failure', 'mistake', 'lesson', '失败', '复盘', '教训', '改进'],
  metric_attribution: ['metric', 'data', 'experiment', 'sql', '指标', '数据', '实验', '归因', '增长'],
  technical_depth: ['technical', 'architecture', 'algorithm', 'system', 'code', '技术', '架构', '算法', '系统', '代码'],
  customer_understanding: ['customer', 'user', 'product', 'requirement', '客户', '用户', '产品', '需求'],
  ownership: ['owner', 'drive', 'deliver', 'lead', '负责', '推动', '交付', '主导'],
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
}

function compact(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  const head = Math.max(1, Math.floor(maxChars * 0.72));
  const tail = Math.max(0, maxChars - head - 18);
  return `${normalized.slice(0, head)} [...evidence clipped...] ${normalized.slice(-tail)}`.slice(0, maxChars);
}

function unique(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

function tokenize(value: string): string[] {
  const latin = value.toLocaleLowerCase().match(/[a-z][a-z0-9+#.-]{1,}/g) || [];
  const chinese = value.match(/[\u4e00-\u9fff]{2,}/g) || [];
  const chineseBigrams = chinese.flatMap((segment) => {
    if (segment.length <= 4) return [segment];
    const parts: string[] = [];
    for (let index = 0; index < segment.length - 1 && parts.length < 24; index += 2) {
      parts.push(segment.slice(index, index + 4));
    }
    return parts;
  });
  return unique([...latin, ...chinese, ...chineseBigrams], 40);
}

function valuesFromEntry(entry: unknown, keys: string[]): string[] {
  const source = asRecord(entry);
  return keys.flatMap((key) => {
    const value = source[key];
    if (typeof value === 'string' || typeof value === 'number') return [text(value)];
    if (Array.isArray(value)) return value.flatMap((item) => typeof item === 'string' || typeof item === 'number' ? [text(item)] : []);
    return [];
  }).filter(Boolean);
}

function makeEvidence(source: InterviewEvidence['source'], index: number, label: string, values: string[]): InterviewEvidence | null {
  const content = compact(unique(values, 12).join('; '), MAX_EVIDENCE_CHARS);
  if (!content) return null;
  return {
    id: `${source}-${index + 1}`,
    source,
    label: compact(label || source, 120),
    content,
    keywords: tokenize(`${label} ${content}`),
  };
}

function collectProfileEvidence(profile: unknown): { evidence: InterviewEvidence[]; skills: string[] } {
  const source = asRecord(profile);
  const evidence: InterviewEvidence[] = [];
  const experienceGroups: Array<{ key: string; source: InterviewEvidence['source']; label: string }> = [
    { key: 'internships', source: 'experience', label: 'Internship' },
    { key: 'workExperience', source: 'experience', label: 'Work experience' },
    { key: 'projects', source: 'project', label: 'Project' },
    { key: 'education', source: 'education', label: 'Education' },
  ];

  for (const group of experienceGroups) {
    asArray(source[group.key]).forEach((entry, index) => {
      const entryRecord = asRecord(entry);
      const name = text(entryRecord.company) || text(entryRecord.name) || text(entryRecord.school) || text(entryRecord.role) || group.label;
      const role = text(entryRecord.role) || text(entryRecord.title) || text(entryRecord.major);
      const values = valuesFromEntry(entry, [
        'company', 'name', 'school', 'role', 'title', 'major', 'description', 'summary',
        'highlights', 'outcomes', 'achievements', 'responsibilities', 'skills', 'months',
      ]);
      const item = makeEvidence(group.source, evidence.length, [group.label, name, role].filter(Boolean).join(': '), values);
      if (item) evidence.push(item);
    });
  }

  const skills = unique([
    ...asArray(source.skills).flatMap((item) => typeof item === 'string' ? [item] : valuesFromEntry(item, ['name', 'skill', 'category'])),
    ...valuesFromEntry(source, ['technicalSkills', 'languages', 'tools']),
  ], 24);
  if (skills.length > 0) {
    const item = makeEvidence('skills', evidence.length, 'Skills', skills);
    if (item) evidence.push(item);
  }
  return { evidence, skills };
}

function collectResumeEvidence(resumeText?: string | null): InterviewEvidence[] {
  if (!resumeText?.trim()) return [];
  const lines = resumeText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length >= 24)
    .slice(0, 20);
  const result: InterviewEvidence[] = [];
  for (let index = 0; index < lines.length && result.length < 8; index += 2) {
    const content = compact(lines.slice(index, index + 2).join(' '), MAX_EVIDENCE_CHARS);
    if (!content) continue;
    result.push({
      id: `resume-${result.length + 1}`,
      source: 'resume',
      label: 'Resume evidence',
      content,
      keywords: tokenize(content),
    });
  }
  return result;
}

function baselineFrom(segmentation?: UserSegmentation | null): string {
  if (!segmentation) return '';
  const quality = segmentation.experienceQuality;
  return [
    `Career stage: ${segmentation.careerStage}`,
    `School tier: ${segmentation.schoolTier}`,
    segmentation.majorMatch ? `Major match: ${segmentation.majorMatch}` : '',
    quality ? `Experience: ${quality.internshipCount} internships, quantified density ${quality.quantifiedDensity}` : '',
  ].filter(Boolean).join('; ');
}

function digestCompanyDNA(dna?: CompanyDNA | null): InterviewContextDigest['company'] {
  if (!dna) return { tagline: '', focusAreas: [], tone: '', vocabulary: [], cultureKeywords: [] };
  return {
    tagline: compact(dna.tagline || '', 260),
    focusAreas: dna.focusAreas.slice(0, 5).map((area) => ({
      dimension: compact(area.dimension, 100),
      probes: area.probes.slice(0, 3).map((probe) => compact(probe, 180)),
    })),
    tone: compact(dna.style?.tone || '', 260),
    vocabulary: unique(dna.vocabulary || [], 10),
    cultureKeywords: unique(dna.cultureKeywords || [], 10),
  };
}

export function buildInterviewContextDigest(input: BuildDigestInput): InterviewContextDigest {
  const profileEvidence = collectProfileEvidence(input.profile);
  const evidence = uniqueEvidence([...profileEvidence.evidence, ...collectResumeEvidence(input.resumeText)]).slice(0, MAX_EVIDENCE_COUNT);
  const description = compact(input.jobDescription || '', 1_500);
  const requirements = compact(input.jobRequirements || '', 1_500);
  const keywords = tokenize(`${input.title || ''} ${input.direction || ''} ${description} ${requirements}`).slice(0, 28);
  const digest: InterviewContextDigest = {
    version: 1,
    language: input.language,
    role: {
      company: compact(input.company, 180),
      title: compact(input.title || '', 180),
      direction: compact(input.direction || '', 160),
      description,
      requirements,
      keywords,
    },
    company: digestCompanyDNA(input.dna),
    candidate: {
      baseline: baselineFrom(input.segmentation),
      skills: profileEvidence.skills,
      evidence,
    },
  };
  return boundDigest(digest);
}

function uniqueEvidence(evidence: InterviewEvidence[]): InterviewEvidence[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = `${item.label}:${item.content}`.toLocaleLowerCase();
    if (!item.content || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function boundDigest(digest: InterviewContextDigest): InterviewContextDigest {
  const bounded = {
    ...digest,
    candidate: { ...digest.candidate, evidence: digest.candidate.evidence.slice(0, MAX_EVIDENCE_COUNT) },
  };
  while (JSON.stringify(bounded).length > MAX_DIGEST_CHARS && bounded.candidate.evidence.length > 4) {
    bounded.candidate.evidence.pop();
  }
  return bounded;
}

export function emptyInterviewFactLedger(): InterviewFactLedger {
  return {
    version: 1,
    coveredIntents: [],
    coveredDimensions: [],
    candidateClaims: [],
    openGaps: [],
    lastQuestion: '',
    lastAnswer: '',
  };
}

export function parseInterviewContextDigest(value: unknown): InterviewContextDigest | null {
  const source = asRecord(value);
  if (source.version !== 1 || !asRecord(source.role).company) return null;
  const role = asRecord(source.role);
  const candidate = asRecord(source.candidate);
  const company = asRecord(source.company);
  const evidence = asArray(candidate.evidence).map((item, index) => {
    const row = asRecord(item);
    const sourceValue = text(row.source);
    if (!['experience', 'project', 'education', 'skills', 'resume'].includes(sourceValue)) return null;
    const content = compact(text(row.content), MAX_EVIDENCE_CHARS);
    if (!content) return null;
    return {
      id: compact(text(row.id) || `evidence-${index + 1}`, 80),
      source: sourceValue as InterviewEvidence['source'],
      label: compact(text(row.label), 120),
      content,
      keywords: unique(asArray(row.keywords).map(text), 40),
    };
  }).filter((item): item is InterviewEvidence => Boolean(item));
  return boundDigest({
    version: 1,
    language: source.language === 'en' ? 'en' : 'zh',
    role: {
      company: compact(text(role.company), 180),
      title: compact(text(role.title), 180),
      direction: compact(text(role.direction), 160),
      description: compact(text(role.description), 1_500),
      requirements: compact(text(role.requirements), 1_500),
      keywords: unique(asArray(role.keywords).map(text), 28),
    },
    company: {
      tagline: compact(text(company.tagline), 260),
      focusAreas: asArray(company.focusAreas).map((item) => {
        const area = asRecord(item);
        return {
          dimension: compact(text(area.dimension), 100),
          probes: unique(asArray(area.probes).map(text).map((probe) => compact(probe, 180)), 3),
        };
      }).filter((area) => area.dimension).slice(0, 5),
      tone: compact(text(company.tone), 260),
      vocabulary: unique(asArray(company.vocabulary).map(text), 10),
      cultureKeywords: unique(asArray(company.cultureKeywords).map(text), 10),
    },
    candidate: {
      baseline: compact(text(candidate.baseline), 500),
      skills: unique(asArray(candidate.skills).map(text), 24),
      evidence,
    },
  });
}

export function parseInterviewFactLedger(value: unknown): InterviewFactLedger {
  const source = asRecord(value);
  const claims = asArray(source.candidateClaims).map((item) => {
    const claim = asRecord(item);
    const claimText = compact(text(claim.text), 360);
    if (!claimText) return null;
    return {
      text: claimText,
      sourceTurn: Math.max(0, Number(claim.sourceTurn) || 0),
      topics: unique(asArray(claim.topics).map(text), 12),
    };
  }).filter((claim): claim is InterviewFactClaim => Boolean(claim));
  return {
    version: 1,
    coveredIntents: unique(asArray(source.coveredIntents).map(text), 24),
    coveredDimensions: unique(asArray(source.coveredDimensions).map(text), 24),
    candidateClaims: claims.slice(-MAX_CLAIMS),
    openGaps: unique(asArray(source.openGaps).map(text), MAX_GAPS),
    lastQuestion: compact(text(source.lastQuestion), 700),
    lastAnswer: compact(text(source.lastAnswer), 900),
  };
}

function extractClaims(answer: string, sourceTurn: number): InterviewFactClaim[] {
  const fragments = answer
    .split(/[。！？!?；;\n]/u)
    .map((fragment) => compact(fragment, 360))
    .filter((fragment) => fragment.length >= 18);
  const selected = fragments
    .filter((fragment) => /(\d|我|负责|推动|实现|设计|分析|优化|led|built|designed|delivered|improved|owned)/iu.test(fragment))
    .slice(0, 3);
  const usable = selected.length > 0 ? selected : fragments.slice(0, 2);
  return usable.map((claim) => ({ text: claim, sourceTurn, topics: tokenize(claim).slice(0, 12) }));
}

function inferGaps(answer: string, intent?: string | null): string[] {
  const result: string[] = [];
  const normalized = answer.trim();
  if (normalized.length < 36) result.push('answer needs more concrete context and decisions');
  if (intent === 'metric_attribution' && !/(\d|%|percent|指标|数据|metric|baseline|sample)/iu.test(normalized)) {
    result.push('missing metric, baseline, or attribution evidence');
  }
  if (intent === 'technical_depth' && !/(架构|算法|系统|trade.?off|design|implementation|技术|方案)/iu.test(normalized)) {
    result.push('missing technical mechanism or trade-off');
  }
  if (intent === 'ownership' && !/(我|负责|主导|决定|led|owned|decision)/iu.test(normalized)) {
    result.push('individual ownership is not explicit');
  }
  return result;
}

export function advanceInterviewFactLedger(
  current: InterviewFactLedger,
  answerInput: LedgerAnswerInput = {},
  questionInput: LedgerQuestionInput = {},
): InterviewFactLedger {
  const next = parseInterviewFactLedger(current);
  if (answerInput.answer?.trim()) {
    const claims = extractClaims(answerInput.answer, answerInput.answerTurnIndex || 0);
    next.candidateClaims = [...next.candidateClaims, ...claims].slice(-MAX_CLAIMS);
    next.openGaps = unique([...next.openGaps, ...inferGaps(answerInput.answer, answerInput.currentIntent)], MAX_GAPS);
    next.lastAnswer = compact(answerInput.answer, 900);
  }
  if (questionInput.question?.trim()) {
    if (questionInput.intentKey) next.coveredIntents = unique([...next.coveredIntents, questionInput.intentKey], 24);
    if (questionInput.dimension) next.coveredDimensions = unique([...next.coveredDimensions, questionInput.dimension], 24);
    next.lastQuestion = compact(questionInput.question, 700);
  }
  return next;
}

function relevantEvidence(digest: InterviewContextDigest, currentIntent?: string | null, currentAnswer?: string | null): InterviewEvidence[] {
  const queryTerms = new Set<string>([
    ...digest.role.keywords,
    ...(currentIntent ? INTENT_TERMS[currentIntent] || [] : []),
    ...tokenize(currentAnswer || ''),
  ].map((term) => term.toLocaleLowerCase()));
  const scored = digest.candidate.evidence.map((evidence, index) => {
    const haystack = `${evidence.label} ${evidence.content}`.toLocaleLowerCase();
    const score = evidence.keywords.reduce((total, keyword) => total + (queryTerms.has(keyword.toLocaleLowerCase()) ? 3 : 0), 0)
      + [...queryTerms].reduce((total, term) => total + (term.length >= 3 && haystack.includes(term) ? 1 : 0), 0)
      + (evidence.source === 'experience' || evidence.source === 'project' ? 0.2 : 0)
      - index * 0.01;
    return { evidence, score };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, 4).map((item) => item.evidence);
}

function formatList(values: string[], limit: number): string {
  return values.slice(0, limit).join('; ');
}

export function buildInterviewMemoryPrompt(input: BuildMemoryPromptInput): string {
  const { digest, ledger } = input;
  const evidence = relevantEvidence(digest, input.currentIntent, input.currentAnswer);
  const focus = digest.company.focusAreas.map((area) => `${area.dimension}: ${formatList(area.probes, 3)}`).join('\n');
  const lines = [
    `Role: ${digest.role.company}${digest.role.title ? ` | ${digest.role.title}` : ''}${digest.role.direction ? ` | ${digest.role.direction}` : ''}`,
    digest.role.description ? `Role context: ${digest.role.description}` : '',
    digest.role.requirements ? `Role requirements: ${digest.role.requirements}` : '',
    digest.company.tagline ? `Company interview focus: ${digest.company.tagline}` : '',
    digest.company.tone ? `Company interview style: ${digest.company.tone}` : '',
    focus ? `Priority dimensions:\n${focus}` : '',
    digest.company.vocabulary.length ? `Company vocabulary: ${formatList(digest.company.vocabulary, 10)}` : '',
    digest.candidate.baseline ? `Candidate baseline: ${digest.candidate.baseline}` : '',
    digest.candidate.skills.length ? `Candidate skills: ${formatList(digest.candidate.skills, 16)}` : '',
    evidence.length ? `Relevant resume evidence:\n${evidence.map((item) => `- [${item.id}] ${item.label}: ${item.content}`).join('\n')}` : '',
    ledger.coveredIntents.length ? `Already tested intents: ${formatList(ledger.coveredIntents, 18)}` : '',
    ledger.coveredDimensions.length ? `Already tested dimensions: ${formatList(ledger.coveredDimensions, 12)}` : '',
    ledger.candidateClaims.length ? `Candidate claims to probe when relevant:\n${ledger.candidateClaims.slice(-6).map((claim) => `- ${claim.text}`).join('\n')}` : '',
    ledger.openGaps.length ? `Unresolved evidence gaps: ${formatList(ledger.openGaps, 6)}` : '',
    input.currentIntent ? `Current question intent: ${input.currentIntent}${input.currentDimension ? ` (${input.currentDimension})` : ''}` : '',
  ].filter(Boolean);
  return compact(lines.join('\n'), 6_000);
}

import PDFParser from 'pdf2json';
import mammoth from 'mammoth';
import { AIProviderConfigError, createTextProviderClient, type TextProviderClient } from '@/lib/ai/text-provider';
import { invokeTrackedTextGeneration } from '@/lib/ai-usage';
import {
  deriveSegmentation,
} from '@/lib/user-segmentation';
import type {
  EducationEntry,
  ExperienceEntry,
  ProjectEntry,
  ResumeEvidenceItem,
  ResumeProfile,
  ResumeProfileConfidence,
  ResumeProfileEvidence,
  UserSegmentation,
} from '@/lib/resume-types';
import { extractFirstJsonObject } from '@/lib/json-extract';

const BASIC_PROFILE_INPUT_LIMIT = 30000;
const PROFILE_INPUT_LIMIT = 12000;
const DEFAULT_LLM_TIMEOUT_MS = 45_000;
export const MAX_RESUME_FILE_SIZE_BYTES = 10 * 1024 * 1024;

function getResumeLlmTimeoutMs(): number {
  const rawValue = process.env.RESUME_PROFILE_LLM_TIMEOUT_MS?.trim();
  if (!rawValue) return DEFAULT_LLM_TIMEOUT_MS;

  const timeoutMs = Number(rawValue);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 120_000) {
    throw new ResumeProfileExtractionError(
      'RESUME_PROFILE_LLM_TIMEOUT_MS 配置无效，请设置为 5000 到 120000 之间的整数（毫秒）',
    );
  }

  return timeoutMs;
}

function createResumeLlmClient(): { client: TextProviderClient; timeoutMs: number } {
  const timeoutMs = getResumeLlmTimeoutMs();
  try {
    return {
      client: createTextProviderClient({ model: process.env.ALIBABA_RESUME_MODEL }),
      timeoutMs,
    };
  } catch (error) {
    if (error instanceof AIProviderConfigError) {
      throw new ResumeProfileExtractionError(error.message);
    }
    throw error;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

export interface ResumeUniversity {
  school: string;
  degree?: string;
  major?: string;
  region?: string;
}

export interface ResumeUserInfo {
  name?: string;
  email?: string;
  phone?: string;
  education?: string[];
  experience?: string[];
  skills?: string[];
  region?: string;
  school?: string;
  degree?: string;
  major?: string;
  universities?: ResumeUniversity[];
}

export interface ResumeParseResult {
  parsed_content: string;
  user_info: ResumeUserInfo;
  profile: ResumeProfile | null;
  segmentation: UserSegmentation | null;
  profile_evidence: ResumeProfileEvidence;
  profile_confidence: ResumeProfileConfidence;
  pages: number;
}

export interface ResumeFileOptions {
  contentType?: string;
  fileName: string;
}

export class UnsupportedResumeFileError extends Error {
  constructor(fileName: string) {
    super(`不支持的简历格式：${fileName}。目前仅支持 PDF、DOCX 和 TXT 文件，旧版 DOC 请先另存为 DOCX。`);
    this.name = 'UnsupportedResumeFileError';
  }
}

export class ResumeProfileExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResumeProfileExtractionError';
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getStoredResumeFile(userInfo: unknown): { fileBase64: string; fileType?: string } | null {
  if (!isRecord(userInfo) || typeof userInfo.file_base64 !== 'string' || !userInfo.file_base64) {
    return null;
  }

  return {
    fileBase64: userInfo.file_base64,
    fileType: typeof userInfo.file_type === 'string' ? userInfo.file_type : undefined,
  };
}

export function mergeResumeUserInfo(current: unknown, parsed: ResumeUserInfo): Record<string, unknown> {
  const currentInfo = isRecord(current) ? { ...current } : {};
  const parsedEntries = Object.entries(parsed).filter(([, value]) => {
    if (value === undefined || value === null) return false;
    return !Array.isArray(value) || value.length > 0;
  });

  return {
    ...currentInfo,
    ...Object.fromEntries(parsedEntries),
  };
}

export function sanitizeResumeUserInfo(userInfo: unknown): unknown {
  if (!isRecord(userInfo)) return userInfo;

  const sanitized = { ...userInfo };
  delete sanitized.file_base64;
  delete sanitized.file_type;
  return sanitized;
}

export function sanitizeResumeRecord<T extends Record<string, unknown>>(resume: T): T {
  return {
    ...resume,
    user_info: sanitizeResumeUserInfo(resume.user_info),
  };
}

function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot >= 0 ? fileName.slice(lastDot + 1).toLowerCase() : '';
}

function getResumeFormat(options: ResumeFileOptions): 'pdf' | 'docx' | 'text' | null {
  const contentType = (options.contentType || '').split(';', 1)[0].toLowerCase();
  const extension = getFileExtension(options.fileName);

  if (contentType === 'application/pdf' || extension === 'pdf') return 'pdf';
  if (
    contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    extension === 'docx'
  ) {
    return 'docx';
  }
  if (contentType.startsWith('text/') || extension === 'txt') return 'text';
  return null;
}

export function isSupportedResumeFile(options: ResumeFileOptions): boolean {
  const format = getResumeFormat(options);
  if (!format) return false;

  const contentType = (options.contentType || '').split(';', 1)[0].toLowerCase();
  if (!contentType || contentType === 'application/octet-stream') return true;
  if (format === 'pdf') return contentType === 'application/pdf';
  if (format === 'docx') {
    return contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  return contentType.startsWith('text/');
}

export function hasSupportedResumeFileSignature(buffer: Buffer, options: ResumeFileOptions): boolean {
  const format = getResumeFormat(options);
  if (!format || buffer.length === 0) return false;

  if (format === 'pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (format === 'docx') {
    return buffer.length >= 4
      && buffer[0] === 0x50
      && buffer[1] === 0x4b
      && buffer[2] === 0x03
      && buffer[3] === 0x04;
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 8_192));
  return !sample.includes(0);
}

function decodePdfText(rawText: string): string {
  if (!rawText) return '';

  try {
    return decodeURIComponent(rawText.replace(/\+/g, ' '));
  } catch {
    return rawText;
  }
}

async function extractTextFromPDF(buffer: Buffer): Promise<{ text: string; pages: number }> {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser(null, true);
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      pdfParser.destroy();
      callback();
    };

    pdfParser.on('pdfParser_dataError', (errData) => {
      const parserError = errData instanceof Error ? errData : errData.parserError;
      console.error('PDF extraction error:', parserError);
      finish(() => reject(new Error('PDF解析失败')));
    });

    pdfParser.on('pdfParser_dataReady', (pdfData) => {
      if (!Array.isArray(pdfData.Pages)) return;

      const text: string[] = [];
      for (const page of pdfData.Pages) {
        for (const textItem of page.Texts || []) {
          const rawText = (textItem.R || []).map((run) => run.T || '').join('');
          const decodedText = decodePdfText(rawText);
          if (decodedText) text.push(decodedText);
        }
        text.push('\n');
      }

      finish(() => resolve({ text: text.join(' '), pages: pdfData.Pages.length || 1 }));
    });

    try {
      pdfParser.parseBuffer(buffer);
    } catch (error) {
      console.error('PDF parser error:', error);
      finish(() => reject(new Error('PDF解析失败')));
    }
  });
}

async function extractTextFromWord(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (error) {
    console.error('Word extraction error:', error);
    throw new Error('Word文档解析失败');
  }
}

export async function extractTextFromResumeFile(
  buffer: Buffer,
  options: ResumeFileOptions,
): Promise<{ text: string; pages: number }> {
  const format = getResumeFormat(options);
  if (!format) throw new UnsupportedResumeFileError(options.fileName);

  if (format === 'pdf') return extractTextFromPDF(buffer);
  if (format === 'docx') {
    return { text: await extractTextFromWord(buffer), pages: 1 };
  }
  return { text: buffer.toString('utf-8'), pages: 1 };
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(toStringValue)
    .filter((item): item is string => Boolean(item));
}

function toNumberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractJsonObject(content: string): Record<string, unknown> | null {
  const parsed = extractFirstJsonObject(content);
  return isRecord(parsed) ? parsed : null;
}

function normalizeUniversities(value: unknown): ResumeUniversity[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): ResumeUniversity[] => {
    if (!isRecord(item)) return [];
    const school = toStringValue(item.school);
    if (!school) return [];

    return [{
      school,
      degree: toStringValue(item.degree),
      major: toStringValue(item.major),
      region: toStringValue(item.region),
    }];
  });
}

function normalizeUserInfo(value: unknown): ResumeUserInfo {
  if (!isRecord(value)) return {};

  return {
    name: toStringValue(value.name),
    email: toStringValue(value.email),
    phone: toStringValue(value.phone),
    education: toStringArray(value.education),
    experience: toStringArray(value.experience),
    skills: toStringArray(value.skills),
    region: toStringValue(value.region),
    school: toStringValue(value.school),
    degree: toStringValue(value.degree),
    major: toStringValue(value.major),
    universities: normalizeUniversities(value.universities),
  };
}

export async function parseResumeContent(content: string): Promise<{
  parsed_content: string;
  user_info: ResumeUserInfo;
}> {
  if (!content.trim()) {
    return { parsed_content: content, user_info: {} };
  }

  try {
    const { client: llmClient, timeoutMs } = createResumeLlmClient();
    const prompt = `请分析以下简历内容，提取关键信息并以JSON格式返回。

简历内容：
${content.slice(0, BASIC_PROFILE_INPUT_LIMIT)}

请提取以下信息并返回JSON格式：
{
  "name": "姓名",
  "email": "邮箱地址",
  "phone": "电话号码",
  "education": ["教育经历1", "教育经历2"],
  "experience": ["工作经历1", "工作经历2"],
  "skills": ["技能1", "技能2", "技能3"],
  "region": "留学地区或求职目标地区（如：美国、英国、新加坡、香港等）",
  "school": "最高学历所在学校名称",
  "degree": "最高学历（本科/硕士/博士）",
  "major": "专业名称",
  "universities": [
    {
      "school": "学校名称",
      "degree": "学历",
      "major": "专业",
      "region": "学校所在地区"
    }
  ]
}

只返回JSON，不要其他说明文字。如果某项信息不存在，返回null或空数组。对于地区，优先提取留学目的地或求职意向地区。`;

    const response = await withTimeout(
      invokeTrackedTextGeneration(llmClient, [
        { role: 'system', content: '你是一个专业的简历解析助手，擅长从简历中提取结构化信息，特别是教育背景相关的地区、学校、学历等信息。' },
        { role: 'user', content: prompt },
      ], { temperature: 0.3, thinking: 'disabled' }, {
        feature: 'resume_parse',
        metadata: { input_characters: content.length },
      }),
      timeoutMs,
      '简历基础字段提取超时',
    );

    return {
      parsed_content: content,
      user_info: normalizeUserInfo(extractJsonObject(response.content || '')),
    };
  } catch (error) {
    console.error('Parse resume error:', error);
    return { parsed_content: content, user_info: {} };
  }
}

function normalizeEducationEntries(value: unknown): EducationEntry[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): EducationEntry[] => {
    if (!isRecord(item)) return [];
    const school = toStringValue(item.school);
    if (!school) return [];

    return [{
      school,
      degree: toStringValue(item.degree),
      major: toStringValue(item.major),
      startYear: toNumberValue(item.startYear),
      endYear: toNumberValue(item.endYear),
      gpa: toStringValue(item.gpa),
      qsEstimate: toNumberValue(item.qsEstimate),
    }];
  });
}

function normalizeExperienceEntries(value: unknown): ExperienceEntry[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): ExperienceEntry[] => {
    if (!isRecord(item)) return [];
    const company = toStringValue(item.company);
    const role = toStringValue(item.role);
    if (!company || !role) return [];

    return [{
      company,
      role,
      startDate: toStringValue(item.startDate),
      endDate: toStringValue(item.endDate),
      months: toNumberValue(item.months),
      isInternship: typeof item.isInternship === 'boolean' ? item.isInternship : undefined,
      convertedToFulltime: typeof item.convertedToFulltime === 'boolean' ? item.convertedToFulltime : undefined,
      level: toStringValue(item.level),
      highlights: toStringArray(item.highlights),
    }];
  });
}

function normalizeProjects(value: unknown): ProjectEntry[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): ProjectEntry[] => {
    if (!isRecord(item)) return [];
    const name = toStringValue(item.name);
    if (!name) return [];

    return [{
      name,
      role: toStringValue(item.role),
      techStack: toStringArray(item.techStack),
      outcomes: toStringArray(item.outcomes),
    }];
  });
}

function normalizeIntention(value: unknown): ResumeProfile['intention'] {
  if (!isRecord(value)) return undefined;

  const intention = {
    roles: toStringArray(value.roles),
    locations: toStringArray(value.locations),
    industries: toStringArray(value.industries),
    workAuthorization: toStringValue(value.workAuthorization),
    availableFrom: toStringValue(value.availableFrom),
    salaryExpectation: toStringValue(value.salaryExpectation),
  };
  return Object.values(intention).some((items) => Array.isArray(items) ? items.length > 0 : Boolean(items))
    ? intention
    : undefined;
}

function normalizeMeta(value: unknown, pages: number): ResumeProfile['meta'] {
  const source = isRecord(value) ? value : {};
  const wordDensity = source.wordDensity === 'sparse' || source.wordDensity === 'normal' || source.wordDensity === 'dense'
    ? source.wordDensity
    : undefined;
  const resumeLanguage = source.resumeLanguage === 'zh' || source.resumeLanguage === 'en' || source.resumeLanguage === 'bilingual'
    ? source.resumeLanguage
    : undefined;

  return {
    pages,
    wordDensity,
    resumeLanguage,
  };
}

function normalizeProfileEvidence(value: unknown): ResumeProfileEvidence {
  if (!isRecord(value)) return {};

  const normalized: ResumeProfileEvidence = {};
  for (const [field, entries] of Object.entries(value)) {
    if (!Array.isArray(entries)) continue;
    const items = entries.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const sourceValue = entry.source;
      if (sourceValue !== 'explicit' && sourceValue !== 'inferred' && sourceValue !== 'user' && sourceValue !== 'unknown') {
        return [];
      }
      const source: ResumeEvidenceItem['source'] = sourceValue;
      return [{
        source,
        quote: toStringValue(entry.quote),
        note: toStringValue(entry.note),
      }];
    });
    if (items.length > 0) normalized[field] = items;
  }
  return normalized;
}

function normalizeProfileConfidence(value: unknown): ResumeProfileConfidence {
  if (!isRecord(value)) return {};

  return Object.fromEntries(
    Object.entries(value).flatMap(([field, score]) => {
      const parsed = toNumberValue(score);
      if (parsed === undefined) return [];
      return [[field, Math.max(0, Math.min(1, parsed > 1 ? parsed / 100 : parsed))]];
    }),
  );
}

function buildProfileUserInfo(raw: Record<string, unknown>, profile: ResumeProfile): ResumeUserInfo {
  const contact = isRecord(raw.contact) ? { ...raw, ...raw.contact } : raw;
  const education = profile.education.map((entry) =>
    [entry.school, entry.degree, entry.major].filter(Boolean).join(' · '),
  );
  const experience = [...profile.internships, ...profile.workExperience].map((entry) =>
    [entry.company, entry.role, entry.months ? `${entry.months}个月` : undefined]
      .filter(Boolean)
      .join(' · '),
  );

  return normalizeUserInfo({
    ...contact,
    education,
    experience,
    skills: profile.skills,
    region: toStringValue(contact.location) || profile.intention?.locations?.[0],
    school: profile.education[0]?.school,
    degree: profile.education[0]?.degree,
    major: profile.education[0]?.major,
    universities: profile.education,
  });
}

interface ResumeProfileExtraction {
  profile: ResumeProfile;
  userInfo: ResumeUserInfo;
  evidence: ResumeProfileEvidence;
  confidence: ResumeProfileConfidence;
}

export interface ResumeParseContext {
  userId?: string | null;
  resumeId?: number | null;
}

async function extractResumeProfile(
  content: string,
  pages: number,
  context: ResumeParseContext = {},
): Promise<ResumeProfileExtraction | null> {
  if (!content.trim()) return null;

  try {
    const { client: llmClient, timeoutMs } = createResumeLlmClient();
    const prompt = `你是简历结构化专家。请从以下简历中提取完整画像，严格以 JSON 返回。

简历内容：
${content.slice(0, PROFILE_INPUT_LIMIT)}

    返回 JSON 结构（不存在的信息用 null 或空数组，不要编造）：
{
  "name": "姓名",
  "email": "邮箱",
  "phone": "电话",
  "location": "所在地",
  "education": [
    { "school": "学校全称", "degree": "本科/硕士/博士/MBA", "major": "专业", "startYear": 2021, "endYear": 2025, "gpa": "GPA或学位等级(如First/2:1)", "qsEstimate": 50 }
  ],
  "internships": [
    { "company": "公司", "role": "岗位", "months": 3, "convertedToFulltime": false, "highlights": ["量化成果1"] }
  ],
  "workExperience": [
    { "company": "公司", "role": "岗位", "months": 24, "level": "职级(如P6/ Senior)", "isInternship": false, "highlights": ["量化成果"] }
  ],
  "projects": [
    { "name": "项目名", "role": "角色", "techStack": ["技术"], "outcomes": ["量化结果"] }
  ],
  "skills": ["技能1", "技能2"],
  "certificates": ["证书1"],
  "languages": ["IELTS 7.5", "TOEFL 110"],
  "intention": {
    "roles": ["意向岗位"],
    "locations": ["意向城市/国家，如'上海'、'新加坡'"],
    "industries": ["意向行业"],
    "workAuthorization": "工作权限/签证状态（如简历明确写出）",
    "availableFrom": "可入职时间（如简历明确写出）",
    "salaryExpectation": "薪资期望（如简历明确写出）"
  },
  "meta": {
    "wordDensity": "sparse/normal/dense",
    "resumeLanguage": "zh/en/bilingual"
  },
  "evidence": {
    "education[0].school": [
      { "source": "explicit", "quote": "简历中的原文片段", "note": "判断说明" }
    ]
  },
  "confidence": {
    "education": 0.95,
    "experience": 0.8,
    "intention": 0.4
  }
}

提取要点：
1. endYear 是毕业年份（推断年级的关键），在读学生按预计毕业年份填；
2. qsEstimate：你对该校 QS 世界排名的大致估计（不确定给 null）；
3. months 为时长月数（起止时间推算）；实习放 internships，全职放 workExperience；
4. highlights/outcomes 优先保留含数字的量化描述；
5. intention 仅在简历明确写出时提取，否则 null；
6. wordDensity 按简历内容密度判断；resumeLanguage 判断简历语言版本。
只返回 JSON，不要任何说明文字。`;

    const response = await withTimeout(
      invokeTrackedTextGeneration(llmClient, [
        { role: 'system', content: '你是专业的简历结构化引擎，只输出合法 JSON。' },
        { role: 'user', content: prompt },
      ], { temperature: 0.2, thinking: 'disabled' }, {
        userId: context.userId,
        feature: 'resume_profile',
        resumeId: context.resumeId,
        metadata: { pages, input_characters: content.length },
      }),
      timeoutMs,
      '简历画像提取超时',
    );

    const parsed = extractJsonObject(response.content || '');
    if (!parsed) {
      console.error('[profile] LLM 未返回有效画像 JSON');
      throw new ResumeProfileExtractionError('画像服务未返回有效结果，请点击重试');
    }

    const profile: ResumeProfile = {
      education: normalizeEducationEntries(parsed.education),
      internships: normalizeExperienceEntries(parsed.internships),
      workExperience: normalizeExperienceEntries(parsed.workExperience),
      projects: normalizeProjects(parsed.projects),
      skills: toStringArray(parsed.skills),
      certificates: toStringArray(parsed.certificates),
      languages: toStringArray(parsed.languages),
      intention: normalizeIntention(parsed.intention),
      meta: normalizeMeta(parsed.meta, pages),
    };

    const hasStructuredData = [
      profile.education,
      profile.internships,
      profile.workExperience,
      profile.projects,
      profile.skills,
      profile.certificates,
      profile.languages || [],
      profile.intention?.roles || [],
      profile.intention?.locations || [],
      profile.intention?.industries || [],
    ].some((items) => items.length > 0);
    if (!hasStructuredData) {
      console.error('[profile] LLM 返回了空画像');
      throw new ResumeProfileExtractionError('未能从简历中识别出有效信息，请检查文件内容后重试');
    }

    return {
      profile,
      userInfo: buildProfileUserInfo(parsed, profile),
      evidence: normalizeProfileEvidence(parsed.evidence),
      confidence: normalizeProfileConfidence(parsed.confidence),
    };
  } catch (error) {
    console.error('[profile] 画像提取失败:', error);
    if (error instanceof ResumeProfileExtractionError) throw error;
    if (error instanceof Error && error.message.includes('超时')) {
      throw new ResumeProfileExtractionError('画像提取超时，请稍后重试');
    }
    throw new ResumeProfileExtractionError('画像服务暂时不可用，请稍后重试');
  }
}

export async function parseResumeText(
  content: string,
  pages: number,
  context: ResumeParseContext = {},
): Promise<ResumeParseResult> {
  const extraction = await extractResumeProfile(content, pages, context);
  if (!extraction) {
    return {
      parsed_content: content,
      user_info: {},
      profile: null,
      segmentation: null,
      profile_evidence: {},
      profile_confidence: {},
      pages,
    };
  }

  return {
    parsed_content: content,
    user_info: extraction.userInfo,
    profile: extraction.profile,
    segmentation: deriveSegmentation(extraction.profile),
    profile_evidence: extraction.evidence,
    profile_confidence: extraction.confidence,
    pages,
  };
}

export async function parseResumeFile(
  buffer: Buffer,
  options: ResumeFileOptions,
  context: ResumeParseContext = {},
): Promise<ResumeParseResult> {
  const extracted = await extractTextFromResumeFile(buffer, options);
  return parseResumeText(extracted.text, extracted.pages, context);
}

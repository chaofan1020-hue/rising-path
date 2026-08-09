import PDFParser from 'pdf2json';
import mammoth from 'mammoth';
import { Config, LLMClient } from 'coze-coding-dev-sdk';
import {
  deriveSegmentation,
  type EducationEntry,
  type ExperienceEntry,
  type ProjectEntry,
  type ResumeProfile,
  type UserSegmentation,
} from '@/lib/user-segmentation';

const BASIC_PROFILE_INPUT_LIMIT = 30000;
const PROFILE_INPUT_LIMIT = 12000;

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
  return getResumeFormat(options) !== null;
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
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed: unknown = JSON.parse(jsonMatch[0]);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
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
    const llmClient = new LLMClient(new Config());
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

    const response = await llmClient.invoke([
      { role: 'system', content: '你是一个专业的简历解析助手，擅长从简历中提取结构化信息，特别是教育背景相关的地区、学校、学历等信息。' },
      { role: 'user', content: prompt },
    ], { temperature: 0.3 });

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
  };
  return Object.values(intention).some((items) => items.length > 0) ? intention : undefined;
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

async function extractResumeProfile(content: string, pages: number): Promise<ResumeProfile | null> {
  if (!content.trim()) return null;

  try {
    const llmClient = new LLMClient(new Config());
    const prompt = `你是简历结构化专家。请从以下简历中提取完整画像，严格以 JSON 返回。

简历内容：
${content.slice(0, PROFILE_INPUT_LIMIT)}

返回 JSON 结构（不存在的信息用 null 或空数组，不要编造）：
{
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
    "industries": ["意向行业"]
  },
  "meta": {
    "wordDensity": "sparse/normal/dense",
    "resumeLanguage": "zh/en/bilingual"
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

    const response = await llmClient.invoke([
      { role: 'system', content: '你是专业的简历结构化引擎，只输出合法 JSON。' },
      { role: 'user', content: prompt },
    ], { temperature: 0.2 });

    const parsed = extractJsonObject(response.content || '');
    if (!parsed || !Array.isArray(parsed.education)) {
      console.error('[profile] LLM 未返回有效画像 JSON');
      return null;
    }

    return {
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
  } catch (error) {
    console.error('[profile] 画像提取失败:', error);
    return null;
  }
}

export async function parseResumeFile(
  buffer: Buffer,
  options: ResumeFileOptions,
): Promise<ResumeParseResult> {
  const extracted = await extractTextFromResumeFile(buffer, options);
  const parsed = await parseResumeContent(extracted.text);
  const profile = await extractResumeProfile(extracted.text, extracted.pages);

  return {
    ...parsed,
    profile,
    segmentation: profile ? deriveSegmentation(profile) : null,
    pages: extracted.pages,
  };
}

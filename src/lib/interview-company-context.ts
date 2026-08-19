import type { CompanyDNA } from './company-dna';

export type InterviewLanguage = 'zh' | 'en';
export type InterviewVoiceStyle = 'analytical' | 'direct' | 'warm' | 'executive' | 'creative' | 'balanced';
export type InterviewVoiceSource = 'dna' | 'job_fallback';

export interface InterviewCompanyContext {
  language: InterviewLanguage;
  voiceStyle: InterviewVoiceStyle;
  voiceSource: InterviewVoiceSource;
}

interface ResolveInterviewCompanyContextInput {
  company?: string | null;
  region?: string | null;
  jobTitle?: string | null;
  jobDirection?: string | null;
  jobDescription?: string | null;
  dna?: CompanyDNA | null;
}

const OVERSEAS_REGION = /(united states|\busa\b|\bu\.s\.?a?\b|canada|united kingdom|\buk\b|england|scotland|wales|ireland|australia|singapore|hong kong|new york|san francisco|seattle|los angeles|boston|chicago|toronto|vancouver|london|manchester|edinburgh|sydney|melbourne|brisbane|perth|kuala lumpur|dubai|tokyo|seoul)/i;
const MAINLAND_REGION = /(中国|china|mainland|beijing|shanghai|shenzhen|guangzhou|hangzhou|chengdu|wuhan|nanjing|suzhou|xiamen|tianjin|chongqing)/i;
const OVERSEAS_COMPANY = /\b(amazon|aws|google|alphabet|microsoft|meta|facebook|apple|netflix|tesla|nvidia|openai|anthropic|stripe|airbnb|uber|lyft|doordash|salesforce|oracle|adobe|intel|ibm|goldman|j\.?p\.?\s*morgan|jpmorgan|morgan stanley|blackrock|blackstone|mckinsey|bcg|boston consulting|bain|deloitte|pwc|pricewaterhousecoopers|ey|ernst|kpmg|accenture|procter|unilever|bloomberg|citigroup|citi|visa|mastercard|paypal|coinbase|palantir|databricks|snowflake|cloudflare|linkedin|atlassian)\b/i;

function textOfDNA(dna: CompanyDNA): string {
  return [
    dna.tagline,
    dna.style.tone,
    ...dna.focusAreas.flatMap((area) => [area.dimension, ...area.probes]),
    ...dna.style.openingPatterns,
    ...dna.style.followupPatterns,
    ...dna.vocabulary,
    ...dna.cultureKeywords,
  ].join(' ');
}

function classifyVoiceStyle(text: string): InterviewVoiceStyle {
  const normalized = text.toLowerCase();
  if (/(高压|快节奏|犀利|直接|结果导向|追问|职业度|合规|审计|交易|投行|finance|investment|risk|audit|trading)/i.test(normalized)) {
    return 'direct';
  }
  if (/(高管|战略|长期|格局|管理层|executive|leadership|strategy|vision)/i.test(normalized)) {
    return 'executive';
  }
  if (/(数据|技术|工程|算法|量化|第一性|结构化|mece|分析|python|software|developer|engineer|data|ai|machine learning)/i.test(normalized)) {
    return 'analytical';
  }
  if (/(创意|品牌|设计|故事|消费者|营销|creative|brand|design|marketing)/i.test(normalized)) {
    return 'creative';
  }
  if (/(温和|成长|用户|协作|包容|教练|文化|沟通|warm|growth|customer|collaboration|culture)/i.test(normalized)) {
    return 'warm';
  }
  return 'balanced';
}

/**
 * Overseas vacancies are interviewed in English irrespective of the web UI
 * locale. Mainland roles retain Chinese by default. The fallback covers new
 * foreign locations that are not yet in the explicit region catalog.
 */
export function inferInterviewLanguage(region?: string | null, company?: string | null): InterviewLanguage {
  const value = region?.trim() || '';
  if (OVERSEAS_COMPANY.test(company?.trim() || '')) return 'en';
  if (!value) return 'zh';
  if (OVERSEAS_REGION.test(value)) return 'en';
  if (MAINLAND_REGION.test(value)) return 'zh';
  return /[\u4e00-\u9fff]/.test(value) ? 'zh' : 'en';
}

export function resolveInterviewCompanyContext(
  input: ResolveInterviewCompanyContextInput,
): InterviewCompanyContext {
  const language = inferInterviewLanguage(input.region, input.company);
  if (input.dna) {
    return {
      language,
      voiceStyle: classifyVoiceStyle(textOfDNA(input.dna)),
      voiceSource: 'dna',
    };
  }
  return {
    language,
    voiceStyle: classifyVoiceStyle([
      input.jobTitle || '',
      input.jobDirection || '',
      input.jobDescription || '',
    ].join(' ')),
    voiceSource: 'job_fallback',
  };
}

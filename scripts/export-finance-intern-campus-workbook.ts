import { config as loadDotenv } from 'dotenv';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';
import { getTargetRegion } from '@/lib/job-region-scope';

loadDotenv({ path: process.env.ENV_FILE || '.env.production.local', override: true, quiet: true });

type JobRow = {
  id: number;
  title: string | null;
  company: string | null;
  region: string | null;
  direction: string | null;
  job_type: string | null;
  employment_type: string | null;
  employment_category: string | null;
  workplace_type: string | null;
  experience_text: string | null;
  experience_min_years: number | null;
  experience_max_years: number | null;
  salary_range: string | null;
  valid_through: string | null;
  posted_at: string | null;
  job_url: string | null;
  source_url: string | null;
  sponsorship: string | null;
};

type RegionKey = '北美' | '澳洲' | '香港' | '英国';
type RoleType = '实习' | '校招';

type ExportJob = {
  id: number;
  company: string;
  title: string;
  roleType: RoleType;
  track: string;
  region: RegionKey;
  location: string;
  workplace: string;
  experience: string;
  salary: string;
  deadline: string;
  posted: string;
  url: string;
};

const INK = 'FF0F2744';
const INK_SOFT = 'FF173554';
const GOLD = 'FFC4A35A';
const GOLD_DEEP = 'FFA4843E';
const PAPER = 'FFF7F4EE';
const IVORY = 'FFFBFAF6';
const ROW_ALT = 'FFF3EEE4';
const LINE = 'FFD9D1C3';
const TEXT = 'FF1C2430';
const MUTED = 'FF6B7280';
const WHITE = 'FFFFFFFF';
const INTERN_INK = 'FF1F6B5A';
const CAMPUS_INK = 'FF3D5A80';
const DASH = '—';

const REGION_ORDER: RegionKey[] = ['北美', '澳洲', '香港', '英国'];
const REGION_FROM_SCOPE: Record<string, RegionKey> = {
  north_america: '北美',
  australia: '澳洲',
  hong_kong: '香港',
  united_kingdom: '英国',
};

const FINANCE_COMPANY_RE = /\b(goldman|jpmorgan|j\.?p\.?\s*morgan|morgan stanley|citigroup|\bciti\b|bank of america|\bbofa\b|wells fargo|barclays|\bubs\b|deutsche bank|\bhsbc\b|blackrock|fidelity|citadel|two sigma|jane street|d\.?e\.?\s*shaw|point72|point 72|millennium|evercore|lazard|jefferies|rothschild|\btpg\b|\bkkr\b|blackstone|carlyle|apollo|macquarie|nomura|mizuho|bnp paribas|societe generale|société générale|\brbc\b|scotiabank|\btd\b bank|toronto[- ]dominion|\bbmo\b|bank of montreal|natwest|standard chartered|state street|northern trust|charles schwab|\bpimco\b|vanguard|bridgewater|renaissance|man group|schroders|invesco|brookfield|oaktree|bain capital|wellington|capital group|raymond james|piper sandler|moelis|\bpjt\b|houlihan lokey|william blair|guggenheim|perella|greenhill|\bmufg\b|\bsmbc\b|\banz\b|westpac|commonwealth bank|\bcba\b|hang seng|bank of china|\bicbc\b|credit agricole|ing bank|lloyds|barings|t\. rowe|t rowe|franklin templeton|invesco|abrdn|legal & general|schroders|natixis|jefferies|cowen|stifel|\bbaird\b|william blair|rothschild & co|lazard|evercore|moelis|centerview|qatalyst|bloomberg)\b/i;

const CONSULTING_COMPANY_RE = /\b(mckinsey|boston consulting|bain & company|\bbcg\b|oliver wyman|kearney|roland berger|strategy&|accenture)\b/i;

const BIG4_COMPANY_RE = /\b(deloitte|pwc|pricewaterhouse|ernst\s*&\s*young|\bey\b|kpmg)\b/i;

const FINANCE_TITLE_RE = /\b(financ(?:e|ial)|investment banking|investment banker|\bibd\b|sales and trading|capital markets|asset management|wealth management|private equity|venture capital|hedge fund|portfolio (?:analyst|manager|intern)|quantitative|\bquant\b|trader|trading|equity research|credit analyst|credit risk|market risk|operational risk|fixed income|treasury|fp&a|financial planning|account(?:ant|ing)|audit(?:or|ing)?|compliance|\baml\b|\bkyc\b|m&a|mergers|acquisitions|restructuring|leveraged finance|global markets|securities|underwriting|actuarial|actuary|research analyst|investment analyst|private bank|private wealth|valuation|transaction services|forensic|fund|controller|middle office|prime brokerage|trade support|markets analyst|risk analyst|credit intern|markets intern)\b|金融|投行|量化|风控|审计|会计|资管|私募|证券|交易员/i;

const TECH_TITLE_RE = /\b(software|developer|\bswe\b|\bsde\b|frontend|front-end|backend|back-end|full[- ]?stack|devops|\bsre\b|data engineer|machine learning|ml engineer|ai engineer|platform engineer|infrastructure|cyber|security engineer|application engineer|hardware|linux|windows|fpga|asic|it operations|ecs engineer|ux |ui |product designer|product manager|\bpm intern\b|scrum|helpdesk|it support|network engineer|cloud engineer|saas operations|systems analyst)\b/i;

const NON_FINANCE_TITLE_RE = /\b(human resources|\bhr intern\b|recruiter|talent acquisition|marketing|communications|brand intern|legal intern|counsel|facilities|receptionist|administrative assistant|campus ambassador|event intern|graphic design|content intern|supply chain|process excellence|tech strategy)\b/i;

const OUT_OF_SCOPE_LOCATION_RE = /\b(india|bengaluru|bangalore|hyderabad|mumbai|chennai|pune|gurgaon|gurugram|noida|delhi|china|shanghai|beijing|shenzhen|hangzhou|tokyo|japan|korea|seoul|singapore|ireland|dublin|germany|france|netherlands|switzerland|brazil|mexico|philippines|poland|romania|israel|tel aviv)\b/i;

const FINANCE_FUNCTION_AT_BANK_RE = /\b(analyst|associate|internship|intern|campus|graduate|programme|program|audit|tax|risk|markets|banking|wealth|asset|quant|trading|research|treasury|controller|compliance)\b/i;

const TECH_PROGRAM_RE = /\b(technology summer|technology college|technology analyst|application development|programmer|it internship|it operations|technology leadership|data & ai|data and ai|ai research|data scientist|application support|apps dev|investment systems|media planning|hackathon|saas operations)\b/i;

const EXPERIENCED_TITLE_RE = /\b(senior|sr\.? |officer|\bavp\b|vice president|\bvp\b|director|principal|staff |lead |intermediate programmer|experienced hire|\bii\b|\biii\b|financial analyst ii)\b/i;

const EARLY_CAREER_TITLE_RE = /\b(intern|internship|summer analyst|summer associate|graduate|campus|new grad|analyst program|rotational|early career|placement)\b/i;

const BIG4_KEEP_RE = /\b(audit|tax|deals|transaction|valuation|forensic|assurance|financial advisory|risk advisory|capital markets|m&a|restructuring|transfer pricing)\b/i;

const SELECT_COLUMNS = [
  'id',
  'title',
  'company',
  'region',
  'direction',
  'job_type',
  'employment_type',
  'employment_category',
  'workplace_type',
  'experience_text',
  'experience_min_years',
  'experience_max_years',
  'salary_range',
  'valid_through',
  'posted_at',
  'job_url',
  'source_url',
  'sponsorship',
].join(',');

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function classifyRoleType(row: JobRow): RoleType | null {
  const haystack = `${row.title || ''} ${row.job_type || ''} ${row.employment_type || ''} ${row.employment_category || ''} ${row.employment_category || ''}`.toLowerCase();
  if (/\b(?:intern|internship|co-?op)\b|\bsummer\s+(?:analyst|associate|intern)\b/.test(haystack) || row.job_type === '实习') {
    return '实习';
  }
  if (/\b(?:graduate|new\s+grad(?:uate)?|entry[- ]?level|campus|early\s+career|full[- ]?time\s+analyst(?:\s+program)?)\b/.test(haystack) || row.job_type === '校招') {
    return '校招';
  }
  return null;
}

function classifyRegion(location: string): RegionKey | null {
  if (!location || OUT_OF_SCOPE_LOCATION_RE.test(location)) return null;
  const scope = getTargetRegion(location, null);
  return scope ? REGION_FROM_SCOPE[scope] || null : null;
}

function formatLocation(location: string): string {
  const parts = location.split('|').map((part) => collapse(part)).filter(Boolean);
  if (parts.length === 0) return DASH;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]}  ·  ${parts[1]}`;
  return `${parts[0]}  ·  ${parts[1]}  等 ${parts.length} 地`;
}

function classifyTrack(row: JobRow, title: string): string {
  const value = `${row.direction || ''} ${title}`.toLowerCase();
  if (/quant|trading|trader/.test(value)) return 'Quant';
  if (/investment banking|ibd|sales.?and.?trading|capital markets|global technology/.test(value)) return 'IBD / Markets';
  if (/private equity|venture capital|asset management|wealth|portfolio valuation/.test(value)) return '资管 / PE';
  if (/risk|compliance|fraud|regulatory|aml|kyc/.test(value)) return 'Risk';
  if (/audit|tax|assurance|accountant|accounting/.test(value)) return 'Audit / Tax';
  if (/research analyst|equity research/.test(value)) return 'Research';
  if (/product/.test(value)) return '资管 / PE';
  if (row.direction === 'IBD/S&T') return 'IBD / Markets';
  if (row.direction === 'Quant') return 'Quant';
  if (row.direction === 'Risk') return 'Risk';
  if (row.direction === 'Finance') return 'Finance';
  if (['SDE', 'Data', 'ML/AI', 'PM', 'Consulting', 'MKT', 'Legal'].includes(text(row.direction))) return 'Finance';
  return text(row.direction) || 'Finance';
}

function isFinanceRelated(row: JobRow, title: string, company: string): boolean {
  const companyIsFinance = FINANCE_COMPANY_RE.test(company);
  const companyIsConsulting = CONSULTING_COMPANY_RE.test(company);
  const companyIsBig4 = BIG4_COMPANY_RE.test(company);
  const titleIsFinance = FINANCE_TITLE_RE.test(title);
  const titleIsTech = TECH_TITLE_RE.test(title) && !/\b(quant|trading|research engineer)\b/i.test(title);

  if (companyIsConsulting) return false;
  if (NON_FINANCE_TITLE_RE.test(title) || titleIsTech) return false;
  if (TECH_PROGRAM_RE.test(title) && !/\b(quant|structured finance|global technology)\b/i.test(title)) return false;
  if (/tools and compilers|whole foods|cybersecurity/i.test(title)) return false;
  if (EXPERIENCED_TITLE_RE.test(title) && !EARLY_CAREER_TITLE_RE.test(title)) return false;
  if (!companyIsFinance && !companyIsBig4 && !EARLY_CAREER_TITLE_RE.test(title) && !/\b(rotational|analyst program|graduate)\b/i.test(title)) return false;
  if (companyIsBig4) return BIG4_KEEP_RE.test(title) || titleIsFinance;
  if (titleIsFinance) return true;
  if (companyIsFinance && FINANCE_FUNCTION_AT_BANK_RE.test(title)) return true;
  return false;
}

function displayOrDash(value: string): string {
  return value ? collapse(value) : DASH;
}

function formatDate(value: string): string {
  if (!value) return DASH;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return DASH;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatExperience(row: JobRow): string {
  const labeled = text(row.experience_text);
  if (labeled) return collapse(labeled);
  const min = row.experience_min_years;
  const max = row.experience_max_years;
  if (min != null && max != null) return `${min}–${max} 年`;
  if (min != null) return `${min}+ 年`;
  if (max != null) return `${max} 年以内`;
  return DASH;
}

function formatWorkplace(value: string): string {
  const normalized = value.toLowerCase();
  if (!normalized) return DASH;
  if (/hybrid/.test(normalized)) return '混合';
  if (/remote|work from home|wfh/.test(normalized)) return '远程';
  if (/on[- ]?site|in[- ]?office|office/.test(normalized)) return '现场';
  return collapse(value);
}

async function fetchRows() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY');
  const projectRef = new URL(url).hostname.split('.')[0];
  const client = createClient(url, key, {
    db: { timeout: 120_000 },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rows: JobRow[] = [];
  for (let offset = 0; ; offset += 1_000) {
    const { data, error } = await client
      .from('jobs')
      .select(SELECT_COLUMNS)
      .eq('is_active', true)
      .eq('is_closed', false)
      .in('job_type', ['实习', '校招'])
      .order('company', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    const page = (data || []) as unknown as JobRow[];
    rows.push(...page);
    if (page.length < 1_000) break;
  }

  return { projectRef, rows };
}

function toExportJobs(rows: JobRow[]): ExportJob[] {
  const seen = new Set<string>();
  const jobs: ExportJob[] = [];
  for (const row of rows) {
    const title = collapse(text(row.title));
    const company = collapse(text(row.company));
    if (!title || !company) continue;
    const roleType = classifyRoleType(row);
    if (!roleType) continue;
    const location = collapse(text(row.region));
    const region = classifyRegion(location);
    if (!region) continue;
    if (!isFinanceRelated(row, title, company)) continue;
    const url = text(row.job_url) || text(row.source_url);
    const key = `${company.toLowerCase()}|${title.toLowerCase()}|${location.toLowerCase()}|${roleType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    jobs.push({
      id: row.id,
      company,
      title,
      roleType,
      track: classifyTrack(row, title),
      region,
      location: formatLocation(location),
      workplace: formatWorkplace(text(row.workplace_type)),
      experience: formatExperience(row),
      salary: displayOrDash(text(row.salary_range)),
      deadline: formatDate(text(row.valid_through)),
      posted: formatDate(text(row.posted_at)),
      url,
    });
  }
  jobs.sort((left, right) => {
    const region = REGION_ORDER.indexOf(left.region) - REGION_ORDER.indexOf(right.region);
    if (region !== 0) return region;
    const type = left.roleType.localeCompare(right.roleType, 'zh-CN');
    if (type !== 0) return type;
    const company = left.company.localeCompare(right.company, 'zh-CN');
    if (company !== 0) return company;
    return left.title.localeCompare(right.title, 'zh-CN');
  });
  return jobs;
}

function fill(argb: string): ExcelJS.FillPattern {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function font(options: Partial<ExcelJS.Font>): Partial<ExcelJS.Font> {
  return { name: 'Calibri', color: { argb: TEXT }, ...options };
}

function yahei(options: Partial<ExcelJS.Font>): Partial<ExcelJS.Font> {
  return { name: 'Microsoft YaHei', color: { argb: TEXT }, ...options };
}

function thinBorder(): Partial<ExcelJS.Borders> {
  const edge: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: LINE } };
  return { top: edge, left: edge, bottom: edge, right: edge };
}

function applySheetChrome(sheet: ExcelJS.Worksheet, tabColor: string, freezeRows = 0) {
  sheet.properties.tabColor = { argb: tabColor };
  sheet.views = [{
    showGridLines: false,
    state: freezeRows > 0 ? 'frozen' : 'normal',
    ySplit: freezeRows > 0 ? freezeRows : undefined,
    zoomScale: freezeRows > 0 ? 120 : 110,
  }];
  sheet.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
    margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.2, footer: 0.2 },
    horizontalCentered: true,
  };
  sheet.headerFooter = {
    oddHeader: '&L&K0F2744Liorvix 金融岗位&R&K6B7280实习 / 校招',
    oddFooter: '&L&K6B7280仅供内部浏览，申请以官网为准&R&K6B7280第 &P 页',
  };
}

function paintRange(sheet: ExcelJS.Worksheet, range: string, argb: string) {
  const [start, end] = range.split(':');
  const startCell = sheet.getCell(start);
  const endCell = sheet.getCell(end || start);
  for (let row = Number(startCell.row); row <= Number(endCell.row); row += 1) {
    for (let col = Number(startCell.col); col <= Number(endCell.col); col += 1) {
      sheet.getCell(row, col).fill = fill(argb);
    }
  }
}

function countBy<T>(items: T[], key: (item: T) => string): Array<[string, number]> {
  const map = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    map.set(value, (map.get(value) || 0) + 1);
  }
  return [...map.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN'));
}

function buildCover(workbook: ExcelJS.Workbook, jobs: ExportJob[], exportedAt: string, projectRef: string) {
  const sheet = workbook.addWorksheet('总览', { properties: { defaultRowHeight: 22 } });
  applySheetChrome(sheet, INK);
  sheet.columns = [
    { width: 4 },
    { width: 22 },
    { width: 18 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 18 },
    { width: 4 },
  ];

  paintRange(sheet, 'A1:J36', PAPER);
  paintRange(sheet, 'A1:J2', INK);
  sheet.mergeCells('B4:I4');
  sheet.mergeCells('B5:I5');
  sheet.mergeCells('B6:I6');
  sheet.getCell('B4').value = 'LIORVIX';
  sheet.getCell('B4').font = yahei({ size: 13, bold: true, color: { argb: GOLD } });
  sheet.getCell('B5').value = '金融实习与校招岗位一览';
  sheet.getCell('B5').font = yahei({ size: 28, bold: true, color: { argb: INK } });
  sheet.getCell('B6').value = '北美  ·  澳洲  ·  香港  ·  英国';
  sheet.getCell('B6').font = yahei({ size: 13, color: { argb: GOLD_DEEP } });
  sheet.getRow(4).height = 22;
  sheet.getRow(5).height = 38;
  sheet.getRow(6).height = 24;

  sheet.mergeCells('B7:I7');
  sheet.getCell('B7').value = `导出时间  ${exportedAt}      数据源  生产岗位库 ${projectRef}      口径  在招 · 实习/校招 · 金融相关`;
  sheet.getCell('B7').font = font({ size: 10, color: { argb: MUTED }, italic: true });

  const internCount = jobs.filter((job) => job.roleType === '实习').length;
  const campusCount = jobs.filter((job) => job.roleType === '校招').length;
  const companyCount = new Set(jobs.map((job) => job.company)).size;
  const kpis: Array<[string, string, string]> = [
    ['在招岗位', String(jobs.length), '条'],
    ['实习', String(internCount), '条'],
    ['校招', String(campusCount), '条'],
    ['覆盖公司', String(companyCount), '家'],
  ];
  kpis.forEach((item, index) => {
    const col = 2 + index * 2;
    const top = sheet.getCell(9, col);
    const number = sheet.getCell(10, col);
    const unit = sheet.getCell(11, col);
    sheet.mergeCells(9, col, 9, col + 1);
    sheet.mergeCells(10, col, 10, col + 1);
    sheet.mergeCells(11, col, 11, col + 1);
    [9, 10, 11].forEach((row) => {
      sheet.getCell(row, col).fill = fill(IVORY);
      sheet.getCell(row, col + 1).fill = fill(IVORY);
      sheet.getCell(row, col).border = thinBorder();
      sheet.getCell(row, col + 1).border = thinBorder();
    });
    top.value = item[0];
    top.font = yahei({ size: 10, color: { argb: MUTED } });
    top.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    number.value = Number(item[1]);
    number.font = yahei({ size: 22, bold: true, color: { argb: INK } });
    number.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    unit.value = item[2];
    unit.font = yahei({ size: 10, color: { argb: GOLD_DEEP } });
    unit.alignment = { vertical: 'top', horizontal: 'left', indent: 1 };
  });
  sheet.getRow(9).height = 20;
  sheet.getRow(10).height = 30;
  sheet.getRow(11).height = 18;

  sheet.getCell('B13').value = '地区分布';
  sheet.getCell('B13').font = yahei({ size: 14, bold: true, color: { argb: INK } });
  const regionHeaders = ['地区', '合计', '实习', '校招', '公司数'];
  regionHeaders.forEach((header, index) => {
    const cell = sheet.getCell(14, 2 + index);
    cell.value = header;
    cell.font = yahei({ size: 10, bold: true, color: { argb: WHITE } });
    cell.fill = fill(INK);
    cell.alignment = { vertical: 'middle', horizontal: index === 0 ? 'left' : 'center' };
    cell.border = thinBorder();
  });
  REGION_ORDER.forEach((region, index) => {
    const subset = jobs.filter((job) => job.region === region);
    const values = [
      region,
      subset.length,
      subset.filter((job) => job.roleType === '实习').length,
      subset.filter((job) => job.roleType === '校招').length,
      new Set(subset.map((job) => job.company)).size,
    ];
    values.forEach((value, colIndex) => {
      const cell = sheet.getCell(15 + index, 2 + colIndex);
      cell.value = value;
      cell.font = yahei({ size: 11, color: { argb: TEXT }, bold: colIndex === 0 });
      cell.fill = fill(index % 2 === 0 ? IVORY : WHITE);
      cell.alignment = { vertical: 'middle', horizontal: colIndex === 0 ? 'left' : 'center' };
      cell.border = thinBorder();
    });
  });

  sheet.getCell('B20').value = '方向分布';
  sheet.getCell('B20').font = yahei({ size: 14, bold: true, color: { argb: INK } });
  ['方向', '岗位数'].forEach((header, index) => {
    const cell = sheet.getCell(21, 2 + index);
    cell.value = header;
    cell.font = yahei({ size: 10, bold: true, color: { argb: WHITE } });
    cell.fill = fill(INK);
    cell.alignment = { vertical: 'middle', horizontal: index === 0 ? 'left' : 'center' };
    cell.border = thinBorder();
  });
  countBy(jobs, (job) => job.track).slice(0, 8).forEach((entry, index) => {
    entry.forEach((value, colIndex) => {
      const cell = sheet.getCell(22 + index, 2 + colIndex);
      cell.value = value;
      cell.font = yahei({ size: 11, color: { argb: TEXT } });
      cell.fill = fill(index % 2 === 0 ? IVORY : WHITE);
      cell.alignment = { vertical: 'middle', horizontal: colIndex === 0 ? 'left' : 'center' };
      cell.border = thinBorder();
    });
  });

  sheet.getCell('E20').value = '岗位最多的公司';
  sheet.getCell('E20').font = yahei({ size: 14, bold: true, color: { argb: INK } });
  ['公司', '岗位数'].forEach((header, index) => {
    const cell = sheet.getCell(21, 5 + index);
    cell.value = header;
    cell.font = yahei({ size: 10, bold: true, color: { argb: WHITE } });
    cell.fill = fill(INK);
    cell.alignment = { vertical: 'middle', horizontal: index === 0 ? 'left' : 'center' };
    cell.border = thinBorder();
  });
  countBy(jobs, (job) => job.company).slice(0, 8).forEach((entry, index) => {
    entry.forEach((value, colIndex) => {
      const cell = sheet.getCell(22 + index, 5 + colIndex);
      cell.value = value;
      cell.font = yahei({ size: 11, color: { argb: TEXT } });
      cell.fill = fill(index % 2 === 0 ? IVORY : WHITE);
      cell.alignment = { vertical: 'middle', horizontal: colIndex === 0 ? 'left' : 'center', wrapText: true };
      cell.border = thinBorder();
    });
  });

  sheet.mergeCells('B32:I34');
  sheet.getCell('B32').value = [
    '筛选说明',
    '只保留当前在招、实习或校招、且地点落在北美 / 澳洲 / 香港 / 英国的金融相关岗位。',
    '金融口径优先看岗位名称（投行、市场、量化、资管、风控、审计税务等），并纳入Goldman、JPM、Citadel 等金融机构的非纯技术岗；McKinsey / BCG 等咨询公司不计入。空字段用 — 表示官网未给出，不以模型补全。',
  ].join('\n');
  sheet.getCell('B32').alignment = { wrapText: true, vertical: 'top' };
  sheet.getCell('B32').font = yahei({ size: 10, color: { argb: MUTED } });
  sheet.getRow(32).height = 22;
  sheet.getRow(33).height = 22;
  sheet.getRow(34).height = 22;
}

const TABLE_HEADERS = ['#', '公司', '岗位名称', '类型', '方向', '地区', '地点', '工作方式', '经验', '薪资', '截止日期', '申请'];
const TABLE_WIDTHS = [6, 24, 46, 10, 16, 10, 28, 12, 16, 18, 14, 12];

function writeJobSheet(workbook: ExcelJS.Workbook, name: string, jobs: ExportJob[], tabColor: string) {
  const sheet = workbook.addWorksheet(name);
  applySheetChrome(sheet, tabColor, 4);
  sheet.columns = TABLE_WIDTHS.map((width) => ({ width }));
  paintRange(sheet, 'A1:L3', INK);

  sheet.mergeCells('A1:L1');
  sheet.getCell('A1').value = name === '岗位明细' ? '金融实习 / 校招岗位明细' : name;
  sheet.getCell('A1').font = yahei({ size: 16, bold: true, color: { argb: WHITE } });
  sheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(1).height = 28;

  sheet.mergeCells('A2:L2');
  sheet.getCell('A2').value = `${jobs.length} 条在招岗位    可按表头筛选公司、类型、方向和地区    点击「查看」打开官方申请页`;
  sheet.getCell('A2').font = font({ size: 10, color: { argb: GOLD } });
  sheet.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(2).height = 18;

  sheet.mergeCells('A3:L3');
  sheet.getCell('A3').value = '';
  sheet.getRow(3).height = 8;

  TABLE_HEADERS.forEach((header, index) => {
    const cell = sheet.getCell(4, index + 1);
    cell.value = header;
    cell.font = yahei({ size: 10, bold: true, color: { argb: WHITE } });
    cell.fill = fill(INK_SOFT);
    cell.alignment = { vertical: 'middle', horizontal: header === '岗位名称' || header === '公司' || header === '地点' ? 'left' : 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: GOLD } },
      bottom: { style: 'thin', color: { argb: GOLD } },
      left: { style: 'thin', color: { argb: INK_SOFT } },
      right: { style: 'thin', color: { argb: INK_SOFT } },
    };
  });
  sheet.getRow(4).height = 24;
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(4, jobs.length + 4), column: TABLE_HEADERS.length } };

  jobs.forEach((job, index) => {
    const rowNumber = index + 5;
    const row = sheet.getRow(rowNumber);
    const values: Array<string | number> = [
      index + 1,
      job.company,
      job.title,
      job.roleType,
      job.track,
      job.region,
      job.location,
      job.workplace,
      job.experience,
      job.salary,
      job.deadline,
      job.url ? '查看' : DASH,
    ];
    values.forEach((value, colIndex) => {
      const cell = row.getCell(colIndex + 1);
      const centered = ![1, 2, 6].includes(colIndex);
      cell.fill = fill(index % 2 === 0 ? IVORY : WHITE);
      cell.border = thinBorder();
      cell.alignment = {
        vertical: 'middle',
        horizontal: centered ? 'center' : 'left',
        wrapText: colIndex === 2 || colIndex === 6,
      };
      if (colIndex === 11 && job.url) {
        cell.value = { text: '查看', hyperlink: job.url };
        cell.font = yahei({ size: 10, color: { argb: GOLD_DEEP }, underline: true, bold: true });
      } else {
        cell.value = value;
        cell.font = yahei({
          size: 10,
          color: { argb: colIndex === 3 ? (job.roleType === '实习' ? INTERN_INK : CAMPUS_INK) : TEXT },
          bold: colIndex === 1 || colIndex === 3,
        });
      }
    });
    row.height = job.title.length > 42 || job.location.length > 28 ? 36 : 22;
  });

  if (jobs.length === 0) {
    sheet.mergeCells('A5:L8');
    sheet.getCell('A5').value = '这一页当前没有符合条件的在招岗位。';
    sheet.getCell('A5').font = yahei({ size: 12, color: { argb: MUTED } });
    sheet.getCell('A5').alignment = { vertical: 'middle', horizontal: 'center' };
  }

  sheet.autoFilter = { from: 'A4', to: `L${Math.max(4, jobs.length + 4)}` };
}

async function main() {
  const exportedAt = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date()).replace(/\//g, '-');

  const { projectRef, rows } = await fetchRows();
  const jobs = toExportJobs(rows);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Liorvix';
  workbook.lastModifiedBy = 'Liorvix';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.company = 'Liorvix';
  workbook.title = '金融实习与校招岗位一览';
  workbook.description = '北美、澳洲、香港、英国的在招金融实习与校招岗位';

  buildCover(workbook, jobs, exportedAt, projectRef);
  writeJobSheet(workbook, '岗位明细', jobs, INK);
  writeJobSheet(workbook, '实习', jobs.filter((job) => job.roleType === '实习'), INTERN_INK);
  writeJobSheet(workbook, '校招', jobs.filter((job) => job.roleType === '校招'), CAMPUS_INK);
  for (const region of REGION_ORDER) {
    writeJobSheet(workbook, region, jobs.filter((job) => job.region === region), GOLD_DEEP);
  }

  const fileName = `Liorvix-金融实习校招岗位-${exportedAt.slice(0, 10)}.xlsx`;
  const outputDir = path.resolve('output');
  await mkdir(outputDir, { recursive: true });
  const projectPath = path.join(outputDir, fileName);
  const desktopPath = path.join('D:\\UserFiles\\Desktop', fileName);
  await workbook.xlsx.writeFile(projectPath);
  await workbook.xlsx.writeFile(desktopPath);

  const summary = {
    projectRef,
    scanned: rows.length,
    exported: jobs.length,
    intern: jobs.filter((job) => job.roleType === '实习').length,
    campus: jobs.filter((job) => job.roleType === '校招').length,
    byRegion: Object.fromEntries(REGION_ORDER.map((region) => [region, jobs.filter((job) => job.region === region).length])),
    companies: new Set(jobs.map((job) => job.company)).size,
    projectPath,
    desktopPath,
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

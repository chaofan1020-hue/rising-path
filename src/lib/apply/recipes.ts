/**
 * 站点配方（ATS Recipes）：把「某个招聘系统长什么样、怎么填、怎么翻页」写成可热更新的声明式 JSON。
 *
 * 为什么要有配方层：
 * - 纯词法识别在 Workday / iCIMS / SuccessFactors 这类「控件不像表单」的站点上只能命中一半；
 * - 通用启发式永远追不上站点改版，但配方可以按域名下发、按天修复，不用重新发扩展版本（Chrome 商店审核不可控）；
 * - 配方命中后字段直接给出 canonical key（置信度 0.99），完全不需要调用大模型，速度和成本都降一个数量级。
 *
 * 维护约定（对应 docs/auto-apply-next-gen-plan.md 的「配方运维」章节）：
 * - 每个配方必须带 `verify`：命中站点后在页面上能观测到的特征，防止把 A 站配方套到 B 站；
 * - 每个配方带 `version` 与 `updatedAt`，服务端可灰度、可回滚；
 * - 选择器基于公开 DOM 结构整理，上线前必须在真实页面做 dry-run 校验，未验证的配方标记 `status: 'draft'`。
 */
import type { CanonicalKey } from './taxonomy';

export type RecipeStatus = 'stable' | 'draft' | 'degraded';

export interface RecipeFieldMap {
  /** CSS 选择器，支持 data-automation-id / name / id 前缀匹配。 */
  selector: string;
  canonicalKey: CanonicalKey;
  /** 取值转换：例如把 "MM/YYYY" 拆成两个控件、或把 Yes/No 映射为 1/0。 */
  transform?: 'digits' | 'date_ym' | 'date_mdy' | 'bool_to_1_0' | 'lowercase';
}

export interface RecipeStep {
  name: string;
  /** 出现这些选择器之一即认为当前处于该步骤。 */
  detect: string[];
  /** 点击后进入下一步的按钮。 */
  next?: string[];
}

export interface RecipeUpload {
  selector: string;
  kind: 'resume' | 'cover_letter' | 'transcript' | 'other';
}

export interface AtsRecipe {
  id: string;
  label: string;
  atsType: string;
  version: number;
  updatedAt: string;
  status: RecipeStatus;
  match: {
    /** 精确域名（不含协议）。 */
    hosts?: string[];
    /** 域名/路径正则（字符串形式，便于下发）。 */
    hostPatterns?: string[];
    pathIncludes?: string[];
    /** 页面出现这些 DOM 选择器即命中。 */
    domSelectors?: string[];
    /** 页面正文出现这些文案即命中。 */
    signals?: string[];
  };
  form?: {
    /** 表单根节点选择器，用于把「页面上的搜索框」排除在扫描范围外。 */
    root?: string;
    inIframe?: boolean;
    /** 需要穿透 shadow root 的组件（Workday 的部分控件）。 */
    shadowDom?: boolean;
    multiStep?: boolean;
  };
  fields?: RecipeFieldMap[];
  steps?: RecipeStep[];
  repeaters?: Array<{ addButton: string; itemRoot?: string }>;
  uploads?: RecipeUpload[];
  submit?: string[];
  /** 已知坑位与人工兜底说明。 */
  notes?: string[];
}

export interface RecipeMatchInput {
  url: string;
  /** 页面上是否出现某个选择器（由 content script 探测后回传）。 */
  hasSelector?: (selector: string) => boolean;
  /** 页面正文（截断后）用于文案信号匹配。 */
  pageText?: string;
}

export interface RecipeMatchResult {
  recipe: AtsRecipe;
  score: number;
  reasons: string[];
}

const GH_FIELDS: RecipeFieldMap[] = [
  { selector: '#first_name, input[name="first_name"]', canonicalKey: 'first_name' },
  { selector: '#last_name, input[name="last_name"]', canonicalKey: 'last_name' },
  { selector: '#email, input[name="email"]', canonicalKey: 'email' },
  { selector: '#phone, input[name="phone"]', canonicalKey: 'phone' },
  { selector: '#location, input[name="location"]', canonicalKey: 'current_location_text' },
  { selector: '#company, input[name="company"]', canonicalKey: 'company_name' },
  { selector: '#resume_attachment, input#resume', canonicalKey: 'education_start_date' },
  { selector: 'input[name="job_application[resume]"]', canonicalKey: 'education_start_date' },
  { selector: '#cover_letter_text, textarea#cover_letter', canonicalKey: 'cover_letter' },
  { selector: 'input[name="job_application[urls][LinkedIn]"]', canonicalKey: 'linkedin_url' },
  { selector: 'input[name="job_application[urls][GitHub]"]', canonicalKey: 'github_url' },
  { selector: 'input[name="job_application[urls][Portfolio]"]', canonicalKey: 'portfolio_url' },
];

export const ATS_RECIPES: AtsRecipe[] = [
  {
    id: 'greenhouse',
    label: 'Greenhouse',
    atsType: 'greenhouse',
    version: 3,
    updatedAt: '2026-11-17',
    status: 'draft',
    match: {
      hosts: ['boards.greenhouse.io', 'job-boards.greenhouse.io', 'boards.eu.greenhouse.io'],
      hostPatterns: ['^.*greenhouse\\.io$'],
      domSelectors: ['#application_form', 'form#application-form'],
      signals: ['powered by greenhouse'],
    },
    form: { root: '#application_form, form#application-form', inIframe: false, multiStep: false },
    fields: GH_FIELDS.filter((field) => field.canonicalKey !== 'education_start_date'),
    uploads: [
      { selector: 'input[type="file"][name*="resume"]', kind: 'resume' },
      { selector: 'input[type="file"][name*="cover"]', kind: 'cover_letter' },
    ],
    submit: ['#submit_app', 'input[type="submit"][value*="Submit"]'],
    notes: [
      '自定义问题在 li.custom-question 里，label 文案自带编号，需要去掉 "Q1." 前缀再交给词库。',
      'EEO 区块在表单底部，选项文案随公司配置变化，必须走 optionAliases 而不是硬编码。',
    ],
  },
  {
    id: 'lever',
    label: 'Lever',
    atsType: 'lever',
    version: 2,
    updatedAt: '2026-11-17',
    status: 'draft',
    match: {
      hosts: ['jobs.lever.co'],
      hostPatterns: ['^jobs\\.lever\\.co$'],
      domSelectors: ['form#application-form', '.application-form'],
      signals: ['powered by lever'],
    },
    form: { root: 'form#application-form', inIframe: false, multiStep: false },
    fields: [
      { selector: 'input[name="name"]', canonicalKey: 'full_name' },
      { selector: 'input[name="email"]', canonicalKey: 'email' },
      { selector: 'input[name="phone"]', canonicalKey: 'phone' },
      { selector: 'input[name="org"]', canonicalKey: 'company_name' },
      { selector: 'input[name="urls[LinkedIn]"]', canonicalKey: 'linkedin_url' },
      { selector: 'input[name="urls[GitHub]"]', canonicalKey: 'github_url' },
      { selector: 'input[name="urls[Portfolio]"]', canonicalKey: 'portfolio_url' },
      { selector: 'textarea[name="comments"]', canonicalKey: 'additional_info' },
    ],
    uploads: [{ selector: 'input[type="file"][name="resume"]', kind: 'resume' }],
    submit: ['.template-btn.submit', 'button[type="submit"]'],
    notes: [
      'Lever 的 name 是单一全名输入框，写入 "First Last"；若站点分拆姓名，走通用词法。',
      '自定义问题在 .application-question 区块，卡片式同页渲染，一次扫描即可全抓。',
    ],
  },
  {
    id: 'workday',
    label: 'Workday',
    atsType: 'workday',
    version: 4,
    updatedAt: '2026-11-17',
    status: 'draft',
    match: {
      hosts: ['myworkdayjobs.com', 'wd1.myworkdaysite.com', 'wd3.myworkdaysite.com', 'wd5.myworkdaysite.com'],
      hostPatterns: ['myworkdayjobs\\.com$', 'myworkdaysite\\.com$'],
      domSelectors: ['[data-automation-id="applicationForm"]', '[data-automation-id="bottom-navigation-next-button"]'],
      signals: ['workday'],
    },
    form: {
      root: '[data-automation-id="applicationForm"], form[data-automation-id]',
      inIframe: false,
      shadowDom: false,
      multiStep: true,
    },
    fields: [
      { selector: 'input[data-automation-id="legalNameSection_firstName"]', canonicalKey: 'first_name' },
      { selector: 'input[data-automation-id="legalNameSection_lastName"]', canonicalKey: 'last_name' },
      { selector: 'input[data-automation-id="email"]', canonicalKey: 'email' },
      { selector: 'input[data-automation-id="phone-number"]', canonicalKey: 'phone' },
      { selector: 'input[data-automation-id="addressSection_addressLine1"]', canonicalKey: 'address_line1' },
      { selector: 'input[data-automation-id="addressSection_city"]', canonicalKey: 'city' },
      { selector: 'input[data-automation-id="addressSection_postalCode"]', canonicalKey: 'postal_code' },
      { selector: 'input[data-automation-id="socialNetworkAccount--1"]', canonicalKey: 'linkedin_url' },
      { selector: 'textarea[data-automation-id="applyFlowCoverLetter"]', canonicalKey: 'cover_letter' },
    ],
    steps: [
      {
        name: 'my-information',
        detect: ['[data-automation-id="legalNameSection_firstName"]', '[data-automation-id="contactInformationSection"]'],
        next: ['[data-automation-id="bottom-navigation-next-button"]'],
      },
      {
        name: 'my-experience',
        detect: ['[data-automation-id="workExperienceSection"]', '[data-automation-id="educationSection"]'],
        next: ['[data-automation-id="bottom-navigation-next-button"]'],
      },
      {
        name: 'application-questions',
        detect: ['[data-automation-id="applicationQuestionSection"]', '[data-automation-id="questionnaireForm"]'],
        next: ['[data-automation-id="bottom-navigation-next-button"]'],
      },
      {
        name: 'voluntary-disclosures',
        detect: ['[data-automation-id="selfIdentificationSection"]', '[data-automation-id="voluntaryDisclosuresSection"]'],
        next: ['[data-automation-id="bottom-navigation-next-button"]'],
      },
      {
        name: 'review',
        detect: ['[data-automation-id="reviewApplication"]', '[data-automation-id="bottom-navigation-submit-button"]'],
      },
    ],
    repeaters: [
      { addButton: '[data-automation-id="add-button"]', itemRoot: '[data-automation-id="experienceSectionItem"]' },
    ],
    uploads: [
      { selector: '[data-automation-id="file-upload-drop-zone"] input[type="file"]', kind: 'resume' },
      { selector: '[data-automation-id="resumeSection"] input[type="file"]', kind: 'resume' },
    ],
    submit: ['[data-automation-id="bottom-navigation-submit-button"]', 'button[data-automation-id="continue"]'],
    notes: [
      'Workday 的地址/日期/下拉都由 button[aria-haspopup="listbox"] 触发，需要先点开再上下键选择，不能直接 set value。',
      '第一步通常会「自动解析简历」并预填，配方命中后应先等解析完成（Network 空闲 + 字段稳定 1.2s），否则会与站点互相覆盖。',
      '提交前有 review 步骤，必须停在 review 让用户确认，禁止直接点 submit。',
    ],
  },
  {
    id: 'icims',
    label: 'iCIMS',
    atsType: 'icims',
    version: 2,
    updatedAt: '2026-11-17',
    status: 'draft',
    match: {
      hosts: ['icims.com', 'careers.icims.com'],
      hostPatterns: ['\\.icims\\.com$'],
      domSelectors: ['#icims_content_iframe', 'iframe#iframe'],
      signals: ['icims'],
    },
    form: { root: '#icims_content_iframe', inIframe: true, multiStep: true },
    fields: [
      { selector: 'input[name*="firstname"], input[id*="firstname"]', canonicalKey: 'first_name' },
      { selector: 'input[name*="lastname"], input[id*="lastname"]', canonicalKey: 'last_name' },
      { selector: 'input[name*="email"], input[id*="email"]', canonicalKey: 'email' },
      { selector: 'input[name*="phone"], input[id*="phone"]', canonicalKey: 'phone' },
    ],
    uploads: [{ selector: 'input[type="file"]', kind: 'resume' }],
    submit: ['input[type="submit"]', 'button[type="submit"]'],
    notes: [
      'iCIMS 表单在 iframe 里，content script 必须 all_frames: true，跨 frame 汇总字段并记录 frameId。',
      '页面常有多步（Profile / Questions / EEO），每步是整页刷新，需要按 frame 重新扫描。',
    ],
  },
  {
    id: 'successfactors',
    label: 'SAP SuccessFactors',
    atsType: 'successfactors',
    version: 2,
    updatedAt: '2026-11-17',
    status: 'draft',
    match: {
      hosts: ['successfactors.com', 'sapsf.com', 'jobs.sap.com'],
      hostPatterns: ['successfactors\\.(com|eu)$', 'sapsf\\.(com|eu)$'],
      domSelectors: ['.rcmFormElement', '[id^="custom_"]'],
      signals: ['successfactors'],
    },
    form: { root: '.rcmFormContainer, form', inIframe: false, shadowDom: true, multiStep: true },
    fields: [
      { selector: 'input[id$="firstName"], input[name$="firstName"]', canonicalKey: 'first_name' },
      { selector: 'input[id$="lastName"], input[name$="lastName"]', canonicalKey: 'last_name' },
      { selector: 'input[id$="email"], input[name$="email"]', canonicalKey: 'email' },
      { selector: 'input[id$="cellPhone"], input[name$="cellPhone"]', canonicalKey: 'phone' },
    ],
    uploads: [{ selector: 'input[type="file"]', kind: 'resume' }],
    notes: [
      'SuccessFactors 大量使用自定义 widget，label 与 input 不在同一 DOM 子树，需要按 aria-labelledby 反查。',
      '部分控件在 shadow root 内，扫描器必须递归 open shadowRoot。',
    ],
  },
  {
    id: 'smartrecruiters',
    label: 'SmartRecruiters',
    atsType: 'smartrecruiters',
    version: 2,
    updatedAt: '2026-11-17',
    status: 'draft',
    match: {
      hosts: ['jobs.smartrecruiters.com', 'careers.smartrecruiters.com'],
      hostPatterns: ['smartrecruiters\\.com$'],
      domSelectors: ['#application-form', '[data-test="application-form"]'],
      signals: ['smartrecruiters'],
    },
    form: { root: '#application-form, [data-test="application-form"]', inIframe: false, multiStep: false },
    fields: [
      { selector: 'input[name="firstName"]', canonicalKey: 'first_name' },
      { selector: 'input[name="lastName"]', canonicalKey: 'last_name' },
      { selector: 'input[name="email"]', canonicalKey: 'email' },
      { selector: 'input[name="phoneNumber"]', canonicalKey: 'phone' },
      { selector: 'input[name="location"]', canonicalKey: 'current_location_text' },
    ],
    uploads: [{ selector: 'input[type="file"]', kind: 'resume' }],
  },
  {
    id: 'ashby',
    label: 'Ashby',
    atsType: 'ashby',
    version: 2,
    updatedAt: '2026-11-17',
    status: 'draft',
    match: {
      hosts: ['jobs.ashbyhq.com'],
      hostPatterns: ['ashbyhq\\.com$'],
      domSelectors: ['form.ashby-application-form', '[class*="ashby"]'],
      signals: ['ashby'],
    },
    form: { root: 'form.ashby-application-form, form', inIframe: false, multiStep: false },
    fields: [
      { selector: 'input[name="_systemfield_name"]', canonicalKey: 'full_name' },
      { selector: 'input[name="_systemfield_email"]', canonicalKey: 'email' },
      { selector: 'input[name="_systemfield_phone"]', canonicalKey: 'phone' },
      { selector: 'input[name="_systemfield_linkedin"]', canonicalKey: 'linkedin_url' },
    ],
    uploads: [{ selector: 'input[type="file"]', kind: 'resume' }],
  },
  {
    id: 'taleo',
    label: 'Oracle Taleo',
    atsType: 'taleo',
    version: 1,
    updatedAt: '2026-11-17',
    status: 'draft',
    match: {
      hosts: ['taleo.net', 'oraclecloud.com'],
      hostPatterns: ['taleo\\.net$', 'taleo\\.net\\.']  ,
      domSelectors: ['#mainFrame', 'iframe[id*="mainFrame"]'],
      signals: ['taleo'],
    },
    form: { root: '#mainFrame', inIframe: true, multiStep: true },
    notes: [
      'Taleo 表单在 iframe 内且使用 table 布局，label 与控件通过 td 相邻，需要按行解析。',
    ],
  },
  {
    id: 'generic',
    label: '通用表单',
    atsType: 'generic',
    version: 1,
    updatedAt: '2026-11-17',
    status: 'stable',
    match: {},
    form: { root: 'form', inIframe: false, multiStep: true },
    notes: ['兜底配方：不提供选择器，完全依赖词法识别 + 大模型兜底。'],
  },
];

function safeText(text?: string): string {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 20_000);
}

function matchesPattern(host: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, 'i').test(host);
  } catch {
    return false;
  }
}

/** 给当前页面挑一个配方；分数相同优先版本更高、状态更稳的。 */
export function matchRecipe(input: RecipeMatchInput, recipes: AtsRecipe[] = ATS_RECIPES): RecipeMatchResult | null {
  let host = '';
  let path = '';
  try {
    const parsed = new URL(input.url);
    host = parsed.hostname.toLowerCase();
    path = parsed.pathname.toLowerCase();
  } catch {
    return null;
  }

  const text = safeText(input.pageText);
  const results: RecipeMatchResult[] = [];

  for (const recipe of recipes) {
    if (recipe.id === 'generic') continue;
    let score = 0;
    const reasons: string[] = [];

    if (recipe.match.hosts?.some((item) => host === item || host.endsWith(`.${item}`))) {
      score += 0.7;
      reasons.push('host');
    }
    if (recipe.match.hostPatterns?.some((pattern) => matchesPattern(host, pattern))) {
      score += 0.6;
      reasons.push('hostPattern');
    }
    if (recipe.match.pathIncludes?.some((fragment) => path.includes(fragment))) {
      score += 0.1;
      reasons.push('path');
    }
    if (recipe.match.domSelectors?.length && input.hasSelector) {
      const hits = recipe.match.domSelectors.filter((selector) => {
        try {
          return input.hasSelector!(selector);
        } catch {
          return false;
        }
      }).length;
      if (hits > 0) {
        score += Math.min(0.5, 0.2 + hits * 0.1);
        reasons.push(`dom:${hits}`);
      }
    }
    if (recipe.match.signals?.length && text) {
      const hits = recipe.match.signals.filter((signal) => text.includes(signal.toLowerCase())).length;
      if (hits > 0) {
        score += Math.min(0.4, 0.15 + hits * 0.1);
        reasons.push(`signal:${hits}`);
      }
    }

    if (score > 0) results.push({ recipe, score: Math.min(1, score), reasons });
  }

  if (results.length === 0) return null;
  results.sort((a, b) => b.score - a.score || b.recipe.version - a.recipe.version);
  // 阈值：低于 0.4 说明只有弱信号，交给通用配方更安全
  if (results[0].score < 0.4) return null;
  return results[0];
}

/** 下发时只带上与当前站点相关的内容，减小 payload。 */
export function serializeRecipeForClient(recipe: AtsRecipe): AtsRecipe {
  return { ...recipe, notes: undefined };
}

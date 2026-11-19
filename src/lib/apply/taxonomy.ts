/**
 * 网申字段「世界语」：把任意 ATS 表单上的一个控件，归一到唯一的标准问题（canonical key）。
 *
 * 设计目标
 * 1. 标准答案只存一份：同一个问题在 Workday / Greenhouse / iCIMS 上被问到 30 次，用户只回答一次。
 * 2. 识别可解释：命中哪条别名、命中强度多少、是否被上下文加强，全部可回放（回放数据用于持续训练词库）。
 * 3. 只描述「问题」不描述「DOM」：DOM 选择器属于站点配方（recipes），问题语义属于词库（taxonomy）。
 *
 * 约定
 * - aliases 一律写「归一化之后」的形式：小写、单词之间单个空格、无标点。见 normalizeFieldText。
 * - exclude 用于排除同词不同义的陷阱（例如 "first name" 也要能排除 "emergency contact first name"）。
 * - 一个 canonical key 只对应一个答案；同一控件出现两次（确认邮箱）用 confirm_* 单独建模。
 */

export type CanonicalGroup =
  | 'identity'
  | 'contact'
  | 'location'
  | 'links'
  | 'work_auth'
  | 'education'
  | 'experience'
  | 'skills'
  | 'screening'
  | 'availability'
  | 'compensation'
  | 'eeo'
  | 'essays'
  | 'consent';

export type CanonicalValueType =
  | 'text'
  | 'longtext'
  | 'email'
  | 'phone'
  | 'url'
  | 'date'
  | 'month_year'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'multi_enum';

/** 答案在写入控件前需要做的格式转换。 */
export type CanonicalFormat =
  | 'plain'
  | 'date_mdy'
  | 'date_dmy'
  | 'date_ym'
  | 'boolean_yes_no'
  | 'enum_option'
  | 'digits';

export interface CanonicalFieldDefinition {
  key: CanonicalKey;
  group: CanonicalGroup;
  valueType: CanonicalValueType;
  format?: CanonicalFormat;
  /** 双语展示名，用于 UI 与日志。 */
  label: { zh: string; en: string };
  /** 归一化后的别名短语，命中即加分。 */
  aliases: string[];
  /** 命中这些短语时整体降权，用于拆开同词不同义。 */
  exclude?: string[];
  /** enum 的标准取值。 */
  options?: string[];
  /** enum 标准取值在各 ATS 上的常见文案（小写、归一化），用于把标准值映射到页面选项。 */
  optionAliases?: Record<string, string[]>;
  /** ApplicationProfile 上的取值路径，用于「没有答案库时从简历派生」。 */
  profilePath?: string;
  /** 高敏字段：不自动填写，必须用户亲自逐次确认（合规）。 */
  sensitive?: boolean;
}

export type CanonicalKey =
  // identity
  | 'first_name'
  | 'middle_name'
  | 'last_name'
  | 'full_name'
  | 'preferred_name'
  | 'pronouns'
  // contact
  | 'email'
  | 'confirm_email'
  | 'phone'
  | 'phone_country_code'
  | 'phone_type'
  | 'alternate_email'
  // location
  | 'address_line1'
  | 'address_line2'
  | 'city'
  | 'state_province'
  | 'postal_code'
  | 'country'
  | 'current_location_text'
  | 'willing_to_relocate'
  | 'preferred_location'
  // links
  | 'linkedin_url'
  | 'github_url'
  | 'portfolio_url'
  | 'website_url'
  // work authorization
  | 'work_authorization'
  | 'requires_sponsorship'
  | 'visa_status'
  | 'citizenship_country'
  | 'security_clearance'
  | 'is_international_student'
  // education
  | 'school_name'
  | 'school_country'
  | 'degree_level'
  | 'major'
  | 'minor'
  | 'gpa'
  | 'gpa_scale'
  | 'education_start_date'
  | 'graduation_date'
  | 'still_enrolled'
  // experience
  | 'company_name'
  | 'job_title'
  | 'employment_type'
  | 'experience_start_date'
  | 'experience_end_date'
  | 'currently_employed'
  | 'years_of_experience'
  | 'reason_for_leaving'
  // skills
  | 'skills'
  | 'languages'
  | 'certifications'
  // screening
  | 'how_did_you_hear'
  | 'referral_name'
  | 'employee_referral'
  | 'worked_here_before'
  | 'applied_before'
  | 'relative_at_company'
  | 'non_compete_agreement'
  | 'background_check_consent'
  | 'drug_test_consent'
  | 'criminal_history'
  // availability
  | 'available_start_date'
  | 'notice_period'
  | 'work_model_preference'
  | 'willing_to_travel'
  | 'overtime_ok'
  | 'shift_availability'
  | 'driver_license'
  | 'relocation_assistance_requested'
  // compensation
  | 'desired_salary'
  | 'salary_currency'
  | 'salary_type'
  | 'current_salary'
  // eeo
  | 'gender'
  | 'race_ethnicity'
  | 'hispanic_latino'
  | 'veteran_status'
  | 'disability_status'
  // essays
  | 'cover_letter'
  | 'why_company'
  | 'why_role'
  | 'career_goal'
  | 'additional_info'
  | 'strongest_project'
  // consent
  | 'privacy_consent'
  | 'terms_consent'
  | 'sms_consent'
  | 'signature'
  | 'application_date';

const YES_NO_OPTIONS = ['yes', 'no'];
const YES_NO_ALIASES: Record<string, string[]> = {
  yes: ['yes', 'y', 'true', '1', '是', '同意', '确认', '有'],
  no: ['no', 'n', 'false', '0', '否', '不同意', '没有'],
};

const DECLINE_ALIASES = ['decline to answer', 'decline', 'prefer not to say', 'prefer not to answer', 'not disclosed', 'no answer', '不愿透露', '拒绝回答', '不透露'];

/** 归一化字段文案：去标点、去必填星号、压缩空白、统一中日韩全角空格。 */
export function normalizeFieldText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u3000\s]+/g, ' ')
    .replace(/[*＊:：·•|/\\()[\]{}<>"'`~!@#$%^&+=?？。，、；;（）【】《》「」“”‘’—…\-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const CANONICAL_FIELDS: Record<CanonicalKey, CanonicalFieldDefinition> = {
  first_name: {
    key: 'first_name', group: 'identity', valueType: 'text', label: { zh: '名', en: 'First name' },
    profilePath: 'personal.firstName',
    aliases: ['first name', 'firstname', 'given name', 'forename', 'legal first name', '名', '名字'],
    exclude: ['emergency', 'reference', 'manager', 'previous'],
  },
  middle_name: {
    key: 'middle_name', group: 'identity', valueType: 'text', label: { zh: '中间名', en: 'Middle name' },
    profilePath: 'personal.middleName',
    aliases: ['middle name', 'middlename', 'middle initial', '中间名'],
  },
  last_name: {
    key: 'last_name', group: 'identity', valueType: 'text', label: { zh: '姓', en: 'Last name' },
    profilePath: 'personal.lastName',
    aliases: ['last name', 'lastname', 'surname', 'family name', 'legal last name', '姓', '姓氏'],
    exclude: ['emergency', 'reference', 'previous', 'company'],
  },
  full_name: {
    key: 'full_name', group: 'identity', valueType: 'text', label: { zh: '姓名', en: 'Full name' },
    profilePath: 'personal.fullName',
    aliases: ['full name', 'fullname', 'legal name', 'name', 'your name', 'applicant name', '姓名'],
    exclude: ['first', 'last', 'middle', 'company', 'school', 'referrer', 'emergency', 'file', 'user', 'job'],
  },
  preferred_name: {
    key: 'preferred_name', group: 'identity', valueType: 'text', label: { zh: '常用名', en: 'Preferred name' },
    aliases: ['preferred name', 'nickname', 'also known as', 'english name', '习惯用名', '英文名'],
  },
  pronouns: {
    key: 'pronouns', group: 'identity', valueType: 'enum', label: { zh: '称谓', en: 'Pronouns' },
    options: ['he_him', 'she_her', 'they_them', 'decline'],
    aliases: ['pronouns', 'preferred pronouns', '称谓', '代词'],
    optionAliases: { decline: DECLINE_ALIASES },
  },
  email: {
    key: 'email', group: 'contact', valueType: 'email', label: { zh: '邮箱', en: 'Email' },
    profilePath: 'personal.email',
    aliases: ['email', 'e mail', 'email address', 'mail', '电子邮箱', '邮箱', '邮件'],
    exclude: ['confirm', 're enter', 'retype', 'verify', 'alternate', 'secondary', 'school', 'emergency'],
  },
  confirm_email: {
    key: 'confirm_email', group: 'contact', valueType: 'email', label: { zh: '确认邮箱', en: 'Confirm email' },
    profilePath: 'personal.email',
    aliases: ['confirm email', 'email confirmation', 're enter email', 'retype email', 'verify email', '再次输入邮箱', '确认邮箱'],
  },
  phone: {
    key: 'phone', group: 'contact', valueType: 'phone', label: { zh: '电话', en: 'Phone' },
    profilePath: 'personal.phone',
    aliases: ['phone', 'phone number', 'mobile', 'mobile phone', 'cell', 'cell phone', 'telephone', 'contact number', '联系电话', '手机', '电话号码'],
    exclude: ['country code', 'extension', 'work phone', 'emergency'],
    format: 'digits',
  },
  phone_country_code: {
    key: 'phone_country_code', group: 'contact', valueType: 'text', label: { zh: '电话区号', en: 'Phone country code' },
    aliases: ['country code', 'dial code', 'phone country code', '区号', '国家代码'],
  },
  phone_type: {
    key: 'phone_type', group: 'contact', valueType: 'enum', label: { zh: '电话类型', en: 'Phone type' },
    options: ['mobile', 'home', 'work'],
    aliases: ['phone type', 'phone device type', 'device type', '电话类型'],
    optionAliases: { mobile: ['mobile', 'cell', '手机'], home: ['home', '住宅'], work: ['work', 'business', '工作'] },
  },
  alternate_email: {
    key: 'alternate_email', group: 'contact', valueType: 'email', label: { zh: '备用邮箱', en: 'Alternate email' },
    aliases: ['alternate email', 'secondary email', 'other email', '备用邮箱'],
  },
  address_line1: {
    key: 'address_line1', group: 'location', valueType: 'text', label: { zh: '地址', en: 'Address' },
    profilePath: 'personal.address',
    aliases: ['address', 'address line 1', 'street address', 'street', 'mailing address', 'current address', 'home address', '地址', '详细地址', '街道'],
    exclude: ['email', 'line 2', 'url', 'website', 'ip'],
  },
  address_line2: {
    key: 'address_line2', group: 'location', valueType: 'text', label: { zh: '地址第二行', en: 'Address line 2' },
    profilePath: 'personal.addressLine2',
    aliases: ['address line 2', 'address 2', 'apt', 'apartment', 'suite', 'unit', 'floor', '地址第二行'],
  },
  city: {
    key: 'city', group: 'location', valueType: 'text', label: { zh: '城市', en: 'City' },
    profilePath: 'personal.city',
    aliases: ['city', 'town', 'city town', 'municipality', '城市', '市'],
    exclude: ['school', 'company', 'birth'],
  },
  state_province: {
    key: 'state_province', group: 'location', valueType: 'text', label: { zh: '州/省', en: 'State / Province' },
    profilePath: 'personal.state',
    aliases: ['state', 'province', 'state province', 'region', 'state territory', '省', '州', '省份'],
    exclude: ['statement', 'status', 'estate'],
  },
  postal_code: {
    key: 'postal_code', group: 'location', valueType: 'text', label: { zh: '邮编', en: 'Postal code' },
    profilePath: 'personal.zipCode',
    aliases: ['zip', 'zip code', 'postal code', 'postcode', 'post code', '邮编', '邮政编码'],
  },
  country: {
    key: 'country', group: 'location', valueType: 'enum', label: { zh: '国家/地区', en: 'Country' },
    profilePath: 'personal.country',
    aliases: ['country', 'country region', 'country of residence', 'nation', '国家', '国家地区'],
    exclude: ['citizenship', 'birth', 'phone', 'code'],
  },
  current_location_text: {
    key: 'current_location_text', group: 'location', valueType: 'text', label: { zh: '当前所在地', en: 'Current location' },
    aliases: ['current location', 'location', 'city and state', 'where are you located', 'where do you live', '当前所在地', '现居地'],
    exclude: ['job', 'work location', 'preferred', 'office'],
  },
  willing_to_relocate: {
    key: 'willing_to_relocate', group: 'location', valueType: 'boolean', format: 'boolean_yes_no', label: { zh: '是否愿意搬迁', en: 'Willing to relocate' },
    options: YES_NO_OPTIONS, optionAliases: YES_NO_ALIASES,
    aliases: ['willing to relocate', 'relocate', 'relocation', 'open to relocation', 'willing to move', '是否愿意搬迁', '接受异地'],
  },
  preferred_location: {
    key: 'preferred_location', group: 'location', valueType: 'multi_enum', label: { zh: '期望工作地点', en: 'Preferred location' },
    aliases: ['preferred location', 'preferred office', 'location preference', 'desired location', 'work location preference', '期望工作地点', '意向城市'],
  },
  linkedin_url: {
    key: 'linkedin_url', group: 'links', valueType: 'url', label: { zh: 'LinkedIn', en: 'LinkedIn' },
    profilePath: 'links.linkedin',
    aliases: ['linkedin', 'linkedin url', 'linkedin profile', 'linked in'],
  },
  github_url: {
    key: 'github_url', group: 'links', valueType: 'url', label: { zh: 'GitHub', en: 'GitHub' },
    profilePath: 'links.github',
    aliases: ['github', 'github url', 'github profile', 'git hub'],
  },
  portfolio_url: {
    key: 'portfolio_url', group: 'links', valueType: 'url', label: { zh: '作品集', en: 'Portfolio' },
    profilePath: 'links.portfolio',
    aliases: ['portfolio', 'portfolio url', 'personal website', 'website', 'personal site', '作品集', '个人网站'],
  },
  website_url: {
    key: 'website_url', group: 'links', valueType: 'url', label: { zh: '其他链接', en: 'Other website' },
    aliases: ['other website', 'blog', 'other url', 'other link', '其他链接'],
  },
  work_authorization: {
    key: 'work_authorization', group: 'work_auth', valueType: 'enum', label: { zh: '工作授权', en: 'Work authorization' },
    profilePath: 'workAuthorization',
    options: ['authorized_no_sponsorship', 'authorized_requires_sponsorship', 'not_authorized', 'other'],
    aliases: [
      'work authorization', 'legally authorized to work', 'authorized to work', 'right to work',
      'eligible to work', 'work eligibility', 'employment authorization', '工作授权', '工作许可', '合法工作',
    ],
    exclude: ['sponsor', 'now or in the future', 'visa type'],
    optionAliases: {
      authorized_no_sponsorship: ['yes', 'authorized', 'i am authorized', 'yes without sponsorship', '是'],
      authorized_requires_sponsorship: ['yes with sponsorship', 'authorized with sponsorship', 'will require sponsorship'],
      not_authorized: ['no', 'not authorized', '否'],
      other: ['other'],
    },
  },
  requires_sponsorship: {
    key: 'requires_sponsorship', group: 'work_auth', valueType: 'boolean', format: 'boolean_yes_no', label: { zh: '是否需要 Sponsor', en: 'Requires sponsorship' },
    profilePath: 'visaStatus',
    options: YES_NO_OPTIONS, optionAliases: YES_NO_ALIASES,
    aliases: [
      'require sponsorship', 'requires sponsorship', 'need sponsorship', 'sponsorship required',
      'visa sponsorship', 'immigration sponsorship', 'now or in the future require sponsorship',
      'will you require sponsorship', '需要赞助', '需要签证担保',
    ],
    exclude: ['offer sponsorship', 'sponsorship available'],
  },
  visa_status: {
    key: 'visa_status', group: 'work_auth', valueType: 'text', label: { zh: '签证状态', en: 'Visa status' },
    profilePath: 'visaStatus',
    aliases: ['visa status', 'visa type', 'current visa', 'immigration status', 'work permit', '签证状态', '签证类型'],
  },
  citizenship_country: {
    key: 'citizenship_country', group: 'work_auth', valueType: 'text', label: { zh: '国籍', en: 'Citizenship' },
    aliases: ['citizenship', 'nationality', 'country of citizenship', '国籍'],
  },
  security_clearance: {
    key: 'security_clearance', group: 'work_auth', valueType: 'enum', label: { zh: '安全许可', en: 'Security clearance' },
    options: ['none', 'active', 'eligible'],
    aliases: ['security clearance', 'clearance level', 'active clearance', '安全许可', '保密许可'],
  },
  is_international_student: {
    key: 'is_international_student', group: 'work_auth', valueType: 'boolean', format: 'boolean_yes_no', label: { zh: '是否国际学生', en: 'International student' },
    options: YES_NO_OPTIONS, optionAliases: YES_NO_ALIASES,
    aliases: ['international student', 'international candidate', 'are you an international', '国际学生', '留学生'],
  },
  school_name: {
    key: 'school_name', group: 'education', valueType: 'text', label: { zh: '学校', en: 'School' },
    profilePath: 'education.0.school',
    aliases: ['school', 'school name', 'university', 'college', 'institution', 'institution name', 'alma mater', '学校', '院校', '大学'],
    exclude: ['high school', 'company'],
  },
  school_country: {
    key: 'school_country', group: 'education', valueType: 'text', label: { zh: '学校所在国家', en: 'School country' },
    aliases: ['school country', 'country of institution', 'institution country', '学校国家'],
  },
  degree_level: {
    key: 'degree_level', group: 'education', valueType: 'enum', label: { zh: '学历', en: 'Degree' },
    profilePath: 'education.0.degree',
    options: ['high_school', 'associate', 'bachelor', 'master', 'mba', 'phd', 'md', 'jd', 'other'],
    aliases: ['degree', 'degree type', 'degree level', 'highest degree', 'education level', 'qualification', '学历', '学位'],
    optionAliases: {
      bachelor: ['bachelor', 'bachelors', 'ba', 'bs', 'b s', 'undergraduate', '本科', '学士'],
      master: ['master', 'masters', 'ms', 'ma', 'meng', 'graduate', '硕士', '研究生'],
      mba: ['mba', 'master of business administration'],
      phd: ['phd', 'doctorate', 'doctoral', '博士'],
      associate: ['associate', 'associates', '大专', '副学士'],
      high_school: ['high school', 'secondary', '高中'],
    },
  },
  major: {
    key: 'major', group: 'education', valueType: 'text', label: { zh: '专业', en: 'Major' },
    profilePath: 'education.0.major',
    aliases: ['major', 'field of study', 'discipline', 'concentration', 'area of study', '专业', '所学专业'],
  },
  minor: {
    key: 'minor', group: 'education', valueType: 'text', label: { zh: '辅修', en: 'Minor' },
    aliases: ['minor', 'minor field', 'second major', '辅修'],
  },
  gpa: {
    key: 'gpa', group: 'education', valueType: 'number', label: { zh: 'GPA', en: 'GPA' },
    aliases: ['gpa', 'grade point average', 'grade point', 'average grade', '绩点', '平均分'],
  },
  gpa_scale: {
    key: 'gpa_scale', group: 'education', valueType: 'number', label: { zh: 'GPA 满分', en: 'GPA scale' },
    aliases: ['gpa scale', 'gpa out of', 'maximum gpa', 'gpa 满分'],
  },
  education_start_date: {
    key: 'education_start_date', group: 'education', valueType: 'month_year', format: 'date_ym', label: { zh: '入学时间', en: 'Education start date' },
    aliases: ['education start date', 'school start date', 'start date of education', '入学时间'],
  },
  graduation_date: {
    key: 'graduation_date', group: 'education', valueType: 'month_year', format: 'date_ym', label: { zh: '毕业时间', en: 'Graduation date' },
    profilePath: 'education.0.graduationDate',
    aliases: ['graduation date', 'expected graduation', 'graduation month', 'date of graduation', 'degree date', '毕业时间', '预计毕业'],
  },
  still_enrolled: {
    key: 'still_enrolled', group: 'education', valueType: 'boolean', format: 'boolean_yes_no', label: { zh: '是否在读', en: 'Currently enrolled' },
    options: YES_NO_OPTIONS, optionAliases: YES_NO_ALIASES,
    aliases: ['currently enrolled', 'still enrolled', 'are you currently a student', '在读', '是否在读'],
  },
  company_name: {
    key: 'company_name', group: 'experience', valueType: 'text', label: { zh: '公司', en: 'Company' },
    profilePath: 'experience.0.company',
    aliases: ['company', 'company name', 'employer', 'employer name', 'organization', 'firm', '公司', '雇主'],
    exclude: ['previous employer at this'],
  },
  job_title: {
    key: 'job_title', group: 'experience', valueType: 'text', label: { zh: '职位', en: 'Job title' },
    profilePath: 'experience.0.title',
    aliases: ['job title', 'title', 'position', 'role', 'position title', 'current title', '职位', '岗位', '职务'],
    exclude: ['job applied', 'position applied for', 'desired'],
  },
  employment_type: {
    key: 'employment_type', group: 'experience', valueType: 'enum', label: { zh: '雇佣类型', en: 'Employment type' },
    options: ['full_time', 'part_time', 'internship', 'contract', 'temporary'],
    aliases: ['employment type', 'job type', 'work type', '雇佣类型', '工作类型'],
    optionAliases: {
      internship: ['internship', 'intern', '实习'],
      full_time: ['full time', 'fulltime', '全职'],
      part_time: ['part time', '兼职'],
      contract: ['contract', 'contractor', '合同'],
    },
  },
  experience_start_date: {
    key: 'experience_start_date', group: 'experience', valueType: 'month_year', format: 'date_ym', label: { zh: '入职时间', en: 'Start date' },
    aliases: ['employment start date', 'work start date', 'start date', 'from', '入职时间', '开始时间'],
    exclude: ['available', 'availability', 'education', 'school'],
  },
  experience_end_date: {
    key: 'experience_end_date', group: 'experience', valueType: 'month_year', format: 'date_ym', label: { zh: '离职时间', en: 'End date' },
    aliases: ['employment end date', 'work end date', 'end date', 'to', '离职时间', '结束时间'],
    exclude: ['available', 'education', 'school', 'graduation'],
  },
  currently_employed: {
    key: 'currently_employed', group: 'experience', valueType: 'boolean', format: 'boolean_yes_no', label: { zh: '是否在职', en: 'Currently employed' },
    options: YES_NO_OPTIONS, optionAliases: YES_NO_ALIASES,
    aliases: ['currently employed', 'currently work here', 'i currently work here', 'is current', 'currently working', '是否在职', '目前在职'],
  },
  years_of_experience: {
    key: 'years_of_experience', group: 'experience', valueType: 'number', label: { zh: '工作年限', en: 'Years of experience' },
    aliases: ['years of experience', 'total experience', 'how many years of experience', 'relevant experience', '工作年限', '经验年限'],
  },
  reason_for_leaving: {
    key: 'reason_for_leaving', group: 'experience', valueType: 'text', label: { zh: '离职原因', en: 'Reason for leaving' },
    aliases: ['reason for leaving', 'why did you leave', 'reason for departure', '离职原因'],
  },
  skills: {
    key: 'skills', group: 'skills', valueType: 'multi_enum', label: { zh: '技能', en: 'Skills' },
    profilePath: 'skills',
    aliases: ['skills', 'key skills', 'technical skills', 'technologies', 'skills and abilities', '技能', '技术栈'],
  },
  languages: {
    key: 'languages', group: 'skills', valueType: 'multi_enum', label: { zh: '语言', en: 'Languages' },
    profilePath: 'languages',
    aliases: ['languages', 'language proficiency', 'spoken languages', '语言', '语言能力'],
  },
  certifications: {
    key: 'certifications', group: 'skills', valueType: 'text', label: { zh: '证书', en: 'Certifications' },
    aliases: ['certifications', 'certificates', 'licenses', 'certification', '证书', '资格证'],
  },
  how_did_you_hear: {
    key: 'how_did_you_hear', group: 'screening', valueType: 'enum', label: { zh: '获知渠道', en: 'How did you hear about us' },
    options: ['company_website', 'job_board', 'linkedin', 'referral', 'campus', 'social_media', 'career_fair', 'other'],
    aliases: ['how did you hear about us', 'how did you hear about this', 'source', 'how did you find us', 'referral source', 'where did you hear', '获知渠道', '从哪里得知'],
    optionAliases: {
      linkedin: ['linkedin', 'linked in'],
      job_board: ['indeed', 'glassdoor', 'handshake', 'job board', '招聘网站'],
      company_website: ['company website', 'our website', 'careers site', '官网'],
      referral: ['referral', 'referred', 'employee referral', '内推'],
      campus: ['campus', 'university', 'career center', '校园'],
      career_fair: ['career fair', 'job fair', '招聘会'],
      social_media: ['social media', 'twitter', 'facebook', 'instagram', '社交媒体'],
      other: ['other', '其他'],
    },
  },
  referral_name: {
    key: 'referral_name', group: 'screening', valueType: 'text', label: { zh: '推荐人', en: 'Referrer name' },
    aliases: ['referral name', 'referrer', 'referred by', 'employee name', 'who referred you', '推荐人', '内推人'],
  },
  employee_referral: {
    key: 'employee_referral', group: 'screening', valueType: 'boolean', format: 'boolean_yes_no', label: { zh: '是否有内部推荐', en: 'Employee referral' },
    options: YES_NO_OPTIONS, optionAliases: YES_NO_ALIASES,
    aliases: ['were you referred', 'do you know anyone', 'employee referral', 'internal referral', '是否有内推'],
  },
  worked_here_before: {
    key: 'worked_here_before', group: 'screening', valueType: 'boolean', format: 'boolean_yes_no', label: { zh: '是否曾在此工作', en: 'Previously worked here' },
    options: YES_NO_OPTIONS, optionAliases: YES_NO_ALIASES,
    aliases: ['previously worked', 'have you worked here', 'former employee', 'current employee', '曾在此工作', '前员工'],
  },
  applied_before: {
    key: 'applied_before', group: 'screening', valueType: 'boolean', format: 'boolean_yes_no', label: { zh: '是否曾申请过', en: 'Applied before' },
    options: YES_NO_OPTIONS, optionAliases: YES_NO_ALIASES,
    aliases: ['applied before', 'previous application', 'have you applied', '曾申请过'],
  },
  relative_at_company: {
    key: 'relative_at_company', group: 'screening', valueType: 'boolean', format: 'boolean_yes_no', label: { zh: '是否有亲属任职', en: 'Relative at company' },
    options: YES_NO_OPTIONS, optionAliases: YES_NO_ALIASES,
    aliases: ['relative employed', 'family member', 'do you have a relative', '亲属任职', '家庭成员'],
  },
  non_compete_agreement: {
    key: 'non_compete_agreement', group: 'screening', valueType: 'boolean', format: 'boolean_yes_no', label: { zh: '是否受竞业限制', en: 'Non-compete' },
    options: YES_NO_OPTIONS, optionAliases: YES_NO_ALIASES,
    aliases: ['non compete', 'noncompete', 'restrictive covenant', '竞业', '竞业协议'],
  },
  background_check_consent: {
    key: 'background_check_consent', group: 'screening', valueType: 'boolean', format: 'boolean_yes_no', label: { zh: '背景调查授权', en: 'Background check' },
    options: YES_NO_OPTIONS, optionAliases: YES_NO_ALIASES,
    aliases: ['background check', 'background screening', 'criminal background', '背景调查'],
    sensitive: true,
  },
  drug_test_consent: {
    key: 'drug_test_consent', group: 'screening', valueType: 'boolean', format: 'boolean_yes_no', label: { zh: '药检同意', en: 'Drug test' },
    options: YES_NO_OPTIONS, optionAliases: YES_NO_ALIASES,
    aliases: ['drug test', 'drug screen', 'substance test', '药检'],
    sensitive: true,
  },
  criminal_history: {
    key: 'criminal_history', group: 'screening', valueType: 'boolean', format: 'boolean_yes_no', label: { zh: '犯罪记录', en: 'Criminal history' },
    options: YES_NO_OPTIONS, optionAliases: YES_NO_ALIASES,
    aliases: ['convicted', 'criminal record', 'felony', 'misdemeanor', '犯罪记录', '刑事记录'],
    sensitive: true,
  },
  available_start_date: {
    key: 'available_start_date', group: 'availability', valueType: 'date', format: 'date_mdy', label: { zh: '可入职时间', en: 'Available start date' },
    aliases: ['available start date', 'earliest start date', 'when can you start', 'availability date', 'start date availability', '可入职时间', '最早入职'],
  },
  notice_period: {
    key: 'notice_period', group: 'availability', valueType: 'text', label: { zh: '离职通知期', en: 'Notice period' },
    aliases: ['notice period', 'notice', 'how much notice', '通知期', '离职提前期'],
  },
  work_model_preference: {
    key: 'work_model_preference', group: 'availability', valueType: 'enum', label: { zh: '工作模式', en: 'Work model' },
    options: ['onsite', 'hybrid', 'remote', 'flexible'],
    aliases: ['work model', 'remote hybrid onsite', 'work arrangement', 'in office', '工作模式', '远程办公'],
    optionAliases: {
      remote: ['remote', 'work from home', 'wfh', '远程'],
      hybrid: ['hybrid', '混合'],
      onsite: ['onsite', 'on site', 'in office', '现场'],
      flexible: ['flexible', '灵活'],
    },
  },
  willing_to_travel: {
    key: 'willing_to_travel', group: 'availability', valueType: 'boolean', format: 'boolean_yes_no', label: { zh: '是否接受出差', en: 'Willing to travel' },
    options: YES_NO_OPTIONS, optionAliases: YES_NO_ALIASES,
    aliases: ['willing to travel', 'travel required', 'able to travel', '接受出差', '出差'],
  },
  overtime_ok: {
    key: 'overtime_ok', group: 'availability', valueType: 'boolean', format: 'boolean_yes_no', label: { zh: '是否接受加班', en: 'Overtime' },
    options: YES_NO_OPTIONS, optionAliases: YES_NO_ALIASES,
    aliases: ['overtime', 'work overtime', 'weekends', '加班'],
  },
  shift_availability: {
    key: 'shift_availability', group: 'availability', valueType: 'text', label: { zh: '班次可用时间', en: 'Shift availability' },
    aliases: ['shift', 'available shifts', 'shift availability', '班次'],
  },
  driver_license: {
    key: 'driver_license', group: 'availability', valueType: 'boolean', format: 'boolean_yes_no', label: { zh: '是否有驾照', en: 'Driver license' },
    options: YES_NO_OPTIONS, optionAliases: YES_NO_ALIASES,
    aliases: ['driver license', 'drivers license', 'valid license', '驾照'],
  },
  relocation_assistance_requested: {
    key: 'relocation_assistance_requested', group: 'availability', valueType: 'boolean', format: 'boolean_yes_no', label: { zh: '是否需要搬迁补助', en: 'Relocation assistance' },
    options: YES_NO_OPTIONS, optionAliases: YES_NO_ALIASES,
    aliases: ['relocation assistance', 'relocation package', '搬迁补助'],
  },
  desired_salary: {
    key: 'desired_salary', group: 'compensation', valueType: 'number', label: { zh: '期望薪资', en: 'Desired salary' },
    aliases: ['desired salary', 'expected salary', 'salary expectation', 'compensation expectation', 'desired compensation', 'expected compensation', '期望薪资', '期望年薪'],
  },
  salary_currency: {
    key: 'salary_currency', group: 'compensation', valueType: 'enum', label: { zh: '薪资币种', en: 'Salary currency' },
    options: ['USD', 'CNY', 'GBP', 'EUR', 'HKD', 'SGD', 'CAD', 'AUD'],
    aliases: ['currency', 'salary currency', '币种'],
  },
  salary_type: {
    key: 'salary_type', group: 'compensation', valueType: 'enum', label: { zh: '薪资周期', en: 'Salary period' },
    options: ['annual', 'monthly', 'hourly'],
    aliases: ['salary period', 'per year', 'per hour', 'salary type', '薪资周期'],
    optionAliases: { annual: ['annual', 'year', 'yearly', '年薪'], monthly: ['month', 'monthly', '月薪'], hourly: ['hour', 'hourly', '时薪'] },
  },
  current_salary: {
    key: 'current_salary', group: 'compensation', valueType: 'number', label: { zh: '当前薪资', en: 'Current salary' },
    aliases: ['current salary', 'current compensation', 'present salary', '当前薪资'],
    sensitive: true,
  },
  gender: {
    key: 'gender', group: 'eeo', valueType: 'enum', label: { zh: '性别', en: 'Gender' },
    options: ['male', 'female', 'non_binary', 'decline'],
    aliases: ['gender', 'sex', 'gender identity', '性别'],
    optionAliases: {
      male: ['male', 'man', '男'],
      female: ['female', 'woman', '女'],
      non_binary: ['non binary', 'nonbinary', 'other', '非二元'],
      decline: DECLINE_ALIASES,
    },
    sensitive: true,
  },
  race_ethnicity: {
    key: 'race_ethnicity', group: 'eeo', valueType: 'enum', label: { zh: '种族/族裔', en: 'Race / Ethnicity' },
    options: ['asian', 'white', 'black', 'hispanic', 'native_american', 'pacific_islander', 'two_or_more', 'decline'],
    aliases: ['race', 'ethnicity', 'race ethnicity', 'racial identity', '种族', '族裔'],
    optionAliases: {
      asian: ['asian', 'chinese', 'east asian', 'south asian', '亚裔', '亚洲'],
      white: ['white', 'caucasian', '白人'],
      black: ['black', 'african american', '非裔'],
      hispanic: ['hispanic', 'latino', 'latina', 'hispanic or latino', '拉美裔'],
      native_american: ['native american', 'american indian', 'alaska native', '原住民'],
      pacific_islander: ['pacific islander', 'native hawaiian', '太平洋岛民'],
      two_or_more: ['two or more', 'multiracial', '多种族'],
      decline: DECLINE_ALIASES,
    },
    sensitive: true,
  },
  hispanic_latino: {
    key: 'hispanic_latino', group: 'eeo', valueType: 'boolean', format: 'boolean_yes_no', label: { zh: '是否拉丁裔', en: 'Hispanic / Latino' },
    options: YES_NO_OPTIONS, optionAliases: YES_NO_ALIASES,
    aliases: ['hispanic or latino', 'are you hispanic', '拉丁裔'],
    sensitive: true,
  },
  veteran_status: {
    key: 'veteran_status', group: 'eeo', valueType: 'enum', label: { zh: '退伍军人身份', en: 'Veteran status' },
    options: ['protected_veteran', 'not_veteran', 'decline'],
    aliases: ['veteran', 'veteran status', 'military service', 'protected veteran', '退伍军人', '退役军人'],
    optionAliases: {
      protected_veteran: ['protected veteran', 'i am a veteran', 'yes'],
      not_veteran: ['not a veteran', 'i am not a protected veteran', 'no'],
      decline: DECLINE_ALIASES,
    },
    sensitive: true,
  },
  disability_status: {
    key: 'disability_status', group: 'eeo', valueType: 'enum', label: { zh: '残障身份', en: 'Disability status' },
    options: ['yes', 'no', 'decline'],
    aliases: ['disability', 'disability status', 'disabled', '残障', '残疾'],
    optionAliases: { yes: ['yes', 'i have a disability'], no: ['no', 'i do not have a disability', 'no disability'], decline: DECLINE_ALIASES },
    sensitive: true,
  },
  cover_letter: {
    key: 'cover_letter', group: 'essays', valueType: 'longtext', label: { zh: '求职信', en: 'Cover letter' },
    aliases: ['cover letter', 'coverletter', 'letter of interest', '求职信', '自荐信'],
  },
  why_company: {
    key: 'why_company', group: 'essays', valueType: 'longtext', label: { zh: '为什么选择我们', en: 'Why this company' },
    aliases: ['why do you want to work here', 'why this company', 'why are you interested in', 'why us', '为什么选择我们', '为什么申请'],
  },
  why_role: {
    key: 'why_role', group: 'essays', valueType: 'longtext', label: { zh: '为什么选择该岗位', en: 'Why this role' },
    aliases: ['why this role', 'why this position', 'why are you a good fit', '为什么适合这个岗位'],
  },
  career_goal: {
    key: 'career_goal', group: 'essays', valueType: 'longtext', label: { zh: '职业目标', en: 'Career goals' },
    aliases: ['career goal', 'career objective', 'where do you see yourself', '职业目标', '职业规划'],
  },
  additional_info: {
    key: 'additional_info', group: 'essays', valueType: 'longtext', label: { zh: '补充信息', en: 'Additional information' },
    aliases: ['additional information', 'anything else', 'other information', 'comments', '补充信息', '其他说明'],
  },
  strongest_project: {
    key: 'strongest_project', group: 'essays', valueType: 'longtext', label: { zh: '最自豪的项目', en: 'Strongest project' },
    aliases: ['most proud project', 'strongest project', 'proudest achievement', '最自豪', '代表性项目'],
  },
  privacy_consent: {
    key: 'privacy_consent', group: 'consent', valueType: 'boolean', format: 'boolean_yes_no', label: { zh: '隐私政策同意', en: 'Privacy consent' },
    options: YES_NO_OPTIONS, optionAliases: YES_NO_ALIASES,
    aliases: ['privacy policy', 'privacy notice', 'consent to process', 'agree to the privacy', '隐私政策', '同意隐私'],
    sensitive: true,
  },
  terms_consent: {
    key: 'terms_consent', group: 'consent', valueType: 'boolean', format: 'boolean_yes_no', label: { zh: '条款同意', en: 'Terms consent' },
    options: YES_NO_OPTIONS, optionAliases: YES_NO_ALIASES,
    aliases: ['terms and conditions', 'terms of use', 'i agree to the terms', '条款', '同意条款'],
    sensitive: true,
  },
  sms_consent: {
    key: 'sms_consent', group: 'consent', valueType: 'boolean', format: 'boolean_yes_no', label: { zh: '短信通知同意', en: 'SMS consent' },
    options: YES_NO_OPTIONS, optionAliases: YES_NO_ALIASES,
    aliases: ['sms', 'text message', 'receive updates by sms', '短信通知'],
    sensitive: true,
  },
  signature: {
    key: 'signature', group: 'consent', valueType: 'text', label: { zh: '签名', en: 'Signature' },
    aliases: ['signature', 'type your name to sign', 'electronic signature', '签名', '电子签名'],
    sensitive: true,
  },
  application_date: {
    key: 'application_date', group: 'consent', valueType: 'date', format: 'date_mdy', label: { zh: '申请日期', en: 'Application date' },
    aliases: ['date', 'application date', 'today s date', 'date of application', '申请日期'],
    sensitive: true,
  },
};

export const CANONICAL_KEYS = Object.keys(CANONICAL_FIELDS) as CanonicalKey[];

export function isCanonicalKey(value: string): value is CanonicalKey {
  return Object.prototype.hasOwnProperty.call(CANONICAL_FIELDS, value);
}

export function canonicalLabel(key: CanonicalKey, locale: 'zh' | 'en' = 'zh'): string {
  return CANONICAL_FIELDS[key].label[locale];
}

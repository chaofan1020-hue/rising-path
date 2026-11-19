/**
 * 字段词库 + 站点配方 + 答案库的回归测试。
 * 跑法：pnpm tsx scripts/test-apply-engine.ts
 */
import { CANONICAL_FIELDS, normalizeFieldText, type CanonicalKey } from '../src/lib/apply/taxonomy';
import { resolveField, summarizeResolutions, type FieldInput } from '../src/lib/apply/resolver';
import {
  buildFieldValues,
  canonicalizeOption,
  deriveAnswerFromProfile,
  formatValue,
  lookupAnswer,
  parseLooseDate,
  upsertAnswer,
  type AnswerBank,
} from '../src/lib/apply/answers';
import { ATS_RECIPES, matchRecipe } from '../src/lib/apply/recipes';
import type { ApplicationProfile } from '../src/lib/application-profile';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  failures.push(`${name}${detail ? ` → ${detail}` : ''}`);
}

function checkKey(name: string, field: FieldInput, expected: CanonicalKey | null, minConfidence = 0) {
  const result = resolveField(field);
  check(
    `${name}: ${field.label ?? field.name ?? field.key}`,
    result.canonicalKey === expected && result.confidence >= minConfidence,
    `got ${result.canonicalKey}@${result.confidence.toFixed(2)} (${result.reasons.join('|')}), want ${expected}`,
  );
}

// ---------------------------------------------------------------------------
// 1. 归一化
// ---------------------------------------------------------------------------
check('normalize: 去标点与必填星号', normalizeFieldText('First Name *') === 'first name');
check('normalize: camelCase 保持单词', normalizeFieldText('firstName') === 'firstname');
check(
  'normalize: 中英标点',
  normalizeFieldText('Are you legally authorized to work?（必须）') === 'are you legally authorized to work 必须',
  normalizeFieldText('Are you legally authorized to work?（必须）'),
);

// ---------------------------------------------------------------------------
// 2. 词法识别：常见标签
// ---------------------------------------------------------------------------
const labelCases: Array<[string, CanonicalKey]> = [
  ['First Name', 'first_name'],
  ['Last Name *', 'last_name'],
  ['Legal First Name', 'first_name'],
  ['Email Address', 'email'],
  ['Confirm Email', 'confirm_email'],
  ['Re-enter Email', 'confirm_email'],
  ['Mobile Phone Number', 'phone'],
  ['LinkedIn Profile URL', 'linkedin_url'],
  ['GitHub', 'github_url'],
  ['Portfolio / Personal Website', 'portfolio_url'],
  ['Street Address', 'address_line1'],
  ['City', 'city'],
  ['State / Province', 'state_province'],
  ['Postal Code', 'postal_code'],
  ['Country', 'country'],
  ['Are you legally authorized to work in the United States?', 'work_authorization'],
  ['Will you now or in the future require sponsorship for employment visa status?', 'requires_sponsorship'],
  ['What is your current visa status?', 'visa_status'],
  ['University', 'school_name'],
  ['Degree Type', 'degree_level'],
  ['Field of Study', 'major'],
  ['GPA', 'gpa'],
  ['Expected Graduation Date', 'graduation_date'],
  ['Company Name', 'company_name'],
  ['Job Title', 'job_title'],
  ['How did you hear about us?', 'how_did_you_hear'],
  ['Were you referred by a current employee?', 'employee_referral'],
  ['Do you have a relative employed at this company?', 'relative_at_company'],
  ['Desired Salary', 'desired_salary'],
  ['Earliest Available Start Date', 'available_start_date'],
  ['Gender', 'gender'],
  ['Race / Ethnicity', 'race_ethnicity'],
  ['Veteran Status', 'veteran_status'],
  ['Disability Status', 'disability_status'],
  ['Cover Letter', 'cover_letter'],
  ['Why do you want to work here?', 'why_company'],
  ['I agree to the Privacy Policy', 'privacy_consent'],
  ['Skills', 'skills'],
  ['Languages', 'languages'],
];

for (const [label, expected] of labelCases) {
  checkKey('label', { key: label, label }, expected, 0.8);
}

// ---------------------------------------------------------------------------
// 3. 属性线索：camelCase / 老式 ASP.NET id
// ---------------------------------------------------------------------------
checkKey('attr', { key: 'a1', name: 'firstName' }, 'first_name', 0.75);
checkKey('attr', { key: 'a2', name: 'ctl00$MainContent$txtLastName' }, 'last_name', 0.7);
checkKey('attr', { key: 'a3', id: 'candidate_email' }, 'email', 0.7);
checkKey('attr', { key: 'a4', name: 'linkedinUrl' }, 'linkedin_url', 0.75);

// ---------------------------------------------------------------------------
// 4. 歧义与陷阱
// ---------------------------------------------------------------------------
const emergency = resolveField({ key: 'e1', label: 'Emergency Contact First Name' });
check('trap: 紧急联系人不应高置信命中 first_name', emergency.confidence < 0.8, `${emergency.canonicalKey}@${emergency.confidence}`);

const nameOnly = resolveField({ key: 'e2', label: 'Name' });
check('trap: 单独 Name 命中 full_name', nameOnly.canonicalKey === 'full_name', String(nameOnly.canonicalKey));

const schoolName = resolveField({ key: 'e3', label: 'School Name' });
check('trap: School Name 命中 school_name', schoolName.canonicalKey === 'school_name', String(schoolName.canonicalKey));

// ---------------------------------------------------------------------------
// 5. 答案映射：选项、布尔、日期
// ---------------------------------------------------------------------------
const genderOptions = ['Male', 'Female', 'Decline to Self Identify'];
check(
  'option: decline 映射到 Greenhouse 文案',
  canonicalizeOption(CANONICAL_FIELDS.gender, 'decline', genderOptions) === 'Decline to Self Identify',
);
check(
  'option: female 映射',
  canonicalizeOption(CANONICAL_FIELDS.gender, 'female', genderOptions) === 'Female',
);
check(
  'option: 布尔 yes 映射到 Yes',
  canonicalizeOption(CANONICAL_FIELDS.requires_sponsorship, 'yes', ['Yes', 'No']) === 'Yes',
);
check(
  'option: 无匹配选项返回 null',
  canonicalizeOption(CANONICAL_FIELDS.gender, 'female', ['Male', 'Decline to Self Identify']) === null,
);
check(
  'option: Workday 式拒绝回答文案',
  canonicalizeOption(CANONICAL_FIELDS.veteran_status, 'decline', ["I don't wish to answer", 'I am a protected veteran']) === "I don't wish to answer",
);

check('date: ISO 解析', JSON.stringify(parseLooseDate('2026-06')) === JSON.stringify({ year: 2026, month: 6 }));
check('date: 美式解析', JSON.stringify(parseLooseDate('06/2026')) === JSON.stringify({ year: 2026, month: 6 }));
check('date: 月份英文', parseLooseDate('Jun 2026')?.month === 6);
check('date: 格式化 date input', formatValue(CANONICAL_FIELDS.graduation_date, '2026-06', { fieldType: 'date' }) === '2026-06-01');
check('date: 文本输入 MM/YYYY', formatValue(CANONICAL_FIELDS.graduation_date, '2026-06', { fieldType: 'text' }) === '06/2026');

// ---------------------------------------------------------------------------
// 6. 档案推导
// ---------------------------------------------------------------------------
const profile: ApplicationProfile = {
  personal: { firstName: 'Wei', lastName: 'Zhang', email: 'wei@example.com', phone: '+1 415 555 0101', city: 'San Jose', state: 'CA', zipCode: '95112', country: 'United States', address: '1 Main St' },
  links: { linkedin: 'https://linkedin.com/in/wei', github: 'https://github.com/wei', portfolio: '' },
  education: [{ school: 'University of Southern California', degree: 'Master of Science', major: 'Computer Science', graduationDate: '2026-05' }],
  experience: [{ company: 'Acme Corp', role: 'Software Engineer Intern' }],
  skills: ['Python', 'TypeScript', 'SQL'],
  languages: ['English', 'Mandarin'],
  workAuthorization: '需要 sponsor',
  visaStatus: 'F-1 OPT',
  summary: 'Backend engineer focused on distributed systems.',
};

check('derive: 全名', deriveAnswerFromProfile(profile, 'full_name')?.value === 'Wei Zhang');
check('derive: 学校', deriveAnswerFromProfile(profile, 'school_name')?.value?.includes('Southern California') === true);
check('derive: 学历归一', deriveAnswerFromProfile(profile, 'degree_level')?.value === 'master');
check('derive: 需要 sponsor', deriveAnswerFromProfile(profile, 'requires_sponsorship')?.value === 'yes');
check('derive: 国际学生', deriveAnswerFromProfile(profile, 'is_international_student')?.value === 'yes');
check('derive: 技能拼接', deriveAnswerFromProfile(profile, 'skills')?.value === 'Python, TypeScript, SQL');
check('derive: 无来源字段返回 null', deriveAnswerFromProfile(profile, 'gpa') === null);

// ---------------------------------------------------------------------------
// 7. 端到端：字段 → 答案
// ---------------------------------------------------------------------------
const bank: AnswerBank = {
  gender: { canonicalKey: 'gender', value: 'decline', source: 'user', confidence: 1 },
  how_did_you_hear: { canonicalKey: 'how_did_you_hear', value: 'linkedin', source: 'user', confidence: 1 },
};

const e2eFields = [
  { key: 'f1', canonicalKey: 'first_name' as CanonicalKey, confidence: 0.97, type: 'text' },
  { key: 'f2', canonicalKey: 'gender' as CanonicalKey, confidence: 0.95, options: ['Male', 'Female', 'Decline to Self Identify'] },
  { key: 'f3', canonicalKey: 'how_did_you_hear' as CanonicalKey, confidence: 0.9, options: ['LinkedIn', 'Company Website', 'Other'] },
  { key: 'f4', canonicalKey: 'graduation_date' as CanonicalKey, confidence: 0.9, type: 'date' },
  { key: 'f5', canonicalKey: 'requires_sponsorship' as CanonicalKey, confidence: 0.9, options: ['Yes', 'No'] },
  { key: 'f6', canonicalKey: 'salary_currency' as CanonicalKey, confidence: 0.9, options: ['USD'] },
];

const built = buildFieldValues(e2eFields, bank, profile, 'boards.greenhouse.io');
const byKey = new Map(built.values.map((value) => [value.fieldKey, value]));
check('e2e: 名字来自档案', byKey.get('f1')?.value === 'Wei');
check('e2e: 性别映射到选项', byKey.get('f2')?.value === 'Decline to Self Identify');
check('e2e: 渠道映射到选项', byKey.get('f3')?.value === 'LinkedIn');
check('e2e: 毕业日期适配 date input', byKey.get('f4')?.value === '2026-05-01');
check('e2e: sponsor 布尔映射', byKey.get('f5')?.value === 'Yes');
check('e2e: 答案库缺失且无推导 → unresolved', built.unresolvedFieldKeys.includes('f6'));

const sensitiveValue = byKey.get('f2');
check('e2e: 高敏字段 needsReview', sensitiveValue?.needsReview === true, JSON.stringify(sensitiveValue));

// 档案切换后答案不串档
const otherProfile: ApplicationProfile = { ...profile, personal: { ...profile.personal, firstName: 'Mei' } };
check('e2e: 换档案后名字跟着变', buildFieldValues(e2eFields, bank, otherProfile).values[0].value === 'Mei');

// 忽略学习：没有答案时不应猜测
check('e2e: 无答案字段不产生值', lookupAnswer('desired_salary', bank, profile) === null);

// 用户改过之后写回答案库
const learned = upsertAnswer(bank, 'desired_salary', '120000');
check('learn: 写回答案库', learned.desired_salary?.value === '120000' && learned.desired_salary?.source === 'user');
check('learn: 布尔归一', upsertAnswer(bank, 'requires_sponsorship', 'Yes').requires_sponsorship?.value === 'yes');

// ---------------------------------------------------------------------------
// 8. 站点配方匹配
// ---------------------------------------------------------------------------
const ghMatch = matchRecipe({ url: 'https://boards.greenhouse.io/acme/jobs/123', hasSelector: (selector) => selector.includes('application_form'), pageText: 'Powered by Greenhouse' });
check('recipe: Greenhouse 命中', ghMatch?.recipe.id === 'greenhouse', JSON.stringify(ghMatch?.reasons));
const wdMatch = matchRecipe({ url: 'https://acme.wd1.myworkdayjobs.com/en-US/careers/job/123', hasSelector: () => false, pageText: 'Workday' });
check('recipe: Workday 命中', wdMatch?.recipe.id === 'workday', JSON.stringify(wdMatch?.reasons));
const unknown = matchRecipe({ url: 'https://careers.example.com/apply/123' });
check('recipe: 未知站点回落 generic', unknown === null);
check('recipe: 每个配方都有 version/updatedAt', ATS_RECIPES.every((recipe) => recipe.version > 0 && Boolean(recipe.updatedAt)));

// ---------------------------------------------------------------------------
// 9. 覆盖度汇总
// ---------------------------------------------------------------------------
const summary = summarizeResolutions([
  resolveField({ key: 's1', label: 'First Name' }),
  resolveField({ key: 's2', label: 'Favorite color of your childhood pet' }),
  resolveField({ key: 's3', recipeKey: 'email', label: 'whatever' }),
]);
check('summary: 统计正确', summary.total === 3 && summary.resolved === 2 && summary.highConfidence >= 2, JSON.stringify(summary));

// ---------------------------------------------------------------------------
console.log(`\n${failed === 0 ? '✅' : '❌'} apply engine tests: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\n失败项：');
  for (const failure of failures) console.log(` - ${failure}`);
  process.exitCode = 1;
}

import { jobExperienceMinYears } from '@/lib/ai-match-experience';
import { userNeedsSponsorship, type MatchJobType, type SponsorshipFilter } from '@/lib/ai-match-filters';
import { expandRoleAliases, roleFamilyFromText, roleMatchLevel, roleScore, normalizeRoleText } from '@/lib/ai-match-role-aliases';
import { REGION_DNA, resolveRegionKey, type RegionKey } from '@/lib/region-dna';
import type { CareerStage, ResumeProfile, UserSegmentation } from '@/lib/resume-types';

type MatchLocale = 'zh-CN' | 'zh-TW' | 'en';

export type JobTrack = 'internship' | 'campus' | 'experienced' | 'unknown';
type SegmentationLike = Pick<UserSegmentation, 'careerStage' | 'regions'> & Partial<Pick<UserSegmentation, 'majorMatch' | 'experienceQuality' | 'targetRole'>>;

export interface FeatureJob {
  id?: number;
  title?: string | null;
  company?: string | null;
  region?: string | null;
  direction?: string | null;
  audience?: string | null;
  job_type?: string | null;
  employment_category?: string | null;
  description?: string | null;
  requirements?: string | null;
  sponsorship?: 'yes' | 'no' | 'unknown' | null;
  experience_min_years?: number | null;
  experience_max_years?: number | null;
  experience_text?: string | null;
  valid_through?: string | null;
}

export interface FeatureContext {
  profile?: ResumeProfile | Partial<ResumeProfile> | null;
  segmentation?: SegmentationLike | null;
  locale?: MatchLocale;
  jobTypes?: MatchJobType[];
  sponsorshipFilter?: SponsorshipFilter;
}

export interface MatchFeatureBreakdown {
  ats: number;
  keywords: number;
  experience: number;
  evidence: number;
  region: number;
  profile_fit: number;
}

export interface MatchFeatureScore {
  score: number;
  breakdown: MatchFeatureBreakdown;
  roleFit: 'direct' | 'adjacent';
  roleScore: number;
  skillHits: string[];
  skillMisses: string[];
  regionMatch: boolean;
  track: JobTrack;
  targetCompany: boolean;
  needsSponsorship: boolean;
  experienceYears: number;
  notes: string[];
}

const INTERNSHIP_PATTERN = /\b(intern|internship|co-?op|summer analyst)\b|实习|暑期/i;
const CAMPUS_PATTERN = /\b(new grad(?:uate)?|graduate|campus|early career|entry[- ]?level|junior|analyst program|engineer i|analyst i)\b|校招|应届|管培/i;
const EXPERIENCED_PATTERN = /\b(senior|sr\.?|staff|principal|manager|director|lead|head|vp|chief)\b|高级|资深|负责人|总监|经理/i;
const BROAD_SKILL_TERMS = new Set([
  'ai', 'data', 'program', 'programming', 'technology', 'tech', 'development',
  'developer', 'engineering', 'engineer', 'software', 'computer', 'science',
  '工作', '开发', '技术', '数据', '项目', '经验', 'intern', 'internship',
]);

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function classifyJobTrack(job: FeatureJob): JobTrack {
  const haystack = `${job.title || ''} ${job.job_type || ''} ${job.employment_category || ''} ${job.audience || ''}`;
  if (job.job_type === '实习' || INTERNSHIP_PATTERN.test(haystack)) return 'internship';
  if (job.job_type === '校招' || CAMPUS_PATTERN.test(haystack)) return 'campus';
  if (job.job_type === '社招' || EXPERIENCED_PATTERN.test(haystack)) return 'experienced';
  return 'unknown';
}

export function collectResumeSkills(profile?: ResumeProfile | null): string[] {
  const projects = profile?.projects || [];
  const sources = [
    ...(profile?.skills || []),
    ...projects.flatMap((item) => item.techStack || []),
  ];
  const unique = [...new Set(sources.map((item) => normalizeRoleText(item)).filter((item) => item.length >= 2 && !BROAD_SKILL_TERMS.has(item)))];
  return unique.slice(0, 24);
}

export function collectTargetRoles(profile?: ResumeProfile | null, segmentation?: SegmentationLike | null): string[] {
  const roles = [
    ...(Array.isArray(profile?.intention?.roles) ? profile!.intention!.roles! : []),
    segmentation?.targetRole || '',
  ].filter((role): role is string => typeof role === 'string' && role.trim().length > 0);
  return [...new Set(roles)];
}

export function collectTargetCompanies(profile?: ResumeProfile | null): string[] {
  return [...new Set((profile?.intention?.targetCompanies || []).map((item) => normalizeRoleText(item)).filter(Boolean))];
}

export function isTargetCompany(job: FeatureJob, targetCompanies: string[]): boolean {
  if (targetCompanies.length === 0) return false;
  const company = normalizeRoleText(job.company);
  if (!company) return false;
  return targetCompanies.some((target) => target.length >= 2 && (company.includes(target) || target.includes(company)));
}

export function profileExperienceYears(profile?: ResumeProfile | null): number {
  const entries = [...(profile?.internships || []), ...(profile?.workExperience || [])];
  const months = entries.reduce((total, entry) => total + (Number(entry.months) || 0), 0);
  return months / 12;
}

function userRegionKeys(profile?: ResumeProfile | null, segmentation?: SegmentationLike | null): RegionKey[] {
  const fromSegmentation = segmentation?.regions || [];
  if (fromSegmentation.length > 0) return fromSegmentation;
  const fromIntention = (profile?.intention?.locations || [])
    .map((item) => resolveRegionKey(item))
    .filter((item): item is RegionKey => !!item);
  return [...new Set(fromIntention)];
}

function sameSuperRegion(left: RegionKey, right: RegionKey): boolean {
  const northAmerica = new Set<RegionKey>(['us', 'ca']);
  const china = new Set<RegionKey>(['cn_t1', 'cn_t2', 'hk']);
  return (northAmerica.has(left) && northAmerica.has(right)) || (china.has(left) && china.has(right));
}

function trackFit(track: JobTrack, stage?: CareerStage | null): number {
  if (!stage) return 60;
  if (stage === 'junior') {
    if (track === 'internship') return 96;
    if (track === 'campus') return 78;
    if (track === 'experienced') return 28;
    return 62;
  }
  if (stage === 'returning_intern') {
    if (track === 'internship') return 88;
    if (track === 'campus') return 90;
    if (track === 'experienced') return 42;
    return 64;
  }
  if (stage === 'senior') {
    if (track === 'campus') return 96;
    if (track === 'internship') return 72;
    if (track === 'experienced') return 48;
    return 66;
  }
  if (track === 'experienced') return 92;
  if (track === 'campus') return 58;
  if (track === 'internship') return 30;
  return 60;
}

function localized(locale: MatchLocale | undefined, values: Record<'zh-CN' | 'zh-TW' | 'en', string>): string {
  if (locale === 'en') return values.en;
  if (locale === 'zh-TW') return values['zh-TW'];
  return values['zh-CN'];
}

function regionHiringAdvice(job: FeatureJob, locale: MatchLocale = 'zh-CN'): string | null {
  const key = resolveRegionKey(job.region);
  if (!key) return null;
  const dna = REGION_DNA[key];
  const signals = dna.keySignals.slice(0, 2).join(locale === 'en' ? ', ' : '、');
  return localized(locale, {
    'zh-CN': `按${dna.name}招聘习惯，投递前优先核对：${signals}。`,
    'zh-TW': `按${dna.name}招聘習慣，投遞前優先核對：${signals}。`,
    en: `For ${dna.nameEn} hiring, confirm these signals before applying: ${signals}.`,
  });
}

export function buildMatchRetrievalTerms(
  profile?: ResumeProfile | null,
  segmentation?: SegmentationLike | null,
  jobTypes: MatchJobType[] = [],
  limit = 8,
): string[] {
  const roles = collectTargetRoles(profile, segmentation);
  const rolePhrases = roles.flatMap((role) => expandRoleAliases(role, 4)).filter((term) => term.length >= 3 && !BROAD_SKILL_TERMS.has(normalizeRoleText(term)));
  const skills = collectResumeSkills(profile);
  const trackTerms: string[] = [];
  if (jobTypes.includes('实习')) trackTerms.push('intern', 'internship', '实习');
  if (jobTypes.includes('校招')) trackTerms.push('"new grad"', 'campus', '校招');
  const unique: string[] = [];
  for (const term of [...rolePhrases, ...trackTerms, ...skills]) {
    const normalized = term.trim();
    if (!normalized || unique.some((item) => item.toLowerCase() === normalized.toLowerCase())) continue;
    unique.push(normalized.includes(' ') ? `"${normalized.replace(/"/g, '')}"` : normalized);
    if (unique.length >= limit) break;
  }
  return unique;
}

export function scoreMatchFeatures(job: FeatureJob, context: FeatureContext): MatchFeatureScore {
  const profile = (context.profile || null) as ResumeProfile | null;
  const segmentation = context.segmentation || null;
  const targetRoles = collectTargetRoles(profile, segmentation);
  const targetCompanies = collectTargetCompanies(profile);
  const jobText = `${job.title || ''} ${job.direction || ''}`;
  const track = classifyJobTrack(job);
  const role = roleScore(jobText, targetRoles);
  const fit = roleMatchLevel(jobText, targetRoles) === 'direct' ? 'direct' : 'adjacent';
  const skills = collectResumeSkills(profile);
  const haystack = normalizeRoleText(`${job.title || ''} ${job.requirements || ''} ${job.description || ''}`.slice(0, 4000));
  const skillHits = skills.filter((skill) => skill.length >= 2 && haystack.includes(skill)).slice(0, 8);
  const skillMisses = skills.filter((skill) => !skillHits.includes(skill)).slice(0, 4);
  const keywords = skills.length === 0
    ? 52
    : clamp(18 + (skillHits.length / Math.max(3, Math.min(skills.length, 8))) * 82);

  const experienceYears = profileExperienceYears(profile);
  const minimum = jobExperienceMinYears(job);
  let experience = 64 + trackFit(track, segmentation?.careerStage) * 0.12;
  if (track === 'experienced' && (segmentation?.careerStage === 'junior' || segmentation?.careerStage === 'returning_intern' || segmentation?.careerStage === 'senior')) {
    experience -= 28;
  }
  if (minimum !== null) {
    const gap = minimum - experienceYears;
    experience += gap > 0 ? -Math.min(58, gap * 22) : Math.min(16, Math.abs(gap) * 4);
  }
  experience = clamp(experience);

  const userRegions = userRegionKeys(profile, segmentation);
  const jobRegion = resolveRegionKey(job.region);
  const regionMatch = !!jobRegion && userRegions.includes(jobRegion);
  let region = 52;
  if (regionMatch) region = 90;
  else if (jobRegion && userRegions.some((item) => sameSuperRegion(item, jobRegion))) region = 72;
  else if (!jobRegion) region = 55;
  else region = 36;
  if (jobRegion === 'us' && profile?.intention?.visaStatus) region = Math.min(100, region + 6);
  region = clamp(region);

  const quantified = [...(profile?.internships || []), ...(profile?.workExperience || [])]
    .flatMap((entry) => entry.highlights || [])
    .some((item) => /\d/.test(item));
  const evidence = clamp(38 + skillHits.length * 10 + (quantified ? 12 : 0));

  let ats = 70;
  if (profile?.meta?.resumeLanguage === 'en' && (jobRegion === 'us' || jobRegion === 'uk' || jobRegion === 'sg' || jobRegion === 'au' || jobRegion === 'ca')) ats += 8;
  if (segmentation?.experienceQuality?.quantifiedDensity === 'high') ats += 6;
  if (profile?.meta?.wordDensity === 'sparse') ats -= 8;
  ats = clamp(ats);

  const needsSponsorship = userNeedsSponsorship(profile, userRegions);
  let visaFit = 80;
  if (needsSponsorship) {
    if (job.sponsorship === 'yes') visaFit = 96;
    else if (job.sponsorship === 'no') visaFit = 12;
    else visaFit = 56;
  }
  const targetCompany = isTargetCompany(job, targetCompanies);
  let extras = 0;
  if (targetCompany) extras += 18;
  if (segmentation?.majorMatch === 'aligned') extras += 8;
  else if (segmentation?.majorMatch === 'related') extras += 4;
  const personalityFamily = roleFamilyFromText(profile?.personality?.recommendations?.[0]?.labelKey || profile?.personality?.primaryDimension || '');
  if (personalityFamily !== 'other' && personalityFamily === roleFamilyFromText(jobText)) extras += 6;
  const profileFit = clamp(role * 0.46 + trackFit(track, segmentation?.careerStage) * 0.24 + visaFit * 0.18 + extras);

  const breakdown: MatchFeatureBreakdown = {
    ats,
    keywords,
    experience,
    evidence,
    region,
    profile_fit: profileFit,
  };
  const score = clamp(
    breakdown.ats * 0.10
    + breakdown.keywords * 0.20
    + breakdown.experience * 0.20
    + breakdown.evidence * 0.10
    + breakdown.region * 0.15
    + breakdown.profile_fit * 0.25,
  );

  const notes: string[] = [];
  if (fit === 'direct') notes.push('target_role');
  if (skillHits.length > 0) notes.push(`skills:${skillHits.slice(0, 4).join(',')}`);
  if (regionMatch) notes.push('region');
  if (targetCompany) notes.push('target_company');
  if (needsSponsorship && job.sponsorship === 'yes') notes.push('sponsorship');
  if (needsSponsorship && job.sponsorship !== 'yes') notes.push('sponsorship_unconfirmed');

  return {
    score,
    breakdown,
    roleFit: fit,
    roleScore: role,
    skillHits,
    skillMisses,
    regionMatch,
    track,
    targetCompany,
    needsSponsorship,
    experienceYears,
    notes,
  };
}

export function buildFeatureExplanation(
  job: FeatureJob,
  features: MatchFeatureScore,
  locale: MatchLocale = 'zh-CN',
): { match_reason: string; evidence: string[]; key_gaps: string[]; suggestions: string } {
  const title = job.title || localized(locale, { 'zh-CN': '该岗位', 'zh-TW': '該職位', en: 'this role' });
  const match_reason = features.roleFit === 'direct'
    ? localized(locale, {
      'zh-CN': `${title} 与你的目标岗位方向一致，简历技能和经历可以进入候选。`,
      'zh-TW': `${title} 與你的目標職位方向一致，履歷技能和經歷可以進入候選。`,
      en: `${title} aligns with your target role, and the resume evidence is strong enough to shortlist.`,
    })
    : localized(locale, {
      'zh-CN': `${title} 与你的主方向相邻，可以作为备选，但需要确认技能和申请窗口。`,
      'zh-TW': `${title} 與你的主方向相鄰，可以作為備選，但需要確認技能和申請窗口。`,
      en: `${title} sits next to your main direction. Keep it as a backup after checking skills and timing.`,
    });

  const evidence: string[] = [];
  if (features.skillHits.length > 0) {
    evidence.push(localized(locale, {
      'zh-CN': `简历技能命中：${features.skillHits.slice(0, 4).join('、')}`,
      'zh-TW': `履歷技能命中：${features.skillHits.slice(0, 4).join('、')}`,
      en: `Resume skills matched: ${features.skillHits.slice(0, 4).join(', ')}`,
    }));
  }
  if (features.regionMatch) {
    evidence.push(localized(locale, {
      'zh-CN': '岗位地区与已确认的求职地区一致',
      'zh-TW': '職位地區與已確認的求職地區一致',
      en: 'The job location matches your confirmed target region',
    }));
  }
  if (features.targetCompany) {
    evidence.push(localized(locale, {
      'zh-CN': '该公司在你的目标公司名单中',
      'zh-TW': '該公司在你的目標公司名單中',
      en: 'This company is on your target list',
    }));
  }
  if (evidence.length === 0) {
    evidence.push(localized(locale, {
      'zh-CN': '当前匹配主要来自岗位类型、地区和经历门槛，而非完整技能重合',
      'zh-TW': '目前匹配主要來自職位類型、地區和經歷門檻，而非完整技能重合',
      en: 'This ranking is based on job track, region, and experience bar more than exact skill overlap',
    }));
  }

  const key_gaps: string[] = [];
  if (features.needsSponsorship && job.sponsorship !== 'yes') {
    key_gaps.push(localized(locale, {
      'zh-CN': '签证担保尚未被官方明确确认',
      'zh-TW': '簽證擔保尚未被官方明確確認',
      en: 'Visa sponsorship has not been confirmed from an official source',
    }));
  }
  if (features.skillMisses.length > 0 && features.skillHits.length < 2) {
    key_gaps.push(localized(locale, {
      'zh-CN': `岗位描述里较少出现你已有的核心技能：${features.skillMisses.slice(0, 3).join('、')}`,
      'zh-TW': `職位描述裡較少出現你已有的核心技能：${features.skillMisses.slice(0, 3).join('、')}`,
      en: `The posting rarely mentions your core skills: ${features.skillMisses.slice(0, 3).join(', ')}`,
    }));
  }
  const minimum = jobExperienceMinYears(job);
  if (minimum !== null && minimum > features.experienceYears + 0.25) {
    key_gaps.push(localized(locale, {
      'zh-CN': `岗位写明至少 ${minimum} 年经验，先补一段可量化相关经历再投会更稳`,
      'zh-TW': `職位寫明至少 ${minimum} 年經驗，先補一段可量化相關經歷再投會更穩`,
      en: `The role asks for at least ${minimum} years. Add a quantified related experience before applying`,
    }));
  }
  if (key_gaps.length === 0) {
    key_gaps.push(localized(locale, {
      'zh-CN': '投递前核对截止日期、地点和官方申请页是否仍开放',
      'zh-TW': '投遞前核對截止日期、地點和官方申請頁是否仍開放',
      en: 'Confirm the deadline, location, and official application page before applying',
    }));
  }

  const experienceGap = minimum !== null && minimum > features.experienceYears + 0.25;
  const baseSuggestion = features.score >= 75
    ? localized(locale, {
      'zh-CN': '可以直接准备申请材料，并针对岗位关键词微调简历。',
      'zh-TW': '可以直接準備申請材料，並針對職位關鍵詞微調履歷。',
      en: 'Prepare the application now and tune the resume toward the posting keywords.',
    })
    : experienceGap
      ? localized(locale, {
        'zh-CN': '这份岗位仍值得准备，但先补一段相关实习或项目成果，再投会更稳。',
        'zh-TW': '這份職位仍值得準備，但先補一段相關實習或專案成果，再投會更穩。',
        en: 'This role is still worth pursuing. Add a related internship or project outcome before applying.',
      })
      : localized(locale, {
        'zh-CN': '这份岗位值得准备。先补齐关键差距，优先改简历中的技能和成果表述，再投递会更稳。',
        'zh-TW': '這份職位值得準備。先補齊關鍵差距，優先改履歷中的技能和成果表述，再投遞會更穩。',
        en: 'This role is worth pursuing. Close the key gaps first, starting with skills and quantified outcomes.',
      });
  const regionAdvice = regionHiringAdvice(job, locale);
  const suggestions = regionAdvice ? `${baseSuggestion} ${regionAdvice}` : baseSuggestion;

  return { match_reason, evidence: evidence.slice(0, 4), key_gaps: key_gaps.slice(0, 4), suggestions };
}

import type { RegionKey } from '@/lib/region-dna';

export type CareerStage = 'junior' | 'senior' | 'experienced' | 'returning_intern';
export type SchoolTier = 1 | 2 | 3;
export type MajorMatch = 'aligned' | 'related' | 'unrelated';
export type CodingPreference = 'likes_coding' | 'neutral' | 'avoids_coding' | 'unknown';
export type CommunicationPreference =
  | 'likes_communication'
  | 'neutral'
  | 'avoids_communication'
  | 'unknown';
export type TargetSchoolBand = 'target' | 'semi_target' | 'non_target' | 'unknown';
export type PlanLocale = 'zh-CN' | 'zh-TW' | 'en';
export type LocalizedPlanText = Partial<Record<PlanLocale, string>>;
export type VisaStatusCategory = 'none' | 'student' | 'work_visa' | 'permanent' | 'unknown';

export interface VisaDates {
  programEndDate?: string;
  visaStartDate?: string;
  visaEndDate?: string;
  stemEligible?: boolean;
}

export interface CareerSignals {
  codingPreference?: CodingPreference;
  communicationPreference?: CommunicationPreference;
  targetIndustries?: string[];
  targetSchoolBand?: TargetSchoolBand;
  coop?: boolean;
}

export interface PlanRefinement {
  narrative?: string;
  backupRoute?: string;
  verificationNote?: string;
  visaNote?: string;
  narratives?: LocalizedPlanText;
  backupRoutes?: LocalizedPlanText;
  verificationNotes?: LocalizedPlanText;
  visaNotes?: LocalizedPlanText;
}

export interface ResumePersonalityProfile {
  model: 'career_fit';
  dimensions: Record<string, number>;
  primaryDimension: string;
  summaryKey: string;
  recommendations: Array<{
    roleKey: string;
    labelKey: string;
    score: number;
    fit: 'strong' | 'medium' | 'explore';
    reasons: string[];
    sponsorship?: {
      level: 'high' | 'medium' | 'low' | 'unknown';
      sponsorJobCount: number;
      activeJobCount: number;
      noteKey: string;
    };
  }>;
  completedAt: string;
}

export const RESUME_PROFILE_SCHEMA_VERSION = 6;

export interface EducationEntry {
  school: string;
  degree?: string;
  major?: string;
  startYear?: number;
  endYear?: number;
  gpa?: string;
  qsEstimate?: number;
  isTargetNote?: string;
}

export interface ExperienceEntry {
  company: string;
  role: string;
  startDate?: string;
  endDate?: string;
  months?: number;
  isInternship?: boolean;
  convertedToFulltime?: boolean;
  level?: string;
  highlights?: string[];
}

export interface ProjectEntry {
  name: string;
  role?: string;
  techStack?: string[];
  outcomes?: string[];
}

export interface ResumeProfile {
  education: EducationEntry[];
  internships: ExperienceEntry[];
  workExperience: ExperienceEntry[];
  projects: ProjectEntry[];
  skills: string[];
  certificates: string[];
  careerSignals?: CareerSignals;
  personality?: ResumePersonalityProfile;
  planRefinement?: PlanRefinement;
  networkingProgress?: unknown;
  schemaVersion?: number;
  languages?: string[];
  intention?: {
    roles?: string[];
    locations?: string[];
    industries?: string[];
    targetCompanies?: string[];
    workAuthorization?: string;
    visaStatus?: string;
    visaDates?: VisaDates;
    availableFrom?: string;
    salaryExpectation?: string;
  };
  meta?: {
    pages?: number;
    wordDensity?: 'sparse' | 'normal' | 'dense';
    resumeLanguage?: 'zh' | 'en' | 'bilingual';
  };
}

export interface UserSegmentation {
  careerStage: CareerStage;
  careerStageReason: string;
  schoolTier: SchoolTier;
  schoolTierSource: 'builtin' | 'llm_estimate' | 'unknown';
  qsBand?: string;
  targetSchoolHits: string[];
  majorMatch?: MajorMatch;
  majorMatchNote?: string;
  targetRole?: string | null;
  regions: RegionKey[];
  regionSource: 'intention' | 'inferred' | 'default';
  experienceQuality: {
    internshipCount: number;
    bigNameCount: number;
    totalMonths: number;
    quantifiedDensity: 'low' | 'medium' | 'high';
  };
  summary: string;
}

export interface SegmentationOverrides {
  careerStage?: CareerStage;
  schoolTier?: SchoolTier;
  majorMatch?: MajorMatch;
  regions?: RegionKey[];
}

export type ResumeFieldSource = 'explicit' | 'inferred' | 'user' | 'unknown';

export interface ResumeEvidenceItem {
  source: ResumeFieldSource;
  quote?: string;
  note?: string;
}

export type ResumeProfileEvidence = Record<string, ResumeEvidenceItem[]>;
export type ResumeProfileConfidence = Record<string, number>;

export type ResumeProcessingStatus =
  | 'uploaded'
  | 'extracting_text'
  | 'extracting_profile'
  | 'deriving_segmentation'
  | 'needs_confirmation'
  | 'ready'
  | 'failed';

export type ResumeProcessingStage =
  | 'queued'
  | 'text_extraction'
  | 'profile_extraction'
  | 'segmentation'
  | 'confirmation'
  | 'complete'
  | 'error';

export interface ResumeProcessingMetadata {
  status: ResumeProcessingStatus;
  stage: ResumeProcessingStage;
  error?: string | null;
  attempts: number;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface ResumeProfileUpdateMetadata {
  profileVersion?: number;
  confirmed?: boolean;
  processingStatus?: ResumeProcessingStatus;
  processingStage?: ResumeProcessingStage;
  profileConfirmedAt?: string | null;
}

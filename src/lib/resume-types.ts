import type { RegionKey } from '@/lib/region-dna';

export type CareerStage = 'junior' | 'senior' | 'experienced' | 'returning_intern';
export type SchoolTier = 1 | 2 | 3;
export type MajorMatch = 'aligned' | 'related' | 'unrelated';

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
  languages?: string[];
  intention?: {
    roles?: string[];
    locations?: string[];
    industries?: string[];
    workAuthorization?: string;
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

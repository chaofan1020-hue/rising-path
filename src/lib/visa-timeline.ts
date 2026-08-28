import type { RegionKey } from '@/lib/region-dna';
import type { VisaDates, VisaStatusCategory } from '@/lib/resume-types';

export type VisaTimelineRisk = 'high' | 'medium' | 'low' | 'info';

export interface VisaTimelineEntry {
  key: string;
  labelKey: string;
  actionKey?: string;
  estimatedDate?: string;
  risk: VisaTimelineRisk;
}

export interface VisaTimeline {
  statusCode: string;
  statusLabelKey: string;
  entries: VisaTimelineEntry[];
}

export interface VisaStatusOption {
  value: string;
  labelKey: string;
  category: VisaStatusCategory;
}

export const VISA_STATUS_OPTIONS: Record<RegionKey, VisaStatusOption[]> = {
  us: [
    { value: 'us_f1_no_opt', labelKey: 'resume.visaOption.us_f1_no_opt', category: 'student' },
    { value: 'us_f1_opt', labelKey: 'resume.visaOption.us_f1_opt', category: 'student' },
    { value: 'us_f1_stem_opt', labelKey: 'resume.visaOption.us_f1_stem_opt', category: 'student' },
    { value: 'us_h1b', labelKey: 'resume.visaOption.us_h1b', category: 'work_visa' },
    { value: 'us_permanent', labelKey: 'resume.visaOption.us_permanent', category: 'permanent' },
    { value: 'none', labelKey: 'resume.visaOption.none', category: 'none' },
  ],
  uk: [
    { value: 'uk_student', labelKey: 'resume.visaOption.uk_student', category: 'student' },
    { value: 'uk_psw', labelKey: 'resume.visaOption.uk_psw', category: 'work_visa' },
    { value: 'uk_skilled_worker', labelKey: 'resume.visaOption.uk_skilled_worker', category: 'work_visa' },
    { value: 'uk_permanent', labelKey: 'resume.visaOption.uk_permanent', category: 'permanent' },
    { value: 'none', labelKey: 'resume.visaOption.none', category: 'none' },
  ],
  sg: [
    { value: 'sg_student_pass', labelKey: 'resume.visaOption.sg_student_pass', category: 'student' },
    { value: 'sg_ep', labelKey: 'resume.visaOption.sg_ep', category: 'work_visa' },
    { value: 'sg_permanent', labelKey: 'resume.visaOption.sg_permanent', category: 'permanent' },
    { value: 'none', labelKey: 'resume.visaOption.none', category: 'none' },
  ],
  ca: [
    { value: 'ca_study_permit', labelKey: 'resume.visaOption.ca_study_permit', category: 'student' },
    { value: 'ca_pgwp', labelKey: 'resume.visaOption.ca_pgwp', category: 'work_visa' },
    { value: 'ca_permanent', labelKey: 'resume.visaOption.ca_permanent', category: 'permanent' },
    { value: 'none', labelKey: 'resume.visaOption.none', category: 'none' },
  ],
  hk: [
    { value: 'hk_student_visa', labelKey: 'resume.visaOption.hk_student_visa', category: 'student' },
    { value: 'hk_iang', labelKey: 'resume.visaOption.hk_iang', category: 'work_visa' },
    { value: 'hk_dependent', labelKey: 'resume.visaOption.hk_dependent', category: 'work_visa' },
    { value: 'hk_permanent', labelKey: 'resume.visaOption.hk_permanent', category: 'permanent' },
    { value: 'none', labelKey: 'resume.visaOption.hk_none', category: 'none' },
  ],
  au: [
    { value: 'au_student_visa', labelKey: 'resume.visaOption.au_student_visa', category: 'student' },
    { value: 'au_485', labelKey: 'resume.visaOption.au_485', category: 'work_visa' },
    { value: 'au_permanent', labelKey: 'resume.visaOption.au_permanent', category: 'permanent' },
    { value: 'none', labelKey: 'resume.visaOption.none', category: 'none' },
  ],
  cn_t1: [
    { value: 'cn_no_visa', labelKey: 'resume.visaOption.cn_no_visa', category: 'permanent' },
  ],
  cn_t2: [
    { value: 'cn_no_visa', labelKey: 'resume.visaOption.cn_no_visa', category: 'permanent' },
  ],
};

export function regionRequiresIdentity(region: RegionKey): boolean {
  return region !== 'cn_t1' && region !== 'cn_t2';
}

export function resolveVisaStatusForRegion(
  intention:
    | {
        visaStatus?: string | null;
        visaByRegion?: Partial<Record<RegionKey, string>> | null;
      }
    | null
    | undefined,
  region: RegionKey,
): string | null | undefined {
  return intention?.visaByRegion?.[region] ?? intention?.visaStatus ?? undefined;
}

export interface BuildVisaTimelineInput {
  region: RegionKey;
  visaStatus?: string | null;
  visaDates?: VisaDates | null;
  programEndYear?: number | null;
  now?: Date;
}

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function nextAprilAfter(date: Date): Date {
  const next = new Date(date.getFullYear(), 3, 1);
  if (next <= date) next.setFullYear(next.getFullYear() + 1);
  return next;
}

function programEndDate(input: BuildVisaTimelineInput): Date | null {
  return parseDate(input.visaDates?.programEndDate)
    ?? (input.programEndYear ? new Date(input.programEndYear, 5, 30) : null);
}

function visaEndDate(input: BuildVisaTimelineInput, fallbackMonths: number): Date | null {
  const explicit = parseDate(input.visaDates?.visaEndDate);
  if (explicit) return explicit;
  const start = parseDate(input.visaDates?.visaStartDate) ?? programEndDate(input);
  return start ? addMonths(start, fallbackMonths) : null;
}

function limitedPermitEntries(
  input: BuildVisaTimelineInput,
  months: number,
  actionKey: string,
): VisaTimelineEntry[] {
  const expiry = visaEndDate(input, months);
  return [{
    key: 'visa_expiry',
    labelKey: 'visaTimeline.visaExpiry',
    actionKey,
    estimatedDate: expiry ? toIso(expiry) : undefined,
    risk: 'high',
  }];
}

function unknownEntries(): VisaTimelineEntry[] {
  return [{
    key: 'confirm_status',
    labelKey: 'visaTimeline.confirmStatus',
    actionKey: 'visaTimeline.action.confirmStatus',
    risk: 'high',
  }];
}

export function buildVisaTimeline(input: BuildVisaTimelineInput): VisaTimeline {
  const statusCode = input.visaStatus || 'unknown';
  const programEnd = programEndDate(input);
  let entries: VisaTimelineEntry[] = [];

  if (statusCode === 'us_f1_no_opt') {
    entries = [
      {
        key: 'opt_application_window',
        labelKey: 'visaTimeline.optApplicationWindow',
        actionKey: 'visaTimeline.action.applyOpt',
        estimatedDate: programEnd ? toIso(addMonths(programEnd, -3)) : undefined,
        risk: 'high',
      },
      {
        key: 'opt_duration',
        labelKey: 'visaTimeline.optDuration',
        estimatedDate: programEnd ? toIso(addMonths(programEnd, 12)) : undefined,
        risk: 'medium',
      },
      {
        key: 'h1b_lottery',
        labelKey: 'visaTimeline.h1bLottery',
        actionKey: 'visaTimeline.action.enterH1b',
        estimatedDate: programEnd ? toIso(nextAprilAfter(programEnd)) : undefined,
        risk: 'medium',
      },
    ];
  } else if (statusCode === 'us_f1_opt' || statusCode === 'us_f1_stem_opt') {
    const totalMonths = statusCode === 'us_f1_stem_opt' ? 36 : 12;
    entries = [
      ...limitedPermitEntries(input, totalMonths, 'visaTimeline.action.confirmSponsorship'),
      {
        key: 'h1b_lottery',
        labelKey: 'visaTimeline.h1bLottery',
        actionKey: 'visaTimeline.action.enterH1b',
        estimatedDate: programEnd ? toIso(nextAprilAfter(programEnd)) : undefined,
        risk: 'medium',
      },
    ];
  } else if (statusCode === 'us_h1b') {
    entries = limitedPermitEntries(input, 36, 'visaTimeline.action.confirmSponsorship');
  } else if (statusCode === 'uk_student') {
    entries = [
      {
        key: 'psw_application',
        labelKey: 'visaTimeline.pswApplication',
        actionKey: 'visaTimeline.action.applyPsw',
        estimatedDate: programEnd ? toIso(programEnd) : undefined,
        risk: 'medium',
      },
      {
        key: 'psw_duration',
        labelKey: 'visaTimeline.pswDuration',
        estimatedDate: programEnd ? toIso(addMonths(programEnd, 24)) : undefined,
        risk: 'medium',
      },
    ];
  } else if (statusCode === 'uk_psw') {
    entries = [
      ...limitedPermitEntries(input, 24, 'visaTimeline.action.convertSkilledWorker'),
    ];
  } else if (statusCode === 'uk_skilled_worker') {
    entries = limitedPermitEntries(input, 36, 'visaTimeline.action.confirmSponsorship');
  } else if (statusCode === 'sg_student_pass') {
    entries = [{
      key: 'ep_application',
      labelKey: 'visaTimeline.epApplication',
      actionKey: 'visaTimeline.action.applyEp',
      risk: 'medium',
    }];
  } else if (statusCode === 'sg_ep') {
    entries = limitedPermitEntries(input, 24, 'visaTimeline.action.confirmSponsorship');
  } else if (statusCode === 'ca_study_permit') {
    entries = [
      {
        key: 'pgwp_application',
        labelKey: 'visaTimeline.pgwpApplication',
        actionKey: 'visaTimeline.action.applyPgwp',
        estimatedDate: programEnd ? toIso(addMonths(programEnd, 3)) : undefined,
        risk: 'high',
      },
      {
        key: 'pgwp_duration',
        labelKey: 'visaTimeline.pgwpDuration',
        estimatedDate: programEnd ? toIso(addMonths(programEnd, 36)) : undefined,
        risk: 'medium',
      },
    ];
  } else if (statusCode === 'ca_pgwp') {
    entries = limitedPermitEntries(input, 36, 'visaTimeline.action.confirmSponsorship');
  } else if (statusCode === 'hk_student_visa') {
    entries = [
      {
        key: 'iang_application',
        labelKey: 'visaTimeline.iangApplication',
        actionKey: 'visaTimeline.action.applyIang',
        estimatedDate: programEnd ? toIso(programEnd) : undefined,
        risk: 'medium',
      },
      {
        key: 'iang_duration',
        labelKey: 'visaTimeline.iangDuration',
        estimatedDate: programEnd ? toIso(addMonths(programEnd, 24)) : undefined,
        risk: 'medium',
      },
    ];
  } else if (statusCode === 'hk_iang' || statusCode === 'hk_dependent') {
    entries = limitedPermitEntries(input, 24, 'visaTimeline.action.confirmSponsorship');
  } else if (statusCode === 'au_student_visa') {
    entries = [
      {
        key: 'visa485_application',
        labelKey: 'visaTimeline.visa485Application',
        actionKey: 'visaTimeline.action.apply485',
        estimatedDate: programEnd ? toIso(programEnd) : undefined,
        risk: 'medium',
      },
      {
        key: 'visa485_duration',
        labelKey: 'visaTimeline.visa485Duration',
        estimatedDate: programEnd ? toIso(addMonths(programEnd, 24)) : undefined,
        risk: 'medium',
      },
    ];
  } else if (statusCode === 'au_485') {
    entries = limitedPermitEntries(input, 24, 'visaTimeline.action.confirmSponsorship');
  } else if (statusCode === 'cn_no_visa' || statusCode === 'us_permanent' || statusCode === 'uk_permanent'
    || statusCode === 'sg_permanent' || statusCode === 'ca_permanent' || statusCode === 'hk_permanent'
    || statusCode === 'au_permanent') {
    entries = [{
      key: 'no_visa_issue',
      labelKey: 'visaTimeline.noVisaIssue',
      risk: 'info',
    }];
  } else if (statusCode === 'none') {
    if (input.region === 'hk') {
      entries = [{
        key: 'hk_work_visa_required',
        labelKey: 'visaTimeline.hkWorkVisaRequired',
        actionKey: 'visaTimeline.action.confirmHkVisa',
        risk: 'medium',
      }];
    } else {
      entries = [{
        key: 'sponsorship_required',
        labelKey: 'visaTimeline.sponsorshipRequired',
        actionKey: 'visaTimeline.action.confirmSponsorship',
        risk: 'high',
      }];
    }
  } else {
    entries = unknownEntries();
  }

  return {
    statusCode,
    statusLabelKey: `resume.visaOption.${statusCode}`,
    entries,
  };
}

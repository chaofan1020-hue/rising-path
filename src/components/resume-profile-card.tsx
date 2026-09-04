'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, PencilLine, Loader2, Plus, Save, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiFetch } from '@/lib/api-client';
import type {
  ResumeProfile,
  ResumeProfileUpdateMetadata,
  UserSegmentation,
} from '@/lib/resume-types';
import { useLanguage } from '@/lib/language-context';
import type { RegionKey } from '@/lib/region-dna';
import { regionRequiresIdentity, VISA_STATUS_OPTIONS } from '@/lib/visa-timeline';
import type { VisaDates } from '@/lib/resume-types';

interface ResumeProfileCardProps {
  id?: string;
  resumeId: number;
  profile: ResumeProfile;
  regions?: RegionKey[];
  confirmed?: boolean;
  defaultEditing?: boolean;
  highlighted?: boolean;
  onUpdated: (
    profile: ResumeProfile,
    segmentation?: UserSegmentation,
    metadata?: ResumeProfileUpdateMetadata,
  ) => void;
}

interface IntentOption {
  value: string;
  label?: string;
}

function parseList(value: string): string[] {
  return value
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function joinList(value?: string[]): string {
  return value?.join('、') || '';
}

function formatProfileDate(value: string, type: 'date' | 'month'): string {
  const parts = value.split('-');
  if (type === 'month' && parts.length >= 2 && parts[0] && parts[1]) {
    return `${parts[0]}.${parts[1]}`;
  }
  if (type === 'date' && parts.length >= 3 && parts[0] && parts[1] && parts[2]) {
    return `${parts[0]}.${parts[1]}.${parts[2]}`;
  }
  return value;
}

function parseProfileDate(value: string, type: 'date' | 'month'): Date | undefined {
  const parts = value.split('-').map(Number);
  if (parts.length < 2 || parts.some((part) => !Number.isFinite(part))) return undefined;
  const [year, month, day = 1] = parts;
  const date = new Date(year, month - 1, type === 'month' ? 1 : day);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toProfileDateValue(date: Date, type: 'date' | 'month'): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  if (type === 'month') return `${year}-${month}`;
  return `${year}-${month}-${String(date.getDate()).padStart(2, '0')}`;
}

function ProfileDateField({
  label,
  value,
  onChange,
  type = 'date',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'date' | 'month';
}) {
  const selectedDate = parseProfileDate(value, type);
  const [open, setOpen] = useState(false);
  const [displayMonth, setDisplayMonth] = useState(() => selectedDate || new Date());

  useEffect(() => {
    const nextDate = parseProfileDate(value, type);
    if (nextDate) setDisplayMonth(nextDate);
  }, [value, type]);

  const handleSelect = (date?: Date) => {
    if (!date) return;
    onChange(toProfileDateValue(date, type));
    setOpen(false);
  };

  return (
    <div className="group min-w-0 space-y-1.5 text-xs text-zinc-500 dark:text-zinc-400">
      <span className="block truncate">{label}</span>
      <div className="relative">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-10 w-full items-center rounded-xl border border-zinc-200/90 bg-zinc-50/70 px-3 text-left shadow-sm shadow-zinc-900/[0.03] transition-colors hover:border-zinc-300 hover:bg-white focus-visible:border-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/5 dark:border-zinc-700/80 dark:bg-zinc-900/60 dark:hover:border-zinc-600 dark:hover:bg-zinc-900 dark:focus-visible:border-zinc-500"
              aria-label={label}
              aria-haspopup="dialog"
              aria-expanded={open}
            >
              <CalendarDays className="mr-2 h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
              <span className={`truncate text-sm ${value ? 'font-medium text-zinc-800 dark:text-zinc-100' : 'text-transparent'}`}>
                {formatProfileDate(value, type) || ' '}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              mode="single"
              selected={selectedDate}
              month={displayMonth}
              onMonthChange={setDisplayMonth}
              onSelect={handleSelect}
              captionLayout="dropdown"
              startMonth={new Date(2000, 0)}
              endMonth={new Date(2100, 11)}
            />
          </PopoverContent>
        </Popover>
        {value && (
          <button
            type="button"
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full p-1 text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
            aria-label={`Clear ${label}`}
            onClick={() => onChange('')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function IntentPicker({
  label,
  value,
  onChange,
  options,
  placeholder,
  customPlaceholder,
  addLabel,
  noOptionsLabel,
  removeLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: IntentOption[];
  placeholder: string;
  customPlaceholder: string;
  addLabel: string;
  noOptionsLabel: string;
  removeLabel: string;
}) {
  const [customValue, setCustomValue] = useState('');
  const [open, setOpen] = useState(false);
  const selected = parseList(value);
  const filteredOptions = useMemo(() => {
    const query = customValue.trim().toLocaleLowerCase();
    return options.filter((option) => !selected.some((item) => item.toLowerCase() === option.value.toLowerCase())
      && (!query || option.value.toLocaleLowerCase().includes(query))).slice(0, 12);
  }, [customValue, options, selected]);
  const addValue = (nextValue: string) => {
    const next = nextValue.trim();
    if (!next || selected.some((item) => item.toLowerCase() === next.toLowerCase())) return;
    onChange([...selected, next].join('、'));
    setCustomValue('');
  };
  const removeValue = (item: string) => onChange(selected.filter((valueItem) => valueItem !== item).join('、'));

  return (
    <div className="space-y-1.5 text-xs text-zinc-500 dark:text-zinc-400">
      <span className="block">{label}</span>
      <div className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
        <div className={`flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 transition-colors ${open ? 'border-zinc-500 ring-2 ring-zinc-500/10' : 'border-input'}`}>
          {selected.map((item) => <span key={item} className="inline-flex max-w-full items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"><span className="max-w-[180px] truncate">{item}</span><button type="button" onClick={() => removeValue(item)} className="rounded-sm text-zinc-400 hover:text-zinc-900 dark:hover:text-white" aria-label={`${removeLabel}: ${item}`}><X className="h-3 w-3" /></button></span>)}
          <input value={customValue} onFocus={() => setOpen(true)} onChange={(event) => { setCustomValue(event.target.value); setOpen(true); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addValue(customValue); } }} placeholder={selected.length ? customPlaceholder : placeholder} className="min-w-[120px] flex-1 bg-transparent px-1 py-0.5 text-sm text-foreground outline-none placeholder:text-muted-foreground" aria-label={label} />
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setOpen((current) => !current)} className="shrink-0 rounded-sm p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-white" aria-label={`${addLabel}: ${label}`} aria-expanded={open} title={addLabel}><Plus className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-45' : ''}`} /></button>
        </div>
         {open && <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
           {filteredOptions.length > 0 ? filteredOptions.map((option) => <button key={option.value} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { addValue(option.value); setOpen(true); }} className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground">{option.label || option.value}</button>) : <p className="px-2 py-2 text-xs text-muted-foreground">{customValue.trim() ? customPlaceholder : noOptionsLabel}</p>}
        </div>}
      </div>
    </div>
  );
}

export function ResumeProfileCard({
  id,
  resumeId,
  profile,
  regions = [],
  confirmed,
  defaultEditing = false,
  highlighted = false,
  onUpdated,
}: ResumeProfileCardProps) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(defaultEditing);
  const [saving, setSaving] = useState(false);
  const [roles, setRoles] = useState('');
  const [industries, setIndustries] = useState('');
  const [targetCompanies, setTargetCompanies] = useState('');
  const [workAuthorization, setWorkAuthorization] = useState('');
  const [visaStatus, setVisaStatus] = useState('');
  const [visaByRegion, setVisaByRegion] = useState<Record<string, string>>({});
  const [sameVisaAcrossRegions, setSameVisaAcrossRegions] = useState(true);
  const [visaDates, setVisaDates] = useState<VisaDates>({});
  const [availableFrom, setAvailableFrom] = useState('');
  const [intentOptions, setIntentOptions] = useState<{
    roles: IntentOption[];
    companies: IntentOption[];
  }>({ roles: [], companies: [] });
  const [intentOptionsLoaded, setIntentOptionsLoaded] = useState(false);

  useEffect(() => {
    setRoles(joinList(profile.intention?.roles));
    setIndustries(joinList(profile.intention?.industries));
    setTargetCompanies(joinList(profile.intention?.targetCompanies));
    setWorkAuthorization(profile.intention?.workAuthorization || '');
    setVisaStatus(profile.intention?.visaStatus || '');
    setVisaByRegion(profile.intention?.visaByRegion || {});
    const byRegionValues = Object.values(profile.intention?.visaByRegion || {}).filter(Boolean);
    setSameVisaAcrossRegions(byRegionValues.length <= 1);
    setVisaDates(profile.intention?.visaDates || {});
    setAvailableFrom(profile.intention?.availableFrom || '');
  }, [profile, regions, t]);

  useEffect(() => {
    if (!editing || intentOptionsLoaded) return;
    let cancelled = false;
    const loadOptions = async () => {
      try {
        const [jobsResponse, companiesResponse, configsResponse] = await Promise.all([
          apiFetch('/api/jobs?summary=1&limit=100', { cache: 'no-store' }),
          apiFetch('/api/jobs/companies', { cache: 'no-store' }),
          apiFetch('/api/configs', { cache: 'no-store' }),
        ]);
        const [jobsData, companiesData, configsData] = await Promise.all([
          jobsResponse.ok ? jobsResponse.json() : { jobs: [] },
          companiesResponse.ok ? companiesResponse.json() : { companies: [] },
          configsResponse.ok ? configsResponse.json() : { configs: {} },
        ]);
        if (cancelled) return;
        const jobs = Array.isArray(jobsData.jobs) ? jobsData.jobs as Array<{ title?: string; direction?: string; region?: string }> : [];
        const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b));
        setIntentOptions({
          roles: unique([
            ...(configsData.configs?.direction || []).map((item: { config_value?: string }) => item.config_value || ''),
            ...jobs.flatMap((job) => [job.title || '', job.direction || '']),
          ]).map((value) => ({ value })),
          companies: unique([
            ...(companiesData.companies || []).map((item: { company_name?: string }) => item.company_name || ''),
          ]).map((value) => ({ value })),
        });
      } catch (error) {
        console.error('Failed to load resume intention options:', error);
      } finally {
        if (!cancelled) setIntentOptionsLoaded(true);
      }
    };
    void loadOptions();
    return () => { cancelled = true; };
  }, [editing, intentOptionsLoaded, regions, t]);

  const identityRegions = regions.filter(regionRequiresIdentity);
  const hasIdentityFields = identityRegions.length > 0;

  const updateRegionVisa = (region: RegionKey, value: string) => {
    setVisaByRegion((current) => {
      const next = { ...current };
      if (sameVisaAcrossRegions) {
        identityRegions.forEach((item) => {
          next[item] = value;
        });
        setVisaStatus(value);
      } else {
        next[region] = value;
      }
      return next;
    });
  };

  const applySameVisaAcrossRegions = (checked: boolean) => {
    setSameVisaAcrossRegions(checked);
    if (checked) {
      const firstValue = Object.values(visaByRegion).find(Boolean);
      setVisaByRegion((current) => {
        const next = { ...current };
        identityRegions.forEach((region) => {
          next[region] = firstValue || '';
        });
        if (firstValue) setVisaStatus(firstValue);
        return next;
      });
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const nextIntention = {
        roles: parseList(roles),
        industries: parseList(industries),
        targetCompanies: parseList(targetCompanies),
        workAuthorization: hasIdentityFields ? workAuthorization.trim() || undefined : undefined,
        visaStatus: hasIdentityFields ? visaStatus || undefined : undefined,
        visaByRegion: hasIdentityFields
          ? Object.fromEntries(Object.entries(visaByRegion).filter(([, value]) => Boolean(value)))
          : undefined,
        visaDates: {
          programEndDate: visaDates.programEndDate || undefined,
          visaStartDate: visaDates.visaStartDate || undefined,
          visaEndDate: visaDates.visaEndDate || undefined,
          stemEligible: visaDates.stemEligible || undefined,
        },
        availableFrom: availableFrom.trim() || undefined,
      };
      const response = await apiFetch(`/api/resume/${resumeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: { intention: nextIntention },
          confirm: true,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.profile) {
        throw new Error(data.error || t('resume.profileSaveFailed'));
      }
      onUpdated(
        data.profile as ResumeProfile,
        data.segmentation as UserSegmentation | undefined,
        {
          profileVersion: data.profile_version,
          confirmed: data.segmentation_confirmed,
          processingStatus: data.processing_status,
          processingStage: data.processing_stage,
          profileConfirmedAt: data.profile_confirmed_at,
        },
      );
      setEditing(false);
    } catch (error) {
      console.error('Profile update failed:', error);
      alert(error instanceof Error ? error.message : t('resume.profileSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section id={id} className={`rounded-xl border p-3 md:p-4 ${highlighted ? 'border-orange-600/80 bg-white ring-1 ring-orange-300/70 dark:border-orange-600 dark:bg-zinc-950 dark:ring-orange-800/60' : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{t('resume.profileTitle')}</h4>
            {confirmed && <Badge variant="secondary" className="text-[10px]">{t('resume.segConfirmed')}</Badge>}
            {highlighted && !editing && (
              <Badge className="text-[10px] bg-orange-200 text-orange-900 dark:bg-orange-800/60 dark:text-orange-100">
                {t('resume.profileEdit')}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('resume.profileEditHint')}</p>
        </div>
        {!editing && (
          <Button size="sm" className="h-8 bg-zinc-900 px-3 text-xs text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200" onClick={() => setEditing(true)}>
            <PencilLine className="mr-1 h-3 w-3" />
            {t('resume.profileEdit')}
          </Button>
        )}
      </div>

      {!editing ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(profile.intention?.roles || []).map((item) => <Badge key={`role-${item}`} variant="outline" className="text-xs">{item}</Badge>)}
          {(profile.intention?.targetCompanies || []).map((item) => <Badge key={`company-${item}`} variant="outline" className="text-xs">{item}</Badge>)}
          {(profile.intention?.industries || []).map((item) => <Badge key={`industry-${item}`} variant="outline" className="text-xs">{item}</Badge>)}
          {!profile.intention?.roles?.length && !profile.intention?.targetCompanies?.length && !profile.intention?.industries?.length && (
            <span className="text-xs text-zinc-400 dark:text-zinc-500">{t('resume.profileEditHint')}</span>
          )}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
           <IntentPicker label={t('resume.profileRoles')} value={roles} onChange={setRoles} options={intentOptions.roles} placeholder={t('resume.profileRolePlaceholder')} customPlaceholder={t('resume.profileCustomPlaceholder')} addLabel={t('resume.profileAdd')} noOptionsLabel={t('resume.profileNoOptions')} removeLabel={t('resume.profileRemove')} />
           <IntentPicker label={t('resume.profileTargetCompanies')} value={targetCompanies} onChange={setTargetCompanies} options={intentOptions.companies} placeholder={t('resume.profileCompanyPlaceholder')} customPlaceholder={t('resume.profileCustomPlaceholder')} addLabel={t('resume.profileAdd')} noOptionsLabel={t('resume.profileNoOptions')} removeLabel={t('resume.profileRemove')} />
          <label className="space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            <span>{t('resume.profileIndustries')}</span>
             <Input value={industries} onChange={(event) => setIndustries(event.target.value)} placeholder={t('resume.profileIndustryPlaceholder')} />
          </label>
          <div className="space-y-1.5 text-xs text-zinc-500 dark:text-zinc-400 md:col-span-2">
            <span className="block">{t('resume.profileLocations')}</span>
            <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-dashed border-zinc-200 bg-zinc-50/60 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900/50">
              {regions.length > 0 ? regions.map((region) => (
                <Badge key={region} variant="outline" className="text-xs">{t(`region.${region}`)}</Badge>
              )) : <span className="text-xs text-zinc-400">{t('resume.profileLocationPlaceholder')}</span>}
            </div>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{t('resume.profileRegionManagedHint')}</p>
          </div>
          <label className={`space-y-1 text-xs text-zinc-500 dark:text-zinc-400 ${hasIdentityFields ? '' : 'hidden'}`}>
            <span>{t('resume.profileWorkAuthorization')}</span>
             <Input value={workAuthorization} onChange={(event) => setWorkAuthorization(event.target.value)} placeholder={t('resume.profileWorkAuthorizationPlaceholder')} />
          </label>
          {hasIdentityFields && (
            <div className="space-y-2 md:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">{t('resume.profileVisaStatus')}</span>
                {identityRegions.length > 1 && (
                  <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <input
                      type="checkbox"
                      className="accent-zinc-900"
                      checked={sameVisaAcrossRegions}
                      onChange={(event) => applySameVisaAcrossRegions(event.target.checked)}
                    />
                    {t('resume.profileSameVisa')}
                  </label>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {identityRegions.map((region) => (
                  <div key={region} className="flex flex-col gap-1">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{t(`region.${region}`)}</span>
                    <Select
                      value={visaByRegion[region] || (sameVisaAcrossRegions ? visaStatus : undefined) || undefined}
                      onValueChange={(value) => updateRegionVisa(region, value)}
                    >
                      <SelectTrigger className="h-9 w-full text-sm">
                        <SelectValue placeholder={t('resume.profileVisaPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {VISA_STATUS_OPTIONS[region].map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {t(option.labelKey)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 md:col-span-2 md:grid-cols-3">
            <ProfileDateField
              label={t('resume.profileProgramEndDate')}
              value={visaDates.programEndDate || ''}
              onChange={(value) => setVisaDates({ ...visaDates, programEndDate: value })}
            />
            {hasIdentityFields && <>
              <ProfileDateField
                label={t('resume.profileVisaStartDate')}
                value={visaDates.visaStartDate || ''}
                onChange={(value) => setVisaDates({ ...visaDates, visaStartDate: value })}
              />
              <ProfileDateField
                label={t('resume.profileVisaEndDate')}
                value={visaDates.visaEndDate || ''}
                onChange={(value) => setVisaDates({ ...visaDates, visaEndDate: value })}
              />
            </>}
          </div>
          <label className={`flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 ${identityRegions.includes('us') ? '' : 'hidden'}`}>
            <input
              type="checkbox"
              className="accent-zinc-900"
              checked={Boolean(visaDates.stemEligible)}
              onChange={(event) => setVisaDates({ ...visaDates, stemEligible: event.target.checked })}
            />
            {t('resume.profileStemEligible')}
          </label>
          <div className="md:col-span-2">
            <ProfileDateField
              label={t('resume.profileAvailableFrom')}
              value={availableFrom}
              type="month"
              onChange={setAvailableFrom}
            />
          </div>
          <div className="flex gap-2 md:col-span-2">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
              {t('resume.profileSave')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>
              {t('resume.cancel')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

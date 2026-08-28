'use client';

import { useEffect, useState } from 'react';
import { PencilLine, Loader2, Save } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  const [locations, setLocations] = useState('');
  const [industries, setIndustries] = useState('');
  const [targetCompanies, setTargetCompanies] = useState('');
  const [workAuthorization, setWorkAuthorization] = useState('');
  const [visaStatus, setVisaStatus] = useState('');
  const [visaByRegion, setVisaByRegion] = useState<Record<string, string>>({});
  const [sameVisaAcrossRegions, setSameVisaAcrossRegions] = useState(true);
  const [visaDates, setVisaDates] = useState<VisaDates>({});
  const [availableFrom, setAvailableFrom] = useState('');

  useEffect(() => {
    setRoles(joinList(profile.intention?.roles));
    setLocations(joinList(profile.intention?.locations));
    setIndustries(joinList(profile.intention?.industries));
    setTargetCompanies(joinList(profile.intention?.targetCompanies));
    setWorkAuthorization(profile.intention?.workAuthorization || '');
    setVisaStatus(profile.intention?.visaStatus || '');
    setVisaByRegion(profile.intention?.visaByRegion || {});
    const byRegionValues = Object.values(profile.intention?.visaByRegion || {}).filter(Boolean);
    setSameVisaAcrossRegions(byRegionValues.length <= 1);
    setVisaDates(profile.intention?.visaDates || {});
    setAvailableFrom(profile.intention?.availableFrom || '');
  }, [profile]);

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
        locations: parseList(locations),
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
            <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{t('resume.segTitle')}</h4>
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
          {(profile.intention?.locations || []).map((item) => <Badge key={`location-${item}`} variant="outline" className="text-xs">{item}</Badge>)}
          {(profile.intention?.industries || []).map((item) => <Badge key={`industry-${item}`} variant="outline" className="text-xs">{item}</Badge>)}
          {!profile.intention?.roles?.length && !profile.intention?.locations?.length && !profile.intention?.industries?.length && (
            <span className="text-xs text-zinc-400 dark:text-zinc-500">{t('resume.profileEditHint')}</span>
          )}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            <span>{t('resume.profileRoles')}</span>
            <Input value={roles} onChange={(event) => setRoles(event.target.value)} placeholder="Product Manager、Data Analyst" />
          </label>
          <label className="space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            <span>{t('resume.profileLocations')}</span>
            <Input value={locations} onChange={(event) => setLocations(event.target.value)} placeholder="Singapore、London" />
          </label>
          <label className="space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            <span>{t('resume.profileIndustries')}</span>
            <Input value={industries} onChange={(event) => setIndustries(event.target.value)} placeholder="Fintech、Internet" />
          </label>
          <label className="space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            <span>{t('resume.profileTargetCompanies')}</span>
            <Input value={targetCompanies} onChange={(event) => setTargetCompanies(event.target.value)} placeholder="Microsoft, LinkedIn" />
          </label>
          <label className={`space-y-1 text-xs text-zinc-500 dark:text-zinc-400 ${hasIdentityFields ? '' : 'hidden'}`}>
            <span>{t('resume.profileWorkAuthorization')}</span>
            <Input value={workAuthorization} onChange={(event) => setWorkAuthorization(event.target.value)} placeholder="可工作签证 / 需要雇主担保" />
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
                      <SelectTrigger className="h-9 text-sm">
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
          <label className={`space-y-1 text-xs text-zinc-500 dark:text-zinc-400 ${hasIdentityFields ? '' : 'hidden'}`}>
            <span>{t('resume.profileProgramEndDate')}</span>
            <Input
              type="date"
              value={visaDates.programEndDate || ''}
              onChange={(event) => setVisaDates({ ...visaDates, programEndDate: event.target.value })}
            />
          </label>
          <label className={`space-y-1 text-xs text-zinc-500 dark:text-zinc-400 ${hasIdentityFields ? '' : 'hidden'}`}>
            <span>{t('resume.profileVisaStartDate')}</span>
            <Input
              type="date"
              value={visaDates.visaStartDate || ''}
              onChange={(event) => setVisaDates({ ...visaDates, visaStartDate: event.target.value })}
            />
          </label>
          <label className={`space-y-1 text-xs text-zinc-500 dark:text-zinc-400 ${hasIdentityFields ? '' : 'hidden'}`}>
            <span>{t('resume.profileVisaEndDate')}</span>
            <Input
              type="date"
              value={visaDates.visaEndDate || ''}
              onChange={(event) => setVisaDates({ ...visaDates, visaEndDate: event.target.value })}
            />
          </label>
          <label className={`flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 ${identityRegions.includes('us') ? '' : 'hidden'}`}>
            <input
              type="checkbox"
              className="accent-zinc-900"
              checked={Boolean(visaDates.stemEligible)}
              onChange={(event) => setVisaDates({ ...visaDates, stemEligible: event.target.checked })}
            />
            {t('resume.profileStemEligible')}
          </label>
          <label className="space-y-1 text-xs text-zinc-500 dark:text-zinc-400 md:col-span-2">
            <span>{t('resume.profileAvailableFrom')}</span>
            <Input value={availableFrom} onChange={(event) => setAvailableFrom(event.target.value)} placeholder="2026-07" />
          </label>
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

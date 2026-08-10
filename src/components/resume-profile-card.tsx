'use client';

import { useEffect, useState } from 'react';
import { PencilLine, Loader2, Save } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api-client';
import type {
  ResumeProfile,
  ResumeProfileUpdateMetadata,
  UserSegmentation,
} from '@/lib/resume-types';
import { useLanguage } from '@/lib/language-context';

interface ResumeProfileCardProps {
  resumeId: number;
  profile: ResumeProfile;
  confirmed?: boolean;
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

export function ResumeProfileCard({ resumeId, profile, confirmed, onUpdated }: ResumeProfileCardProps) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [roles, setRoles] = useState('');
  const [locations, setLocations] = useState('');
  const [industries, setIndustries] = useState('');
  const [workAuthorization, setWorkAuthorization] = useState('');
  const [availableFrom, setAvailableFrom] = useState('');

  useEffect(() => {
    setRoles(joinList(profile.intention?.roles));
    setLocations(joinList(profile.intention?.locations));
    setIndustries(joinList(profile.intention?.industries));
    setWorkAuthorization(profile.intention?.workAuthorization || '');
    setAvailableFrom(profile.intention?.availableFrom || '');
  }, [profile]);

  const save = async () => {
    setSaving(true);
    try {
      const nextIntention = {
        roles: parseList(roles),
        locations: parseList(locations),
        industries: parseList(industries),
        workAuthorization: workAuthorization.trim() || undefined,
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
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3 md:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{t('resume.segTitle')}</h4>
            {confirmed && <Badge variant="secondary" className="text-[10px]">{t('resume.segConfirmed')}</Badge>}
          </div>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('resume.profileEditHint')}</p>
        </div>
        {!editing && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setEditing(true)}>
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
            <span>{t('resume.profileWorkAuthorization')}</span>
            <Input value={workAuthorization} onChange={(event) => setWorkAuthorization(event.target.value)} placeholder="可工作签证 / 需要雇主担保" />
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

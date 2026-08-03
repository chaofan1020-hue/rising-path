'use client';

// 分层确认卡片：简历解析后展示求职画像与分层结果，支持手动修正
// 分层三维度：求职阶段 × 院校背景 × 专业匹配度；地区为第一权重
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  GraduationCap,
  MapPin,
  Briefcase,
  Wrench,
  PencilLine,
  Loader2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useLanguage } from '@/lib/language-context';

export type CareerStage = 'junior' | 'senior' | 'experienced' | 'returning_intern';
export type RegionKey = 'us' | 'uk' | 'sg' | 'cn_t1' | 'cn_t2';
export type MajorMatch = 'aligned' | 'related' | 'unrelated';

export interface Segmentation {
  careerStage: CareerStage;
  careerStageReason: string;
  schoolTier: 1 | 2 | 3;
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

interface SegmentationCardProps {
  resumeId: number;
  segmentation: Segmentation;
  confirmed?: boolean;
  skills?: string[];
  schoolLine?: string;  // 如 "墨尔本大学 · 数据分析硕士"
  onUpdated: (seg: Segmentation) => void;
}

const STAGE_KEYS: CareerStage[] = ['junior', 'senior', 'experienced', 'returning_intern'];
const REGION_KEYS: RegionKey[] = ['us', 'uk', 'sg', 'cn_t1', 'cn_t2'];
const MATCH_KEYS: MajorMatch[] = ['aligned', 'related', 'unrelated'];

export function SegmentationCard({
  resumeId,
  segmentation,
  confirmed,
  skills,
  schoolLine,
  onUpdated,
}: SegmentationCardProps) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<{
    careerStage: CareerStage;
    schoolTier: string;
    majorMatch?: MajorMatch;
    regions: RegionKey[];
  }>({
    careerStage: segmentation.careerStage,
    schoolTier: String(segmentation.schoolTier),
    majorMatch: segmentation.majorMatch,
    regions: segmentation.regions,
  });

  const stageLabel = (s: CareerStage) => t(`resume.segStage_${s}`);
  const regionLabel = (r: RegionKey) => t(`resume.segRegion_${r}`);
  const matchLabel = (m: MajorMatch) => t(`resume.segMatch_${m}`);

  const save = async () => {
    setSaving(true);
    try {
      // 从 localStorage 读取 accessCodeId（与 access-guard 一致的存储 key）
      let accessCodeId: number | null = null;
      if (typeof window !== 'undefined') {
        const idRaw = localStorage.getItem('access_code_id');
        if (idRaw) accessCodeId = Number(idRaw);
        if (!accessCodeId) {
          const codeRaw = localStorage.getItem('access_code');
          if (codeRaw) {
            try { accessCodeId = JSON.parse(codeRaw).id ?? null; } catch { /* ignore */ }
          }
        }
      }
      const res = await fetch(`/api/resume/${resumeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessCodeId,
          overrides: {
            careerStage: draft.careerStage,
            schoolTier: Number(draft.schoolTier) as 1 | 2 | 3,
            majorMatch: draft.majorMatch,
            regions: draft.regions,
          },
        }),
      });
      const data = await res.json();
      if (res.ok && data.segmentation) {
        onUpdated(data.segmentation);
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleRegion = (r: RegionKey) => {
    setDraft((d) => ({
      ...d,
      regions: d.regions.includes(r) ? d.regions.filter((x) => x !== r) : [...d.regions, r],
    }));
  };

  return (
    <div className="rounded-xl border border-terracotta-200/60 dark:border-terracotta-800/40 bg-gradient-to-br from-beige-50 to-terracotta-50/40 dark:from-zinc-900 dark:to-zinc-900/60 p-3 md:p-4">
      {/* 标题行 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <GraduationCap className="h-4 w-4 text-terracotta-600 flex-shrink-0" />
          <span className="text-sm font-semibold truncate">{t('resume.segTitle')}</span>
          {confirmed && (
            <Badge variant="secondary" className="text-[10px] bg-sage-100 text-sage-700 dark:bg-sage-900 dark:text-sage-300">
              <CheckCircle2 className="h-3 w-3 mr-0.5" />
              {t('resume.segConfirmed')}
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-terracotta-700 dark:text-terracotta-300"
          onClick={() => setEditing((e) => !e)}
        >
          <PencilLine className="h-3 w-3 mr-1" />
          {t('resume.segEdit')}
          {editing ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />}
        </Button>
      </div>

      {/* 画像摘要 */}
      <div className="mt-2.5 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1.5 text-xs md:text-[13px] text-zinc-700 dark:text-zinc-300">
        <div className="flex items-center gap-1.5 min-w-0">
          <Briefcase className="h-3.5 w-3.5 text-sage-600 flex-shrink-0" />
          <span className="text-muted-foreground">{t('resume.segStage')}:</span>
          <span className="font-medium truncate">{stageLabel(segmentation.careerStage)}</span>
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <MapPin className="h-3.5 w-3.5 text-sage-600 flex-shrink-0" />
          <span className="text-muted-foreground">{t('resume.segRegion')}:</span>
          <span className="font-medium truncate">{segmentation.regions.map(regionLabel).join(' / ')}</span>
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <GraduationCap className="h-3.5 w-3.5 text-sage-600 flex-shrink-0" />
          <span className="text-muted-foreground">{t('resume.segSchool')}:</span>
          <span className="font-medium truncate">
            {segmentation.qsBand ? `${segmentation.qsBand} · ` : ''}Tier {segmentation.schoolTier}
            {segmentation.majorMatch ? ` · ${matchLabel(segmentation.majorMatch)}` : ''}
          </span>
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <Wrench className="h-3.5 w-3.5 text-sage-600 flex-shrink-0" />
          <span className="text-muted-foreground">{t('resume.segExp')}:</span>
          <span className="font-medium truncate">
            {t('resume.segExpValue')
              .replace('{n}', String(segmentation.experienceQuality.internshipCount))
              .replace('{big}', String(segmentation.experienceQuality.bigNameCount))
              .replace('{m}', String(segmentation.experienceQuality.totalMonths))}
          </span>
        </div>
      </div>
      {schoolLine && (
        <p className="mt-1 text-[11px] text-muted-foreground truncate">{schoolLine}</p>
      )}
      {skills && skills.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {skills.slice(0, 8).map((s) => (
            <Badge key={s} variant="outline" className="text-[10px] py-0">{s}</Badge>
          ))}
        </div>
      )}

      {/* 分层结论 */}
      <div className="mt-2.5 rounded-lg bg-terracotta-100/60 dark:bg-terracotta-900/20 px-2.5 py-1.5">
        <span className="text-[11px] text-terracotta-700 dark:text-terracotta-300 font-medium">
          {t('resume.segResult')}：{segmentation.summary}
        </span>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">{t('resume.segReason')}：{segmentation.careerStageReason}</p>

      {/* 修正区 */}
      {editing && (
        <div className="mt-3 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-3 space-y-2.5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div>
              <label className="text-[11px] text-muted-foreground">{t('resume.segStage')}</label>
              <Select value={draft.careerStage} onValueChange={(v) => setDraft((d) => ({ ...d, careerStage: v as CareerStage }))}>
                <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STAGE_KEYS.map((s) => (
                    <SelectItem key={s} value={s} className="text-xs">{stageLabel(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">{t('resume.segTier')}</label>
              <Select value={draft.schoolTier} onValueChange={(v) => setDraft((d) => ({ ...d, schoolTier: v }))}>
                <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3].map((n) => (
                    <SelectItem key={n} value={String(n)} className="text-xs">Tier {n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">{t('resume.segMajor')}</label>
              <Select
                value={draft.majorMatch || 'none'}
                onValueChange={(v) => setDraft((d) => ({ ...d, majorMatch: v === 'none' ? undefined : (v as MajorMatch) }))}
              >
                <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs">—</SelectItem>
                  {MATCH_KEYS.map((m) => (
                    <SelectItem key={m} value={m} className="text-xs">{matchLabel(m)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">{t('resume.segRegion')}（{t('resume.segRegionMulti')}）</label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {REGION_KEYS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => toggleRegion(r)}
                  className={`px-2 py-1 rounded-md text-[11px] border transition-colors ${
                    draft.regions.includes(r)
                      ? 'bg-terracotta-600 text-white border-terracotta-600'
                      : 'bg-transparent border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:border-terracotta-400'
                  }`}
                >
                  {regionLabel(r)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end">
            <Button size="sm" className="h-7 text-xs" onClick={save} disabled={saving || draft.regions.length === 0}>
              {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
              {saving ? t('resume.segUpdating') : t('resume.segConfirm')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

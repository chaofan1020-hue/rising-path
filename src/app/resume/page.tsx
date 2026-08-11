'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Upload,
  FileText,
  Trash2,
  Loader2,
  User,
  Calendar,
  Languages,
  Sparkles,
  Map,
} from 'lucide-react';
import Link from 'next/link';
import { AuthGuard } from '@/components/auth-guard';
import { apiFetch } from '@/lib/api-client';
import { Header1 } from '@/components/header1';
import { SegmentationCard } from '@/components/segmentation-card';
import { ResumeProfileCard } from '@/components/resume-profile-card';
import type {
  ResumeProfile,
  ResumeProcessingStage,
  ResumeProcessingStatus,
  ResumeProfileConfidence,
  ResumeProfileEvidence,
  ResumeProfileUpdateMetadata,
  UserSegmentation,
} from '@/lib/resume-types';
import { Target, Wand2, Send, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';
import PageBackButton from '@/components/page-back-button';

interface ParsedFields {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  education?: Array<{
    school: string;
    degree: string;
    major: string;
    duration?: string;
    gpa?: string;
  }>;
  experience?: Array<{
    company: string;
    title: string;
    duration?: string;
    highlights?: string[];
  }>;
  skills?: {
    technical?: string[];
    languages?: string[];
    tools?: string[];
  };
  summary?: string;
}

interface Resume {
  id: number;
  file_key: string;
  file_name: string;
  parsed_content: string;
  parsed_fields?: ParsedFields;
  segmentation?: UserSegmentation | null;
  segmentation_confirmed?: boolean;
  profile?: ResumeProfile | null;
  processing_status?: ResumeProcessingStatus;
  processing_stage?: ResumeProcessingStage;
  processing_error?: string | null;
  processing_attempts?: number;
  profile_version?: number;
  profile_confirmed_at?: string | null;
  profile_evidence?: ResumeProfileEvidence;
  profile_confidence?: ResumeProfileConfidence;
  user_info: {
    name?: string;
    email?: string;
    phone?: string;
    education?: string[];
    experience?: string[];
    skills?: string[];
  };
  created_at: string;
}

const ACTIVE_PROCESSING_STATUSES: ResumeProcessingStatus[] = [
  'uploaded',
  'extracting_text',
  'extracting_profile',
  'deriving_segmentation',
];

function isProcessing(resume: Resume): boolean {
  return !!resume.processing_status && ACTIVE_PROCESSING_STATUSES.includes(resume.processing_status);
}

// 内部组件
function ResumeContent() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [translatingId, setTranslatingId] = useState<number | null>(null);
  const [reparsingId, setReparsingId] = useState<number | null>(null);
  const { t } = useLanguage();

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  }, []);

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await apiFetch('/api/resume', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      
      if (response.ok && data.resume) {
        setResumes((prev) => [data.resume as Resume, ...prev]);
        setSelectedFile(null);
      } else if (data.error) {
        alert(t('resume.uploadFailed') + ': ' + data.error);
      }
    } catch (error) {
      console.error('Upload failed:', error);
      alert(t('resume.uploadFailedRetry'));
    } finally {
      setUploading(false);
    }
  };

  const fetchingResumesRef = useRef(false);

  const fetchResumes = useCallback(async (options: { showLoading?: boolean } = {}) => {
    if (fetchingResumesRef.current) return;
    fetchingResumesRef.current = true;
    if (options.showLoading) setLoading(true);
    try {
      const response = await apiFetch('/api/resume');
      const data = await response.json();
      setResumes(data.resumes || []);
    } catch (error) {
      console.error('Failed to fetch resumes:', error);
    } finally {
      fetchingResumesRef.current = false;
      if (options.showLoading) setLoading(false);
    }
  }, []);

  const reparseResume = async (resume: Resume) => {
    setReparsingId(resume.id);
    try {
      const response = await apiFetch('/api/resume/reparse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeId: resume.id }),
      });
      const data = await response.json();
      if (response.ok && data.resume) {
        setResumes((prev) => prev.map((item) => item.id === resume.id ? data.resume as Resume : item));
      } else {
        alert(t('resume.uploadFailed') + ': ' + (data.error || t('resume.uploadFailedRetry')));
      }
    } catch (error) {
      console.error('Re-parse failed:', error);
      alert(t('resume.uploadFailedRetry'));
    } finally {
      setReparsingId(null);
    }
  };

  const deleteResume = async (id: number) => {
    if (!confirm(t('resume.deleteConfirm'))) {
      return;
    }
    
    try {
      const response = await apiFetch(`/api/resume/${id}`, { method: 'DELETE' });
      const data = await response.json();
      
      if (response.ok && data.success) {
        setResumes(resumes.filter((r) => r.id !== id));
      } else {
        alert(t('resume.deleteFailed') + ': ' + (data.error || ''));
      }
    } catch (error) {
      console.error('Failed to delete resume:', error);
      alert(t('resume.deleteFailedRetry'));
    }
  };

  const translateResume = async (resume: Resume) => {
    setTranslatingId(resume.id);
    try {
      const response = await apiFetch('/api/ai/translate-resume-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resumeId: resume.id,
          content: resume.parsed_content,
          userInfo: resume.user_info,
        }),
      });

      const data = await response.json();
      if (data.resume) {
        setResumes(resumes.map(r => 
          r.id === resume.id ? { ...r, ...data.resume } : r
        ));
      }
    } catch (error) {
      console.error('Translation failed:', error);
    } finally {
      setTranslatingId(null);
    }
  };

  useEffect(() => {
    void fetchResumes({ showLoading: true });
  }, [fetchResumes]);

  const processingResumeIds = resumes
    .filter(isProcessing)
    .map((resume) => resume.id)
    .join(',');

  useEffect(() => {
    if (!processingResumeIds) return;
    const interval = window.setInterval(() => {
      void fetchResumes();
    }, 2000);
    return () => window.clearInterval(interval);
  }, [fetchResumes, processingResumeIds]);

  const hasConfirmedResume = resumes.some((resume) =>
    resume.segmentation_confirmed === true && resume.processing_status === 'ready',
  );

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <Header1 />
      <main className="relative container mx-auto px-4 pt-16 md:pt-20 pb-16">
        {/* Hero：左对齐 eyebrow + 大标题（Tailark 式） */}
        <div className="relative mb-8 md:mb-10">
          <p className="text-sm font-medium text-zinc-400 dark:text-zinc-500 mb-3">{t('resume.eyebrow')}</p>
          <PageBackButton fallbackHref="/" className="mb-3" />
          <h1 className="text-2xl md:text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 mb-4">{t('resume.title')}</h1>
          <p className="text-zinc-500 dark:text-zinc-400 max-w-2xl md:text-lg leading-relaxed">{t('resume.subtitle')}</p>
        </div>

        {/* 上传 Dropzone */}
        <div className="relative mb-8 md:mb-10 max-w-2xl mx-auto">
          <label
            className={`block rounded-2xl border-2 border-dashed border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/60 backdrop-blur-sm transition-colors cursor-pointer hover:border-zinc-400 dark:hover:border-zinc-600 ${uploading ? 'pointer-events-none opacity-60' : ''}`}
          >
            <input
              type="file"
              accept=".pdf,.doc,.docx,.txt"
              onChange={handleFileSelect}
              disabled={uploading}
              className="hidden"
            />
            <div className="flex flex-col items-center gap-3 py-9 md:py-12 px-4">
              <div className="w-12 h-12 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                <Upload className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
              </div>
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{t('resume.upload.title')}</p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center">{t('resume.upload.hint')}</p>
            </div>
          </label>

          {selectedFile && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-300 max-w-[220px]">
                <FileText className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{selectedFile.name}</span>
              </span>
              <Button
                onClick={handleUpload}
                disabled={uploading}
                size="sm"
                className="h-8 bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {uploading ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    {t('resume.upload.uploading')}
                  </>
                ) : (
                  <>
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                    {t('resume.upload.button')}
                  </>
                )}
              </Button>
            </div>
          )}

        </div>

        {/* 状态引导区域 */}
        {resumes.length > 0 ? (
          <div className="relative mb-8 md:mb-10 max-w-2xl mx-auto rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 px-4 md:px-5 py-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="h-5 w-5 text-zinc-700 dark:text-zinc-300" />
                </div>
                <div>
                  <p className="font-medium text-sm text-zinc-800 dark:text-zinc-100">
                    {hasConfirmedResume ? t('resume.uploaded') : t('resume.parsing')} {resumes.length} {t('resume.resumesUnit')}
                  </p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">
                    {hasConfirmedResume ? t('resume.nextStep') : t('resume.upload.parsing')}
                  </p>
                </div>
              </div>
              {hasConfirmedResume && <div className="flex items-center gap-2">
                <Link href="/ai-match">
                  <Button size="sm" className="gap-1.5 bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">
                    <Target className="h-3.5 w-3.5" />
                    {t('resume.aiMatch')}
                  </Button>
                </Link>
                <Link href="/optimize">
                  <Button variant="outline" size="sm" className="gap-1.5 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                    <Wand2 className="h-3.5 w-3.5" />
                    {t('resume.optimize')}
                  </Button>
                </Link>
              </div>}
            </div>
          </div>
        ) : (
          <div className="relative mb-8 md:mb-10 max-w-2xl mx-auto rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 px-4 py-6">
            <p className="text-sm text-zinc-400 dark:text-zinc-500 text-center mb-4">{t('resume.noResume')}</p>
            <div className="grid grid-cols-3 gap-2 max-w-md mx-auto text-xs">
              <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900/60 text-zinc-600 dark:text-zinc-300">
                <Target className="h-4 w-4" />
                <span>{t('resume.feature.aiMatch')}</span>
              </div>
              <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900/60 text-zinc-600 dark:text-zinc-300">
                <Wand2 className="h-4 w-4" />
                <span>{t('resume.feature.optimize')}</span>
              </div>
              <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900/60 text-zinc-600 dark:text-zinc-300">
                <Send className="h-4 w-4" />
                <span>{t('resume.feature.autoApply')}</span>
              </div>
            </div>
          </div>
        )}

        {/* Resume List */}
        <div className="relative space-y-3 max-w-3xl mx-auto">
          <div className="flex items-center justify-between">
            <h2 className="text-base md:text-lg font-semibold tracking-tight text-zinc-800 dark:text-zinc-100">{t('resume.myResumes')}</h2>
            <Button variant="ghost" size="sm" className="text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100" onClick={() => void fetchResumes({ showLoading: true })}>
              {t('resume.refresh')}
            </Button>
          </div>
          {loading ? (
            <div className="text-center py-16 text-zinc-400">
              <Loader2 className="h-7 w-7 animate-spin mx-auto mb-3" />
              <p className="text-sm">{t('resume.loading')}</p>
            </div>
          ) : resumes.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 py-16 text-center text-zinc-400">
              <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">{t('resume.noResumes')}</p>
            </div>
          ) : (
            resumes.map((resume) => (
              <Card key={resume.id} className="border-zinc-200 dark:border-zinc-800 shadow-none hover:shadow-xl hover:shadow-zinc-900/[0.06] dark:hover:shadow-black/30 transition-shadow duration-300 rounded-2xl">
                <CardContent className="p-4 md:p-5">
                  <div className="flex flex-col gap-3 md:gap-4">
                    {/* 文件信息 */}
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 md:w-10 md:h-10 rounded-lg bg-zinc-900 dark:bg-white flex items-center justify-center flex-shrink-0 shadow-lg shadow-zinc-900/15 dark:shadow-black/30">
                        <FileText className="h-4 w-4 md:h-5 md:w-5 text-white dark:text-zinc-900" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm tracking-tight truncate text-zinc-900 dark:text-zinc-50">{resume.file_name}</h3>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          <Badge variant="secondary" className="text-xs bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 hover:bg-zinc-100">
                            <Calendar className="h-3 w-3 mr-1" />
                            {new Date(resume.created_at).toLocaleDateString()}
                          </Badge>
                          {resume.user_info?.name ? (
                            <Badge variant="outline" className="text-xs border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300">
                              <User className="h-3 w-3 mr-1" />
                              {resume.user_info.name}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs border-zinc-200 dark:border-zinc-700 text-zinc-400">
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              {t('resume.parsing')}
                            </Badge>
                          )}
                          {resume.processing_status === 'needs_confirmation' && (
                            <Badge variant="outline" className="text-xs border-amber-200 text-amber-700 dark:border-amber-800 dark:text-amber-300">
                              {t('resume.nextStep')}
                            </Badge>
                          )}
                          {resume.processing_status === 'failed' && (
                            <Badge variant="outline" className="text-xs border-red-200 text-red-700 dark:border-red-800 dark:text-red-300">
                              {t('resume.uploadFailed')}
                            </Badge>
                          )}
                        </div>
                        {resume.processing_status === 'failed' && resume.processing_error && (
                          <p className="text-xs text-red-600 dark:text-red-400 mt-1.5">{resume.processing_error}</p>
                        )}
                        {resume.parsed_content && !resume.parsed_content.includes('正在解析') && (
                          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1.5 line-clamp-2 hidden md:block">
                            {resume.parsed_content.substring(0, 140)}...
                          </p>
                        )}
                      </div>
                    </div>

                    {/* 分层确认卡片：求职画像透明展示 + 可修正 */}
                    {resume.profile && (
                      <ResumeProfileCard
                        resumeId={resume.id}
                        profile={resume.profile}
                        confirmed={resume.segmentation_confirmed}
                        onUpdated={(profile, segmentation, metadata: ResumeProfileUpdateMetadata = {}) => setResumes((prev) => prev.map((item) => item.id === resume.id ? {
                          ...item,
                          profile,
                          segmentation: segmentation || item.segmentation,
                          processing_status: metadata.processingStatus || 'ready',
                          processing_stage: metadata.processingStage || 'complete',
                          profile_version: metadata.profileVersion || item.profile_version,
                          profile_confirmed_at: metadata.profileConfirmedAt ?? item.profile_confirmed_at,
                          segmentation_confirmed: metadata.confirmed ?? true,
                        } : item))}
                      />
                    )}
                    {resume.segmentation && (
                      <SegmentationCard
                        resumeId={resume.id}
                        segmentation={resume.segmentation}
                        confirmed={resume.segmentation_confirmed}
                        skills={resume.profile?.skills}
                        schoolLine={resume.profile?.education?.[0]
                          ? `${resume.profile.education[0].school}${resume.profile.education[0].major ? ` · ${resume.profile.education[0].major}` : ''}${resume.profile.education[0].degree ? ` · ${resume.profile.education[0].degree}` : ''}`
                          : undefined}
                        onUpdated={(seg, metadata: ResumeProfileUpdateMetadata = {}) =>
                          setResumes((prev) => prev.map((r) => r.id === resume.id ? {
                            ...r,
                            segmentation: seg,
                            segmentation_confirmed: metadata.confirmed ?? true,
                            processing_status: metadata.processingStatus || 'ready',
                            processing_stage: metadata.processingStage || 'complete',
                            profile_version: metadata.profileVersion || r.profile_version,
                            profile_confirmed_at: metadata.profileConfirmedAt ?? r.profile_confirmed_at,
                          } : r))
                        }
                      />
                    )}
                    
                    {/* 操作按钮 - 手机端换行显示 */}
                    <div className="flex flex-wrap gap-2 pl-0 md:pl-[48px]">
                      {resume.processing_status === 'failed' && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs h-7 px-2.5 border-red-200 text-red-700 dark:border-red-800 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/30"
                          onClick={() => reparseResume(resume)}
                          disabled={reparsingId === resume.id}
                        >
                          {reparsingId === resume.id && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                          {t('resume.uploadFailedRetry')}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-7 px-2.5 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                        onClick={() => translateResume(resume)}
                        disabled={translatingId === resume.id}
                      >
                        {translatingId === resume.id ? (
                          <>
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            {t('resume.translating')}
                          </>
                        ) : (
                          <>
                            <Languages className="h-3 w-3 mr-1" />
                            {t('resume.translate')}
                          </>
                        )}
                      </Button>
                      <Link href="/field-mappings" className="hidden sm:block">
                        <Button variant="outline" size="sm" className="text-xs h-7 px-2.5 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                          <Map className="h-3 w-3 mr-1" />
                          {t('resume.fieldMapping')}
                        </Button>
                      </Link>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-7 px-2.5 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                          >
                            {t('resume.viewDetail')}
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl max-h-[85vh] md:max-h-[80vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle className="text-base md:text-lg truncate pr-6">{resume.file_name}</DialogTitle>
                            <DialogDescription className="text-xs md:text-sm">
                              {t('resume.parseResult')}
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4">
                            {/* 结构化字段 (AI提取) */}
                            {resume.parsed_fields && (
                              <div className="bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-100 dark:border-zinc-800 p-3 md:p-4 rounded-xl">
                                <div className="flex items-center gap-2 mb-3">
                                  <div className="w-7 h-7 rounded-lg bg-zinc-900 dark:bg-white flex items-center justify-center">
                                    <Sparkles className="h-3.5 w-3.5 text-white dark:text-zinc-900" />
                                  </div>
                                  <h4 className="font-semibold text-sm md:text-base text-zinc-900 dark:text-zinc-50">{t('resume.structuredFields')}</h4>
                                  <Badge variant="secondary" className="text-xs bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{t('resume.aiExtracted')}</Badge>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                                  {resume.parsed_fields.name && (
                                    <div>
                                      <span className="text-zinc-400 dark:text-zinc-500">{t('resume.name')}:</span>
                                      <p className="font-medium text-zinc-800 dark:text-zinc-100">{resume.parsed_fields.name}</p>
                                    </div>
                                  )}
                                  {resume.parsed_fields.email && (
                                    <div>
                                      <span className="text-zinc-400 dark:text-zinc-500">{t('resume.email')}:</span>
                                      <p className="font-medium break-all text-zinc-800 dark:text-zinc-100">{resume.parsed_fields.email}</p>
                                    </div>
                                  )}
                                  {resume.parsed_fields.phone && (
                                    <div>
                                      <span className="text-zinc-400 dark:text-zinc-500">{t('resume.phone')}:</span>
                                      <p className="font-medium text-zinc-800 dark:text-zinc-100">{resume.parsed_fields.phone}</p>
                                    </div>
                                  )}
                                  {resume.parsed_fields.location && (
                                    <div>
                                      <span className="text-zinc-400 dark:text-zinc-500">{t('resume.location')}:</span>
                                      <p className="font-medium text-zinc-800 dark:text-zinc-100">{resume.parsed_fields.location}</p>
                                    </div>
                                  )}
                                </div>

                                {resume.parsed_fields.education && resume.parsed_fields.education.length > 0 && (
                                  <div className="mt-3">
                                    <span className="text-sm text-zinc-400 dark:text-zinc-500">{t('resume.education')}:</span>
                                    <ul className="mt-1 space-y-1">
                                      {resume.parsed_fields.education.map((edu, i) => (
                                        <li key={i} className="text-sm text-zinc-800 dark:text-zinc-100">
                                          <strong>{edu.school}</strong> - {edu.degree} {edu.major}
                                          {edu.duration && <span className="text-zinc-400 dark:text-zinc-500"> ({edu.duration})</span>}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}

                                {resume.parsed_fields.experience && resume.parsed_fields.experience.length > 0 && (
                                  <div className="mt-3">
                                    <span className="text-sm text-zinc-400 dark:text-zinc-500">{t('resume.experience')}:</span>
                                    <ul className="mt-1 space-y-2">
                                      {resume.parsed_fields.experience.map((exp, i) => (
                                        <li key={i} className="text-sm text-zinc-800 dark:text-zinc-100">
                                          <strong>{exp.company}</strong> - {exp.title}
                                          {exp.duration && <span className="text-zinc-400 dark:text-zinc-500"> ({exp.duration})</span>}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}

                                {resume.parsed_fields.skills && (
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {resume.parsed_fields.skills.technical?.map((skill, i) => (
                                      <Badge key={`tech-${i}`} variant="secondary" className="bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{skill}</Badge>
                                    ))}
                                    {resume.parsed_fields.skills.languages?.map((skill, i) => (
                                      <Badge key={`lang-${i}`} variant="outline" className="border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300">{skill}</Badge>
                                    ))}
                                  </div>
                                )}

                                <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                                  <Link href="/field-mappings">
                                    <Button variant="outline" size="sm" className="w-full border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                                      <Map className="h-4 w-4 mr-2" />
                                      {t('resume.configureMapping')}
                                    </Button>
                                  </Link>
                                </div>
                              </div>
                            )}

                            {resume.profile && (
                              <div className="bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-100 dark:border-zinc-800 p-3 md:p-4 rounded-xl space-y-4">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <div className="w-7 h-7 rounded-lg bg-zinc-900 dark:bg-white flex items-center justify-center">
                                      <User className="h-3.5 w-3.5 text-white dark:text-zinc-900" />
                                    </div>
                                    <h4 className="font-semibold text-sm md:text-base text-zinc-900 dark:text-zinc-50">{t('resume.segTitle')}</h4>
                                  </div>
                                  {resume.profile_version ? (
                                    <Badge variant="outline" className="text-[10px] border-zinc-200 dark:border-zinc-700">
                                      v{resume.profile_version}
                                    </Badge>
                                  ) : null}
                                </div>

                                {resume.profile.education.length > 0 && (
                                  <div>
                                    <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-1">{t('resume.education')}</p>
                                    <div className="space-y-1">
                                      {resume.profile.education.map((education, index) => (
                                        <p key={`${education.school}-${index}`} className="text-sm text-zinc-800 dark:text-zinc-100">
                                          <strong>{education.school}</strong>
                                          {[education.degree, education.major, education.endYear ? String(education.endYear) : undefined]
                                            .filter(Boolean)
                                            .join(' · ')}
                                        </p>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {(resume.profile.internships.length > 0 || resume.profile.workExperience.length > 0) && (
                                  <div>
                                    <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-1">{t('resume.experience')}</p>
                                    <div className="space-y-1">
                                      {[...resume.profile.internships, ...resume.profile.workExperience].map((experience, index) => (
                                        <p key={`${experience.company}-${experience.role}-${index}`} className="text-sm text-zinc-800 dark:text-zinc-100">
                                          <strong>{experience.company}</strong> · {experience.role}
                                          {experience.months ? <span className="text-zinc-400"> · {experience.months}个月</span> : null}
                                        </p>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {resume.profile.skills.length > 0 && (
                                  <div>
                                    <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-1">{t('resume.skills')}</p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {resume.profile.skills.map((skill) => (
                                        <Badge key={skill} variant="secondary" className="text-xs bg-white dark:bg-zinc-800">{skill}</Badge>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {resume.profile.intention && (
                                  <div className="text-sm text-zinc-800 dark:text-zinc-100 space-y-1">
                                    {resume.profile.intention.roles?.length ? <p><strong>岗位：</strong>{resume.profile.intention.roles.join('、')}</p> : null}
                                    {resume.profile.intention.locations?.length ? <p><strong>地区：</strong>{resume.profile.intention.locations.join('、')}</p> : null}
                                    {resume.profile.intention.industries?.length ? <p><strong>行业：</strong>{resume.profile.intention.industries.join('、')}</p> : null}
                                    {resume.profile.intention.workAuthorization ? <p><strong>工作权限：</strong>{resume.profile.intention.workAuthorization}</p> : null}
                                    {resume.profile.intention.availableFrom ? <p><strong>可入职：</strong>{resume.profile.intention.availableFrom}</p> : null}
                                  </div>
                                )}

                                {Object.keys(resume.profile_confidence || {}).length > 0 && (
                                  <div>
                                    <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-2">{t('resume.profileConfidence')}</p>
                                    <div className="grid grid-cols-2 gap-2">
                                      {Object.entries(resume.profile_confidence || {}).slice(0, 6).map(([field, score]) => (
                                        <div key={field} className="flex items-center justify-between gap-2 text-xs">
                                          <span className="truncate text-zinc-500 dark:text-zinc-400">{field}</span>
                                          <span className="font-medium text-zinc-800 dark:text-zinc-100">{Math.round(score * 100)}%</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {Object.keys(resume.profile_evidence || {}).length > 0 && (
                                  <div>
                                    <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-2">{t('resume.profileEvidence')}</p>
                                    <div className="space-y-2">
                                      {Object.entries(resume.profile_evidence || {}).slice(0, 6).map(([field, items]) => (
                                        <div key={field} className="text-xs">
                                          <p className="text-zinc-500 dark:text-zinc-400">{field}</p>
                                          {items.slice(0, 1).map((item, index) => (
                                            <p key={`${field}-${index}`} className="mt-0.5 text-zinc-700 dark:text-zinc-300 break-words">
                                              {item.quote || item.note || item.source}
                                            </p>
                                          ))}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* 原始解析信息 */}
                            {resume.user_info?.name && (
                              <div>
                                <h4 className="font-semibold text-sm md:text-base mb-2">{t('resume.basicInfo')}</h4>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                                  {resume.user_info.name && <p><strong>{t('resume.name')}:</strong> {resume.user_info.name}</p>}
                                  {resume.user_info.email && <p className="break-all"><strong>{t('resume.email')}:</strong> {resume.user_info.email}</p>}
                                  {resume.user_info.phone && <p><strong>{t('resume.phone')}:</strong> {resume.user_info.phone}</p>}
                                </div>
                              </div>
                            )}
                            {resume.user_info?.education && resume.user_info.education.length > 0 && (
                              <div>
                                <h4 className="font-semibold text-sm md:text-base mb-2">{t('resume.education')}</h4>
                                <ul className="list-disc list-inside text-sm space-y-1">
                                  {resume.user_info.education.map((edu, i) => (
                                    <li key={i}>{edu}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {resume.user_info?.experience && resume.user_info.experience.length > 0 && (
                              <div>
                                <h4 className="font-semibold text-sm md:text-base mb-2">{t('resume.experience')}</h4>
                                <ul className="list-disc list-inside text-sm space-y-1">
                                  {resume.user_info.experience.map((exp, i) => (
                                    <li key={i}>{exp}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {resume.user_info?.skills && resume.user_info.skills.length > 0 && (
                              <div>
                                <h4 className="font-semibold text-sm md:text-base mb-2">{t('resume.skills')}</h4>
                                <div className="flex flex-wrap gap-1.5 md:gap-2">
                                  {resume.user_info.skills.map((skill, i) => (
                                    <Badge key={i} variant="secondary" className="text-xs">{skill}</Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </DialogContent>
                      </Dialog>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs h-7 px-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                        onClick={() => deleteResume(resume.id)}
                      >
                        <Trash2 className="h-3 w-3 md:h-4 md:w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </main>
    </div>
  );
}

// 主组件
export default function ResumePage() {
  return (
    <AuthGuard>
      <ResumeContent />
    </AuthGuard>
  );
}

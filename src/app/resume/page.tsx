'use client';

import { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
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
  CheckCircle,
  User,
  Calendar,
  Languages,
  Sparkles,
  Map,
} from 'lucide-react';
import Link from 'next/link';
import { AccessGuard, useAccessCode } from '@/components/access-guard';
import { Header1 } from '@/components/header1';
import { SegmentationCard, type Segmentation } from '@/components/segmentation-card';
import { Target, Wand2, Send, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';

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
  segmentation?: Segmentation | null;
  segmentation_confirmed?: boolean;
  profile?: {
    education?: Array<{ school: string; degree?: string; major?: string }>;
    skills?: string[];
  } | null;
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

// 内部组件 - 在 AccessGuard 内部使用 useAccessCode
function ResumeContent() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedResume, setSelectedResume] = useState<Resume | null>(null);
  const [translatingId, setTranslatingId] = useState<number | null>(null);
  const [extractingId, setExtractingId] = useState<number | null>(null);
  const { accessCodeId } = useAccessCode();
  const { t } = useLanguage();

  // 提取结构化字段
  const extractFields = async (resume: Resume) => {
    setExtractingId(resume.id);
    try {
      const response = await fetch('/api/resume/extract-fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resume_id: resume.id,
          access_code_id: accessCodeId,
        }),
      });

      const data = await response.json();
      if (data.success && data.parsed_fields) {
        setResumes(resumes.map(r => 
          r.id === resume.id ? { ...r, parsed_fields: data.parsed_fields } : r
        ));
        setSelectedResume(prev => prev?.id === resume.id ? { ...prev, parsed_fields: data.parsed_fields } : prev);
        alert(t('resume.extractSuccess'));
      } else if (data.error) {
        alert(t('resume.extractFailed') + ': ' + data.error);
      }
    } catch (error) {
      console.error('Extract failed:', error);
      alert(t('resume.extractFailedRetry'));
    } finally {
      setExtractingId(null);
    }
  };

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  }, []);

  const handleUpload = async () => {
    if (!selectedFile) return;

    if (!accessCodeId) {
      alert(t('resume.loginFirst'));
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('access_code_id', accessCodeId.toString());

      // Simulate progress
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      const response = await fetch('/api/resume', {
        method: 'POST',
        body: formData,
      });

      clearInterval(progressInterval);
      setUploadProgress(100);

      const data = await response.json();
      
      if (data.resume) {
        // 等待几秒后刷新列表以获取解析结果
        setTimeout(() => {
          fetchResumes();
        }, 3000);
        setSelectedFile(null);
        setUploadProgress(0);
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

  const fetchResumes = async () => {
    setLoading(true);
    try {
      if (!accessCodeId) {
        setResumes([]);
        return;
      }
      const params = new URLSearchParams();
      params.append('access_code_id', accessCodeId.toString());
      const response = await fetch(`/api/resume?${params.toString()}`);
      const data = await response.json();
      setResumes(data.resumes || []);
    } catch (error) {
      console.error('Failed to fetch resumes:', error);
    } finally {
      setLoading(false);
    }
  };

  const deleteResume = async (id: number) => {
    if (!confirm(t('resume.deleteConfirm'))) {
      return;
    }
    
    try {
      const response = await fetch(`/api/resume/${id}`, { method: 'DELETE' });
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
      const response = await fetch('/api/ai/translate-resume-content', {
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

  // Fetch resumes when accessCodeId changes
  useEffect(() => {
    if (accessCodeId) {
      fetchResumes();
    }
  }, [accessCodeId]);

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <Header1 />
      <main className="relative container mx-auto px-4 pt-16 md:pt-20 pb-16">
        {/* Hero：左对齐 eyebrow + 大标题（Tailark 式） */}
        <div className="relative mb-8 md:mb-10">
          <p className="text-sm font-medium text-zinc-400 dark:text-zinc-500 mb-3">{t('resume.eyebrow')}</p>
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

          {uploading && (
            <div className="mt-4 max-w-sm mx-auto">
              <Progress value={uploadProgress} className="h-1.5" />
              <p className="text-xs text-zinc-400 mt-2 text-center">
                {uploadProgress < 100 ? t('resume.upload.parsing') : t('resume.upload.complete')}
              </p>
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
                  <p className="font-medium text-sm text-zinc-800 dark:text-zinc-100">{t('resume.uploaded')} {resumes.length} {t('resume.resumesUnit')}</p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">{t('resume.nextStep')}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
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
              </div>
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
        <div className="relative space-y-4 max-w-3xl mx-auto">
          <div className="flex items-center justify-between">
            <h2 className="text-base md:text-lg font-semibold tracking-tight text-zinc-800 dark:text-zinc-100">{t('resume.myResumes')}</h2>
            <Button variant="ghost" size="sm" className="text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100" onClick={fetchResumes}>
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
                <CardContent className="pt-4 md:pt-6">
                  <div className="flex flex-col gap-4">
                    {/* 文件信息 */}
                    <div className="flex items-start gap-3 md:gap-4">
                      <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-zinc-900 dark:bg-white flex items-center justify-center flex-shrink-0 shadow-lg shadow-zinc-900/15 dark:shadow-black/30">
                        <FileText className="h-5 w-5 md:h-6 md:w-6 text-white dark:text-zinc-900" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm md:text-base tracking-tight truncate text-zinc-900 dark:text-zinc-50">{resume.file_name}</h3>
                        <div className="flex flex-wrap gap-1.5 md:gap-2 mt-2">
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
                        </div>
                        {resume.parsed_content && !resume.parsed_content.includes('正在解析') && (
                          <p className="text-xs md:text-sm text-zinc-400 dark:text-zinc-500 mt-2 line-clamp-2 hidden md:block">
                            {resume.parsed_content.substring(0, 150)}...
                          </p>
                        )}
                      </div>
                    </div>

                    {/* 分层确认卡片：求职画像透明展示 + 可修正 */}
                    {resume.segmentation && (
                      <SegmentationCard
                        resumeId={resume.id}
                        segmentation={resume.segmentation}
                        confirmed={resume.segmentation_confirmed}
                        skills={resume.profile?.skills}
                        schoolLine={resume.profile?.education?.[0]
                          ? `${resume.profile.education[0].school}${resume.profile.education[0].major ? ` · ${resume.profile.education[0].major}` : ''}${resume.profile.education[0].degree ? ` · ${resume.profile.education[0].degree}` : ''}`
                          : undefined}
                        onUpdated={(seg) =>
                          setResumes((prev) => prev.map((r) => r.id === resume.id ? { ...r, segmentation: seg, segmentation_confirmed: true } : r))
                        }
                      />
                    )}
                    
                    {/* 操作按钮 - 手机端换行显示 */}
                    <div className="flex flex-wrap gap-2 md:gap-2 pl-0 md:pl-[52px]">
                      {resume.parsed_content && !resume.parsed_content.includes('正在解析') && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs h-8 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                          onClick={() => extractFields(resume)}
                          disabled={extractingId === resume.id}
                        >
                          {extractingId === resume.id ? (
                            <>
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              {t('resume.extracting')}
                            </>
                          ) : resume.parsed_fields ? (
                            <>
                              <CheckCircle className="h-3 w-3 mr-1" />
                              {t('resume.extracted')}
                            </>
                          ) : (
                            <>
                              <Sparkles className="h-3 w-3 mr-1" />
                              {t('resume.extractFields')}
                            </>
                          )}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-8 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
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
                        <Button variant="outline" size="sm" className="text-xs h-8 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                          <Map className="h-3 w-3 mr-1" />
                          {t('resume.fieldMapping')}
                        </Button>
                      </Link>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-8 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                            onClick={() => setSelectedResume(resume)}
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
                        className="text-xs h-8 px-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
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

// 主组件 - 使用 AccessGuard 包裹内部组件
export default function ResumePage() {
  return (
    <AccessGuard>
      <ResumeContent />
    </AccessGuard>
  );
}

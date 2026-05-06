'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { AccessGuard, useAccessCode } from '@/components/access-guard';
import { StepProgressBar } from '@/components/step-progress-bar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  Shield, Sparkles, ArrowRight, Loader2, CheckCircle,
  FileText, Eye, Edit3, Wand2, ChevronDown, ChevronUp,
} from 'lucide-react';

interface SelectedJob {
  job_id: number;
  job_title: string;
  company: string;
  match_score: number;
  match_reason: string;
  suggestions?: string;
}

interface ResumeData {
  name: string;
  contact: { email?: string; phone?: string; location?: string; linkedin?: string; };
  summary?: string;
  skills?: string[];
  experience?: { title: string; company: string; location?: string; period: string; highlights: string[]; }[];
  education?: { degree: string; school: string; major?: string; period: string; gpa?: string; }[];
  projects?: { name: string; role?: string; period?: string; description?: string; highlights: string[]; }[];
  certifications?: string[];
}

interface JobOptimization {
  status: 'pending' | 'optimizing' | 'optimized' | 'skipped';
  resumeData?: ResumeData;
  optimizedContent?: string;
}

function ConfirmContent() {
  const router = useRouter();
  const { accessCodeId } = useAccessCode();
  const [selectedJobs, setSelectedJobs] = useState<SelectedJob[]>([]);
  const [optimizations, setOptimizations] = useState<Record<number, JobOptimization>>({});
  const [currentOptimizeJob, setCurrentOptimizeJob] = useState<number | null>(null);
  const [optimizeProgress, setOptimizeProgress] = useState(0);
  const [expandedJob, setExpandedJob] = useState<number | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingJobId, setEditingJobId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [resumeId, setResumeId] = useState<string>('');

  // 加载选中的岗位
  useEffect(() => {
    const saved = localStorage.getItem('risingpath_step3_jobs');
    if (saved) {
      try {
        setSelectedJobs(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load step3 jobs:', e);
      }
    }

    // 加载简历ID
    const step1Data = localStorage.getItem('risingpath_step1_data');
    if (step1Data) {
      try {
        const data = JSON.parse(step1Data);
        if (data.resumeId) setResumeId(data.resumeId.toString());
      } catch (e) {}
    }

    const step2Data = localStorage.getItem('risingpath_step2_data');
    if (step2Data) {
      try {
        const data = JSON.parse(step2Data);
        if (data.selectedResumeId) setResumeId(data.selectedResumeId);
      } catch (e) {}
    }
  }, []);

  // 恢复优化状态
  useEffect(() => {
    const saved = localStorage.getItem('risingpath_step3_optimizations');
    if (saved) {
      try {
        setOptimizations(JSON.parse(saved));
      } catch (e) {}
    }
  }, []);

  // 保存优化状态
  useEffect(() => {
    if (Object.keys(optimizations).length > 0) {
      localStorage.setItem('risingpath_step3_optimizations', JSON.stringify(optimizations));
    }
  }, [optimizations]);

  // 单个岗位ATS优化
  const handleOptimizeOne = async (job: SelectedJob) => {
    if (!resumeId || !accessCodeId) return;

    setOptimizations(prev => ({
      ...prev,
      [job.job_id]: { status: 'optimizing' }
    }));
    setCurrentOptimizeJob(job.job_id);
    setOptimizeProgress(0);

    try {
      const progressInterval = setInterval(() => {
        setOptimizeProgress(prev => Math.min(prev + 3, 90));
      }, 100);

      const response = await fetch('/api/ai/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resumeId: resumeId,
          targetCompany: job.company,
          targetPosition: job.job_title,
          suggestions: job.suggestions || '',
          accessCodeId,
        }),
      });

      clearInterval(progressInterval);
      setOptimizeProgress(100);

      const data = await response.json();
      
      setOptimizations(prev => ({
        ...prev,
        [job.job_id]: {
          status: 'optimized',
          resumeData: data.resume_data,
          optimizedContent: data.optimized_content,
        }
      }));

      setTimeout(() => setOptimizeProgress(0), 1000);
    } catch (error) {
      console.error('Optimization failed:', error);
      setOptimizations(prev => ({
        ...prev,
        [job.job_id]: { status: 'pending' }
      }));
    } finally {
      setCurrentOptimizeJob(null);
    }
  };

  // 批量优化所有岗位
  const handleOptimizeAll = async () => {
    const pendingJobs = selectedJobs.filter(
      job => optimizations[job.job_id]?.status === 'pending' || !optimizations[job.job_id]
    );
    
    for (const job of pendingJobs) {
      await handleOptimizeOne(job);
    }
  };

  // 跳过优化
  const handleSkip = (jobId: number) => {
    setOptimizations(prev => ({
      ...prev,
      [jobId]: { status: 'skipped' }
    }));
  };

  // 编辑优化结果
  const handleEdit = (jobId: number) => {
    const opt = optimizations[jobId];
    if (opt?.optimizedContent) {
      setEditingContent(opt.optimizedContent);
    }
    setEditingJobId(jobId);
    setEditDialogOpen(true);
  };

  // 保存编辑
  const handleSaveEdit = () => {
    if (editingJobId && editingContent) {
      setOptimizations(prev => ({
        ...prev,
        [editingJobId]: {
          ...prev[editingJobId],
          optimizedContent: editingContent,
          status: 'optimized',
        }
      }));
    }
    setEditDialogOpen(false);
    setEditingJobId(null);
    setEditingContent('');
  };

  // 移除岗位
  const handleRemoveJob = (jobId: number) => {
    setSelectedJobs(prev => prev.filter(j => j.job_id !== jobId));
    setOptimizations(prev => {
      const next = { ...prev };
      delete next[jobId];
      return next;
    });
    localStorage.setItem('risingpath_step3_jobs', JSON.stringify(selectedJobs.filter(j => j.job_id !== jobId)));
  };

  // 确认并进入下一步
  const handleConfirmAndNext = () => {
    const confirmedJobs = selectedJobs.map(job => ({
      ...job,
      optimizedContent: optimizations[job.job_id]?.optimizedContent || null,
      optimized: optimizations[job.job_id]?.status === 'optimized',
    }));
    localStorage.setItem('risingpath_step4_jobs', JSON.stringify(confirmedJobs));
    router.push('/submit-job?step=4');
  };

  const optimizedCount = Object.values(optimizations).filter(o => o.status === 'optimized').length;
  const allDone = selectedJobs.every(
    job => optimizations[job.job_id]?.status === 'optimized' || optimizations[job.job_id]?.status === 'skipped'
  );

  if (selectedJobs.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b sticky top-0 bg-background/95 backdrop-blur z-50">
          <div className="container mx-auto px-4 h-16 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <Image src="/logo.svg" alt="Rising Path" width={28} height={28} className="rounded" />
              <span className="font-bold text-lg md:text-xl">Rising Path</span>
            </Link>
          </div>
        </header>
        <div className="border-b bg-muted/30">
          <div className="container mx-auto px-4 py-3">
            <StepProgressBar currentStep={3} />
          </div>
        </div>
        <div className="container mx-auto px-4 py-16 text-center">
          <Shield className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h2 className="text-xl font-semibold mb-2">暂无待确认岗位</h2>
          <p className="text-muted-foreground mb-6">请先在AI选岗页面选择岗位</p>
          <Button onClick={() => router.push('/ai-match')} className="bg-gradient-to-r from-purple-600 to-blue-600">
            去选岗
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b sticky top-0 bg-background/95 backdrop-blur z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo.svg" alt="Rising Path" width={28} height={28} className="rounded" />
            <span className="font-bold text-lg md:text-xl">Rising Path</span>
          </Link>
        </div>
      </header>

      {/* Step Progress Bar */}
      <div className="border-b bg-muted/30">
        <div className="container mx-auto px-4 py-3">
          <StepProgressBar currentStep={3} />
        </div>
      </div>

      <main className="container mx-auto px-4 py-4 md:py-8 max-w-5xl">
        {/* Page Title */}
        <div className="mb-6 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-1 md:mb-2 flex items-center gap-2 md:gap-3">
            <Shield className="h-6 w-6 md:h-8 md:w-8 text-purple-600" />
            确认岗位 & ATS优化
          </h1>
          <p className="text-sm md:text-base text-muted-foreground">
            确认你选择的岗位，AI将针对每个岗位自动优化你的简历以通过ATS筛选
          </p>
        </div>

        {/* Summary */}
        <div className="flex items-center gap-4 mb-6 flex-wrap">
          <Card className="flex-1 min-w-[140px]">
            <CardContent className="py-3 text-center">
              <div className="text-2xl font-bold text-purple-600">{selectedJobs.length}</div>
              <div className="text-xs text-muted-foreground">待处理岗位</div>
            </CardContent>
          </Card>
          <Card className="flex-1 min-w-[140px]">
            <CardContent className="py-3 text-center">
              <div className="text-2xl font-bold text-green-600">{optimizedCount}</div>
              <div className="text-xs text-muted-foreground">已优化</div>
            </CardContent>
          </Card>
          <Card className="flex-1 min-w-[140px]">
            <CardContent className="py-3 text-center">
              <div className="text-2xl font-bold text-muted-foreground">
                {Object.values(optimizations).filter(o => o.status === 'skipped').length}
              </div>
              <div className="text-xs text-muted-foreground">已跳过</div>
            </CardContent>
          </Card>
        </div>

        {/* Batch Action */}
        <div className="flex items-center gap-3 mb-4">
          <Button
            onClick={handleOptimizeAll}
            disabled={currentOptimizeJob !== null}
            className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
          >
            {currentOptimizeJob ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                优化中...
              </>
            ) : (
              <>
                <Wand2 className="mr-2 h-4 w-4" />
                一键优化全部简历
              </>
            )}
          </Button>
          <span className="text-xs text-muted-foreground">
            AI将针对每个岗位自动调整简历关键词和内容
          </span>
        </div>

        {/* Progress bar when optimizing */}
        {currentOptimizeJob && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">
                正在优化: {selectedJobs.find(j => j.job_id === currentOptimizeJob)?.company} - {selectedJobs.find(j => j.job_id === currentOptimizeJob)?.job_title}
              </span>
              <span className="text-xs font-medium">{optimizeProgress}%</span>
            </div>
            <Progress value={optimizeProgress} className="h-1.5" />
          </div>
        )}

        {/* Job List */}
        <div className="space-y-3">
          {selectedJobs.map((job) => {
            const opt = optimizations[job.job_id];
            const isExpanded = expandedJob === job.job_id;
            const isOptimizing = opt?.status === 'optimizing';

            return (
              <Card key={job.job_id} className={`transition-all ${
                opt?.status === 'optimized' ? 'border-green-200 bg-green-50/50 dark:bg-green-950/20' :
                opt?.status === 'skipped' ? 'border-gray-200 opacity-70' :
                opt?.status === 'optimizing' ? 'border-purple-200 bg-purple-50/50 dark:bg-purple-950/20' :
                ''
              }`}>
                <CardContent className="py-4">
                  <div className="flex items-start gap-3">
                    {/* Status Icon */}
                    <div className="flex-shrink-0 mt-0.5">
                      {opt?.status === 'optimized' ? (
                        <CheckCircle className="h-5 w-5 text-green-600" />
                      ) : opt?.status === 'skipped' ? (
                        <div className="h-5 w-5 rounded-full border-2 border-gray-300" />
                      ) : isOptimizing ? (
                        <Loader2 className="h-5 w-5 text-purple-600 animate-spin" />
                      ) : (
                        <div className="h-5 w-5 rounded-full border-2 border-purple-300" />
                      )}
                    </div>

                    {/* Job Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-sm md:text-base">{job.job_title}</h3>
                        <Badge variant="secondary" className="text-xs">{job.match_score}分</Badge>
                      </div>
                      <p className="text-xs md:text-sm text-muted-foreground">{job.company}</p>

                      {/* Optimization Status */}
                      {opt?.status === 'optimized' && (
                        <div className="mt-2 flex items-center gap-2">
                          <Badge className="bg-green-600 text-xs">ATS优化完成</Badge>
                          <button
                            onClick={() => setExpandedJob(isExpanded ? null : job.job_id)}
                            className="text-xs text-purple-600 hover:underline flex items-center gap-1"
                          >
                            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            {isExpanded ? '收起' : '查看优化结果'}
                          </button>
                          <button
                            onClick={() => handleEdit(job.job_id)}
                            className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                          >
                            <Edit3 className="h-3 w-3" />
                            手动调整
                          </button>
                        </div>
                      )}

                      {isOptimizing && (
                        <div className="mt-2">
                          <Progress value={optimizeProgress} className="h-1" />
                          <p className="text-xs text-muted-foreground mt-1">AI正在针对该岗位优化简历...</p>
                        </div>
                      )}

                      {/* Expanded optimization preview */}
                      {isExpanded && opt?.optimizedContent && (
                        <div className="mt-3 p-3 bg-white dark:bg-gray-900 rounded-lg border text-xs whitespace-pre-wrap max-h-60 overflow-y-auto">
                          {opt.optimizedContent}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex-shrink-0 flex items-center gap-1">
                      {!opt || opt.status === 'pending' ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleOptimizeOne(job)}
                            disabled={currentOptimizeJob !== null}
                            className="text-xs h-8"
                          >
                            <Sparkles className="mr-1 h-3 w-3" />
                            优化
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleSkip(job.job_id)}
                            className="text-xs h-8 text-muted-foreground"
                          >
                            跳过
                          </Button>
                        </>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemoveJob(job.job_id)}
                        className="text-xs h-8 text-red-500"
                      >
                        移除
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Bottom Action Bar */}
        <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t py-4 -mx-4 px-4 mt-6">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {allDone ? (
                <span className="text-green-600 flex items-center gap-1">
                  <CheckCircle className="h-4 w-4" />
                  所有岗位已处理完成
                </span>
              ) : (
                <span>还有 {selectedJobs.length - optimizedCount - Object.values(optimizations).filter(o => o.status === 'skipped').length} 个岗位待处理</span>
              )}
            </div>
            <Button
              onClick={handleConfirmAndNext}
              disabled={!allDone}
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
              size="lg"
            >
              确认全部，开始投递
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </main>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit3 className="h-5 w-5" />
              手动调整优化结果
            </DialogTitle>
            <DialogDescription>
              你可以在AI优化结果的基础上进一步调整简历内容
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={editingContent}
            onChange={(e) => setEditingContent(e.target.value)}
            className="min-h-[400px] font-mono text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>取消</Button>
            <Button onClick={handleSaveEdit} className="bg-purple-600 hover:bg-purple-700">保存修改</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function ConfirmPage() {
  return (
    <AccessGuard>
      <ConfirmContent />
    </AccessGuard>
  );
}

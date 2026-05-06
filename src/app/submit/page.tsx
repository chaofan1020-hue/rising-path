'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { AccessGuard, useAccessCode } from '@/components/access-guard';
import { StepProgressBar } from '@/components/step-progress-bar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Send, ArrowRight, Loader2, CheckCircle, ExternalLink,
  Mail, Clock, XCircle,
} from 'lucide-react';

interface ConfirmedJob {
  job_id: number;
  job_title: string;
  company: string;
  match_score: number;
  match_reason: string;
  suggestions?: string;
  optimizedContent?: string | null;
  optimized: boolean;
}

type SubmitStatus = 'pending' | 'submitting' | 'submitted' | 'failed';

function SubmitContent() {
  const router = useRouter();
  const { accessCodeId } = useAccessCode();
  const [confirmedJobs, setConfirmedJobs] = useState<ConfirmedJob[]>([]);
  const [submitStatuses, setSubmitStatuses] = useState<Record<number, SubmitStatus>>({});
  const [currentSubmitting, setCurrentSubmitting] = useState<number | null>(null);
  const [email, setEmail] = useState('');
  const [emailConfirmed, setEmailConfirmed] = useState(false);

  // 加载数据
  useEffect(() => {
    const saved = localStorage.getItem('risingpath_step4_jobs');
    if (saved) {
      try {
        setConfirmedJobs(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load step4 jobs:', e);
      }
    }

    // 从简历中获取默认邮箱
    const step1Data = localStorage.getItem('risingpath_step1_data');
    if (step1Data) {
      try {
        const data = JSON.parse(step1Data);
        if (data.email) setEmail(data.email);
      } catch (e) {}
    }

    // 恢复提交状态
    const savedStatus = localStorage.getItem('risingpath_step4_statuses');
    if (savedStatus) {
      try {
        setSubmitStatuses(JSON.parse(savedStatus));
      } catch (e) {}
    }

    const savedEmail = localStorage.getItem('risingpath_step4_email');
    if (savedEmail) {
      setEmail(savedEmail);
      setEmailConfirmed(true);
    }
  }, []);

  // 保存状态
  useEffect(() => {
    if (Object.keys(submitStatuses).length > 0) {
      localStorage.setItem('risingpath_step4_statuses', JSON.stringify(submitStatuses));
    }
  }, [submitStatuses]);

  // 提交单个申请
  const handleSubmitOne = async (job: ConfirmedJob) => {
    if (!accessCodeId) return;

    setCurrentSubmitting(job.job_id);
    setSubmitStatuses(prev => ({ ...prev, [job.job_id]: 'submitting' }));

    try {
      const response = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: job.job_id,
          accessCodeId,
          notes: job.optimized ? `ATS优化版本已应用 | 匹配分数: ${job.match_score}` : `匹配分数: ${job.match_score}`,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setSubmitStatuses(prev => ({ ...prev, [job.job_id]: 'submitted' }));
      } else {
        setSubmitStatuses(prev => ({ ...prev, [job.job_id]: 'failed' }));
      }
    } catch (error) {
      console.error('Submit failed:', error);
      setSubmitStatuses(prev => ({ ...prev, [job.job_id]: 'failed' }));
    } finally {
      setCurrentSubmitting(null);
    }
  };

  // 批量提交
  const handleSubmitAll = async () => {
    const pendingJobs = confirmedJobs.filter(
      job => !submitStatuses[job.job_id] || submitStatuses[job.job_id] === 'pending' || submitStatuses[job.job_id] === 'failed'
    );

    for (const job of pendingJobs) {
      await handleSubmitOne(job);
    }
  };

  // 确认邮箱
  const handleConfirmEmail = () => {
    if (email) {
      setEmailConfirmed(true);
      localStorage.setItem('risingpath_step4_email', email);
    }
  };

  // 进入下一步
  const handleNextStep = () => {
    router.push('/applications?step=5');
  };

  const submittedCount = Object.values(submitStatuses).filter(s => s === 'submitted').length;
  const allSubmitted = confirmedJobs.length > 0 && submittedCount === confirmedJobs.length;

  if (confirmedJobs.length === 0) {
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
            <StepProgressBar currentStep={4} />
          </div>
        </div>
        <div className="container mx-auto px-4 py-16 text-center">
          <Send className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h2 className="text-xl font-semibold mb-2">暂无待投递岗位</h2>
          <p className="text-muted-foreground mb-6">请先确认岗位并完成ATS优化</p>
          <Button onClick={() => router.push('/confirm')} className="bg-gradient-to-r from-purple-600 to-blue-600">
            去确认岗位
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
          <StepProgressBar currentStep={4} />
        </div>
      </div>

      <main className="container mx-auto px-4 py-4 md:py-8 max-w-5xl">
        {/* Page Title */}
        <div className="mb-6 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-1 md:mb-2 flex items-center gap-2 md:gap-3">
            <Send className="h-6 w-6 md:h-8 md:w-8 text-purple-600" />
            开始投递
          </h1>
          <p className="text-sm md:text-base text-muted-foreground">
            逐一提交你的岗位申请，系统将自动记录投递状态
          </p>
        </div>

        {/* Email Section */}
        {!emailConfirmed ? (
          <Card className="mb-6 border-blue-200 bg-blue-50/50 dark:bg-blue-950/20">
            <CardContent className="py-4">
              <div className="flex items-center gap-2 mb-3">
                <Mail className="h-5 w-5 text-blue-600" />
                <h3 className="font-semibold">设置回执邮箱</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-3">每次投递后将向此邮箱发送确认回执</p>
              <div className="flex gap-2">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="输入你的邮箱地址"
                  className="flex-1"
                />
                <Button onClick={handleConfirmEmail} disabled={!email} className="bg-blue-600 hover:bg-blue-700">
                  确认邮箱
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="mb-6 border-green-200 bg-green-50/50 dark:bg-green-950/20">
            <CardContent className="py-3">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span className="text-sm">回执邮箱: <strong>{email}</strong></span>
                <button onClick={() => setEmailConfirmed(false)} className="text-xs text-muted-foreground hover:underline ml-2">修改</button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary */}
        <div className="flex items-center gap-4 mb-6 flex-wrap">
          <Card className="flex-1 min-w-[120px]">
            <CardContent className="py-3 text-center">
              <div className="text-2xl font-bold">{confirmedJobs.length}</div>
              <div className="text-xs text-muted-foreground">待投递</div>
            </CardContent>
          </Card>
          <Card className="flex-1 min-w-[120px]">
            <CardContent className="py-3 text-center">
              <div className="text-2xl font-bold text-green-600">{submittedCount}</div>
              <div className="text-xs text-muted-foreground">已投递</div>
            </CardContent>
          </Card>
        </div>

        {/* Batch Action */}
        <div className="flex items-center gap-3 mb-4">
          <Button
            onClick={handleSubmitAll}
            disabled={currentSubmitting !== null || !emailConfirmed}
            className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
          >
            {currentSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                投递中...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                一键投递全部 ({submittedCount}/{confirmedJobs.length})
              </>
            )}
          </Button>
        </div>

        {/* Job List */}
        <div className="space-y-3">
          {confirmedJobs.map((job, index) => {
            const status = submitStatuses[job.job_id] || 'pending';
            const isSubmitting = status === 'submitting';

            return (
              <Card key={job.job_id} className={`transition-all ${
                status === 'submitted' ? 'border-green-200 bg-green-50/50 dark:bg-green-950/20' :
                status === 'failed' ? 'border-red-200 bg-red-50/50 dark:bg-red-950/20' :
                ''
              }`}>
                <CardContent className="py-4">
                  <div className="flex items-center gap-3">
                    {/* Index */}
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-medium">
                      {index + 1}
                    </div>

                    {/* Job Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <h3 className="font-semibold text-sm md:text-base">{job.job_title}</h3>
                        {job.optimized && (
                          <Badge className="bg-purple-600 text-[10px] px-1.5">ATS优化</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{job.company}</p>
                    </div>

                    {/* Status */}
                    <div className="flex-shrink-0 flex items-center gap-2">
                      {status === 'pending' && (
                        <Button
                          size="sm"
                          onClick={() => handleSubmitOne(job)}
                          disabled={currentSubmitting !== null || !emailConfirmed}
                          className="text-xs h-8 bg-purple-600 hover:bg-purple-700"
                        >
                          <Send className="mr-1 h-3 w-3" />
                          投递
                        </Button>
                      )}
                      {status === 'submitting' && (
                        <Badge variant="secondary" className="text-xs">
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          投递中
                        </Badge>
                      )}
                      {status === 'submitted' && (
                        <Badge className="bg-green-600 text-xs">
                          <CheckCircle className="mr-1 h-3 w-3" />
                          已投递
                        </Badge>
                      )}
                      {status === 'failed' && (
                        <div className="flex items-center gap-1">
                          <Badge variant="destructive" className="text-xs">
                            <XCircle className="mr-1 h-3 w-3" />
                            失败
                          </Badge>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleSubmitOne(job)}
                            className="text-xs h-7"
                          >
                            重试
                          </Button>
                        </div>
                      )}

                      {/* 官网申请链接 */}
                      <Button size="sm" variant="outline" className="text-xs h-8" asChild>
                        <Link href={`/jobs/${job.job_id}`} target="_blank">
                          <ExternalLink className="mr-1 h-3 w-3" />
                          官网
                        </Link>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Bottom Action */}
        <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t py-4 -mx-4 px-4 mt-6">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {allSubmitted ? (
                <span className="text-green-600 flex items-center gap-1">
                  <CheckCircle className="h-4 w-4" />
                  全部投递完成！
                </span>
              ) : (
                <span>投递进度: {submittedCount}/{confirmedJobs.length}</span>
              )}
            </div>
            <Button
              onClick={handleNextStep}
              disabled={submittedCount === 0}
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
              size="lg"
            >
              查看投递记录
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function SubmitPage() {
  return (
    <AccessGuard>
      <SubmitContent />
    </AccessGuard>
  );
}

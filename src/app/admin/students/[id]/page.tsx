'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { Activity, ArrowLeft, Copy, FileText, Loader2, Mic, Send, Sparkles, Coins, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useAdminPermissions } from '@/components/admin-shell';
import { StudentIdentity } from '@/components/admin/student-identity';
import { ADMIN_PERMISSIONS } from '@/lib/admin-permission-constants';
import { studentPublicCode } from '@/lib/admin-student-identity';

type Usage = { call_count: number; successful_calls: number; failed_calls: number; total_tokens: number; input_tokens: number; output_tokens: number; actual_calls: number; estimated_calls: number; unknown_calls: number; input_audio_seconds: number; output_audio_seconds: number; estimated_costs: Record<string, number | string>; priced_calls: number; unpriced_calls: number };
type Feature = Usage & { feature: string };
type Event = { id: number; feature: string; provider: string; model: string | null; status: string; modality: string; total_tokens: number | null; input_audio_seconds: number | null; output_audio_seconds: number | null; estimated_cost: number | string | null; currency: string; created_at: string };
type Detail = {
  student: {
    id: string;
    publicCode?: string;
    displayName: string;
    nameSource?: 'profile' | 'resume' | 'email' | 'code' | 'unknown';
    emailHandle?: string | null;
    avatarUrl?: string | null;
    schoolName?: string | null;
    preferredRegion?: string | null;
    careerStage?: string | null;
    createdAt: string | null;
  };
  business: { resumes: number; applications: number; interviews: number; aiMatches: number };
  usage: Usage | null;
  features: Feature[];
  recentEvents: Event[];
};
type ResumeRow = { id: number; file_name: string; processing_status?: string | null; processing_stage?: string | null; segmentation_confirmed?: boolean | null; created_at: string; updated_at?: string | null };
type ApplicationRow = { id: number; status: string; submitted_at: string | null; created_at: string; jobs: { title: string; company: string; region?: string; direction?: string } | null; resumes: { file_name: string } | null };
type InterviewRow = { id: number; interview_type: string | null; target_company: string | null; mode: string | null; total_rounds: number | null; current_round: number | null; status: string | null; report_grade: string | null; overall_score: number | null; created_at: string };
type CreditDetail = {
  account: { balance: number | string; lifetime_granted: number | string; lifetime_spent: number | string; updated_at: string } | null;
  ledger: Array<{ id: number; entry_type: string; delta: number | string; balance_after: number | string; metric: string | null; reason: string | null; created_at: string }>;
  reservations: Array<{ id: number; metric: string; units: number | string; credits: number | string; status: string; created_at: string }>;
};

const WORKBENCH_TABS = [
  { id: 'overview', label: '概览' },
  { id: 'resumes', label: '简历' },
  { id: 'applications', label: '网申' },
  { id: 'interviews', label: '面试' },
  { id: 'credits', label: '积分' },
] as const;
type WorkbenchTab = typeof WORKBENCH_TABS[number]['id'];

const labels: Record<string, string> = { ai_match: 'AI 选岗', resume_optimize: '简历优化', resume_score: '简历评分', resume_translate: '简历翻译', resume_parse: '简历解析', resume_profile: '简历画像', interview_chat: '面试对话', interview_summary: '面试总结', interview_asr: '语音识别', interview_asr_realtime: '实时语音识别', interview_tts: '语音合成', interview_tts_realtime: '实时语音合成' };
const resumeStatusLabels: Record<string, string> = {
  uploaded: '已上传',
  extracting_text: '提取文本中',
  extracting_profile: '生成画像中',
  deriving_segmentation: '计算分层中',
  needs_confirmation: '待确认',
  ready: '已完成',
  failed: '处理失败',
};
const applicationStatusLabels: Record<string, string> = { pending: '待投递', filling: '填写中', submitted: '已投递', closed: '已关闭' };
const interviewStatusLabels: Record<string, string> = { active: '进行中', completed: '已完成', abandoned: '已放弃' };
const metricNames: Record<string, string> = { interview_turn: '面试回合', asr_minutes: '语音识别', tts_minutes: '语音合成', ai_match: 'AI 选岗', resume_optimize: '简历优化', resume_parse: '简历解析', application_profile: '求职档案', application_prefill: '网申预填' };
const n = (value: number | string | null | undefined) => new Intl.NumberFormat('zh-CN').format(Number(value || 0));
const minutes = (value: number | string | null | undefined) => (Number(value || 0) / 60).toFixed(2);
const costs = (value: Record<string, number | string> | undefined) => Object.entries(value || {}).map(([currency, amount]) => `${currency} ${Number(amount).toFixed(4)}`).join(' / ') || '未定价';
const dateTime = (value: string | null | undefined) => value ? new Date(value).toLocaleString('zh-CN') : '—';

function isWorkbenchTab(value: string | null): value is WorkbenchTab {
  return WORKBENCH_TABS.some((tab) => tab.id === value);
}

function AdminStudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loading: permissionsLoading, hasPermission } = useAdminPermissions();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resumes, setResumes] = useState<ResumeRow[]>([]);
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [interviews, setInterviews] = useState<InterviewRow[]>([]);
  const [credits, setCredits] = useState<CreditDetail | null>(null);
  const [sectionLoading, setSectionLoading] = useState(false);
  const [sectionError, setSectionError] = useState('');
  const [grantAmount, setGrantAmount] = useState('100');
  const [grantReason, setGrantReason] = useState('管理员发放积分');
  const [granting, setGranting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmCode, setConfirmCode] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const allowed = hasPermission(ADMIN_PERMISSIONS.usersRead);
  const canDelete = hasPermission(ADMIN_PERMISSIONS.usersWrite);
  const canWriteCredits = hasPermission(ADMIN_PERMISSIONS.configWrite);
  const tab = isWorkbenchTab(searchParams.get('tab')) ? searchParams.get('tab') as WorkbenchTab : 'overview';

  const setTab = (next: WorkbenchTab) => {
    const path = `/admin/students/${encodeURIComponent(id)}`;
    router.replace(next === 'overview' ? path : `${path}?tab=${next}`);
  };

  useEffect(() => {
    if (permissionsLoading || !allowed || !id) return;
    let cancelled = false;
    setLoading(true);
    void fetch(`/api/admin/students/${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok) {
          const required = Array.isArray(json.error?.requiredMigrations) ? `（所需迁移：${json.error.requiredMigrations.join('、')}）` : '';
          throw new Error(`${json.error?.message || '加载学生详情失败'}${required}`);
        }
        if (!cancelled) setDetail(json.data);
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '加载学生详情失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [allowed, id, permissionsLoading]);

  const loadSection = useCallback(async (section: WorkbenchTab) => {
    if (!id || section === 'overview') return;
    setSectionLoading(true);
    setSectionError('');
    try {
      if (section === 'resumes') {
        const response = await fetch(`/api/admin/resumes?userId=${encodeURIComponent(id)}&page=1&pageSize=50`, { cache: 'no-store' });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error?.message || '加载简历失败');
        setResumes(json.data || []);
      } else if (section === 'applications') {
        const response = await fetch(`/api/admin/applications?userId=${encodeURIComponent(id)}&page=1&pageSize=50`, { cache: 'no-store' });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error?.message || '加载网申失败');
        setApplications(json.data || []);
      } else if (section === 'interviews') {
        const response = await fetch(`/api/admin/students/${encodeURIComponent(id)}/interviews?page=1&pageSize=50`, { cache: 'no-store' });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error?.message || '加载面试失败');
        setInterviews(json.data || []);
      } else if (section === 'credits') {
        const response = await fetch(`/api/admin/credits?userId=${encodeURIComponent(id)}`, { cache: 'no-store' });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error?.message || '加载积分失败');
        setCredits(json.data || null);
      }
    } catch (reason) {
      setSectionError(reason instanceof Error ? reason.message : '加载失败');
    } finally {
      setSectionLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!permissionsLoading && allowed && tab !== 'overview') void loadSection(tab);
  }, [allowed, loadSection, permissionsLoading, tab]);

  const grantCredits = async () => {
    if (!id) return;
    setGranting(true);
    setSectionError('');
    try {
      const amount = Number(grantAmount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('请输入大于 0 的积分数量');
      const response = await fetch('/api/admin/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: id, amount, reason: grantReason }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || '发放积分失败');
      await loadSection('credits');
    } catch (reason) {
      setSectionError(reason instanceof Error ? reason.message : '发放积分失败');
    } finally {
      setGranting(false);
    }
  };

  const deleteStudent = async () => {
    if (!id) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const response = await fetch(`/api/admin/students/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmCode }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || '删除学员失败');
      router.push('/admin/students');
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : '删除学员失败');
    } finally {
      setDeleting(false);
    }
  };

  if (permissionsLoading || loading) return <main className="flex min-h-80 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></main>;
  if (!allowed) return <main className="mx-auto max-w-5xl px-4 py-8"><div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">当前管理员角色无权查看学员详情</div></main>;
  if (error || !detail) return <main className="mx-auto max-w-5xl px-4 py-8"><Link href="/admin/students"><Button variant="ghost" size="sm"><ArrowLeft className="mr-2 h-4 w-4" />返回学员</Button></Link><p className="mt-6 text-sm text-destructive">{error || '学员不存在'}</p></main>;
  const usage = detail.usage;
  const publicCode = detail.student.publicCode || studentPublicCode(detail.student.id);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <Link href="/admin/students"><Button variant="ghost" size="sm"><ArrowLeft className="mr-2 h-4 w-4" />返回学员</Button></Link>
      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <StudentIdentity student={{
          userId: detail.student.id,
          publicCode,
          displayName: detail.student.displayName,
          nameSource: detail.student.nameSource,
          emailHandle: detail.student.emailHandle,
          avatarUrl: detail.student.avatarUrl,
          schoolName: detail.student.schoolName,
          preferredRegion: detail.student.preferredRegion,
          careerStage: detail.student.careerStage,
        }} />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(detail.student.id)}>
            <Copy className="mr-1.5 h-3.5 w-3.5" />复制内部 ID
          </Button>
          {canDelete && (
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => { setConfirmCode(''); setDeleteError(''); setDeleteOpen(true); }}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />删除学员
            </Button>
          )}
        </div>
      </div>

      <div className="mt-6 flex gap-1 overflow-x-auto rounded-lg border border-zinc-200 bg-white p-1.5 dark:border-zinc-800 dark:bg-zinc-950">
        {WORKBENCH_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`rounded-md px-4 py-2 text-sm whitespace-nowrap ${tab === item.id ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900'}`}
          >
            {item.label}
            {item.id === 'resumes' ? ` ${detail.business.resumes}` : ''}
            {item.id === 'applications' ? ` ${detail.business.applications}` : ''}
            {item.id === 'interviews' ? ` ${detail.business.interviews}` : ''}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="总 Token" value={n(usage?.total_tokens)} icon={<Activity className="h-4 w-4" />} note={`输入 ${n(usage?.input_tokens)} / 输出 ${n(usage?.output_tokens)}`} />
            <Metric label="预计成本" value={costs(usage?.estimated_costs)} icon={<Sparkles className="h-4 w-4" />} note={`已定价 ${n(usage?.priced_calls)} / 未定价 ${n(usage?.unpriced_calls)}`} />
            <Metric label="语音时长" value={`ASR ${minutes(usage?.input_audio_seconds)} 分`} icon={<Mic className="h-4 w-4" />} note={`TTS ${minutes(usage?.output_audio_seconds)} 分`} />
            <Metric label="AI 调用" value={n(usage?.call_count)} icon={<Activity className="h-4 w-4" />} note={`成功 ${n(usage?.successful_calls)} / 失败 ${n(usage?.failed_calls)}`} />
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-3">
            <Card>
              <CardHeader><CardTitle className="text-base">业务使用</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                <button type="button" className="text-left" onClick={() => setTab('resumes')}><Stat label="简历" value={detail.business.resumes} icon={<FileText className="h-4 w-4" />} /></button>
                <button type="button" className="text-left" onClick={() => setTab('applications')}><Stat label="网申" value={detail.business.applications} icon={<Send className="h-4 w-4" />} /></button>
                <button type="button" className="text-left" onClick={() => setTab('interviews')}><Stat label="模拟面试" value={detail.business.interviews} icon={<Mic className="h-4 w-4" />} /></button>
                <Stat label="AI 选岗" value={detail.business.aiMatches} icon={<Sparkles className="h-4 w-4" />} />
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">按功能用量</CardTitle>
                <CardDescription>文本 Token、音频分钟与价格快照分开统计</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {detail.features.map((feature) => (
                  <div key={feature.feature} className="flex items-center justify-between gap-6 border-b border-zinc-100 py-3 text-sm last:border-0 dark:border-zinc-800">
                    <div>
                      <div className="font-medium">{labels[feature.feature] || feature.feature}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{n(feature.call_count)} 次，ASR {minutes(feature.input_audio_seconds)} / TTS {minutes(feature.output_audio_seconds)} 分</div>
                    </div>
                    <div className="text-right">
                      <div>{n(feature.total_tokens)} Token</div>
                      <div className="mt-1 text-xs text-muted-foreground">{costs(feature.estimated_costs)}</div>
                    </div>
                  </div>
                ))}
                {detail.features.length === 0 && <p className="py-4 text-sm text-muted-foreground">暂无 AI 用量记录</p>}
              </CardContent>
            </Card>
          </div>
          <Card className="mt-5">
            <CardHeader>
              <CardTitle className="text-base">最近 AI 调用</CardTitle>
              <CardDescription>不包含请求正文、简历内容或面试对话</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[840px] text-sm">
                  <thead className="border-b text-left text-muted-foreground">
                    <tr>
                      <th className="py-3 pr-6 font-medium">时间</th>
                      <th className="py-3 pr-6 font-medium">功能</th>
                      <th className="py-3 pr-6 font-medium">供应商 / 模型</th>
                      <th className="py-3 pr-6 font-medium">用量</th>
                      <th className="py-3 pr-6 font-medium">成本</th>
                      <th className="py-3 font-medium">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.recentEvents.map((event) => (
                      <tr key={event.id} className="border-b last:border-0">
                        <td className="py-4 pr-6 text-xs">{dateTime(event.created_at)}</td>
                        <td className="py-4 pr-6">{labels[event.feature] || event.feature}</td>
                        <td className="py-4 pr-6 text-xs">{event.provider} / {event.model || '-'}</td>
                        <td className="py-4 pr-6">{event.modality === 'audio' ? `ASR ${minutes(event.input_audio_seconds)} / TTS ${minutes(event.output_audio_seconds)} 分` : `${n(event.total_tokens)} Token`}</td>
                        <td className="py-4 pr-6">{event.estimated_cost === null ? '未定价' : `${event.currency} ${Number(event.estimated_cost).toFixed(4)}`}</td>
                        <td className="py-4"><Badge variant={event.status === 'success' ? 'secondary' : 'destructive'}>{event.status === 'success' ? '成功' : '失败'}</Badge></td>
                      </tr>
                    ))}
                    {detail.recentEvents.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">暂无调用记录</td></tr>}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {tab !== 'overview' && (
        <div className="mt-6">
          {sectionError && <p className="mb-4 text-sm text-destructive">{sectionError}</p>}
          {sectionLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : tab === 'resumes' ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">简历</CardTitle>
                <CardDescription>只展示处理状态，不展示简历正文或解析内容</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="border-b text-left text-muted-foreground"><tr><th className="py-3 pr-6 font-medium">文件</th><th className="py-3 pr-6 font-medium">状态</th><th className="py-3 pr-6 font-medium">分层确认</th><th className="py-3 font-medium">更新时间</th></tr></thead>
                    <tbody>
                      {resumes.map((resume) => (
                        <tr key={resume.id} className="border-b last:border-0">
                          <td className="py-4 pr-6 font-medium">{resume.file_name}</td>
                          <td className="py-4 pr-6">{resumeStatusLabels[resume.processing_status || ''] || resume.processing_status || '未知'}</td>
                          <td className="py-4 pr-6">{resume.segmentation_confirmed ? '已确认' : '未确认'}</td>
                          <td className="py-4 text-xs text-muted-foreground">{dateTime(resume.updated_at || resume.created_at)}</td>
                        </tr>
                      ))}
                      {resumes.length === 0 && <tr><td colSpan={4} className="py-10 text-center text-muted-foreground">该学员还没有简历</td></tr>}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : tab === 'applications' ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">网申</CardTitle>
                <CardDescription>按投递进度查看，不展示完整备注或表单内容</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="border-b text-left text-muted-foreground"><tr><th className="py-3 pr-6 font-medium">岗位</th><th className="py-3 pr-6 font-medium">公司</th><th className="py-3 pr-6 font-medium">状态</th><th className="py-3 font-medium">投递时间</th></tr></thead>
                    <tbody>
                      {applications.map((application) => (
                        <tr key={application.id} className="border-b last:border-0">
                          <td className="py-4 pr-6 font-medium">{application.jobs?.title || '岗位已删除'}</td>
                          <td className="py-4 pr-6">{application.jobs?.company || '—'}</td>
                          <td className="py-4 pr-6">{applicationStatusLabels[application.status] || application.status}</td>
                          <td className="py-4 text-xs text-muted-foreground">{dateTime(application.submitted_at || application.created_at)}</td>
                        </tr>
                      ))}
                      {applications.length === 0 && <tr><td colSpan={4} className="py-10 text-center text-muted-foreground">该学员还没有网申记录</td></tr>}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : tab === 'interviews' ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">面试</CardTitle>
                <CardDescription>只展示场次摘要，不展示对话原文</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="border-b text-left text-muted-foreground"><tr><th className="py-3 pr-6 font-medium">公司</th><th className="py-3 pr-6 font-medium">类型</th><th className="py-3 pr-6 font-medium">模式</th><th className="py-3 pr-6 font-medium">轮次</th><th className="py-3 pr-6 font-medium">成绩</th><th className="py-3 pr-6 font-medium">状态</th><th className="py-3 font-medium">时间</th></tr></thead>
                    <tbody>
                      {interviews.map((interview) => (
                        <tr key={interview.id} className="border-b last:border-0">
                          <td className="py-4 pr-6 font-medium">{interview.target_company || '未指定公司'}</td>
                          <td className="py-4 pr-6">{interview.interview_type || '—'}</td>
                          <td className="py-4 pr-6">{interview.mode === 'gauntlet' ? '多轮' : '单轮'}</td>
                          <td className="py-4 pr-6">{interview.current_round || 0}/{interview.total_rounds || 0}</td>
                          <td className="py-4 pr-6">{interview.report_grade || (interview.overall_score != null ? n(interview.overall_score) : '—')}</td>
                          <td className="py-4 pr-6">{interviewStatusLabels[interview.status || ''] || interview.status || '—'}</td>
                          <td className="py-4 text-xs text-muted-foreground">{dateTime(interview.created_at)}</td>
                        </tr>
                      ))}
                      {interviews.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-muted-foreground">该学员还没有面试记录</td></tr>}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">积分账本</CardTitle>
                  <CardDescription>该学员的余额、发放和消耗记录</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900"><p className="text-xs text-muted-foreground">当前余额</p><p className="mt-1 text-xl font-semibold">{n(credits?.account?.balance)}</p></div>
                    <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900"><p className="text-xs text-muted-foreground">累计发放</p><p className="mt-1 text-xl font-semibold">{n(credits?.account?.lifetime_granted)}</p></div>
                    <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900"><p className="text-xs text-muted-foreground">累计消耗</p><p className="mt-1 text-xl font-semibold">{n(credits?.account?.lifetime_spent)}</p></div>
                  </div>
                  <div className="space-y-2">
                    {(credits?.ledger || []).slice(0, 20).map((entry) => (
                      <div key={entry.id} className="flex items-center justify-between gap-3 border-b py-2 text-sm last:border-0">
                        <div className="min-w-0">
                          <p className="truncate">{entry.reason || entry.entry_type}{entry.metric ? ` · ${metricNames[entry.metric] || entry.metric}` : ''}</p>
                          <p className="text-xs text-muted-foreground">{dateTime(entry.created_at)}</p>
                        </div>
                        <span className={Number(entry.delta) >= 0 ? 'font-medium text-emerald-600' : 'font-medium text-red-600'}>{Number(entry.delta) >= 0 ? '+' : ''}{n(entry.delta)}</span>
                      </div>
                    ))}
                    {(credits?.ledger || []).length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">暂无积分流水</p>}
                  </div>
                </CardContent>
              </Card>
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">发放积分</CardTitle>
                    <CardDescription>直接发给当前学员</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Input type="number" min="1" value={grantAmount} onChange={(event) => setGrantAmount(event.target.value)} placeholder="积分数量" />
                    <Textarea value={grantReason} onChange={(event) => setGrantReason(event.target.value)} placeholder="操作原因" className="min-h-20" />
                    <Button className="w-full" disabled={!canWriteCredits || granting || !Number(grantAmount)} onClick={() => void grantCredits()}>
                      <Plus className="mr-2 h-4 w-4" />{granting ? '处理中...' : '确认发放'}
                    </Button>
                    {!canWriteCredits && <p className="text-xs text-muted-foreground">当前角色只有查看权限。</p>}
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5 text-sm">
                    <p className="text-muted-foreground">平台开关、价格规则和批量账户在积分规则页。</p>
                    <Link href="/admin/credits" className="mt-3 inline-flex items-center text-sm font-medium hover:underline">
                      <Coins className="mr-1.5 h-4 w-4" />打开平台积分规则
                    </Link>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </div>
      )}
      <AlertDialog open={deleteOpen} onOpenChange={(open) => { if (!deleting) { setDeleteOpen(open); if (!open) setConfirmCode(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除学员账号</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除 {detail.student.displayName} 的账号、简历、网申和面试数据，无法恢复。请输入短码 {publicCode} 确认。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="student-detail-delete-code">学员短码</Label>
            <Input
              id="student-detail-delete-code"
              value={confirmCode}
              onChange={(event) => setConfirmCode(event.target.value)}
              placeholder={publicCode}
              autoComplete="off"
            />
            {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting || !confirmCode.trim()}
              onClick={(event) => { event.preventDefault(); void deleteStudent(); }}
            >
              {deleting ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

export default function AdminStudentDetailPageWithSuspense() {
  return (
    <Suspense fallback={<main className="flex min-h-80 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></main>}>
      <AdminStudentDetailPage />
    </Suspense>
  );
}

function Metric({ label, value, icon, note }: { label: string; value: string; icon: React.ReactNode; note: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
        <p className="mt-3 break-words text-lg font-semibold" title={value}>{value}</p>
        <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}
function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-zinc-50 px-3 py-3 dark:bg-zinc-900">
      <span className="text-muted-foreground">{icon}</span>
      <span>{label}</span>
      <span className="ml-auto font-medium tabular-nums">{n(value)}</span>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Activity, ArrowLeft, FileText, Loader2, Mic, Send, Sparkles, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAdminPermissions } from '@/components/admin-shell';
import { ADMIN_PERMISSIONS } from '@/lib/admin-permission-constants';

type Usage = { call_count: number; successful_calls: number; failed_calls: number; total_tokens: number; input_tokens: number; output_tokens: number; actual_calls: number; estimated_calls: number; unknown_calls: number; input_audio_seconds: number; output_audio_seconds: number; estimated_costs: Record<string, number | string>; priced_calls: number; unpriced_calls: number };
type Feature = Usage & { feature: string };
type Event = { id: number; feature: string; provider: string; model: string | null; status: string; modality: string; total_tokens: number | null; input_audio_seconds: number | null; output_audio_seconds: number | null; estimated_cost: number | string | null; currency: string; created_at: string };
type Detail = { student: { id: string; displayName: string; createdAt: string | null }; business: { resumes: number; applications: number; interviews: number; aiMatches: number }; usage: Usage | null; features: Feature[]; recentEvents: Event[] };

const labels: Record<string, string> = { ai_match: 'AI 选岗', resume_optimize: '简历优化', resume_score: '简历评分', resume_translate: '简历翻译', resume_parse: '简历解析', resume_profile: '简历画像', interview_chat: '面试对话', interview_summary: '面试总结', interview_asr: '语音识别', interview_asr_realtime: '实时语音识别', interview_tts: '语音合成', interview_tts_realtime: '实时语音合成' };
const n = (value: number | string | null | undefined) => new Intl.NumberFormat('zh-CN').format(Number(value || 0));
const minutes = (value: number | string | null | undefined) => (Number(value || 0) / 60).toFixed(2);
const costs = (value: Record<string, number | string> | undefined) => Object.entries(value || {}).map(([currency, amount]) => `${currency} ${Number(amount).toFixed(4)}`).join(' / ') || '未定价';

export default function AdminStudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { loading: permissionsLoading, hasPermission } = useAdminPermissions();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const allowed = hasPermission(ADMIN_PERMISSIONS.usersRead);

  useEffect(() => {
    if (permissionsLoading || !allowed || !id) return;
    let cancelled = false;
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

  if (permissionsLoading || loading) return <main className="flex min-h-80 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></main>;
  if (!allowed) return <main className="mx-auto max-w-5xl px-4 py-8"><div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">当前管理员角色无权查看学生用量详情</div></main>;
  if (error || !detail) return <main className="mx-auto max-w-5xl px-4 py-8"><Link href="/admin/students"><Button variant="ghost" size="sm"><ArrowLeft className="mr-2 h-4 w-4" />返回学生中心</Button></Link><p className="mt-6 text-sm text-destructive">{error || '学生不存在'}</p></main>;
  const usage = detail.usage;

  return <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
    <Link href="/admin/students"><Button variant="ghost" size="sm"><ArrowLeft className="mr-2 h-4 w-4" />返回学生中心</Button></Link>
    <div className="mt-4 flex items-start gap-3"><UserRound className="mt-1 h-5 w-5 text-primary" /><div><h1 className="text-lg font-semibold">{detail.student.displayName}</h1><p className="mt-1 font-mono text-xs text-muted-foreground">{detail.student.id}</p></div></div>
    <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Metric label="总 Token" value={n(usage?.total_tokens)} icon={<Activity className="h-4 w-4" />} note={`输入 ${n(usage?.input_tokens)} / 输出 ${n(usage?.output_tokens)}`} />
      <Metric label="预计成本" value={costs(usage?.estimated_costs)} icon={<Sparkles className="h-4 w-4" />} note={`已定价 ${n(usage?.priced_calls)} / 未定价 ${n(usage?.unpriced_calls)}`} />
      <Metric label="语音时长" value={`ASR ${minutes(usage?.input_audio_seconds)} 分`} icon={<Mic className="h-4 w-4" />} note={`TTS ${minutes(usage?.output_audio_seconds)} 分`} />
      <Metric label="AI 调用" value={n(usage?.call_count)} icon={<Activity className="h-4 w-4" />} note={`成功 ${n(usage?.successful_calls)} / 失败 ${n(usage?.failed_calls)}`} />
    </div>
    <div className="mt-4 grid gap-4 lg:grid-cols-3"><Card><CardHeader><CardTitle className="text-base">业务使用</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-3 text-sm"><Stat label="简历" value={detail.business.resumes} icon={<FileText className="h-4 w-4" />} /><Stat label="网申" value={detail.business.applications} icon={<Send className="h-4 w-4" />} /><Stat label="模拟面试" value={detail.business.interviews} icon={<Mic className="h-4 w-4" />} /><Stat label="AI 选岗" value={detail.business.aiMatches} icon={<Sparkles className="h-4 w-4" />} /></CardContent></Card><Card className="lg:col-span-2"><CardHeader><CardTitle className="text-base">按功能用量</CardTitle><CardDescription>文本 Token、音频分钟与价格快照分开统计</CardDescription></CardHeader><CardContent className="space-y-3">{detail.features.map((feature) => <div key={feature.feature} className="flex items-center justify-between gap-3 border-b pb-3 text-sm last:border-0"><div><div className="font-medium">{labels[feature.feature] || feature.feature}</div><div className="mt-1 text-xs text-muted-foreground">{n(feature.call_count)} 次，ASR {minutes(feature.input_audio_seconds)} / TTS {minutes(feature.output_audio_seconds)} 分</div></div><div className="text-right"><div>{n(feature.total_tokens)} Token</div><div className="mt-1 text-xs text-muted-foreground">{costs(feature.estimated_costs)}</div></div></div>)}{detail.features.length === 0 && <p className="py-4 text-sm text-muted-foreground">暂无 AI 用量记录</p>}</CardContent></Card></div>
    <Card className="mt-4"><CardHeader><CardTitle className="text-base">最近 AI 调用</CardTitle><CardDescription>不包含请求正文、简历内容或面试对话</CardDescription></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="border-b text-left text-muted-foreground"><tr><th className="py-2">时间</th><th>功能</th><th>供应商 / 模型</th><th>用量</th><th>成本</th><th>状态</th></tr></thead><tbody>{detail.recentEvents.map((event) => <tr key={event.id} className="border-b last:border-0"><td className="py-3 text-xs">{new Date(event.created_at).toLocaleString('zh-CN')}</td><td>{labels[event.feature] || event.feature}</td><td className="text-xs">{event.provider} / {event.model || '-'}</td><td>{event.modality === 'audio' ? `ASR ${minutes(event.input_audio_seconds)} / TTS ${minutes(event.output_audio_seconds)} 分` : `${n(event.total_tokens)} Token`}</td><td>{event.estimated_cost === null ? '未定价' : `${event.currency} ${Number(event.estimated_cost).toFixed(4)}`}</td><td><Badge variant={event.status === 'success' ? 'secondary' : 'destructive'}>{event.status === 'success' ? '成功' : '失败'}</Badge></td></tr>)}{detail.recentEvents.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">暂无调用记录</td></tr>}</tbody></table></div></CardContent></Card>
  </main>;
}

function Metric({ label, value, icon, note }: { label: string; value: string; icon: React.ReactNode; note: string }) { return <Card><CardContent className="pt-5"><div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div><p className="mt-2 break-words text-lg font-semibold" title={value}>{value}</p><p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{note}</p></CardContent></Card>; }
function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) { return <div className="flex items-center gap-2"><span className="text-muted-foreground">{icon}</span><span>{label}</span><span className="ml-auto font-medium">{n(value)}</span></div>; }

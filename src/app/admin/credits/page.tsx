'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, BarChart3, ChevronRight, Coins, Eye, Loader2, Plus, RefreshCw, Save, TrendingUp, Users, WalletCards, X } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useAdminPermissions } from '@/components/admin-shell';
import { ADMIN_PERMISSIONS } from '@/lib/admin-permission-constants';

type Account = { user_id: string; balance: number; lifetime_granted: number; lifetime_spent: number; updated_at: string };
type StudentOption = { user_id: string; display_name: string; resume_count: number; application_count: number; interview_count: number; last_activity_at: string };
type PriceRule = { metric: string; display_name: string; unit_name: string; credit_cost: number | string; enabled: boolean; max_units_per_request: number | string | null; notes: string | null };
type Alert = { userId: string; type: string; severity: 'warning' | 'critical'; value: number; message: string };
type Summary = { accountCount: number; totalBalance: number; totalGranted: number; totalSpent: number; spent24h: number; alerts: Alert[] };
type Detail = { account: { user_id: string; balance: number | string; lifetime_granted: number | string; lifetime_spent: number | string; version: number; updated_at: string } | null; ledger: Array<{ id: number; entry_type: string; delta: number | string; balance_after: number | string; metric: string | null; reason: string | null; created_at: string }>; reservations: Array<{ id: number; metric: string; units: number | string; credits: number | string; status: string; expires_at: string; created_at: string; settled_at: string | null }> };
type TrendPoint = { date: string; interview_turn: number; asr_minutes: number; tts_minutes: number; other: number; credits: number };
type Enforcement = { enabled: boolean; updatedAt: string | null };

const number = (value: number | string | null | undefined) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(Number(value || 0));
const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' }) : '-';
const metricNames: Record<string, string> = { interview_turn: '面试回合', asr_minutes: '语音识别', tts_minutes: '语音合成', ai_match: 'AI 选岗', resume_optimize: '简历优化', resume_parse: '简历解析', application_profile: '求职档案', application_prefill: '网申预填' };
function shortUserId(userId: string) {
  return `${userId.slice(0, 8)}…${userId.slice(-4)}`;
}

function StatCard({ label, value, note, icon, tone = 'neutral' }: { label: string; value: string; note: string; icon: React.ReactNode; tone?: 'neutral' | 'amber' | 'green' | 'red' }) {
  const tones = { neutral: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200', amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300', green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300', red: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300' };
  return <Card className="border-border/70 shadow-sm"><CardContent className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p></div><span className={`flex h-9 w-9 items-center justify-center rounded-lg ${tones[tone]}`}>{icon}</span></div><p className="mt-2 text-xs text-muted-foreground">{note}</p></CardContent></Card>;
}

export default function AdminCreditsPage() {
  const { loading: permissionLoading, hasPermission } = useAdminPermissions();
  const canRead = hasPermission(ADMIN_PERMISSIONS.usersRead);
  const canWrite = hasPermission(ADMIN_PERMISSIONS.configWrite);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [prices, setPrices] = useState<PriceRule[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [enforcement, setEnforcement] = useState<Enforcement>({ enabled: false, updatedAt: null });
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [amount, setAmount] = useState('100');
  const [reason, setReason] = useState('管理员发放积分');
  const [studentSearch, setStudentSearch] = useState('');

  const loadStudents = useCallback(async () => {
    const firstResponse = await fetch('/api/admin/students?page=1&pageSize=100&sort=recent_activity', { cache: 'no-store' });
    const firstJson = await firstResponse.json();
    if (!firstResponse.ok) throw new Error(firstJson.error?.message || '读取学生目录失败');
    const firstPage = Array.isArray(firstJson.data) ? firstJson.data : [];
    const total = Number(firstJson.meta?.total || firstPage.length);
    const totalPages = Math.ceil(total / 100);
    if (totalPages <= 1) return firstPage as StudentOption[];
    const remainingPages = await Promise.all(Array.from({ length: totalPages - 1 }, (_, index) => fetch(`/api/admin/students?page=${index + 2}&pageSize=100&sort=recent_activity`, { cache: 'no-store' }).then(async (response) => {
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || '读取学生目录失败');
      return Array.isArray(json.data) ? json.data : [];
    })));
    return firstPage.concat(...remainingPages) as StudentOption[];
  }, []);

  const loadOverview = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [response, studentOptions] = await Promise.all([
        fetch('/api/admin/credits', { cache: 'no-store' }),
        loadStudents(),
      ]);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || '读取积分数据失败');
      setAccounts(json.data?.accounts || []); setStudents(studentOptions); setPrices(json.data?.prices || []); setTrend(json.data?.trend || []); setSummary(json.data?.summary || null); setEnforcement(json.data?.enforcement || { enabled: false, updatedAt: null });
    } catch (reason) { setError(reason instanceof Error ? reason.message : '读取积分数据失败'); }
    finally { setLoading(false); }
  }, [loadStudents]);

  const loadDetail = useCallback(async (nextUserId: string) => {
    setSelectedUserId(nextUserId); setDetailLoading(true);
    try {
      const response = await fetch(`/api/admin/credits?userId=${encodeURIComponent(nextUserId)}`, { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || '读取用户详情失败');
      setDetail(json.data || null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '读取用户详情失败'); }
    finally { setDetailLoading(false); }
  }, []);

  useEffect(() => { if (!permissionLoading && canRead) void loadOverview(); }, [canRead, loadOverview, permissionLoading]);

  const filteredAccounts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? accounts.filter((account) => account.user_id.toLowerCase().includes(query)) : accounts;
  }, [accounts, search]);

  const filteredStudents = useMemo(() => {
    const query = studentSearch.trim().toLowerCase();
    if (!query) return students;
    return students.filter((student) => student.display_name.toLowerCase().includes(query) || student.user_id.toLowerCase().includes(query));
  }, [studentSearch, students]);

  const selectedStudent = students.find((student) => student.user_id === selectedStudentId) || null;

  const grantSelectedStudent = async () => {
    setSaving(true); setError('');
    try {
      const creditAmount = Number(amount);
      if (!Number.isFinite(creditAmount) || creditAmount <= 0) throw new Error('请输入大于 0 的积分数量');
      const creditResponse = await fetch('/api/admin/credits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: selectedStudentId, amount: creditAmount, reason }) });
      const creditJson = await creditResponse.json();
      if (!creditResponse.ok) throw new Error(creditJson.error?.message || '发放积分失败');
      await loadOverview();
      await loadDetail(selectedStudentId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '发放积分失败'); }
    finally { setSaving(false); }
  };

  const updatePrice = async (rule: PriceRule) => {
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/admin/credits', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metric: rule.metric, creditCost: Number(rule.credit_cost), enabled: rule.enabled, maxUnitsPerRequest: rule.max_units_per_request === null ? null : Number(rule.max_units_per_request), notes: rule.notes }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || '保存价格失败');
      await loadOverview();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存价格失败'); }
    finally { setSaving(false); }
  };

  const updateEnforcement = async (enabled: boolean) => {
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/admin/credits', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set_enforcement', enabled }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || '更新积分开关失败');
      setEnforcement(json.data || { enabled, updatedAt: null });
    } catch (reason) { setError(reason instanceof Error ? reason.message : '更新积分开关失败'); }
    finally { setSaving(false); }
  };

  const releaseReservation = async (reservationId: number) => {
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/admin/credits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'release_reservation', reservationId }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || '释放积分预留失败');
      await loadOverview();
      if (selectedUserId) await loadDetail(selectedUserId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '释放积分预留失败'); }
    finally { setSaving(false); }
  };

  if (permissionLoading) return <main className="flex min-h-80 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></main>;
  if (!canRead) return <main className="mx-auto max-w-6xl px-4 py-8"><div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">当前管理员角色无权查看积分管理</div></main>;

  return <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400"><Coins className="h-3.5 w-3.5" />运营控制台</div><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">积分管理</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">开启后，所有 AI 功能按积分余额控制；关闭后，保留账本和用量记录，但不拦截用户请求。</p></div><div className="flex flex-wrap items-center gap-2"><div className="flex h-9 items-center gap-2 rounded-md border border-zinc-200 px-3 text-sm dark:border-zinc-800"><Switch checked={enforcement.enabled} onCheckedChange={(enabled) => void updateEnforcement(enabled)} disabled={!canWrite || saving || loading} aria-label="积分控制开关" /><span>{enforcement.enabled ? '积分控制已开启' : '积分控制已关闭'}</span></div><Button variant="outline" size="sm" className="border-zinc-200 dark:border-zinc-800" onClick={() => void loadOverview()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新</Button></div></header>
    {error && <div className="mb-5 flex items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive"><X className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
    <details className="mt-5 rounded-xl border border-border/70 bg-card shadow-sm"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-sm font-medium marker:hidden sm:px-5"><span>运营数据</span><span className="text-xs font-normal text-muted-foreground">积分余额、消耗趋势和异常提醒</span></summary><div className="space-y-5 border-t p-4 sm:p-5"><section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><StatCard label="积分账户" value={number(summary?.accountCount)} note="已建立积分账户的用户" icon={<Users className="h-4 w-4" />} /><StatCard label="当前流通积分" value={number(summary?.totalBalance)} note="所有用户当前余额" icon={<WalletCards className="h-4 w-4" />} tone="amber" /><StatCard label="累计发放" value={number(summary?.totalGranted)} note="所有管理员发放的积分" icon={<Plus className="h-4 w-4" />} tone="green" /><StatCard label="累计消耗" value={number(summary?.totalSpent)} note="已预扣并确认的消耗" icon={<TrendingUp className="h-4 w-4" />} /><StatCard label="近 24 小时消耗" value={number(summary?.spent24h)} note={summary?.alerts.length ? `${summary.alerts.length} 条需要关注` : '暂无异常告警'} icon={<Activity className="h-4 w-4" />} tone={summary?.alerts.length ? 'red' : 'neutral'} /></section>
    {summary && summary.alerts.length > 0 && <Card className="mt-5 border-amber-200 bg-amber-50/70 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/20"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-amber-600" />需要关注</CardTitle><CardDescription>根据近 24 小时积分流水和未结算预留自动识别。</CardDescription></CardHeader><CardContent className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{summary.alerts.slice(0, 6).map((alert, index) => <button type="button" key={`${alert.userId}-${alert.type}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-amber-200/80 bg-background/70 p-3 text-left transition-colors hover:bg-background dark:border-amber-900/50" onClick={() => void loadDetail(alert.userId)}><div className="min-w-0"><div className="flex items-center gap-2"><Badge variant={alert.severity === 'critical' ? 'destructive' : 'outline'}>{alert.severity === 'critical' ? '高' : '注意'}</Badge><span className="truncate font-mono text-xs">{alert.userId}</span></div><p className="mt-2 text-xs text-muted-foreground">{alert.message}</p></div><ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /></button>)}</CardContent></Card>}
    <Card className="mt-5 border-border/70 shadow-sm">
      <CardHeader className="border-b pb-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="h-4 w-4 text-primary" />近 14 天积分消耗</CardTitle><CardDescription>按积分账本的预扣记录统计，真实供应商成本请以 AI 用量页为准。</CardDescription></div><Badge variant="outline">{number(trend.reduce((sum, item) => sum + item.credits, 0))} 分</Badge></div></CardHeader>
      <CardContent className="pt-5"><div className="h-64 w-full">{trend.length === 0 ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">暂无积分消耗记录</div> : <ResponsiveContainer width="100%" height="100%"><BarChart data={trend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}><CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/60" /><XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(value) => String(value).slice(5)} /><YAxis tickLine={false} axisLine={false} tickMargin={8} width={42} /><Tooltip cursor={{ fill: 'hsl(var(--muted))', opacity: 0.35 }} formatter={(value) => [`${number(Number(value))} 分`, '积分']} /><Bar dataKey="interview_turn" name="模拟面试" stackId="credits" fill="#0f766e" radius={[3, 3, 0, 0]} /><Bar dataKey="asr_minutes" name="语音识别" stackId="credits" fill="#d97706" /><Bar dataKey="tts_minutes" name="语音合成" stackId="credits" fill="#0284c7" /><Bar dataKey="other" name="其他能力" stackId="credits" fill="#64748b" /></BarChart></ResponsiveContainer>}</div><div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-teal-700" />模拟面试</span><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-amber-600" />语音识别</span><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-sky-600" />语音合成</span><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-slate-500" />其他能力</span></div></CardContent>
    </Card></div></details>
     <div className="mt-5 grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]"><Card className="min-w-0 border-border/70 shadow-sm"><CardHeader className="border-b pb-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">已发放账户</CardTitle><CardDescription className="mt-1">查看余额、累计发放和消耗记录。</CardDescription></div><Input value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 w-full sm:w-64" placeholder="按用户 ID 搜索" /></div></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="px-5 py-3 font-medium">用户</th><th className="px-3 py-3 text-right font-medium">当前余额</th><th className="px-3 py-3 text-right font-medium">累计发放</th><th className="px-3 py-3 text-right font-medium">累计消耗</th><th className="px-3 py-3 font-medium">更新时间</th><th className="px-5 py-3 text-right font-medium">详情</th></tr></thead><tbody>{loading ? <tr><td colSpan={6} className="py-14 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" /></td></tr> : filteredAccounts.map((account) => <tr key={account.user_id} className={`border-t transition-colors hover:bg-muted/30 ${selectedUserId === account.user_id ? 'bg-primary/5' : ''}`}><td className="px-5 py-3.5"><button type="button" className="max-w-[330px] truncate font-mono text-xs text-left hover:text-primary" onClick={() => void loadDetail(account.user_id)}>{account.user_id}</button></td><td className="px-3 py-3.5 text-right font-semibold">{number(account.balance)}</td><td className="px-3 py-3.5 text-right">{number(account.lifetime_granted)}</td><td className="px-3 py-3.5 text-right">{number(account.lifetime_spent)}</td><td className="px-3 py-3.5 text-xs text-muted-foreground">{date(account.updated_at)}</td><td className="px-5 py-3.5 text-right"><Button variant="ghost" size="sm" onClick={() => void loadDetail(account.user_id)}><Eye className="mr-1.5 h-4 w-4" />查看</Button></td></tr>)}{!loading && filteredAccounts.length === 0 && <tr><td colSpan={6} className="py-14 text-center text-sm text-muted-foreground">没有匹配的积分账户</td></tr>}</tbody></table></div></CardContent></Card>
      <div className="space-y-5 xl:order-first"><Card className="border-border/70 shadow-sm"><CardHeader className="pb-3"><CardTitle className="text-base">发放积分</CardTitle><CardDescription>选择学生并发放积分。积分余额不足时，AI 功能会自动不可用。</CardDescription></CardHeader><CardContent className="space-y-3"><Input value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="搜索学生昵称或用户 ID" /><Select value={selectedStudentId} onValueChange={(value) => { setSelectedStudentId(value); void loadDetail(value); }}><SelectTrigger className="w-full"><SelectValue placeholder="选择学生" /></SelectTrigger><SelectContent>{filteredStudents.length > 0 ? filteredStudents.map((student) => <SelectItem key={student.user_id} value={student.user_id}><span className="flex max-w-[280px] items-center gap-2"><span className="truncate">{student.display_name || '未命名用户'}</span><span className="font-mono text-[10px] text-muted-foreground">{shortUserId(student.user_id)}</span></span></SelectItem>) : <SelectItem value="__no_match__" disabled>没有匹配的学生</SelectItem>}</SelectContent></Select>{selectedStudent && <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs"><div className="flex items-center justify-between gap-2"><span className="font-medium">{selectedStudent.display_name || '未命名用户'}</span><span className="font-semibold">当前余额 {number(accounts.find((account) => account.user_id === selectedStudent.user_id)?.balance)} 分</span></div></div>}<div><p className="mb-1.5 text-xs font-medium text-muted-foreground">本次发放</p><Input type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="积分数量" /></div><Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="操作原因（可选）" className="min-h-20" /><Button className="w-full" disabled={!canWrite || saving || !selectedStudentId || !Number(amount)} onClick={() => void grantSelectedStudent()}><Plus className="mr-2 h-4 w-4" />{saving ? '处理中...' : '确认发放'}</Button>{!canWrite && <p className="text-xs text-muted-foreground">当前角色只有查看权限。</p>}</CardContent></Card>
      {selectedUserId && <Card className="border-primary/20 bg-primary/[0.02] shadow-sm"><CardHeader className="pb-3"><CardTitle className="flex items-center justify-between text-base">用户详情<Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setSelectedUserId(''); setDetail(null); }}><X className="h-4 w-4" /></Button></CardTitle><CardDescription className="break-all font-mono text-xs">{selectedUserId}</CardDescription></CardHeader><CardContent>{detailLoading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div> : detail ? <div className="space-y-4"><div className="rounded-lg bg-background p-3"><p className="text-xs text-muted-foreground">余额</p><p className="mt-1 text-lg font-semibold">{number(detail.account?.balance)}</p></div><div className="border-t pt-3"><p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">最近流水</p><div className="space-y-2">{detail.ledger.slice(0, 6).map((entry) => <div key={entry.id} className="flex items-center justify-between gap-2 text-xs"><span className="truncate text-muted-foreground">{entry.reason || entry.entry_type}{entry.metric ? ` · ${metricNames[entry.metric] || entry.metric}` : ''}</span><span className={Number(entry.delta) >= 0 ? 'font-medium text-emerald-600' : 'font-medium text-red-600'}>{Number(entry.delta) >= 0 ? '+' : ''}{number(entry.delta)}</span></div>)}{detail.ledger.length === 0 && <p className="text-xs text-muted-foreground">暂无流水</p>}</div></div><div className="border-t pt-3"><p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">积分预留</p><div className="space-y-2">{detail.reservations.slice(0, 5).map((reservation) => <div key={reservation.id} className="flex items-center justify-between gap-2 text-xs"><div className="min-w-0"><p className="truncate">{metricNames[reservation.metric] || reservation.metric} · {number(reservation.credits)} 分</p><p className="text-muted-foreground">{reservation.status} · {date(reservation.created_at)}</p></div>{reservation.status === 'reserved' && <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" disabled={!canWrite || saving} onClick={() => void releaseReservation(reservation.id)}>释放</Button>}</div>)}{detail.reservations.length === 0 && <p className="text-xs text-muted-foreground">暂无预留记录</p>}</div></div></div> : <p className="py-6 text-sm text-muted-foreground">暂无详情</p>}</CardContent></Card>}</div>
     </div>
     <details className="mt-5 rounded-xl border border-border/70 bg-card shadow-sm"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-sm font-medium marker:hidden sm:px-5"><span>积分规则</span><span className="text-xs font-normal text-muted-foreground">调整功能消耗和单次上限</span></summary><div className="border-t p-4 sm:p-5"><Card className="border-border/70 shadow-sm"><CardHeader className="border-b pb-4"><CardTitle className="text-base">积分价格规则</CardTitle><CardDescription>面试回合和语音费用较高，调价会立即影响后续请求。</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full min-w-[820px] text-sm"><thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="px-5 py-3 font-medium">功能</th><th className="px-3 py-3 font-medium">单位</th><th className="px-3 py-3 font-medium">每单位积分</th><th className="px-3 py-3 font-medium">单次上限</th><th className="px-3 py-3 font-medium">状态</th><th className="px-5 py-3 text-right font-medium">操作</th></tr></thead><tbody>{prices.map((rule) => <tr key={rule.metric} className="border-t"><td className="px-5 py-3.5"><div className="font-medium">{rule.display_name}</div><div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{rule.metric}</div></td><td className="px-3 py-3.5 text-muted-foreground">{rule.unit_name}</td><td className="px-3 py-3.5"><Input className="h-8 w-24" type="number" min="0.01" value={rule.credit_cost} onChange={(event) => setPrices((items) => items.map((item) => item.metric === rule.metric ? { ...item, credit_cost: event.target.value } : item))} /></td><td className="px-3 py-3.5"><Input className="h-8 w-24" type="number" min="0.01" value={rule.max_units_per_request ?? ''} onChange={(event) => setPrices((items) => items.map((item) => item.metric === rule.metric ? { ...item, max_units_per_request: event.target.value || null } : item))} /></td><td className="px-3 py-3.5"><Badge variant={rule.enabled ? 'secondary' : 'outline'}>{rule.enabled ? '启用' : '停用'}</Badge></td><td className="px-5 py-3.5 text-right"><Button variant="outline" size="sm" disabled={!canWrite || saving} onClick={() => void updatePrice(rule)}><Save className="mr-1.5 h-4 w-4" />保存</Button></td></tr>)}</tbody></table></div></CardContent></Card></div></details>
   </main>;
}

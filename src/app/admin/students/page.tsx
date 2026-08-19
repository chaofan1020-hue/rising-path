'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Loader2, Search, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAdminPermissions } from '@/components/admin-shell';
import { ADMIN_PERMISSIONS } from '@/lib/admin-permission-constants';

type Student = {
  user_id: string;
  display_name: string;
  created_at: string;
  resume_count: number;
  application_count: number;
  interview_count: number;
  ai_match_count: number;
  ai_call_count: number;
  total_tokens: number;
  last_activity_at: string;
};

const pageSize = 25;
const number = (value: number) => new Intl.NumberFormat('zh-CN').format(Number(value || 0));

export default function AdminStudentsPage() {
  const { loading: permissionsLoading, hasPermission } = useAdminPermissions();
  const allowed = hasPermission(ADMIN_PERMISSIONS.usersRead);
  const [students, setStudents] = useState<Student[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recent_activity');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setSearch(searchInput);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (permissionsLoading || !allowed) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort });
    if (search) params.set('search', search);
      void fetch(`/api/admin/students?${params.toString()}`, { cache: 'no-store' })
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok) {
          const required = Array.isArray(json.error?.requiredMigrations) ? `（所需迁移：${json.error.requiredMigrations.join('、')}）` : '';
          throw new Error(`${json.error?.message || '加载学生目录失败'}${required}`);
        }
        if (!cancelled) {
          setStudents(json.data || []);
          setTotal(Number(json.meta?.total || 0));
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setStudents([]);
          setTotal(0);
          setError(reason instanceof Error ? reason.message : '加载学生目录失败');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [allowed, page, permissionsLoading, search, sort]);

  if (permissionsLoading) return <main className="flex min-h-80 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></main>;
  if (!allowed) return <main className="mx-auto max-w-6xl px-4 py-8"><div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">当前管理员角色无权查看学生目录</div></main>;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="flex items-center gap-2 text-xl font-semibold"><Users className="h-5 w-5 text-primary" />学生中心</h1><p className="mt-1 text-sm text-muted-foreground">仅展示运营汇总，不包含邮箱、简历正文、画像或面试对话。</p></div>
      <p className="pt-1 text-sm text-muted-foreground">共 {number(total)} 名学生</p>
    </div>
    <Card className="mt-5">
      <CardHeader className="pb-3"><CardTitle className="text-base">学生目录</CardTitle><CardDescription>可按昵称或用户 ID 搜索，进入详情查看 Token、音频用量和价格快照成本。</CardDescription></CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="搜索昵称或用户 ID" className="pl-9" /></div>
          <Select value={sort} onValueChange={(value) => { setPage(1); setSort(value); }}><SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="recent_activity">最近活跃</SelectItem><SelectItem value="ai_usage">AI Token 用量</SelectItem><SelectItem value="resumes">简历数量</SelectItem><SelectItem value="interviews">面试次数</SelectItem></SelectContent></Select>
        </div>
        {error ? <div className="py-10 text-center text-sm text-destructive">{error}</div> : <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-sm"><thead className="border-b text-left text-muted-foreground"><tr><th className="py-2 font-medium">学生</th><th className="py-2 text-right font-medium">简历</th><th className="py-2 text-right font-medium">网申</th><th className="py-2 text-right font-medium">面试</th><th className="py-2 text-right font-medium">AI 调用</th><th className="py-2 text-right font-medium">Token</th><th className="py-2 font-medium">最近活跃</th><th className="py-2 text-right font-medium">操作</th></tr></thead><tbody>{loading ? <tr><td colSpan={8} className="py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr> : students.map((student) => <tr key={student.user_id} className="border-b last:border-0"><td className="py-3"><p className="font-medium">{student.display_name}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{student.user_id.slice(0, 8)}...</p></td><td className="py-3 text-right">{number(student.resume_count)}</td><td className="py-3 text-right">{number(student.application_count)}</td><td className="py-3 text-right">{number(student.interview_count)}</td><td className="py-3 text-right">{number(student.ai_call_count)}</td><td className="py-3 text-right">{number(student.total_tokens)}</td><td className="py-3 text-xs">{new Date(student.last_activity_at).toLocaleString('zh-CN')}</td><td className="py-3 text-right"><Link href={`/admin/students/${encodeURIComponent(student.user_id)}`}><Button variant="ghost" size="sm">详情<ArrowRight className="ml-1 h-4 w-4" /></Button></Link></td></tr>)}{!loading && students.length === 0 && <tr><td colSpan={8} className="py-12 text-center text-muted-foreground">没有匹配的学生</td></tr>}</tbody></table></div>}
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground"><span>第 {page} / {totalPages} 页</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}><ChevronLeft className="mr-1 h-4 w-4" />上一页</Button><Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>下一页<ChevronRight className="ml-1 h-4 w-4" /></Button></div></div>
      </CardContent>
    </Card>
  </main>;
}

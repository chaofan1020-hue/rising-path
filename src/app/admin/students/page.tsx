'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Loader2, Search, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useAdminPermissions } from '@/components/admin-shell';
import { StudentIdentity } from '@/components/admin/student-identity';
import { ADMIN_PERMISSIONS } from '@/lib/admin-permission-constants';
import { identityFromDirectoryRow, studentPublicCode } from '@/lib/admin-student-identity';

type Student = {
  user_id: string;
  public_code?: string;
  display_name: string;
  resume_name?: string | null;
  email_local?: string | null;
  email_domain?: string | null;
  avatar_url?: string | null;
  school_name?: string | null;
  preferred_region?: string | null;
  career_stage?: string | null;
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

function relativeTime(value: string) {
  const delta = Date.now() - new Date(value).getTime();
  const minutes = Math.round(delta / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(value).toLocaleDateString('zh-CN');
}

function MetricCell({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  const content = (
    <>
      <span className="block text-[11px] font-medium tracking-wide text-zinc-500">{label}</span>
      <span className="mt-1.5 block text-sm font-medium tabular-nums text-zinc-900 dark:text-zinc-100">{value}</span>
    </>
  );
  if (!href) return <div className="min-w-[5.75rem]">{content}</div>;
  return (
    <Link href={href} className="min-w-[5.75rem] rounded-md px-1 py-0.5 hover:bg-zinc-50 dark:hover:bg-zinc-900">
      {content}
    </Link>
  );
}

export default function AdminStudentsPage() {
  const { loading: permissionsLoading, hasPermission } = useAdminPermissions();
  const allowed = hasPermission(ADMIN_PERMISSIONS.usersRead);
  const canDelete = hasPermission(ADMIN_PERMISSIONS.usersWrite);
  const [students, setStudents] = useState<Student[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recent_activity');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Student | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

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

  const deleteStudent = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const response = await fetch(`/api/admin/students/${encodeURIComponent(pendingDelete.user_id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmCode }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || '删除学员失败');
      setStudents((current) => current.filter((item) => item.user_id !== pendingDelete.user_id));
      setTotal((value) => Math.max(0, value - 1));
      setPendingDelete(null);
      setConfirmCode('');
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : '删除学员失败');
    } finally {
      setDeleting(false);
    }
  };

  if (permissionsLoading) return <main className="flex min-h-80 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></main>;
  if (!allowed) return <main className="mx-auto max-w-6xl px-4 py-8"><div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">当前管理员角色无权查看学生目录</div></main>;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold"><Users className="h-5 w-5" />学员</h1>
          <p className="mt-1 text-sm text-zinc-500">没有姓名时用邮箱名区分。可搜姓名、邮箱、学校或短码。</p>
        </div>
        <p className="pt-1 text-sm text-muted-foreground">共 {number(total)} 名</p>
      </div>
      <Card className="mt-6 border-zinc-200 shadow-sm dark:border-zinc-800">
        <CardContent className="p-5 sm:p-6">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="搜索姓名、邮箱、学校或短码" className="pl-9" />
            </div>
            <Select value={sort} onValueChange={(value) => { setPage(1); setSort(value); }}>
              <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="recent_activity">最近活跃</SelectItem>
                <SelectItem value="ai_usage">AI Token 用量</SelectItem>
                <SelectItem value="resumes">简历数量</SelectItem>
                <SelectItem value="interviews">面试次数</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error ? <div className="py-10 text-center text-sm text-destructive">{error}</div> : (
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {loading ? (
                <div className="py-16 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
              ) : students.map((student) => {
                const href = `/admin/students/${encodeURIComponent(student.user_id)}`;
                return (
                  <div key={student.user_id} className="flex flex-col gap-5 py-5 first:pt-2 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1 lg:max-w-md xl:max-w-lg">
                      <StudentIdentity
                        student={identityFromDirectoryRow(student)}
                        href={href}
                      />
                    </div>
                    <div className="flex flex-wrap items-start gap-x-8 gap-y-4 lg:justify-end lg:pl-8">
                      <MetricCell label="简历" value={number(student.resume_count)} href={`${href}?tab=resumes`} />
                      <MetricCell label="网申" value={number(student.application_count)} href={`${href}?tab=applications`} />
                      <MetricCell label="面试" value={number(student.interview_count)} href={`${href}?tab=interviews`} />
                      <MetricCell label="AI 调用" value={number(student.ai_call_count)} />
                      <MetricCell label="最近活跃" value={relativeTime(student.last_activity_at)} />
                      {canDelete && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-1 text-destructive hover:text-destructive"
                          onClick={() => { setDeleteError(''); setConfirmCode(''); setPendingDelete(student); }}
                        >
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />删除
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
              {!loading && students.length === 0 && <div className="py-12 text-center text-sm text-muted-foreground">没有匹配的学员</div>}
            </div>
          )}
          <div className="mt-5 flex items-center justify-between border-t border-zinc-200 pt-4 text-sm text-muted-foreground dark:border-zinc-800">
            <span>第 {page} / {totalPages} 页</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}><ChevronLeft className="mr-1 h-4 w-4" />上一页</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>下一页<ChevronRight className="ml-1 h-4 w-4" /></Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => { if (!open && !deleting) { setPendingDelete(null); setConfirmCode(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除学员账号</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除 {pendingDelete?.display_name || '该学员'} 的账号、简历、网申和面试数据，无法恢复。请输入短码 {pendingDelete ? (pendingDelete.public_code || studentPublicCode(pendingDelete.user_id)) : ''} 确认。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="student-delete-code">学员短码</Label>
            <Input
              id="student-delete-code"
              value={confirmCode}
              onChange={(event) => setConfirmCode(event.target.value)}
              placeholder="LV-XXXXXXXX"
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

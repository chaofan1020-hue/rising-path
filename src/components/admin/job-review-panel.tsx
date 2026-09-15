'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { AdminPageShell } from '@/components/admin/page-shell';
import { useAdminPermissions } from '@/components/admin-shell';
import { ADMIN_PERMISSIONS } from '@/lib/admin-permission-constants';

type JobSubmission = {
  id: number;
  title: string;
  company: string;
  region: string | null;
  direction: string | null;
  job_type: string | null;
  job_url: string | null;
  status: 'pending' | 'approved' | 'rejected';
  notes: string | null;
  submitted_at: string;
  created_at: string;
};

const PAGE_SIZE = 20;

export function AdminJobReviewPanel() {
  const { hasPermission } = useAdminPermissions();
  const canWriteJobs = hasPermission(ADMIN_PERMISSIONS.jobsWrite);
  const [rows, setRows] = useState<JobSubmission[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('pending');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reviewing, setReviewing] = useState<JobSubmission | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject' | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), status });
      if (search.trim()) params.set('search', search.trim());
      const response = await fetch(`/api/admin/job-submissions?${params.toString()}`, { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || '岗位投稿加载失败');
      setRows(json.data || []);
      setTotal(Number(json.meta?.total || 0));
    } catch (reason) {
      setRows([]);
      setTotal(0);
      setError(reason instanceof Error ? reason.message : '岗位投稿加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, search, status]);

  useEffect(() => { void load(); }, [load]);

  const review = async () => {
    if (!reviewing || !reviewAction) return;
    setSaving(true);
    try {
      const response = await fetch('/api/admin/job-submissions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: reviewing.id, action: reviewAction, notes: reviewNotes }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || '岗位投稿审核失败');
      setReviewing(null);
      setReviewNotes('');
      setReviewAction(null);
      await load();
    } catch (reason) {
      alert(reason instanceof Error ? reason.message : '岗位投稿审核失败');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (submission: JobSubmission) => {
    if (!confirm(`确定删除“${submission.company} - ${submission.title}”这条投稿吗？`)) return;
    try {
      const response = await fetch(`/api/admin/job-submissions?id=${submission.id}`, { method: 'DELETE' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || '删除岗位投稿失败');
      if (rows.length === 1 && page > 1) setPage((value) => value - 1);
      else await load();
    } catch (reason) {
      alert(reason instanceof Error ? reason.message : '删除岗位投稿失败');
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AdminPageShell title="投稿审核" description="审核用户提交的岗位线索，不展示投稿人联系方式" permission={ADMIN_PERMISSIONS.jobsRead}>
      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-lg">岗位投稿审核</CardTitle>
              <CardDescription>批准会以数据库事务创建正式岗位并更新审核状态。</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新
            </Button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input className="sm:max-w-sm" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="搜索岗位或公司" />
            <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}>
              <SelectTrigger className="sm:w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">待审核</SelectItem>
                <SelectItem value="approved">已批准</SelectItem>
                <SelectItem value="rejected">已拒绝</SelectItem>
                <SelectItem value="all">全部状态</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="py-10 text-center"><XCircle className="mx-auto h-8 w-8 text-destructive" /><p className="mt-2 text-sm text-destructive">{error}</p></div>
          ) : loading ? (
            <div className="py-10 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" /><p className="mt-2 text-sm text-muted-foreground">加载岗位投稿...</p></div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] text-sm">
                  <thead><tr className="border-b text-left text-muted-foreground"><th className="py-2 font-medium">岗位</th><th className="py-2 font-medium">地区 / 方向</th><th className="py-2 font-medium">投稿时间</th><th className="py-2 font-medium">状态</th><th className="py-2 font-medium">审核备注</th><th className="py-2 text-right font-medium">操作</th></tr></thead>
                  <tbody>
                    {rows.map((submission) => (
                      <tr key={submission.id} className="border-b align-top last:border-0">
                        <td className="py-3 pr-3">
                          <p className="font-medium">{submission.title}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{submission.company}{submission.job_type ? ` · ${submission.job_type}` : ''}</p>
                          {submission.job_url && <a className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline" href={submission.job_url} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3" />岗位链接</a>}
                        </td>
                        <td className="py-3">{submission.region || '未标注'}<span className="text-muted-foreground"> / </span>{submission.direction || '未标注'}</td>
                        <td className="py-3 text-xs text-muted-foreground">{new Date(submission.submitted_at || submission.created_at).toLocaleString('zh-CN')}</td>
                        <td className="py-3"><Badge variant={submission.status === 'approved' ? 'secondary' : submission.status === 'rejected' ? 'destructive' : 'outline'}>{submission.status === 'approved' ? '已批准' : submission.status === 'rejected' ? '已拒绝' : '待审核'}</Badge></td>
                        <td className="max-w-[220px] py-3 text-xs text-muted-foreground">{submission.notes || '-'}</td>
                        <td className="py-3 text-right">
                          {canWriteJobs && (
                            <div className="flex justify-end gap-1">
                              {submission.status === 'pending' && (
                                <>
                                  <Button size="sm" onClick={() => { setReviewing(submission); setReviewNotes(''); setReviewAction('approve'); }}>批准</Button>
                                  <Button size="sm" variant="outline" onClick={() => { setReviewing(submission); setReviewNotes(''); setReviewAction('reject'); }}>拒绝</Button>
                                </>
                              )}
                              <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" title="删除投稿" onClick={() => void remove(submission)}><Trash2 className="h-4 w-4" /></Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-muted-foreground">暂无符合条件的岗位投稿</td></tr>}
                  </tbody>
                </table>
              </div>
              {total > PAGE_SIZE && (
                <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                  <span>第 {page} / {totalPages} 页，共 {total} 条</span>
                  <div className="flex gap-1">
                    <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                    <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}><ChevronRight className="h-4 w-4" /></Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(reviewing)} onOpenChange={(open) => { if (!open && !saving) { setReviewing(null); setReviewNotes(''); setReviewAction(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{reviewAction === 'approve' ? '批准岗位投稿' : '拒绝岗位投稿'}</DialogTitle>
            <DialogDescription>{reviewing ? `${reviewing.company} · ${reviewing.title}` : ''}</DialogDescription>
          </DialogHeader>
          <Textarea value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} placeholder={reviewAction === 'approve' ? '可记录审核说明' : '可说明拒绝原因'} />
          {reviewAction === 'approve' && <p className="text-xs text-muted-foreground">确认后会原子地创建正式岗位并将投稿标记为已批准。</p>}
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => { setReviewing(null); setReviewNotes(''); setReviewAction(null); }}>取消</Button>
            <Button variant={reviewAction === 'reject' ? 'destructive' : 'default'} disabled={saving} onClick={() => void review()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {reviewAction === 'approve' ? '确认批准' : '确认拒绝'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminPageShell>
  );
}

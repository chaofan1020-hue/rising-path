'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AdminPageShell } from '@/components/admin/page-shell';
import { ADMIN_PERMISSIONS } from '@/lib/admin-permission-constants';
import { studentPublicCode } from '@/lib/admin-student-identity';

type AdminAuditLog = {
  id: number;
  action: string;
  resource_type: string;
  resource_id: string | null;
  subject_user_id: string | null;
  metadata: Record<string, unknown>;
  after_data: Record<string, unknown> | null;
  success: boolean;
  created_at: string;
};

function formatAuditPayload(value: Record<string, unknown> | null): string {
  if (!value || Object.keys(value).length === 0) return '-';
  try {
    return JSON.stringify(value);
  } catch {
    return '[无法显示]';
  }
}

const PAGE_SIZE = 15;

export function AdminAuditPanel() {
  const [logs, setLogs] = useState<AdminAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [action, setAction] = useState('all');
  const [resourceType, setResourceType] = useState('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => { setPage(1); }, [action, resourceType]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (action !== 'all') params.set('action', action);
    if (resourceType !== 'all') params.set('resourceType', resourceType);
    try {
      const response = await fetch(`/api/admin/audit-logs?${params.toString()}`, { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) {
        const required = Array.isArray(json.error?.requiredMigrations) ? `（所需迁移：${json.error.requiredMigrations.join('、')}）` : '';
        throw new Error(`${json.error?.message || '审计日志加载失败'}${required}`);
      }
      setLogs(json.data || []);
      setTotal(Number(json.meta?.total || 0));
    } catch (reason) {
      setLogs([]);
      setTotal(0);
      setError(reason instanceof Error ? reason.message : '审计日志加载失败');
    } finally {
      setLoading(false);
    }
  }, [action, page, resourceType]);

  useEffect(() => { void load(); }, [load]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AdminPageShell
      title="审计日志"
      description="查看后台操作的安全记录，敏感字段和简历正文不会保存"
      permission={ADMIN_PERMISSIONS.auditRead}
      actions={<Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新</Button>}
    >
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">管理员审计日志</CardTitle>
          <CardDescription>记录管理员写操作及结果。学员只显示短码，不展示完整用户 ID。</CardDescription>
          <div className="flex flex-col gap-2 pt-2 sm:flex-row">
            <Select value={resourceType} onValueChange={setResourceType}>
              <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="资源类型" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部资源</SelectItem>
                <SelectItem value="job">岗位</SelectItem>
                <SelectItem value="job_config">岗位配置</SelectItem>
                <SelectItem value="company_config">企业配置</SelectItem>
                <SelectItem value="company_logo">企业 Logo</SelectItem>
                <SelectItem value="resume">简历</SelectItem>
                <SelectItem value="application">网申</SelectItem>
                <SelectItem value="company_dna">企业 DNA</SelectItem>
                <SelectItem value="interview_feedback">面试反馈</SelectItem>
                <SelectItem value="job_feed">岗位同步</SelectItem>
                <SelectItem value="credit_account">积分账户</SelectItem>
              </SelectContent>
            </Select>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger className="w-full sm:w-56"><SelectValue placeholder="操作类型" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部操作</SelectItem>
                <SelectItem value="job.create">创建岗位</SelectItem>
                <SelectItem value="job.update">编辑岗位</SelectItem>
                <SelectItem value="job.delete">删除岗位</SelectItem>
                <SelectItem value="job.batch_create">批量导入岗位</SelectItem>
                <SelectItem value="job.batch_delete">批量删除岗位</SelectItem>
                <SelectItem value="config.create">创建配置</SelectItem>
                <SelectItem value="config.delete">删除配置</SelectItem>
                <SelectItem value="credits.adjust">调整积分</SelectItem>
                <SelectItem value="company_dna.update">更新企业 DNA</SelectItem>
                <SelectItem value="job_feed.sync">同步岗位数据</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-muted/50">
                <tr className="border-b">
                  <th className="px-3 py-2 text-left font-medium">时间</th>
                  <th className="px-3 py-2 text-left font-medium">操作</th>
                  <th className="px-3 py-2 text-left font-medium">资源</th>
                  <th className="px-3 py-2 text-left font-medium">学员短码</th>
                  <th className="px-3 py-2 text-left font-medium">结果</th>
                  <th className="px-3 py-2 text-left font-medium">审计摘要</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b last:border-0">
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-muted-foreground">{new Date(log.created_at).toLocaleString('zh-CN')}</td>
                    <td className="px-3 py-3 font-medium">{log.action}</td>
                    <td className="px-3 py-3 text-xs">{log.resource_type}{log.resource_id ? ` #${log.resource_id}` : ''}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{log.subject_user_id ? studentPublicCode(log.subject_user_id) : '-'}</td>
                    <td className="px-3 py-3"><Badge variant={log.success ? 'secondary' : 'destructive'}>{log.success ? '成功' : '失败'}</Badge></td>
                    <td className="max-w-[420px] truncate px-3 py-3 text-xs text-muted-foreground" title={formatAuditPayload(log.after_data || log.metadata)}>
                      {formatAuditPayload(log.after_data || log.metadata)}
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && !loading && <tr><td colSpan={6} className="py-10 text-center text-muted-foreground">暂无审计记录</td></tr>}
                {loading && <tr><td colSpan={6} className="py-10 text-center text-muted-foreground">加载中...</td></tr>}
              </tbody>
            </table>
          </div>
          {total > PAGE_SIZE && (
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>共 {total} 条，第 {page} / {totalPages} 页</span>
              <div className="flex gap-1">
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </AdminPageShell>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Send, Clock, Archive, PenLine, Plus, Trash2, Briefcase, MapPin, Loader2, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api-client';
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABELS,
  type ApplicationStatus,
} from '@/lib/application-status';

interface Application {
  id: number;
  job_id: number;
  resume_id: number;
  status: ApplicationStatus;
  notes: string;
  submitted_at: string;
  created_at: string;
  jobs: {
    title: string;
    company: string;
    region: string;
    direction: string;
  };
  resumes: {
    file_name: string;
  };
}

const statusMeta: Record<ApplicationStatus, { label: string; icon: typeof Clock; variant: 'default' | 'secondary' | 'outline' }> = {
  pending: { label: APPLICATION_STATUS_LABELS.pending.zh, icon: Clock, variant: 'secondary' },
  filling: { label: APPLICATION_STATUS_LABELS.filling.zh, icon: PenLine, variant: 'secondary' },
  submitted: { label: APPLICATION_STATUS_LABELS.submitted.zh, icon: Send, variant: 'default' },
  closed: { label: APPLICATION_STATUS_LABELS.closed.zh, icon: Archive, variant: 'outline' },
};

export default function ApplicationList() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | ApplicationStatus>('all');

  const fetchApplications = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiFetch('/api/applications');
      const data = await response.json();
      setApplications(data.applications || []);
    } catch (error) {
      console.error('Failed to fetch applications:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchApplications();
  }, [fetchApplications]);

  const filteredApplications = useMemo(
    () => (filter === 'all' ? applications : applications.filter((app) => app.status === filter)),
    [applications, filter]
  );

  const counts = useMemo(() => {
    const base = { total: applications.length, pending: 0, filling: 0, submitted: 0, closed: 0 };
    for (const app of applications) {
      if (app.status === 'pending') base.pending += 1;
      else if (app.status === 'filling') base.filling += 1;
      else if (app.status === 'submitted') base.submitted += 1;
      else base.closed += 1;
    }
    return base;
  }, [applications]);

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这条网申记录吗？')) return;
    try {
      const response = await apiFetch(`/api/applications/${id}`, { method: 'DELETE' });
      if (response.ok) {
        setApplications((apps) => apps.filter((app) => app.id !== id));
      } else {
        alert('删除失败');
      }
    } catch {
      alert('删除失败');
    }
  };

  const handleUpdateStatus = async (id: number, status: ApplicationStatus) => {
    try {
      const response = await apiFetch(`/api/applications/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await response.json();
      if (response.ok && data.application) {
        setApplications((apps) =>
          apps.map((app) =>
            app.id === id
              ? { ...app, status: data.application.status, submitted_at: data.application.submitted_at || app.submitted_at }
              : app
          )
        );
      } else {
        alert(data.error || '更新状态失败');
      }
    } catch {
      alert('更新状态失败');
    }
  };

  const StatusBadge = ({ status }: { status: ApplicationStatus }) => {
    const meta = statusMeta[status] || statusMeta.pending;
    const Icon = meta.icon;
    return (
      <Badge variant={meta.variant} className="gap-1">
        <Icon className="h-3 w-3" />
        {meta.label}
      </Badge>
    );
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-xl">
        <div className="rounded-lg border p-3">
          <div className="text-xl font-bold">{counts.total}</div>
          <div className="text-xs text-muted-foreground mt-0.5">总申请</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xl font-bold">{counts.pending}</div>
          <div className="text-xs text-muted-foreground mt-0.5">待投递</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xl font-bold">{counts.filling}</div>
          <div className="text-xs text-muted-foreground mt-0.5">填写中</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xl font-bold">{counts.submitted}</div>
          <div className="text-xs text-muted-foreground mt-0.5">已投递</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>
          全部 {counts.total}
        </FilterButton>
        {APPLICATION_STATUSES.map((status) => (
          <FilterButton key={status} active={filter === status} onClick={() => setFilter(status)}>
            {APPLICATION_STATUS_LABELS[status].zh} {counts[status]}
          </FilterButton>
        ))}
      </div>

      <div className="border rounded-lg overflow-hidden bg-card">
        <div className="border-b px-4 py-3 text-sm font-medium">申请列表</div>
        <div className="divide-y">
          {loading ? (
            <div className="text-center py-12 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
              加载中...
            </div>
          ) : filteredApplications.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Briefcase className="h-10 w-10 mx-auto mb-4 opacity-50" />
              <p className="mb-4">暂无网申记录</p>
              <Link href="/jobs">
                <Button size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  去添加岗位
                </Button>
              </Link>
            </div>
          ) : (
            filteredApplications.map((app) => (
              <div
                key={app.id}
                className="flex flex-col md:flex-row md:items-center gap-3 px-4 py-3 md:px-5 hover:bg-muted/40 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-sm truncate">{app.jobs?.title || '未知岗位'}</h3>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {app.jobs?.company || '未知公司'}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="inline-flex items-center gap-1 cursor-pointer">
                          <StatusBadge status={app.status} />
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {APPLICATION_STATUSES.map((status) => (
                          <DropdownMenuItem key={status} onClick={() => handleUpdateStatus(app.id, status)}>
                            {APPLICATION_STATUS_LABELS[status].zh}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {app.jobs?.region && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {app.jobs.region}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      创建于 {new Date(app.created_at).toLocaleDateString()}
                    </span>
                    {app.submitted_at && (
                      <span className="text-xs text-muted-foreground">
                        投递于 {new Date(app.submitted_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 md:pl-4">
                  <Button size="sm" variant="outline" asChild className="h-8 text-xs">
                    <Link
                      href={`/optimize?jobId=${app.job_id}&company=${encodeURIComponent(app.jobs?.company || '')}&position=${encodeURIComponent(app.jobs?.title || '')}&region=${encodeURIComponent(app.jobs?.region || '')}${app.resume_id ? `&resumeId=${app.resume_id}` : ''}`}
                    >
                      优化简历
                    </Link>
                  </Button>
                  <Button size="sm" variant="outline" asChild className="h-8 text-xs">
                    <Link href={`/jobs/${app.job_id}`}>查看详情</Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleDelete(app.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
        active
          ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
          : 'border text-muted-foreground hover:bg-muted'
      }`}
    >
      {children}
    </button>
  );
}

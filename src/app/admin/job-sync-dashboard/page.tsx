"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Ban,
  CheckCircle2,
  ChevronRight,
  Database,
  ExternalLink,
  FileWarning,
  Filter,
  Globe2,
  Layers3,
  Play,
  RefreshCw,
  Search,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAdminPermissions } from "@/components/admin-shell";
import { ADMIN_PERMISSIONS } from "@/lib/admin-permission-constants";

type Status =
  | "healthy"
  | "running"
  | "attention"
  | "failed"
  | "retrying"
  | "stalled"
  | "discovery_required"
  | "unknown";
type Field =
  | "location"
  | "workplace_type"
  | "employment_category"
  | "experience"
  | "salary"
  | "deadline";
type LiveRun = {
  id: number;
  stage: string | null;
  currentCompany: string | null;
  currentPage: number;
  currentCursorPreview: string | null;
  hasMore: boolean;
  totalCandidates: number;
  processedCandidates: number;
  remainingCandidates: number;
  lastHeartbeatAt: string | null;
  pages: number;
  received: number;
  upserted: number;
  rowFailures: number;
  fatalFailures: number;
  startedAt: string;
};
type Coverage = {
  verified: number;
  pending_recheck: number;
  rejected_legacy: number;
  unavailable_on_official_source: number;
  verified_percent: number;
};
type Company = {
  companyName: string;
  upstreamCompanyId: string | null;
  logo: { logo_url: string | null; fallback_logo_url: string | null };
  source: {
    type: string;
    basis: string;
    status: string;
    careersUrl: string | null;
    hosts: unknown[];
    connector: string | null;
  };
  status: Status;
  reasons: Array<{ code: string; label: string }>;
  counts: {
    localActiveJobs: number;
    officialActiveJobs: number | null;
    upstreamDiscoveredJobs: number | null;
    officialVsUpstreamDelta: number | null;
    officialCountSource?: string;
    officialCountStatus?: string;
    officialCountLowerBound?: number | null;
  };
  feed: {
    mode: string;
    stateSource: string;
    status: Status;
    cursorPreview: string | null;
    lastSuccessAt: string | null;
    lastAttemptedAt: string | null;
    nextRetryAt: string | null;
    consecutiveFailures: number;
    leaseExpiresAt: string | null;
    lastError: string | null;
    lastReceived: number;
    lastUpserted: number;
    lastClosed: number;
    lastRowFailures: number;
    lastFatalFailures: number;
    liveRun: LiveRun | null;
  };
  official: {
    stateSource: string | null;
    status: Status;
    cursorPreview: string | null;
    lastSuccessAt: string | null;
    lastAttemptedAt: string | null;
    nextRetryAt: string | null;
    consecutiveFailures: number;
    leaseExpiresAt: string | null;
    lastError: string | null;
    fields: Record<string, Coverage>;
    fieldTotals: {
      verified: number;
      pending: number;
      rejected: number;
      unavailable: number;
    };
    liveRun: LiveRun | null;
  };
  failures: {
    pending: number;
    processing: number;
    resolved: number;
    dead: number;
  };
  historicalReview?: {
    sourceSystem: string;
    status: string;
    totalCandidates: number;
    processedCandidates: number;
    remainingCandidates: number;
    updatedJobs: number;
    unavailableFields: number;
    skippedJobs: number;
    failedJobs: number;
    lastError: string | null;
    lastHeartbeatAt: string | null;
    nextRunAt: string | null;
    leaseExpiresAt: string | null;
    liveRun: LiveRun | null;
  } | null;
};
type ActiveRun = LiveRun & {
  sourceSystem: string;
  mode: string;
  company: string | null;
};
type Dashboard = {
  generatedAt: string;
  freshness: {
    databaseSnapshotAt: string | null;
    countReconciliationCompanies: number;
  };
  summary: {
    activeCompanies: number;
    healthyCompanies: number;
    attentionCompanies: number;
    failedCompanies: number;
    runningCompanies: number;
    localActiveJobs: number;
    officialActiveJobs: number | null;
    upstreamDiscoveredJobs: number | null;
    countDelta: number | null;
    feed: {
      status: Status;
      cursorPreview: string | null;
      lastSuccessAt: string | null;
      lastAttemptedAt: string | null;
      leaseExpiresAt: string | null;
      consecutiveFailures: number;
      lastError: string | null;
      liveRun: LiveRun | null;
    } | null;
    activeRuns: ActiveRun[];
    activeRun: ActiveRun | null;
    officialDue: number;
    failures: {
      pending: number;
      processing: number;
      resolved: number;
      dead: number;
    };
  };
  companies: Company[];
};
type Detail = Company & {
  runs: Array<Record<string, unknown>>;
  failureSamples: Array<Record<string, unknown>>;
};

const fields: Record<Field, string> = {
  location: "地点",
  workplace_type: "工作方式",
  employment_category: "岗位类型",
  experience: "经验",
  salary: "薪资",
  deadline: "截止日期",
};
const statuses: Record<Status, string> = {
  healthy: "正常",
  running: "正在处理",
  attention: "需要关注",
  failed: "处理失败",
  retrying: "等待重试",
  stalled: "长时间没有进展",
  discovery_required: "等待探测",
  unknown: "尚未开始",
};
const statusStyles: Record<Status, string> = {
  healthy: "border-emerald-200 bg-emerald-50 text-emerald-700",
  running: "border-blue-200 bg-blue-50 text-blue-700",
  attention: "border-amber-200 bg-amber-50 text-amber-700",
  failed: "border-red-200 bg-red-50 text-red-700",
  retrying: "border-orange-200 bg-orange-50 text-orange-700",
  stalled: "border-red-200 bg-red-50 text-red-700",
  discovery_required: "border-slate-200 bg-slate-50 text-slate-700",
  unknown: "border-slate-200 bg-slate-50 text-slate-600",
};
const stages: Record<string, string> = {
  claiming: "准备任务",
  fetching: "从上游服务器读取岗位",
  processing_company: "处理这家公司岗位",
  writing: "写入本站数据库",
  finalizing: "整理本轮结果",
  waiting: "等待下一页",
};
const fmt = (value: number | null | undefined) =>
  new Intl.NumberFormat("zh-CN").format(value ?? 0);
const when = (value: string | null | undefined) => {
  if (!value) return "暂无";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "暂无"
    : new Intl.DateTimeFormat("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(date);
};
const pct = (value: number | undefined) =>
  Math.max(0, Math.min(100, Number(value) || 0));
function StatusTag({ status }: { status: Status }) {
  return (
    <Badge variant="outline" className={`gap-1.5 ${statusStyles[status]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {statuses[status]}
    </Badge>
  );
}
function CompanyLogo({ company }: { company: Company }) {
  const [fallback, setFallback] = useState(false);
  const src = fallback ? company.logo.fallback_logo_url : company.logo.logo_url;
  return src ? (
    <img
      src={src}
      alt={`${company.companyName} logo`}
      className="h-11 w-11 shrink-0 rounded-xl border bg-white object-contain p-1"
      onError={() => setFallback(true)}
    />
  ) : (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-sm font-semibold text-white">
      {company.companyName.slice(0, 2).toUpperCase()}
    </span>
  );
}
function Metric({
  label,
  value,
  note,
  icon: Icon,
  tone = "normal",
}: {
  label: string;
  value: string;
  note: string;
  icon: typeof Globe2;
  tone?: "normal" | "good" | "warn";
}) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon
          className={`h-3.5 w-3.5 ${tone === "good" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : ""}`}
        />
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold leading-tight">{value}</div>
      <div className="mt-1 break-words text-[11px] leading-4 text-muted-foreground">
        {note}
      </div>
    </div>
  );
}
function LiveProgress({ run, companyName }: { run: LiveRun; companyName?: string | null }) {
  const total = Math.max(0, Number(run.totalCandidates) || 0);
  const processed = Math.max(
    0,
    Number(run.processedCandidates) || Number(run.received) || 0,
  );
  const remaining = Math.max(
    0,
    Number(run.remainingCandidates) || (total > 0 ? total - processed : 0),
  );
  const percent =
    total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : null;
  return (
    <div className="rounded-xl border-2 border-blue-200 bg-blue-50/70 p-5 dark:border-blue-900 dark:bg-blue-950/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-base font-semibold text-blue-800 dark:text-blue-200">
          <Activity className="h-5 w-5 animate-pulse" />
          {stages[run.stage || ""] || run.stage || "同步任务正在运行"}
        </div>
        <span className="text-sm text-blue-700 dark:text-blue-300">
          最近进度：{when(run.lastHeartbeatAt)}
        </span>
      </div>
      <div className="mt-3 rounded-lg border border-blue-300 bg-blue-100/80 px-4 py-3 text-lg font-bold text-blue-950 dark:border-blue-800 dark:bg-blue-900/40 dark:text-blue-100">
        正在处理：{companyName || run.currentCompany || "未标记公司"}
      </div>
      <div className="mt-4 rounded-lg border border-blue-200 bg-white/70 p-4 dark:bg-blue-950/20">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-sm text-muted-foreground">当前公司</div>
            <div className="mt-1 break-words text-lg font-semibold">
              {run.currentCompany || companyName || "未标记公司"}
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm text-muted-foreground">完成比例</div>
            <div className="mt-1 text-3xl font-bold text-blue-700 dark:text-blue-200">
              {percent === null ? "统计中" : `${percent}%`}
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div>
            <div className="text-sm text-muted-foreground">本轮总岗位</div>
            <div className="mt-1 text-2xl font-bold">
              {total > 0 ? fmt(total) : "统计中"}
            </div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">已经处理</div>
            <div className="mt-1 text-2xl font-bold text-blue-700 dark:text-blue-200">
              {fmt(processed)}
            </div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">还剩未处理</div>
            <div className="mt-1 text-2xl font-bold text-amber-600">
              {total > 0 ? fmt(remaining) : "统计中"}
            </div>
          </div>
        </div>
        {percent !== null && <Progress value={percent} className="mt-4 h-3" />}
        <div className="mt-3 text-sm text-muted-foreground">
          第 {fmt(run.currentPage)} 批 · 已写入 {fmt(run.upserted)} · 跳过/失败{" "}
          {fmt(run.rowFailures)} ·{" "}
          {run.hasMore ? "还有后续岗位" : "本轮即将完成"}
        </div>
      </div>
    </div>
  );
}
function CompanyCard({
  company,
  onOpen,
}: {
  company: Company;
  onOpen: (name: string) => void;
}) {
  const coverage = Object.values(company.official.fields);
  const verified = coverage.length
    ? coverage.reduce((sum, item) => sum + pct(item.verified_percent), 0) /
      coverage.length
    : 0;
  const pending = company.official.fieldTotals.pending;
  const activeRun = company.feed.liveRun || company.official.liveRun || company.historicalReview?.liveRun || null;
  const running = Boolean(activeRun || company.status === "running");
  const reviewProgress = !activeRun && company.historicalReview && company.historicalReview.totalCandidates > 0
    ? company.historicalReview
    : null;
  const total = activeRun
    ? Math.max(0, Number(activeRun.totalCandidates) || 0)
    : reviewProgress?.totalCandidates || 0;
  const processed = activeRun
    ? Math.max(0, Number(activeRun.processedCandidates) || 0)
    : reviewProgress?.processedCandidates || 0;
  const remaining = activeRun
    ? Math.max(0, Number(activeRun.remainingCandidates) || Math.max(0, total - processed))
    : reviewProgress?.remainingCandidates || 0;
  const progress = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : null;
  const runLabel = company.feed.liveRun ? "正在同步岗位" : company.official.liveRun ? "正在补全字段" : "历史字段复核";
  const statusText = running
    ? activeRun
      ? `${runLabel} · ${activeRun.currentCompany || company.companyName}`
      : "任务正在准备"
    : company.historicalReview?.status === "completed"
      ? `历史复核已完成：补全 ${fmt(company.historicalReview.updatedJobs)} 个岗位，失败 ${fmt(company.historicalReview.failedJobs)} 个`
      : company.historicalReview?.status === "paused"
        ? `历史复核已暂停：${company.historicalReview.lastError || "等待来源或写入条件"}`
    : company.reasons[0]?.label || (company.status === "healthy" ? "最近一轮已完成，等待新岗位" : "当前没有执行中的任务");
  return (
    <button
      type="button"
      onClick={() => onOpen(company.companyName)}
      className="block w-full text-left"
    >
      <Card
        className={`h-full min-w-0 overflow-hidden transition-shadow hover:shadow-md ${running ? "border-blue-300 ring-1 ring-blue-200" : ""}`}
      >
        <CardHeader className="pb-4">
          <div className="flex items-start gap-3">
            <CompanyLogo company={company} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="break-words text-xl leading-6">
                  {company.companyName}
                </CardTitle>
                <StatusTag status={company.status} />
              </div>
              <p className={`mt-2 break-words text-sm leading-5 ${running ? "font-medium text-blue-700" : company.reasons.length ? "text-amber-700" : "text-muted-foreground"}`}>
                {statusText}
              </p>
            </div>
            <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="grid min-w-0 gap-3 md:grid-cols-3">
            <div className="min-w-0 rounded-xl border bg-muted/20 p-4">
              <div className="text-sm text-muted-foreground">本站有效岗位</div>
              <div className="mt-1 break-all text-3xl font-bold leading-tight tabular-nums">{fmt(company.counts.localActiveJobs)}</div>
              <div className="mt-1 text-xs text-muted-foreground">已按展示规则筛选</div>
            </div>
            <div className={`min-w-0 rounded-xl border p-4 ${activeRun ? "border-blue-200 bg-blue-50/60" : "bg-muted/20"}`}>
              <div className="text-sm text-muted-foreground">本轮已处理</div>
              <div className="mt-1 break-all text-3xl font-bold leading-tight tabular-nums">{total > 0 ? fmt(processed) : "—"}</div>
              <div className="mt-1 text-xs text-muted-foreground">{total > 0 ? `共 ${fmt(total)} 个岗位` : "本轮尚未建立岗位清单"}</div>
            </div>
            <div className={`min-w-0 rounded-xl border p-4 ${activeRun && remaining > 0 ? "border-amber-200 bg-amber-50/60" : "bg-muted/20"}`}>
              <div className="text-sm text-muted-foreground">本轮剩余</div>
              <div className="mt-1 break-all text-3xl font-bold leading-tight tabular-nums">{total > 0 ? fmt(remaining) : "—"}</div>
              <div className="mt-1 text-xs text-muted-foreground">{total > 0 ? (progress === null ? "正在统计" : `已完成 ${progress}%`) : "等待建立岗位清单"}</div>
            </div>
          </div>
          {progress !== null && <div><div className="mb-1 flex items-center justify-between text-sm"><span className="font-medium">{runLabel} · {company.companyName}</span><span className="font-semibold tabular-nums">{progress}%</span></div><Progress value={progress} className="h-2.5" /></div>}
          <div className="grid min-w-0 gap-3 rounded-xl border bg-muted/10 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0"><div className="text-sm font-medium">字段覆盖</div><div className="mt-1 text-2xl font-bold tabular-nums">{Math.round(verified)}%</div><Progress value={pct(verified)} className="mt-2 h-2" /></div>
            <div className="min-w-0 sm:text-right"><div className="text-sm text-muted-foreground">历史待复核</div><div className="mt-1 break-all text-2xl font-bold tabular-nums">{fmt(pending)}</div><div className="text-xs text-muted-foreground">不等于本轮剩余岗位</div></div>
          </div>
          {company.historicalReview && (
            <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 text-violet-950">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">历史字段复核</div>
                <Badge variant="outline" className="border-violet-300 text-violet-800">
                  {company.historicalReview.status === "running"
                    ? "正在复核"
                    : company.historicalReview.status === "completed"
                      ? "本轮完成"
                      : company.historicalReview.status === "paused"
                        ? "已暂停"
                        : company.historicalReview.status === "failed"
                          ? "复核失败"
                          : "等待复核"}
                </Badge>
              </div>
              <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div>已处理 <span className="font-bold tabular-nums">{fmt(company.historicalReview.processedCandidates)}</span></div>
                <div>还剩 <span className="font-bold tabular-nums">{fmt(company.historicalReview.remainingCandidates)}</span></div>
                <div>实际补全岗位 <span className="font-bold tabular-nums">{fmt(company.historicalReview.updatedJobs)}</span></div>
                <div>官网未提供字段 <span className="font-bold tabular-nums">{fmt(company.historicalReview.unavailableFields)}</span></div>
                <div>跳过岗位 <span className="font-bold tabular-nums">{fmt(company.historicalReview.skippedJobs)}</span></div>
                <div>失败岗位 <span className="font-bold tabular-nums">{fmt(company.historicalReview.failedJobs)}</span></div>
              </div>
              <div className="mt-3 rounded-lg border border-violet-200 bg-white/60 px-3 py-2 text-sm dark:border-violet-800 dark:bg-violet-950/30">
                {company.historicalReview.status === "completed"
                  ? `本轮已完成：补全 ${fmt(company.historicalReview.updatedJobs)} 个岗位，官网未提供 ${fmt(company.historicalReview.unavailableFields)} 个字段，跳过 ${fmt(company.historicalReview.skippedJobs)} 个，失败 ${fmt(company.historicalReview.failedJobs)} 个。`
                  : company.historicalReview.status === "paused"
                    ? `当前没有执行：${company.historicalReview.lastError || "等待人工处理来源或开启写入"}。`
                    : "任务会按公司顺序连续处理；只有失败或长时间无进展才会让出处理名额。"}
              </div>
              <div className="mt-2 text-xs text-violet-700">复核只补地点、工作方式、岗位类型、经验、薪资、截止日期及官网证据，不新增岗位、不改变上下架。健康公司会持续处理到剩余为 0；只有失败或卡住才会暂时让出处理名额。</div>
            </div>
          )}
        </CardContent>
      </Card>
    </button>
  );
}

export default function JobSyncDashboardPage() {
  const { loading: permissionsLoading, hasPermission } = useAdminPermissions();
  const allowed = hasPermission(ADMIN_PERMISSIONS.dashboardRead);
  const canWrite = hasPermission(ADMIN_PERMISSIONS.jobSyncWrite);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [status, setStatus] = useState("all");
  const [field, setField] = useState("all");
  const [search, setSearch] = useState("");
  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/job-sync-dashboard", {
        cache: "no-store",
      });
      const payload = (await response.json()) as Dashboard & {
        error?: string | { message?: string };
      };
      if (!response.ok)
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : payload.error?.message || "读取同步状态失败",
        );
      setDashboard(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取同步状态失败");
    } finally {
      setLoading(false);
    }
  }, []);
  const runAction = useCallback(
    async (action: string, payload: Record<string, unknown> = {}) => {
      if (!canWrite) return;
      setActionBusy(true);
      setError("");
      setNotice("");
      try {
        const response = await fetch("/api/admin/job-sync-dashboard/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...payload }),
        });
        const result = (await response.json()) as {
          data?: { requeuedIds?: number[]; aborted?: boolean };
          error?: { message?: string };
        };
        if (!response.ok) throw new Error(result.error?.message || "操作失败");
        if (action === "run_incremental")
          setNotice("已启动一轮增量同步，页面会显示实时进度。");
        else if (action === "run_company")
          setNotice("已启动该公司的定向同步。");
        else if (action === "run_official_company")
          setNotice("已启动该公司的官方字段补全。");
        else if (action === "retry_failures")
          setNotice(
            `已重新放回 ${fmt(result.data?.requeuedIds?.length)} 条失败记录。`,
          );
        else if (action === "abort_stale_reconcile")
          setNotice(
            result.data?.aborted
              ? "已清理过期的全量对账进度，岗位数据未被删除。"
              : "没有发现需要清理的过期对账。",
          );
        else setNotice("操作已完成。");
        await fetchDashboard();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "操作失败");
      } finally {
        setActionBusy(false);
      }
    },
    [canWrite, fetchDashboard],
  );
  useEffect(() => {
    if (!permissionsLoading && allowed) void fetchDashboard();
  }, [allowed, fetchDashboard, permissionsLoading]);
  useEffect(() => {
    document.body.dataset.jobSyncDashboard = "true";
    return () => {
      delete document.body.dataset.jobSyncDashboard;
    };
  }, []);
  useEffect(() => {
    if (!allowed) return;
    const refreshMs = dashboard?.summary.activeRuns?.length ? 5_000 : 30_000;
    const timer = window.setInterval(() => void fetchDashboard(), refreshMs);
    return () => window.clearInterval(timer);
  }, [allowed, dashboard?.summary.activeRuns?.length, fetchDashboard]);
  const openDetail = async (companyName: string) => {
    setSelected(companyName);
    setDetail(null);
    setDetailLoading(true);
    try {
      const response = await fetch(
        `/api/admin/job-sync-dashboard/${encodeURIComponent(companyName)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as {
        data?: Detail;
        error?: { message?: string };
      };
      if (!response.ok || !payload.data)
        throw new Error(payload.error?.message || "读取公司详情失败");
      setDetail(payload.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取公司详情失败");
    } finally {
      setDetailLoading(false);
    }
  };
  const companies = useMemo(() => {
    const list = (dashboard?.companies || []).filter((company) => {
      const statusMatch =
        status === "all" ||
        (status === "attention"
          ? [
              "attention",
              "retrying",
              "stalled",
              "discovery_required",
              "unknown",
            ].includes(company.status)
          : company.status === status);
      const fieldMatch =
        field === "all" ||
        (company.official.fields[field]?.pending_recheck || 0) > 0 ||
        (company.official.fields[field]?.rejected_legacy || 0) > 0;
      return (
        statusMatch &&
        fieldMatch &&
        (!search.trim() ||
          company.companyName
            .toLowerCase()
            .includes(search.trim().toLowerCase()))
      );
    });
    return [...list].sort(
      (left, right) =>
        Number(
          Boolean(
            right.feed.liveRun ||
              right.official.liveRun ||
              right.status === "running",
          ),
        ) -
          Number(
            Boolean(
              left.feed.liveRun ||
                left.official.liveRun ||
                left.status === "running",
            ),
          ) || left.companyName.localeCompare(right.companyName),
    );
  }, [dashboard, field, search, status]);
  if (permissionsLoading || (loading && !dashboard))
    return (
      <main className="min-h-screen p-8">
        <div className="mx-auto max-w-[1800px] space-y-5">
          <div className="h-48 animate-pulse rounded-xl bg-muted" />
          <div className="grid gap-5 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, index) => (
          <div
                key={index}
                className="h-52 animate-pulse rounded-xl bg-muted"
              />
            ))}
          </div>
        </div>
      </main>
    );
  if (!allowed)
    return (
      <main className="p-8">
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            当前管理员没有查看岗位同步大屏的权限。
          </CardContent>
        </Card>
      </main>
    );
  const summary = dashboard?.summary;
  const feed = summary?.feed;
  const active = summary?.activeRun;
  const activeRuns = summary?.activeRuns || [];
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-muted/20 px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-[1800px] space-y-5">
        <header className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Activity className="h-4 w-4 text-primary" />
              岗位同步运行台
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">
              岗位同步状态
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              只展示当前运行状态、岗位数量和需要处理的问题。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              每 60 秒自动刷新
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchDashboard()}
              disabled={loading}
            >
              <RefreshCw
                className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
              刷新
            </Button>
          </div>
        </header>
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        )}
        {notice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {notice}
          </div>
        )}
        {summary && dashboard && (
          <section className="rounded-xl border bg-card p-4 shadow-sm md:p-5">
            <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Activity
                    className={`h-4 w-4 ${active ? "animate-pulse text-blue-600" : "text-primary"}`}
                  />
                  系统现在在做什么
                </div>
                <p className="mt-1 break-words text-lg font-semibold">
                  {active
                    ? `${stages[active.stage || ""] || "处理同步任务"}${active.company ? `：${active.company}` : ""}`
                    : feed?.status === "healthy"
                      ? "主同步空闲，等待下一轮岗位变化"
                      : "当前没有正在执行的任务"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  数据生成于 {when(dashboard.generatedAt)} · 数据库最新观测{" "}
                  {when(dashboard.freshness.databaseSnapshotAt)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canWrite && (
                  <Button
                    size="sm"
                    onClick={() => {
                      if (
                        window.confirm(
                          "立即开始一轮增量同步？最多处理 10 页，不执行全量对账。",
                        )
                      )
                        void runAction("run_incremental", { maxPages: 10 });
                    }}
                    disabled={actionBusy || Boolean(active)}
                  >
                    <Play className="mr-1 h-3.5 w-3.5" />
                    立即同步
                  </Button>
                )}
                {canWrite && (
                  <Button
                    variant="outline"
                    size="sm"
                    title="只释放已经超时的对账任务占用，不删除岗位或公司数据"
                    onClick={() => {
                      if (
                        window.confirm(
                          "只清理已经超时的对账任务占用？不会删除岗位，也不会修改岗位上下架状态。",
                        )
                      )
                        void runAction("abort_stale_reconcile");
                    }}
                    disabled={actionBusy}
                  >
                    <Ban className="mr-1 h-3.5 w-3.5" />
                    清理卡住的对账占用
                  </Button>
                )}
              </div>
            </div>
            {activeRuns.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="text-sm font-semibold">
                  同时处理中的公司（{activeRuns.length}）
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  {activeRuns.map((run) => (
                    <LiveProgress key={run.id} run={run} companyName={run.company} />
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
        {summary && (
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              [
                "活跃公司",
                fmt(summary.activeCompanies),
                `正在处理 ${fmt(summary.runningCompanies)} 家`,
              ],
              ["正常", fmt(summary.healthyCompanies), "当前没有阻塞"],
              ["正在处理", fmt(summary.runningCompanies), "卡片会显示实时进度"],
              [
                "需要关注",
                fmt(summary.attentionCompanies),
                `失败 ${fmt(summary.failedCompanies)} 家`,
              ],
              ["本站有效岗位", fmt(summary.localActiveJobs), "按展示规则筛选后的岗位"],
            ].map(([label, value, note]) => (
              <Card key={label}>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="mt-1 text-2xl font-semibold">{value}</div>
                  <div className="mt-1 break-words text-xs text-muted-foreground">
                    {note}
                  </div>
                </CardContent>
              </Card>
            ))}
          </section>
        )}
        <section className="rounded-xl border border-sky-200 bg-sky-50/70 p-4 text-sky-950 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-100">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">历史字段复核是做什么的？</h2>
            <span className="text-xs font-medium text-sky-700 dark:text-sky-300">只补字段，不重同步岗位</span>
          </div>
          <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
            <div className="rounded-lg border border-sky-200 bg-white/60 p-3 dark:border-sky-800 dark:bg-sky-950/30">
              <div className="font-medium">1. 读取官网详情</div>
              <p className="mt-1 leading-5 text-sky-900/75 dark:text-sky-100/75">逐个打开本站已有岗位对应的官方页面，寻找六项真实字段和证据。</p>
            </div>
            <div className="rounded-lg border border-sky-200 bg-white/60 p-3 dark:border-sky-800 dark:bg-sky-950/30">
              <div className="font-medium">2. 补齐本站字段</div>
              <p className="mt-1 leading-5 text-sky-900/75 dark:text-sky-100/75">只写入地点、工作方式、岗位类型、经验、薪资、截止日期及来源证据。</p>
            </div>
            <div className="rounded-lg border border-sky-200 bg-white/60 p-3 dark:border-sky-800 dark:bg-sky-950/30">
              <div className="font-medium">3. 给出处理结果</div>
              <p className="mt-1 leading-5 text-sky-900/75 dark:text-sky-100/75">补全成功、官网未提供、跳过、失败分别计数；不会新增岗位，也不会改变上下架。</p>
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-sky-800/80 dark:text-sky-200/80">所以复核完成后岗位总数通常不会变化；要看它是否生效，请看公司卡片里的“已处理、还剩、实际补全、官网未提供、跳过、失败”，而不是只看岗位数量。</p>
        </section>
        <section className="flex flex-col gap-3 rounded-xl border bg-card p-3 md:flex-row md:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索公司"
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-[145px]">
                <SelectValue placeholder="公司状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部公司</SelectItem>
                <SelectItem value="running">正在处理</SelectItem>
                <SelectItem value="attention">需要关注</SelectItem>
                <SelectItem value="failed">处理失败</SelectItem>
                <SelectItem value="healthy">正常</SelectItem>
              </SelectContent>
            </Select>
            <Select value={field} onValueChange={setField}>
              <SelectTrigger className="w-[145px]">
                <SelectValue placeholder="字段问题" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部字段</SelectItem>
                {Object.entries(fields).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}待处理
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </section>
        {companies.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              没有符合条件的公司。
            </CardContent>
          </Card>
        ) : (
          <section className="grid gap-5 lg:grid-cols-3">
            {companies.map((company) => (
              <CompanyCard
                key={company.companyName}
                company={company}
                onOpen={openDetail}
              />
            ))}
          </section>
        )}
      </div>
      <Sheet
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) {
            setSelected("");
            setDetail(null);
          }
        }}
      >
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-xl"
        >
          <SheetHeader>
            <SheetTitle>{selected || "公司详情"}</SheetTitle>
            <SheetDescription>
              查看这家公司在官网、上游服务器、本站数据库和字段补全的具体位置。
            </SheetDescription>
          </SheetHeader>
          {detailLoading && (
            <div className="px-4 py-8 text-sm text-muted-foreground">
              正在读取详情…
            </div>
          )}
          {detail && (
            <div className="space-y-5 px-4 pb-8">
              <div className="flex items-start gap-3">
                <CompanyLogo company={detail} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusTag status={detail.status} />
                  </div>
                  <p className="mt-1 break-words text-sm text-muted-foreground">
                    {detail.reasons[0]?.label || "当前没有阻塞"}
                  </p>
                </div>
              </div>
              {canWrite && (
                <div className="flex flex-wrap gap-2 rounded-lg border bg-muted/20 p-3">
                  <Button
                    size="sm"
                    onClick={() => {
                      if (
                        window.confirm(
                          `处理 ${detail.companyName} 的一轮岗位？`,
                        )
                      )
                        void runAction("run_company", {
                          company: detail.companyName,
                          maxPages: 10,
                        });
                    }}
                    disabled={actionBusy || Boolean(detail.feed.liveRun)}
                  >
                    <Play className="mr-1 h-3.5 w-3.5" />
                    处理这家公司
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (
                        window.confirm(
                          `补全 ${detail.companyName} 的官方字段？`,
                        )
                      )
                        void runAction("run_official_company", {
                          company: detail.companyName,
                        });
                    }}
                    disabled={
                      actionBusy ||
                      Boolean(
                        detail.official.liveRun ||
                          detail.official.leaseExpiresAt,
                      )
                    }
                  >
                    <Wrench className="mr-1 h-3.5 w-3.5" />
                    补全官方字段
                  </Button>
                  {detail.feed.status === "stalled" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void runAction("release_expired_lease", {
                          sourceSystem: detail.feed.stateSource,
                        })
                      }
                      disabled={actionBusy}
                    >
                      <Ban className="mr-1 h-4 w-4" />
                      释放过期占用
                    </Button>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Metric
                  icon={Globe2}
                  label="官网岗位数"
                  value={
                    detail.counts.officialActiveJobs === null
                      ? detail.counts.officialCountStatus === "capped_unavailable"
                        ? `至少 ${fmt(detail.counts.officialCountLowerBound || 0)}`
                        : "未知"
                      : fmt(detail.counts.officialActiveJobs)
                  }
                  note={detail.counts.officialCountStatus === "capped_unavailable"
                    ? "官方接口有数量上限，不能得出精确总数"
                    : `官方来源：${detail.counts.officialCountSource || "未记录"}`}
                />
                <Metric
                  icon={Database}
                  label="上游已采到"
                  value={
                    detail.counts.upstreamDiscoveredJobs === null
                      ? "未知"
                      : fmt(detail.counts.upstreamDiscoveredJobs)
                  }
                  note="最近成功批次"
                />
                <Metric
                  icon={Layers3}
                  label="本站数据库"
                  value={fmt(detail.counts.localActiveJobs)}
                  note="筛选后入库"
                />
                <Metric
                  icon={CheckCircle2}
                  label="字段补全"
                  value={`${Math.round(Object.values(detail.official.fields).reduce((sum, item) => sum + pct(item.verified_percent), 0) / Math.max(1, Object.keys(detail.official.fields).length))}%`}
                  note={`历史待复核 ${fmt(detail.official.fieldTotals.pending)} 条 · 历史拒绝 ${fmt(detail.official.fieldTotals.rejected)} 条`}
                />
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">当前处理位置</h3>
                {detail.feed.liveRun && (
                  <LiveProgress run={detail.feed.liveRun} companyName={detail.companyName} />
                )}
                {detail.official.liveRun && (
                  <LiveProgress run={detail.official.liveRun} companyName={detail.companyName} />
                )}
                {detail.historicalReview?.liveRun && (
                  <LiveProgress run={detail.historicalReview.liveRun} companyName={detail.companyName} />
                )}
                <div className="rounded-lg border p-3 text-sm">
                  <div className="font-medium">
                    岗位从上游服务器到本站数据库
                  </div>
                  <div className="mt-2 grid gap-1 text-xs">
                    <div>处理阶段：{detail.feed.liveRun ? stages[detail.feed.liveRun.stage || ""] || "正在处理" : detail.feed.status === "healthy" ? "已完成最近一轮" : "等待处理"}</div>
                    <div>
                      最近成功：{when(detail.feed.lastSuccessAt)} · 最近尝试：
                      {when(detail.feed.lastAttemptedAt)}
                    </div>
                    <div>
                      本次结果：读取 {fmt(detail.feed.lastReceived)} · 写入{" "}
                      {fmt(detail.feed.lastUpserted)} · 关闭{" "}
                      {fmt(detail.feed.lastClosed)} · 行失败{" "}
                      {fmt(detail.feed.lastRowFailures)} · 页面失败{" "}
                      {fmt(detail.feed.lastFatalFailures)}
                    </div>
                  </div>
                  {detail.feed.lastError && (
                    <p className="mt-2 break-words text-xs text-red-600">
                      {detail.feed.lastError}
                    </p>
                  )}
                </div>
                <div className="rounded-lg border p-3 text-sm">
                  <div className="font-medium">官方字段补全</div>
                  <div className="mt-2 grid gap-1 text-xs">
                    <div>处理阶段：{detail.official.liveRun ? stages[detail.official.liveRun.stage || ""] || "正在处理" : detail.official.status === "healthy" ? "已完成最近一轮" : "等待处理"}</div>
                    <div>
                      最近成功：{when(detail.official.lastSuccessAt)} ·
                      最近尝试：{when(detail.official.lastAttemptedAt)}
                    </div>
                    <div>
                      待复核 {fmt(detail.official.fieldTotals.pending)} ·
                      历史拒绝 {fmt(detail.official.fieldTotals.rejected)} ·
                      官网未提供 {fmt(detail.official.fieldTotals.unavailable)}
                    </div>
                  </div>
                  {detail.official.lastError && (
                    <p className="mt-2 break-words text-xs text-red-600">
                      {detail.official.lastError}
                    </p>
                  )}
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">六项字段</h3>
                <div className="space-y-2">
                  {(
                    Object.entries(detail.official.fields) as Array<
                      [Field, Coverage]
                    >
                  ).map(([key, item]) => (
                    <div key={key} className="rounded-lg border p-3">
                      <div className="flex justify-between gap-2 text-sm">
                        <span>{fields[key]}</span>
                        <span>{Math.round(item.verified_percent)}% 已验证</span>
                      </div>
                      <Progress
                        value={pct(item.verified_percent)}
                        className="mt-2 h-1.5"
                      />
                      <div className="mt-1 break-words text-xs text-muted-foreground">
                        待复核 {fmt(item.pending_recheck)} · 历史拒绝{" "}
                        {fmt(item.rejected_legacy)} · 官网未提供{" "}
                        {fmt(item.unavailable_on_official_source)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">最近运行</h3>
                {detail.runs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无运行记录</p>
                ) : (
                  <div className="divide-y rounded-lg border">
                    {detail.runs.slice(0, 8).map((run, index) => (
                      <div
                        key={String(run.id || index)}
                        className="break-words p-3 text-xs"
                      >
                        <div className="flex flex-wrap justify-between gap-2">
                          <span className="font-medium">
                            {String(run.mode || "同步")} ·{" "}
                            {String(run.status || "未知")}
                          </span>
                          <span className="text-muted-foreground">
                            {when(
                              typeof run.started_at === "string"
                                ? run.started_at
                                : null,
                            )}
                          </span>
                        </div>
                        <p className="mt-1 text-muted-foreground">
                          {Number(run.total_candidates) > 0
                            ? `处理 ${fmt(Number(run.processed_candidates) || 0)} / ${fmt(Number(run.total_candidates))}，剩余 ${fmt(Number(run.remaining_candidates) || 0)} · `
                            : ""}
                          读取 {fmt(Number(run.received) || 0)} · 写入{" "}
                          {fmt(Number(run.upserted) || 0)} · 关闭{" "}
                          {fmt(Number(run.closed) || 0)} · 行失败{" "}
                          {fmt(Number(run.row_failures) || 0)}
                        </p>
                        {typeof run.error_message === "string" &&
                          run.error_message && (
                            <p className="mt-1 text-red-600">
                              {run.error_message}
                            </p>
                          )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {canWrite && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => void runAction("start_historical_review", { company: detail.companyName })}
                      disabled={actionBusy}
                    >
                      <Wrench className="mr-1 h-4 w-4" />
                      开始历史复核
                    </Button>
                    {detail.historicalReview && ["queued", "running"].includes(detail.historicalReview.status) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void runAction("pause_historical_review", { company: detail.companyName })}
                        disabled={actionBusy}
                      >
                        <Ban className="mr-1 h-4 w-4" />
                        暂停历史复核
                      </Button>
                    )}
                  </>
                )}
                <Link href="/admin/job-rotation">
                  <Button variant="outline" size="sm">
                    <ArrowRight className="mr-1 h-4 w-4" />
                    岗位轮换
                  </Button>
                </Link>
                <Link href="/admin?tab=jobs">
                  <Button variant="outline" size="sm">
                    <ArrowRight className="mr-1 h-4 w-4" />
                    岗位管理
                  </Button>
                </Link>
                <Link href="/admin?tab=audit">
                  <Button variant="outline" size="sm">
                    <FileWarning className="mr-1 h-4 w-4" />
                    审计日志
                  </Button>
                </Link>
                <a
                  href="/api/admin/job-sync-failures"
                  target="_blank"
                  rel="noreferrer"
                >
                  <Button variant="outline" size="sm">
                    <ExternalLink className="mr-1 h-4 w-4" />
                    失败队列 API
                  </Button>
                </a>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </main>
  );
}

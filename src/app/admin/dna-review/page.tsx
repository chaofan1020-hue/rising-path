'use client';

// 面试基因审查台：真实度反馈闭环的人工环节
// 低分案例（<6）→ 对照对话记录审查差异点 → 编辑基因（版本+1，后续面试即启用新版）→ 标记已处理
// 高分案例（>=6）→ 沉淀为训练数据（提问记录只读查看）
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAdminPermissions } from '@/components/admin-shell';
import { ADMIN_PERMISSIONS } from '@/lib/admin-permission-constants';
import {
  Loader2, Building2, MessageSquare, Dna, CheckCircle2, RefreshCw,
  ChevronRight, AlertTriangle, ThumbsUp,
} from 'lucide-react';

interface FeedbackItem {
  id: number;
  session_id: number;
  company: string;
  realism_score: number;
  feedback_text: string | null;
  status: string;
  dna_source: string | null;
  dna_version: number | null;
  review_notes: string | null;
  created_at: string;
}

interface ChatMsg {
  role: string;
  content: string;
  round?: number;
  ts?: number;
}

interface CaseDetail {
  feedback: FeedbackItem;
  session: {
    id: number;
    interview_type: string;
    mode: string;
    total_rounds: number;
    job_description: string;
    messages: ChatMsg[];
  } | null;
  currentDNA: {
    dna: Record<string, unknown>;
    source: string;
    version: number;
  } | null;
}

type Tab = 'pending_review' | 'high_quality' | 'reviewed';

const TABS: { key: Tab; label: string; desc: string }[] = [
  { key: 'pending_review', label: '待审查', desc: '真实度 < 6 分的低真实度案例' },
  { key: 'high_quality', label: '高质量案例', desc: '真实度 ≥ 6 分，提问记录沉淀为训练数据' },
  { key: 'reviewed', label: '已处理', desc: '已完成人工审查与基因更新' },
];

interface DNAHistoryVersion {
  id: number;
  version: number;
  source: string;
  review_notes: string | null;
  published_by: string | null;
  published_at: string;
}

function DNAReviewContent() {
  const { loading: permissionsLoading, hasPermission } = useAdminPermissions();
  const canReadDNA = hasPermission(ADMIN_PERMISSIONS.dnaRead);
  const canPublishDNA = hasPermission(ADMIN_PERMISSIONS.dnaPublish);
  const canReviewFeedback = hasPermission(ADMIN_PERMISSIONS.feedbackReview);
  const [tab, setTab] = useState<Tab>('pending_review');
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [dnaText, setDnaText] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [history, setHistory] = useState<DNAHistoryVersion[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadList = useCallback(async (t: Tab) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/dna-feedback?status=${t}`);
      const data = await res.json();
      setItems(data.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (permissionsLoading || !canReadDNA) return;
    setSelectedId(null);
    setDetail(null);
    loadList(tab);
  }, [canReadDNA, permissionsLoading, tab, loadList]);

  const openCase = async (id: number) => {
    setSelectedId(id);
    setDetailLoading(true);
    setSaveMsg('');
    setHistory([]);
    try {
      const res = await fetch(`/api/admin/dna-feedback/${id}`);
      const data = await res.json();
      setDetail(data);
      setDnaText(data.currentDNA ? JSON.stringify(data.currentDNA.dna, null, 2) : '');
      setReviewNotes(data.feedback.review_notes || '');
      if (data.feedback?.company) {
        setHistoryLoading(true);
        const historyResponse = await fetch(`/api/admin/dna/versions?company=${encodeURIComponent(data.feedback.company)}`);
        const historyData = await historyResponse.json();
        setHistory(Array.isArray(historyData.data) ? historyData.data : []);
      }
    } catch {
      setDetail(null);
      setHistory([]);
    } finally {
      setDetailLoading(false);
      setHistoryLoading(false);
    }
  };

  // 保存基因：版本 +1，后续面试即启用新版（prompt 版本更新）
  const saveDNA = async () => {
    if (!detail || !canPublishDNA) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(dnaText);
    } catch {
      setSaveMsg('JSON 格式错误，请检查');
      return;
    }
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch('/api/company-dna', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: detail.feedback.company, dna: parsed, reviewNotes }),
      });
      const data = await res.json();
      if (res.ok) {
        setSaveMsg(`基因已更新至 v${data.version}，后续面试立即生效`);
      } else {
        setSaveMsg(data.error || '保存失败');
      }
    } catch {
      setSaveMsg('网络错误');
    } finally {
      setSaving(false);
    }
  };

  const markReviewed = async () => {
    if (!detail || !canReviewFeedback) return;
    setSaving(true);
    try {
      await fetch(`/api/admin/dna-feedback/${detail.feedback.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'reviewed', reviewNotes }),
      });
      await loadList(tab);
      setSelectedId(null);
      setDetail(null);
    } finally {
      setSaving(false);
    }
  };

  const rollbackVersion = async (versionId: number) => {
    if (!canPublishDNA) return;
    if (!window.confirm('确认回滚到此版本吗？回滚会生成新的当前版本，不会删除历史记录。')) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const response = await fetch('/api/admin/dna/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId }),
      });
      const data = await response.json();
      if (!response.ok) {
        setSaveMsg(data.error?.message || '回滚失败');
        return;
      }
      setSaveMsg(`已从历史版本回滚，当前版本为 v${data.data?.version || '?'}`);
      if (detail?.feedback.company) {
        const historyResponse = await fetch(`/api/admin/dna/versions?company=${encodeURIComponent(detail.feedback.company)}`);
        const historyData = await historyResponse.json();
        setHistory(Array.isArray(historyData.data) ? historyData.data : []);
      }
    } catch {
      setSaveMsg('网络错误，回滚失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-background">
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 md:py-8">
        {permissionsLoading ? (
          <div className="flex min-h-80 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>
        ) : !canReadDNA ? (
          <div className="rounded-lg border border-dashed py-20 text-center text-sm text-muted-foreground">当前管理员角色无权查看 DNA 审核台</div>
        ) : <>
        <div className="mb-6 flex items-start gap-3">
          <Dna className="mt-0.5 h-5 w-5 shrink-0 text-zinc-900 dark:text-white" />
          <div>
            <h1 className="text-xl font-semibold">面试基因审查</h1>
            <p className="mt-1 text-sm text-muted-foreground">审查真实度反馈，维护企业面试基因和版本历史。</p>
          </div>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`h-9 rounded-md border px-3 text-sm transition-colors ${
                tab === t.key
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
          <button
            onClick={() => loadList(tab)}
            className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted hover:text-foreground"
            title="刷新"
            aria-label="刷新案例列表"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-5 text-xs text-muted-foreground">{TABS.find((t) => t.key === tab)?.desc}</p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* 案例列表 */}
          <div className="space-y-2">
            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : items.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">暂无案例</div>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => openCase(item.id)}
                  className={`w-full text-left rounded-lg border p-3.5 transition-colors ${
                    selectedId === item.id
                      ? 'border-primary bg-primary/5'
                      : 'bg-card hover:border-primary/50'
                  }`}
                >
                  <div className="mb-1 flex min-w-0 items-center gap-2">
                    <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate text-sm font-medium">{item.company}</span>
                    <span className={`ml-auto text-xs font-semibold px-1.5 py-0.5 rounded ${
                      item.realism_score < 6
                        ? 'bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400'
                        : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400'
                    }`}>
                      {item.realism_score} 分
                    </span>
                  </div>
                  {item.feedback_text && (
                    <p className="mb-1 text-xs text-muted-foreground line-clamp-2">{item.feedback_text}</p>
                  )}
                  <div className="flex min-w-0 items-center text-[11px] text-muted-foreground">
                    <span>{new Date(item.created_at).toLocaleString('zh-CN')}</span>
                    {item.dna_version != null && <span className="ml-2">基因 v{item.dna_version}</span>}
                    <ChevronRight className="h-3 w-3 ml-auto" />
                  </div>
                </button>
              ))
            )}
          </div>

          {/* 案例详情 */}
          <div className="lg:col-span-2">
            {detailLoading ? (
              <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>
            ) : !detail ? (
              <div className="rounded-lg border border-dashed py-20 text-center text-sm text-muted-foreground">
                选择左侧案例开始审查
              </div>
            ) : (
              <div className="space-y-4">
                {/* 候选人反馈 */}
                <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    {detail.feedback.realism_score < 6 ? (
                      <AlertTriangle className="h-4 w-4 text-red-500" />
                    ) : (
                      <ThumbsUp className="h-4 w-4 text-emerald-500" />
                    )}
                    <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      候选人反馈 · {detail.feedback.company} · {detail.feedback.realism_score}/10
                    </h2>
                  </div>
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    {detail.feedback.feedback_text || '（未填写文字反馈）'}
                  </p>
                </section>

                {/* 对话记录 */}
                <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                  <div className="flex min-w-0 items-start gap-2 mb-3">
                    <MessageSquare className="h-4 w-4 text-zinc-400" />
                    <h2 className="min-w-0 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      面试对话记录
                      {detail.session && (
                        <span className="ml-2 text-xs font-normal text-zinc-400">
                          {detail.session.mode === 'gauntlet' ? `${detail.session.total_rounds} 轮闯关` : '单面'} · {detail.session.interview_type}
                        </span>
                      )}
                    </h2>
                  </div>
                  <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                    {(detail.session?.messages || []).map((m, i) => (
                      <div key={i} className={`break-words text-xs rounded-lg px-3 py-2 ${
                        m.role === 'interviewer'
                          ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200'
                          : 'bg-zinc-50 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800'
                      }`}>
                        <span className="font-medium">{m.role === 'interviewer' ? '面试官' : '候选人'}</span>
                        {m.round ? <span className="text-zinc-400 ml-1">R{m.round}</span> : null}
                        <p className="mt-0.5 whitespace-pre-wrap">{m.content}</p>
                      </div>
                    ))}
                    {(!detail.session || detail.session.messages.length === 0) && (
                      <p className="text-xs text-zinc-400">无对话记录</p>
                    )}
                  </div>
                </section>

                <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div>
                      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">版本历史</h2>
                      <p className="text-[11px] text-zinc-400">发布和回滚都会生成新版本，历史快照不会被覆盖。</p>
                    </div>
                    {historyLoading && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
                  </div>
                  <div className="space-y-2">
                    {history.map((item) => (
                      <div key={item.id} className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="font-medium text-zinc-900 dark:text-zinc-100">v{item.version} · {item.source === 'manual' ? '人工发布' : item.source}</div>
                          <div className="mt-1 text-zinc-400">{new Date(item.published_at).toLocaleString('zh-CN')}{item.published_by ? ` · ${item.published_by}` : ''}</div>
                          {item.review_notes && <div className="mt-1 break-words text-zinc-500 dark:text-zinc-400">{item.review_notes}</div>}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 shrink-0"
                          disabled={!canPublishDNA || saving || item.version === detail.currentDNA?.version}
                          onClick={() => void rollbackVersion(item.id)}
                        >
                          回滚到此版本
                        </Button>
                      </div>
                    ))}
                    {!historyLoading && history.length === 0 && <p className="text-xs text-zinc-400">暂无版本快照</p>}
                  </div>
                </section>

                {/* 基因编辑器（低分案例的核心操作区） */}
                <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Dna className="h-4 w-4 text-zinc-400" />
                    <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      当前基因
                      {detail.currentDNA && (
                        <span className="ml-2 text-xs font-normal text-zinc-400">
                          来源 {detail.currentDNA.source} · v{detail.currentDNA.version}
                        </span>
                      )}
                    </h2>
                  </div>
                  <p className="text-[11px] text-zinc-400 mb-2">
                    对照候选人反馈与对话记录，直接编辑基因 JSON。保存后版本 +1，后续面试立即使用新版提问基因。
                  </p>
                  <Textarea
                    value={dnaText}
                    onChange={(e) => setDnaText(e.target.value)}
                    rows={14}
                    className="font-mono text-xs rounded-lg"
                    spellCheck={false}
                    readOnly={!canPublishDNA}
                  />
                  <Textarea
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    rows={2}
                    placeholder="审查备注：差异点诊断、本次调整说明…"
                    className="mt-2 text-sm rounded-lg"
                    readOnly={!canPublishDNA && !canReviewFeedback}
                  />
                  {saveMsg && <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{saveMsg}</p>}
                  <div className="flex flex-wrap gap-2 mt-3">
                    <Button
                      onClick={saveDNA}
                      disabled={!canPublishDNA || saving || !dnaText.trim()}
                      className="h-9 px-4"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存基因（版本 +1）'}
                    </Button>
                    {detail.feedback.status === 'pending_review' && canReviewFeedback && (
                      <Button onClick={markReviewed} disabled={saving} variant="outline" className="h-9 px-4">
                        <CheckCircle2 className="h-4 w-4 mr-1.5" />
                        标记已处理
                      </Button>
                    )}
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>
        </>}
      </main>
    </div>
  );
}

export default function DNAReviewPage() {
  return <DNAReviewContent />;
}

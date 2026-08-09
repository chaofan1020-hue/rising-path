'use client';

// 面试基因审查台：真实度反馈闭环的人工环节
// 低分案例（<6）→ 对照对话记录审查差异点 → 编辑基因（版本+1，后续面试即启用新版）→ 标记已处理
// 高分案例（>=6）→ 沉淀为训练数据（提问记录只读查看）
import { useCallback, useEffect, useState } from 'react';
import { AdminAuthGuard } from '@/components/admin-auth-guard';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
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

function DNAReviewContent() {
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
    setSelectedId(null);
    setDetail(null);
    loadList(tab);
  }, [tab, loadList]);

  const openCase = async (id: number) => {
    setSelectedId(id);
    setDetailLoading(true);
    setSaveMsg('');
    try {
      const res = await fetch(`/api/admin/dna-feedback/${id}`);
      const data = await res.json();
      setDetail(data);
      setDnaText(data.currentDNA ? JSON.stringify(data.currentDNA.dna, null, 2) : '');
      setReviewNotes(data.feedback.review_notes || '');
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  // 保存基因：版本 +1，后续面试即启用新版（prompt 版本更新）
  const saveDNA = async () => {
    if (!detail) return;
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
    if (!detail) return;
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

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-3">
          <Dna className="h-5 w-5 text-zinc-700 dark:text-zinc-300" />
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">面试基因审查台</h1>
          <span className="text-xs text-zinc-400">真实度反馈 → 人工审查 → 基因迭代</span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {/* Tabs */}
        <div className="flex gap-2 mb-5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-full text-sm transition-colors ${
                tab === t.key
                  ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                  : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700'
              }`}
            >
              {t.label}
            </button>
          ))}
          <button
            onClick={() => loadList(tab)}
            className="ml-auto p-2 rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            title="刷新"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-zinc-400 mb-4">{TABS.find((t) => t.key === tab)?.desc}</p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* 案例列表 */}
          <div className="space-y-2">
            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>
            ) : items.length === 0 ? (
              <div className="text-center py-12 text-sm text-zinc-400">暂无案例</div>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => openCase(item.id)}
                  className={`w-full text-left rounded-xl border p-3.5 transition-colors ${
                    selectedId === item.id
                      ? 'border-zinc-900 dark:border-zinc-200 bg-white dark:bg-zinc-900'
                      : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 hover:border-zinc-400'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Building2 className="h-3.5 w-3.5 text-zinc-400" />
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.company}</span>
                    <span className={`ml-auto text-xs font-semibold px-1.5 py-0.5 rounded ${
                      item.realism_score < 6
                        ? 'bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400'
                        : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400'
                    }`}>
                      {item.realism_score} 分
                    </span>
                  </div>
                  {item.feedback_text && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2 mb-1">{item.feedback_text}</p>
                  )}
                  <div className="flex items-center text-[11px] text-zinc-400">
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
              <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 py-20 text-center text-sm text-zinc-400">
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
                  <div className="flex items-center gap-2 mb-3">
                    <MessageSquare className="h-4 w-4 text-zinc-400" />
                    <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
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
                      <div key={i} className={`text-xs rounded-lg px-3 py-2 ${
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
                  />
                  <Textarea
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    rows={2}
                    placeholder="审查备注：差异点诊断、本次调整说明…"
                    className="mt-2 text-sm rounded-lg"
                  />
                  {saveMsg && <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{saveMsg}</p>}
                  <div className="flex gap-2 mt-3">
                    <Button
                      onClick={saveDNA}
                      disabled={saving || !dnaText.trim()}
                      className="rounded-full bg-zinc-900 hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 text-white h-9 px-5"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存基因（版本 +1）'}
                    </Button>
                    {detail.feedback.status === 'pending_review' && (
                      <Button onClick={markReviewed} disabled={saving} variant="outline" className="rounded-full h-9 px-5">
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
      </main>
    </div>
  );
}

export default function DNAReviewPage() {
  return (
    <AdminAuthGuard>
      <DNAReviewContent />
    </AdminAuthGuard>
  );
}

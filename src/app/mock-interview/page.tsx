"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Header1 } from "@/components/header1";
import { AuthGuard } from "@/components/auth-guard";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import {
  Modal, ModalBody, ModalContent, ModalDescription,
  ModalFooter, ModalHeader, ModalTitle,
} from "@/components/ui/modal";
import { useLanguage } from "@/lib/language-context";
import { createInterviewASRSocket, downsampleToPCM16 } from "@/lib/interview-asr-client";
import { createInterviewTTSSocket } from "@/lib/interview-tts-client";
import {
  Bot, Loader2, RotateCcw, ClipboardList,
  Mic, MicOff, VolumeX, PhoneOff, Video, VideoOff, User,
  Building2, Briefcase, FileText, ChevronDown, Check, Timer,
} from "lucide-react";
import { startAmbience, stopAmbience } from "@/lib/interview-audio";
import PageBackButton from "@/components/page-back-button";

// 通用下拉选择器（与 jobs 页一致的 Popover 交互，避免原生 select 交互问题）
function OptionSelect({
  icon: Icon,
  label,
  placeholder,
  options,
  value,
  onChange,
  disabled,
  loading,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  placeholder: string;
  options: { value: string; text: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.value === value);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter((option) => option.text.toLocaleLowerCase().includes(normalizedQuery))
    : options;
  const close = () => {
    setOpen(false);
    setQuery("");
  };
  useEffect(() => {
    if (open) window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);
  return (
    <Popover open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) setQuery(""); }}>
      <PopoverAnchor asChild>
        <div
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-disabled={disabled || undefined}
          onMouseDown={() => { if (!disabled) setOpen(true); }}
          className={`w-full h-11 inline-flex items-center gap-2 px-4 rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-black dark:text-white transition-colors ${disabled ? "opacity-50 cursor-not-allowed" : "hover:border-zinc-400 dark:hover:border-zinc-500"}`}
        >
          <Icon className="h-4 w-4 text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={open ? query : selected?.text || ""}
            placeholder={placeholder}
            disabled={disabled}
            aria-label={label}
            onFocus={() => { if (!disabled) { setQuery(""); setOpen(true); } }}
            onChange={(event) => { setQuery(event.target.value); if (!open) setOpen(true); }}
            onKeyDown={(event) => {
              if (event.key === "Escape") close();
              if (event.key === "Enter" && filteredOptions.length === 1) {
                event.preventDefault();
                onChange(filteredOptions[0].value);
                close();
              }
            }}
            className="min-w-0 flex-1 h-full bg-transparent outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500"
          />
          {loading ? <Loader2 className="h-4 w-4 text-gray-400 flex-shrink-0 animate-spin" /> : <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />}
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-1 max-h-80 overflow-visible"
        align="start"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div
          role="listbox"
          aria-label={label}
          className="max-h-64 overflow-y-scroll overscroll-contain touch-pan-y pt-1 [scrollbar-width:thin]"
          onWheelCapture={(event) => event.stopPropagation()}
        >
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={() => { onChange(""); close(); }}
            className={`w-full flex items-center gap-2 text-left px-3 py-2 rounded-md text-sm transition-colors ${
              !value ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "hover:bg-muted"
            }`}
          >
            {!value && <Check className="h-3.5 w-3.5" />}
            <span className={!value ? "" : "pl-5"}>{placeholder}</span>
          </button>
          {filteredOptions.map((opt) => (
            <button
              type="button"
              key={opt.value}
              onClick={() => { onChange(opt.value); close(); }}
              className={`w-full flex items-center gap-2 text-left px-3 py-2 rounded-md text-sm transition-colors ${
                value === opt.value ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "hover:bg-muted"
              }`}
            >
              {value === opt.value && <Check className="h-3.5 w-3.5 flex-shrink-0" />}
              <span className={value === opt.value ? "" : "pl-5"}>{opt.text}</span>
            </button>
          ))}
          {filteredOptions.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">未找到匹配项</p>
          )}
        </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type Stage = "setup" | "interview" | "summary";

interface Message {
  role: "interviewer" | "candidate";
  content: string;
  requestId?: string;
}

interface ResumeItem {
  id: number;
  file_name: string;
  processing_status?: string;
  segmentation_confirmed?: boolean;
}

interface JobItem {
  id: number;
  title: string;
  company: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const ROUND_HANDOFF_DELAY_MS = 900;
const TTS_START_BUFFER_SECONDS = 0.18;
const ASR_SEND_RMS_THRESHOLD = 0.018;
const ASR_MIN_TRANSCRIPT_CHARS = 3;
const AUTO_SUBMIT_SETTLE_MS = 450;
const SUMMARY_CLIENT_TIMEOUT_MS = 38_000;

// ===== 结构化面试报告 =====
interface ReportVerdict {
  pass: boolean;
  vote: string;
  grade: string;
  hireLevel: string;
  headline: string;
}

interface ReportCommitteeItem {
  interviewerId: number;
  name: string;
  company: string;
  round: number;
  roleLabel: string;
  archetypeLabel: string;
  tags: string[];
  grade: string;
  attitude: string;
  comment: string;
  keyMoment: { question: string; answer: string; note: string };
}

interface RadarDim {
  dimension: string;
  score: number;
  grade: string;
  diagnosis: string;
}

interface InterviewReport {
  version?: number;
  mode?: string;
  metrics?: Record<string, unknown>;
  coach?: Record<string, unknown>;
  verdict: ReportVerdict;
  committee: ReportCommitteeItem[];
  radar: RadarDim[];
  highlights: {
    mistakes: Array<{ title: string; scene: string; consequence: string; coach: string }>;
    best: { title: string; scene: string; effect: string; coach: string };
  };
  actionPlan: { immediate: string[]; practice: string[]; reading: string[] };
  annotations: Array<{ msgIndex: number; label: string; note: string }>;
}

interface ReportStats {
  durationSec: number;
  totalCharacters: number;
  turns: number;
  questions: number;
  avgResponseSec: number | null;
}

interface HistoryPoint {
  date: string;
  score: number;
  grade: string | null;
}

// 评级颜色映射
function gradeColor(grade: string): string {
  const g = grade.toUpperCase();
  if (g.startsWith("A")) return "text-emerald-500";
  if (g.startsWith("B")) return "text-amber-500";
  return "text-red-500";
}
function gradeDot(grade: string): string {
  const g = grade.toUpperCase();
  if (g.startsWith("A")) return "bg-emerald-500";
  if (g.startsWith("B")) return "bg-amber-500";
  return "bg-red-500";
}

let companyCatalogPromise: Promise<string[]> | null = null;
const pickerJobsCache = new Map<string, JobItem[]>();

function isSubstantiveTranscript(value: string): boolean {
  const text = value.replace(/\s+/g, "").trim();
  if (text.length < ASR_MIN_TRANSCRIPT_CHARS) return false;
  if (/^(嗯+|啊+|哦+|噢+|呃+|hi+|hello+|noise|silence)$/i.test(text)) return false;
  const chineseCharacters = text.match(/[\u4e00-\u9fff]/g)?.length || 0;
  const latinCharacters = text.match(/[a-z0-9]/gi)?.length || 0;
  return chineseCharacters >= ASR_MIN_TRANSCRIPT_CHARS || latinCharacters >= ASR_MIN_TRANSCRIPT_CHARS;
}

// SVG 雷达图（6 维）
function RadarChart({ dims }: { dims: RadarDim[] }) {
  const cx = 110, cy = 100, r = 72;
  const n = dims.length || 6;
  const angle = (i: number) => (Math.PI / 2) - (i * 2 * Math.PI) / n;
  const pt = (i: number, ratio: number) => ({
    x: cx + Math.cos(angle(i)) * r * ratio,
    y: cy - Math.sin(angle(i)) * r * ratio,
  });
  const rings = [0.25, 0.5, 0.75, 1];
  const valuePts = dims.map((d, i) => pt(i, Math.max(0, Math.min(1, d.score / 100))));
  const poly = (pts: Array<{ x: number; y: number }>) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 220 200" className="w-full max-w-[300px] mx-auto">
      {rings.map((ratio) => (
        <polygon
          key={ratio}
          points={poly(Array.from({ length: n }, (_, i) => pt(i, ratio)))}
          fill="none"
          stroke="currentColor"
          strokeWidth="0.5"
          className="text-zinc-300 dark:text-zinc-700"
        />
      ))}
      {dims.map((_, i) => {
        const p = pt(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="currentColor" strokeWidth="0.5" className="text-zinc-300 dark:text-zinc-700" />;
      })}
      <polygon points={poly(valuePts)} fill="rgba(196,106,74,0.25)" stroke="#C46A4A" strokeWidth="1.5" />
      {valuePts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="#C46A4A" />
      ))}
      {dims.map((d, i) => {
        const p = pt(i, 1.22);
        return (
          <text
            key={d.dimension}
            x={p.x}
            y={p.y}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-zinc-500 dark:fill-zinc-400"
            fontSize="9"
          >
            {d.dimension.length > 6 ? d.dimension.slice(0, 6) : d.dimension}
          </text>
        );
      })}
    </svg>
  );
}

// SVG 历史趋势折线
function TrendChart({ points, current }: { points: HistoryPoint[]; current: number | null }) {
  const data = [...points.map((p) => p.score), ...(current !== null ? [current] : [])];
  if (data.length === 0) return null;
  const w = 320, h = 90, pad = 18;
  const min = Math.max(0, Math.min(...data) - 10);
  const max = Math.min(100, Math.max(...data) + 10);
  const x = (i: number) => data.length === 1 ? w / 2 : pad + (i * (w - pad * 2)) / (data.length - 1);
  const y = (v: number) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-[360px] mx-auto">
      <polyline
        points={data.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
        fill="none"
        stroke="#B5BEB0"
        strokeWidth="2"
      />
      {data.map((v, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(v)} r={i === data.length - 1 ? 4 : 3} fill={i === data.length - 1 ? "#C46A4A" : "#B5BEB0"} />
          <text x={x(i)} y={y(v) - 8} textAnchor="middle" fontSize="9" className="fill-zinc-500 dark:fill-zinc-400">{v}</text>
        </g>
      ))}
    </svg>
  );
}

function MockInterviewContent() {
  const { t, locale } = useLanguage();
  const [stage, setStage] = useState<Stage>("setup");

  // 设置项
  const [companies, setCompanies] = useState<string[]>([]);
  const [selectedCompany, setSelectedCompany] = useState("");
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const jobsByCompanyRef = useRef(new Map<string, JobItem[]>());
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [resumes, setResumes] = useState<ResumeItem[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState<number | null>(null);

  // 企业面试基因预览（设置页）
  interface DNAPreview {
    company: string;
    source: "curated" | "cached" | "generated";
    tagline: string;
    focusAreas: { dimension: string; weight: string }[];
    tone: string;
    cultureKeywords: string[];
    signatureQuestions: string[];
  }
  const [dnaPreview, setDnaPreview] = useState<DNAPreview | null>(null);
  const [dnaLoading, setDnaLoading] = useState(false);

  // 真实度问卷（报告生成后弹出：评分分流高/低真实度案例，驱动基因迭代闭环）
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [realismScore, setRealismScore] = useState<number | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackDone, setFeedbackDone] = useState(false);

  // 面试状态
  const [sessionId, setSessionId] = useState<number | null>(null);
  // React state 更新是异步的；语音链路必须立即拿到开场 SSE 返回的会话 ID。
  const sessionIdRef = useRef<number | null>(null);
  const [sessionRevision, setSessionRevision] = useState(0);
  const sessionRevisionRef = useRef(0);
  const [overallScore, setOverallScore] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [ending, setEnding] = useState(false);
  const [summary, setSummary] = useState("");

  // 结构化面试报告（委员会评议）
  const [report, setReport] = useState<InterviewReport | null>(null);
  const [reportView, setReportView] = useState<"coach" | "committee">("coach");
  const [reportStats, setReportStats] = useState<ReportStats | null>(null);
  const [reportHistory, setReportHistory] = useState<HistoryPoint[]>([]);
  const [reportChars, setReportChars] = useState(0); // 生成中已接收字符数（进度展示）
  const [reportError, setReportError] = useState(false); // 报告生成失败（可重试）

  // 自动真实流程状态：HR 初筛 → 业务深挖 → 跨部门交叉 → 高管终面
  const totalRounds = 4;
  const [currentRound, setCurrentRound] = useState(1);
  const [currentInterviewer, setCurrentInterviewer] = useState<{
    id: number;
    name: string;
    company: string;
    personality: string;
    voice?: string;
    speechRate?: number;
    loudnessRate?: number;
    title?: { zh: string; en: string } | null;
  } | null>(null);
  const [roundRoleLabel, setRoundRoleLabel] = useState<{ zh: string; en: string } | null>(null);
  // Completion is determined only by a structured server event, never model text.
  const [interviewCompleted, setInterviewCompleted] = useState(false);

  // 自然轮次交接：上一位收尾后整理记录，再由下一位开场
  const [organizing, setOrganizing] = useState(false);
  // 每轮倒计时（秒）
  const [roundSecondsLeft, setRoundSecondsLeft] = useState<number | null>(null);

  // 视频/语音状态
  const [cameraOn, setCameraOn] = useState(false);
  const [micError, setMicError] = useState(false);
  // 免提模式：麦克风常开 + VAD 语音活动检测
  const [listening, setListening] = useState(false);
  const [setupOpen, setSetupOpen] = useState(true);
  const [voiceActive, setVoiceActive] = useState(false); // 检测到正在说话
  const vadRafRef = useRef<number | null>(null);
  // 麦克风错误细分：denied=权限被拒 nodevice=无设备 busy=被占用 unknown=其他
  const [micErrorKind, setMicErrorKind] = useState<"denied" | "nodevice" | "busy" | "unknown" | null>(null);
  // 是否运行在嵌入预览（iframe）中：iframe 内浏览器会直接禁止麦克风权限请求
  const [inIframe, setInIframe] = useState(false);
  useEffect(() => {
    try {
      setInIframe(window.self !== window.top);
    } catch {
      setInIframe(true); // 跨域访问 top 抛错即视为 iframe
    }
  }, []);
  const [cameraError, setCameraError] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [noSpeech, setNoSpeech] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [pendingTranscript, setPendingTranscript] = useState("");
  const [answerRetryRequired, setAnswerRetryRequired] = useState(false);
  const [realtimeFallback, setRealtimeFallback] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [showSubtitle, setShowSubtitle] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const realtimeItemRef = useRef<string | null>(null);
  const submittedAsrItemsRef = useRef(new Set<string>());
  const pendingTranscriptRef = useRef("");
  const pendingTranscriptSourceRef = useRef<"asr" | "asr_fallback">("asr");
  const answerSubmittingRef = useRef(false);
  const pendingAnswerRequestRef = useRef<{ text: string; requestId: string } | null>(null);
  const autoSubmitTimerRef = useRef<number | null>(null);
  const submitPendingTranscriptRef = useRef<() => void>(() => {});
  const summaryAbortRef = useRef<AbortController | null>(null);
  const summaryRunningRef = useRef(false);
  const turnPlanCacheRef = useRef(new Map<string, { plan: unknown; token: string }>());
  const realtimeSocketRef = useRef<WebSocket | null>(null);
  const realtimeTtsSocketRef = useRef<WebSocket | null>(null);
  const realtimeTtsOpeningRef = useRef<Promise<WebSocket> | null>(null);
  const realtimeTtsHeartbeatRef = useRef<number | null>(null);
  const realtimeTtsRequestIdRef = useRef<string | null>(null);
  const realtimeAudioCtxRef = useRef<AudioContext | null>(null);
  const realtimeProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const ttsNextTimeRef = useRef(0);
  const activeTTSStopRef = useRef<(() => void) | null>(null);
  const ttsSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  // 面试官音波图：Web Audio 频谱分析
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const graphReadyRef = useRef(false);
  const waveCanvasRef = useRef<HTMLCanvasElement>(null);
  const speakingRef = useRef(false);
  const streamingRef = useRef(false);
  const recognizingRef = useRef(false);
  const candidateTurnRef = useRef(false);
  const audioQueueRef = useRef<Array<{
    text: string;
    speaker?: string;
    speechRate?: number;
    loudnessRate?: number;
  }>>([]);
  const audioDrainingRef = useRef(false);
  const audioWaitersRef = useRef<Array<() => void>>([]);
  const interruptRef = useRef(false);
  const timeoutFiredRef = useRef(false);
  const timeoutEscalateRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interviewAliveRef = useRef(false);
  // `listening` means the session owns an ASR connection. It does not mean
  // microphone samples may be submitted at every moment.
  const candidateTurn = listening
    && !speaking
    && !streaming
    && !recognizing
    && !organizing
    && !ending
    && !interviewCompleted;

  // 建立音频分析图（固定 audio 元素，只建一次）；失败则音波降级为伪动画
  const ensureAudioGraph = useCallback(() => {
    const el = audioRef.current;
    if (!el || graphReadyRef.current) return;
    try {
      const Ctor = window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const source = ctx.createMediaElementSource(el);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128; // 64 个频点
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      graphReadyRef.current = true;
    } catch {
      // 浏览器不支持：保持静默降级
    }
  }, []);

  // 首次用户手势（点击/触摸）时建立音频图并激活 AudioContext：
  // 浏览器自动播放策略要求 AudioContext 在手势上下文中创建/恢复，
  // 否则 createMediaElementSource 接管 audio 元素后输出静音（面试官无声）
  useEffect(() => {
    const activate = () => {
      ensureAudioGraph();
      audioCtxRef.current?.resume().catch(() => {});
      if (graphReadyRef.current) {
        window.removeEventListener("pointerdown", activate);
      }
    };
    window.addEventListener("pointerdown", activate);
    return () => window.removeEventListener("pointerdown", activate);
  }, [ensureAudioGraph]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const roundTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const language = locale === "en" ? "en" : "zh";
  const interviewLanguageRef = useRef<"zh" | "en">(language);

  useEffect(() => {
    speakingRef.current = speaking;
  }, [speaking]);

  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);

  useEffect(() => {
    recognizingRef.current = recognizing;
  }, [recognizing]);

  useEffect(() => {
    if (!sessionIdRef.current) interviewLanguageRef.current = language;
  }, [language]);

  useEffect(() => {
    candidateTurnRef.current = candidateTurn;
  }, [candidateTurn]);

  useEffect(() => () => {
    if (autoSubmitTimerRef.current) window.clearTimeout(autoSubmitTimerRef.current);
    summaryAbortRef.current?.abort();
  }, []);

  // 加载公司列表
  useEffect(() => {
    const controller = new AbortController();
    companyCatalogPromise ||= fetch("/api/interview/jobs", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.companies || []);
    companyCatalogPromise
      .then((catalog) => { if (!controller.signal.aborted) setCompanies(catalog); })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        companyCatalogPromise = null;
    });
    return () => controller.abort();
  }, []);

  // 加载简历列表
  useEffect(() => {
    apiFetch("/api/resume")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setResumes((d.resumes || []).filter((resume: ResumeItem) =>
            resume.processing_status === "ready" && resume.segmentation_confirmed === true,
          ));
        }
      })
      .catch((e) => console.error("[mock-interview] fetch resumes error:", e));
  }, []);

  // 公司变化时加载岗位
  useEffect(() => {
    if (!selectedCompany) {
      setJobs([]);
      setSelectedJobId(null);
      setJobsLoading(false);
      return;
    }
    const cachedJobs = jobsByCompanyRef.current.get(selectedCompany) || pickerJobsCache.get(selectedCompany);
    if (cachedJobs) {
      setJobs(cachedJobs);
      setSelectedJobId(null);
      setJobsLoading(false);
      return;
    }
    const controller = new AbortController();
    const companyAtRequest = selectedCompany;
    setJobs([]);
    setJobsLoading(true);
    fetch(`/api/interview/jobs?company=${encodeURIComponent(companyAtRequest)}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!controller.signal.aborted && companyAtRequest === selectedCompany && d) {
          const nextJobs = d.jobs || [];
          jobsByCompanyRef.current.set(companyAtRequest, nextJobs);
          pickerJobsCache.set(companyAtRequest, nextJobs);
          setJobs(nextJobs);
        }
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
      })
      .finally(() => {
        if (!controller.signal.aborted && companyAtRequest === selectedCompany) setJobsLoading(false);
      });
    setSelectedJobId(null);
    return () => controller.abort();
  }, [selectedCompany]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, summary]);

  // 报告生成完成后自动弹出真实度问卷（每场面试一次）
  useEffect(() => {
    if (stage === "summary" && report && sessionId && !feedbackDone && !feedbackOpen) {
      const timer = setTimeout(() => setFeedbackOpen(true), 800);
      return () => clearTimeout(timer);
    }
  }, [stage, report, sessionId, feedbackDone, feedbackOpen]);

  // 企业面试基因预览：公司只能来自岗位目录，避免公司和岗位来源不一致。
  useEffect(() => {
    const company = selectedCompany.trim();
    if (company.length < 2) {
      setDnaPreview(null);
      setDnaLoading(false);
      return;
    }
    const controller = new AbortController();
    setDnaLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/company-dna?name=${encodeURIComponent(company)}`, { signal: controller.signal });
        if (res.ok) {
          const preview = await res.json() as DNAPreview & { available?: boolean };
          if (!controller.signal.aborted && preview.available !== false) setDnaPreview(preview);
          else if (!controller.signal.aborted) setDnaPreview(null);
        } else {
          setDnaPreview(null);
        }
      } catch (error) {
        if (!controller.signal.aborted) setDnaPreview(null);
      } finally {
        if (!controller.signal.aborted) setDnaLoading(false);
      }
    }, 600);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [selectedCompany]);

  // 面试官音波图：真实音频频谱驱动（AnalyserNode），不可用时降级为正弦伪音波
  useEffect(() => {
    if (stage !== "interview") return;
    const canvas = waveCanvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;
    let raf = 0;
    const dataArr = new Uint8Array(64);
    const render = () => {
      raf = requestAnimationFrame(render);
      const W = canvas.width;
      const H = canvas.height;
      ctx2d.clearRect(0, 0, W, H);
      const analyser = analyserRef.current;
      let hasData = false;
      // 仅当 AudioContext 运行时频谱数据才有效（suspended 时数据冻结为 0，需降级伪音波）
      if (analyser && audioCtxRef.current?.state === "running") {
        analyser.getByteFrequencyData(dataArr);
        hasData = true;
      }
      const bars = 56;
      const gap = 3;
      const bw = (W - gap * (bars - 1)) / bars;
      const t = Date.now() / 1000;
      const grad = ctx2d.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, "#C46A4A");
      grad.addColorStop(1, "#B5BEB0");
      ctx2d.fillStyle = grad;
      for (let i = 0; i < bars; i++) {
        let amp: number;
        if (hasData) {
          // 幂次分布聚焦人声频段，保留静默基线
          const idx = Math.min(dataArr.length - 1, Math.floor(Math.pow(i / bars, 1.5) * dataArr.length));
          amp = Math.max(dataArr[idx] / 255, 0.05);
        } else if (speaking) {
          amp = 0.25 + 0.55 * Math.abs(Math.sin(t * 3.2 + i * 0.32)) * (0.5 + 0.5 * Math.sin(t * 1.3 + i * 0.11));
        } else {
          amp = 0.05 + 0.015 * Math.sin(t * 1.5 + i * 0.4);
        }
        const h = Math.max(3, amp * H * 0.92);
        ctx2d.fillRect(i * (bw + gap), (H - h) / 2, bw, h);
      }
    };
    render();
    return () => cancelAnimationFrame(raf);
  }, [stage, speaking]);

  // 开启摄像头（遵循 WebRTC 规范：始终渲染 video，等待 loadedmetadata）
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: { echoCancellation: true },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().catch(() => {});
          setCameraOn(true);
        };
      }
      setCameraError(false);
    } catch {
      setCameraError(true);
      setCameraOn(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  const stopRealtimeTts = useCallback((closeSocket = false) => {
    const requestId = realtimeTtsRequestIdRef.current;
    const socket = realtimeTtsSocketRef.current;
    if (requestId && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "cancel", requestId }));
    }
    realtimeTtsRequestIdRef.current = null;
    ttsSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Sources may have already ended.
      }
    });
    ttsSourcesRef.current.clear();
    ttsNextTimeRef.current = audioCtxRef.current?.currentTime || 0;
    if (!closeSocket || !socket) return;
    if (realtimeTtsHeartbeatRef.current !== null) {
      window.clearInterval(realtimeTtsHeartbeatRef.current);
      realtimeTtsHeartbeatRef.current = null;
    }
    realtimeTtsSocketRef.current = null;
    realtimeTtsOpeningRef.current = null;
    if (socket.readyState === WebSocket.OPEN) socket.close(1000, "interview stopped");
    else if (socket.readyState === WebSocket.CONNECTING) socket.close();
  }, []);

  // 组件卸载清理
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      audioRef.current?.pause();
      stopRealtimeTts(true);
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
    };
  }, [stopRealtimeTts]);

  // 启动每轮倒计时（分钟）；归零后由 roundSecondsLeft 副作用触发收尾请求
  const startRoundTimer = useCallback((minutes = 8) => {
    if (roundTimerRef.current) clearInterval(roundTimerRef.current);
    setRoundSecondsLeft(minutes * 60);
    roundTimerRef.current = setInterval(() => {
      setRoundSecondsLeft((prev) => {
        if (prev === null || prev <= 0) {
          if (roundTimerRef.current) clearInterval(roundTimerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  // 清理所有压力机制（结束/重开时调用）
  const clearPressure = useCallback(() => {
    if (roundTimerRef.current) clearInterval(roundTimerRef.current);
    if (timeoutEscalateRef.current) clearTimeout(timeoutEscalateRef.current);
    roundTimerRef.current = null;
    timeoutEscalateRef.current = null;
    timeoutFiredRef.current = false;
    audioQueueRef.current = [];
    interruptRef.current = true;
    activeTTSStopRef.current?.();
    stopRealtimeTts(true);
    const audio = audioRef.current;
    audio?.pause();
    audio?.onended?.call(audio, new Event("ended"));
    setOrganizing(false);
    setRoundSecondsLeft(null);
    stopAmbience();
  }, [stopRealtimeTts]);

  const fetchTtsAudio = useCallback(
    async (item: { text: string; speaker?: string; speechRate?: number; loudnessRate?: number }) => {
      try {
        const res = await apiFetch("/api/interview/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: item.text,
            language: interviewLanguageRef.current,
            speaker: item.speaker,
            speechRate: item.speechRate,
            loudnessRate: item.loudnessRate,
             sessionId: sessionIdRef.current,
           }),
        });
        if (!res.ok) throw new Error("TTS failed");
        return await res.arrayBuffer();
      } catch {
        return null;
      }
    },
    [language]
  );

  const getRealtimeTicket = useCallback(async (capability: "asr" | "tts") => {
    const res = await apiFetch("/api/interview/realtime-ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability, sessionId: sessionIdRef.current }),
    });
    if (!res.ok) throw new Error("realtime ticket unavailable");
    const data = await res.json() as { ticket?: string };
    if (!data.ticket) throw new Error("realtime ticket missing");
    return data.ticket;
  }, []);

  const getRealtimeTtsSocket = useCallback(async (): Promise<WebSocket> => {
    const existing = realtimeTtsSocketRef.current;
    if (existing?.readyState === WebSocket.OPEN) return existing;
    if (realtimeTtsOpeningRef.current) return realtimeTtsOpeningRef.current;

    const opening = (async () => {
      const ticket = await getRealtimeTicket("tts");
      const socket = createInterviewTTSSocket(ticket);
      socket.binaryType = "arraybuffer";
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          if (realtimeTtsSocketRef.current === socket) realtimeTtsSocketRef.current = null;
          if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) socket.close();
          reject(error);
        };
        const timeout = window.setTimeout(() => fail(new Error("Cartesia TTS connection timeout")), 12000);
        socket.onopen = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          realtimeTtsHeartbeatRef.current = window.setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
          }, 25_000);
          resolve();
        };
        socket.onerror = () => {
          fail(new Error("Cartesia TTS connection failed"));
        };
        socket.onclose = () => {
          if (realtimeTtsHeartbeatRef.current !== null) {
            window.clearInterval(realtimeTtsHeartbeatRef.current);
            realtimeTtsHeartbeatRef.current = null;
          }
          if (realtimeTtsSocketRef.current === socket) realtimeTtsSocketRef.current = null;
          if (!settled) fail(new Error("Cartesia TTS connection closed"));
        };
      });
      realtimeTtsSocketRef.current = socket;
      return socket;
    })();
    realtimeTtsOpeningRef.current = opening;
    try {
      return await opening;
    } finally {
      realtimeTtsOpeningRef.current = null;
    }
  }, [getRealtimeTicket]);

  const playSingleTts = useCallback(
    async (item: { text: string; speaker?: string; speechRate?: number; loudnessRate?: number }) => {
      try {
        const playRealtime = async (): Promise<void> => {
          ensureAudioGraph();
          let ctx = audioCtxRef.current;
          if (!ctx) {
            const Ctor = window.AudioContext ||
              (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (!Ctor) throw new Error("当前浏览器不支持实时音频播放");
            ctx = new Ctor();
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 128;
            analyser.smoothingTimeConstant = 0.75;
            analyser.connect(ctx.destination);
            audioCtxRef.current = ctx;
            analyserRef.current = analyser;
          }
          if (ctx.state === "suspended") await ctx.resume();

          const socket = await getRealtimeTtsSocket();
          const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
          let hasAudio = false;
          let finished = false;
          let timer: number | null = null;
          let playbackStarted = false;
          let bufferedSeconds = 0;
          let pendingBuffers: AudioBuffer[] = [];
          const scheduleBufferedAudio = (force = false) => {
            if (!ctx || pendingBuffers.length === 0) return;
            if (!force && !playbackStarted && bufferedSeconds < TTS_START_BUFFER_SECONDS && pendingBuffers.length < 2) {
              return;
            }
            let startAt = Math.max(
              ctx.currentTime + (playbackStarted ? 0.015 : 0.08),
              ttsNextTimeRef.current,
            );
            for (const audioBuffer of pendingBuffers) {
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              ttsSourcesRef.current.add(source);
              source.onended = () => ttsSourcesRef.current.delete(source);
              if (analyserRef.current) source.connect(analyserRef.current);
              else source.connect(ctx.destination);
              source.start(startAt);
              startAt += audioBuffer.duration;
            }
            playbackStarted = true;
            ttsNextTimeRef.current = startAt;
            pendingBuffers = [];
            bufferedSeconds = 0;
          };
          const schedulePCM = (data: ArrayBuffer) => {
            if (!ctx || data.byteLength < 2) return;
            const samples = new Int16Array(data);
            const audioBuffer = ctx.createBuffer(1, samples.length, 44100);
            const channel = audioBuffer.getChannelData(0);
            for (let i = 0; i < samples.length; i += 1) channel[i] = samples[i] / 0x8000;
            pendingBuffers.push(audioBuffer);
            bufferedSeconds += audioBuffer.duration;
            hasAudio = true;
            // Cartesia sends raw PCM in small packets. Start after a short
            // buffer, then schedule packets contiguously on one audio clock.
            scheduleBufferedAudio();
          };

          await new Promise<void>((resolve, reject) => {
            const finish = () => {
              if (finished) return;
              finished = true;
              if (timer !== null) window.clearTimeout(timer);
              if (realtimeTtsRequestIdRef.current === requestId) realtimeTtsRequestIdRef.current = null;
              resolve();
            };
            const stop = () => {
              if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "cancel", requestId }));
              pendingBuffers = [];
              bufferedSeconds = 0;
              ttsSourcesRef.current.forEach((source) => { try { source.stop(); } catch {} });
              ttsSourcesRef.current.clear();
              finish();
            };
            activeTTSStopRef.current = stop;
            const fail = (error: Error) => {
              if (finished) return;
              if (hasAudio) {
                if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "cancel", requestId }));
                finish();
                return;
              }
              finished = true;
              if (timer !== null) window.clearTimeout(timer);
              if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "cancel", requestId }));
              reject(error);
            };
            timer = window.setTimeout(() => fail(new Error("Cartesia TTS stream timeout")), 30000);
            realtimeTtsRequestIdRef.current = requestId;
            socket.send(JSON.stringify({
              type: "speak",
              requestId,
              text: item.text,
              language: interviewLanguageRef.current,
              speaker: item.speaker,
              speechRate: item.speechRate,
               sessionId: sessionIdRef.current,
            }));
            socket.onmessage = (event) => {
              if (event.data instanceof ArrayBuffer) {
                schedulePCM(event.data);
                return;
              }
              if (event.data instanceof Blob) {
                event.data.arrayBuffer().then(schedulePCM).catch(() => {});
                return;
              }
              try {
                const data = JSON.parse(String(event.data)) as { type?: string; requestId?: string; error?: string };
                if (data.requestId && data.requestId !== requestId) return;
                if (data.type === "done") {
                  scheduleBufferedAudio(true);
                  if (!playbackStarted) {
                    fail(new Error("Cartesia TTS returned no audio"));
                    return;
                  }
                  const waitMs = Math.max(0, (ttsNextTimeRef.current - ctx!.currentTime) * 1000 + 60);
                  timer = window.setTimeout(finish, waitMs);
                } else if (data.type === "cancelled") {
                  finish();
                } else if (data.type === "error") {
                  fail(new Error(data.error || "Cartesia TTS failed"));
                }
              } catch {
                fail(new Error("Cartesia TTS response invalid"));
              }
            };
            socket.onerror = () => {
              if (realtimeTtsRequestIdRef.current === requestId) fail(new Error("Cartesia TTS connection failed"));
            };
            socket.onclose = () => {
              if (realtimeTtsSocketRef.current === socket) realtimeTtsSocketRef.current = null;
              if (!finished && realtimeTtsRequestIdRef.current === requestId) fail(new Error("Cartesia TTS connection closed"));
            };
          }).finally(() => {
            activeTTSStopRef.current = null;
          });
        };

        try {
          await playRealtime();
        } catch {
          // 实时 TTS 未配置或连接失败时，保留 HTTP MP3 兜底，避免面试无声。
          stopRealtimeTts(true);
          const buf = await fetchTtsAudio(item);
          if (interruptRef.current || !buf?.byteLength) return;
          const audio = audioRef.current;
          if (!audio) return;
          if (audioCtxRef.current?.state === "suspended") {
            await audioCtxRef.current.resume().catch(() => {});
          }
          audio.pause();
          const blobUrl = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
          await new Promise<void>((resolve) => {
            const done = () => {
              URL.revokeObjectURL(blobUrl);
              resolve();
            };
            const stop = () => {
              audio.pause();
              done();
            };
            activeTTSStopRef.current = stop;
            audio.src = blobUrl;
            audio.onended = done;
            audio.onerror = done;
            audio.play().catch(done);
          }).finally(() => {
            activeTTSStopRef.current = null;
          });
        }
      } catch {
        // TTS 失败时保持原有静默兜底，面试流程仍可继续。
      }
    },
    [ensureAudioGraph, fetchTtsAudio, getRealtimeTtsSocket, stopRealtimeTts]
  );

  const drainAudioQueue = useCallback(async () => {
    if (audioDrainingRef.current) return;
    audioDrainingRef.current = true;
    try {
      while (audioQueueRef.current.length > 0 && !interruptRef.current) {
        const item = audioQueueRef.current.shift();
        if (!item) break;
        setSpeaking(true);
        await playSingleTts(item);
      }
    } finally {
      audioDrainingRef.current = false;
      setSpeaking(false);
      const waiters = audioWaitersRef.current.splice(0);
      waiters.forEach((resolve) => resolve());
    }
  }, [playSingleTts]);

  const waitForAudioDrain = useCallback(async () => {
    while (audioDrainingRef.current && !interruptRef.current) {
      await new Promise<void>((resolve) => {
        audioWaitersRef.current.push(resolve);
      });
    }
  }, []);

  const interruptInterviewer = useCallback(() => {
    interruptRef.current = true;
    audioQueueRef.current = [];
    activeTTSStopRef.current?.();
    stopRealtimeTts();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.onended?.call(audio, new Event("ended"));
    }
    setSpeaking(false);
  }, [stopRealtimeTts]);

  const enqueueInterviewerAudio = useCallback(
    (text: string, speaker?: string, speechRate?: number, loudnessRate?: number) => {
      if (!text.trim()) return;
      interruptRef.current = false;
      audioQueueRef.current.push({ text, speaker, speechRate, loudnessRate });
      if (audioDrainingRef.current) {
        setTimeout(() => void drainAudioQueue(), 0);
      } else {
        void drainAudioQueue();
      }
    },
    [drainAudioQueue]
  );

  // 流式请求面试官（复用逻辑：开始面试 / 提交回答）
  const streamInterviewer = useCallback(
    async (payload: Record<string, unknown>) => {
      const isTurnRequest = Object.prototype.hasOwnProperty.call(payload, "answer")
        || payload.timeout === true
        || payload.switchNext === true;
      const clientRequestId = typeof payload.clientRequestId === "string"
        ? payload.clientRequestId
        : isTurnRequest ? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}` : undefined;
      const streamMessageId = clientRequestId || `system-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const res = await apiFetch("/api/interview/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: interviewLanguageRef.current,
          ...payload,
          clientRequestId,
          revision: typeof payload.revision === "number"
            ? payload.revision
            : (typeof payload.sessionId === "number" ? payload.sessionId : sessionIdRef.current)
              ? sessionRevisionRef.current
              : undefined,
          inputSource: payload.inputSource || "system",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const error = new Error(err.error || "request failed") as Error & { code?: string; revision?: number };
        error.code = typeof err.code === "string" ? err.code : undefined;
        error.revision = typeof err.revision === "number" ? err.revision : undefined;
        throw error;
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("no reader");
      const decoder = new TextDecoder();
      let fullContent = "";
      let buffer = "";
      let newSessionId: number | null = null;
      let activeInterviewer: typeof currentInterviewer = null;
      let completedInfo: { round: number; endedReason: string | null } | null = null;
      let roundEnded = false;
      let streamError: Error | null = null;
      let ttsPendingContent = "";
      const streamSpeaker = () => activeInterviewer ?? currentInterviewer;
      const flushStreamedAudio = (final = false) => {
        const normalized = ttsPendingContent.trim();
        if (!normalized) return;
        const boundary = Math.max(
          normalized.lastIndexOf("。"),
          normalized.lastIndexOf("！"),
          normalized.lastIndexOf("？"),
          normalized.lastIndexOf("!"),
          normalized.lastIndexOf("?"),
          normalized.lastIndexOf(". "),
        );
        if (!final && boundary < 7 && normalized.length < 120) return;
        const length = final ? normalized.length : boundary >= 7 ? boundary + 1 : normalized.length;
        const segment = normalized.slice(0, length).trim();
        ttsPendingContent = normalized.slice(length).trimStart();
        if (!segment) return;
        const speaker = streamSpeaker();
        enqueueInterviewerAudio(segment, speaker?.voice, speaker?.speechRate, speaker?.loudnessRate);
      };

      // A retry/replay must update the same placeholder. The last empty
      // interviewer row is request-owned while a stream is active; locating it
      // inside the state updater avoids a React concurrent-render race.
      setMessages((prev) => [...prev, { role: "interviewer", content: "", requestId: streamMessageId }]);
      streamingRef.current = true;
      setStreaming(true);

      try {
        while (true) {
          if (!interviewAliveRef.current) break;
          const { done, value } = await reader.read();
          if (done || !interviewAliveRef.current) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.sessionId) {
              newSessionId = data.sessionId;
              sessionIdRef.current = data.sessionId;
              setSessionId(data.sessionId);
              if (data.language === "en" || data.language === "zh") {
                interviewLanguageRef.current = data.language;
              }
              if (!isTurnRequest) {
                // The ticket is session-bound. Opening this connection while the
                // interviewer starts speaking removes its handshake from the first audio path.
                void getRealtimeTtsSocket().catch(() => {});
                // ASR connects while the opening is generated and played, but
                // its samples stay gated until the interviewer has finished.
                setListening(true);
              }
            }
            if (typeof data.revision === "number") {
              sessionRevisionRef.current = data.revision;
              setSessionRevision(data.revision);
            }
            if (data.roundEnd) {
              roundEnded = true;
            }
            if (data.type === "session.completed") {
              completedInfo = {
                round: typeof data.round === "number" ? data.round : 1,
                endedReason: typeof data.endedReason === "string" ? data.endedReason : null,
              };
            }
            if (data.type === "error" || data.error) {
              streamError = new Error(typeof data.error === "string" ? data.error : "interview stream failed");
              continue;
            }
            if (data.replay && typeof data.content === "string") {
              fullContent = data.content;
              ttsPendingContent = data.content;
              setMessages((prev) => {
                const next = [...prev];
                const index = next.findLastIndex((message) => message.role === "interviewer" && message.requestId === streamMessageId);
                if (index >= 0) next[index] = { role: "interviewer", content: fullContent, requestId: streamMessageId };
                return next;
              });
              continue;
            }
            if (data.interviewer) {
              // 淘汰帧/轮次切换帧/同轮追问帧都会携带面试官信息——
              // 每次回复都刷新，保证 TTS 音色始终一致（修复同一面试官音色漂移）
              activeInterviewer = data.interviewer;
              setCurrentInterviewer(data.interviewer);
            }
            if (data.roundStart && data.interviewer) {
              setRoundRoleLabel(data.roundRoleLabel || null);
              startRoundTimer(typeof data.timeLimit === "number" ? data.timeLimit : 8);
              if (timeoutEscalateRef.current) clearTimeout(timeoutEscalateRef.current);
              timeoutFiredRef.current = false;
              setCurrentRound(data.round || 1);
              setOrganizing(false);
            }
            if (data.content) {
              fullContent += data.content;
              ttsPendingContent += data.content;
              flushStreamedAudio();
              setMessages((prev) => {
                const next = [...prev];
                const index = next.findLastIndex((message) => message.role === "interviewer" && message.requestId === streamMessageId);
                if (index >= 0) next[index] = { role: "interviewer", content: fullContent, requestId: streamMessageId };
                return next;
              });
            }
          } catch {
            // ignore parse error
          }
          }
        }
      } catch (error) {
        streamingRef.current = false;
        setStreaming(false);
        throw error;
      }
      if (!interviewAliveRef.current) {
        streamingRef.current = false;
        setStreaming(false);
        return { fullContent: "", newSessionId: null, activeInterviewer: null, completedInfo: null, roundEnded: false };
      }
      if (streamError) {
        streamingRef.current = false;
        setStreaming(false);
        throw streamError;
      }
      flushStreamedAudio(true);
      streamingRef.current = false;
      setStreaming(false);
      return { fullContent, newSessionId, activeInterviewer, completedInfo, roundEnded };
    },
    [startRoundTimer, enqueueInterviewerAudio, currentInterviewer, getRealtimeTtsSocket]
  );

  // 开始面试
  const handleStart = async () => {
    const targetCompany = selectedCompany.trim();
    if (!targetCompany || !selectedJobId) {
      alert(t("mockInterview.companyRequired"));
      return;
    }
    // 进入面试间前先申请麦克风权限，被拒绝则留在设置页
    try {
      const preflightStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true }, video: false });
      preflightStream.getTracks().forEach((track) => track.stop());
    } catch (err) {
      handleMicError(err);
      return;
    }
    interviewAliveRef.current = true;
    if (!selectedResumeId) {
      alert(t("mockInterview.resumeRequired"));
      return;
    }
    setMessages([]);
    setSummary("");
    setOverallScore(null);
    sessionIdRef.current = null;
    setSessionId(null);
    sessionRevisionRef.current = 0;
    setSessionRevision(0);
    setCurrentRound(1);
    setCurrentInterviewer(null);
    setRealtimeFallback(false);
    setLiveTranscript("");
    realtimeItemRef.current = null;
    submittedAsrItemsRef.current.clear();
    setStage("interview");
    await startCamera();
    // 先创建会话并播放面试官开场白；拿到 sessionId 后再启动 ASR，避免
    // 首次 ticket/HTTP fallback 绑定到 null 会话。
    setListening(false);
    startAmbience();
    try {
      await streamInterviewer({
        jobId: selectedJobId,
        resumeId: selectedResumeId || undefined,
        mode: "gauntlet",
        totalRounds,
      });
      await waitForAudioDrain();
      if (interviewAliveRef.current && sessionIdRef.current) setListening(true);
    } catch {
      if (interviewAliveRef.current) {
        alert(t("mockInterview.startFailed"));
        setStage("setup");
        setListening(false);
        sessionIdRef.current = null;
        setSessionId(null);
        interruptInterviewer();
        stopCamera();
      }
    }
  };

  // 获取含活跃音轨的麦克风流（复用摄像头流；音轨缺失时重新请求并合并）
  const getMicStream = async (): Promise<MediaStream> => {
    let stream = streamRef.current;
    const hasLiveAudio = !!stream?.getAudioTracks().some((tr) => tr.readyState === "live");
    if (!stream || !hasLiveAudio) {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } });
      if (stream && stream.getVideoTracks().some((tr) => tr.readyState === "live")) {
        // 保留摄像头视频轨，替换音轨
        stream.getAudioTracks().forEach((tr) => { tr.stop(); stream!.removeTrack(tr); });
        audioStream.getAudioTracks().forEach((tr) => stream!.addTrack(tr));
      } else {
        stream?.getTracks().forEach((tr) => tr.stop());
        stream = audioStream;
      }
      streamRef.current = stream;
    }
    return stream;
  };

  const stageRecognizedTranscript = (rawText: string, source: "asr" | "asr_fallback" = "asr") => {
    if (answerSubmittingRef.current || streamingRef.current) return;
    const text = rawText.trim();
    if (!isSubstantiveTranscript(text)) {
      setNoSpeech(true);
      window.setTimeout(() => setNoSpeech(false), 1800);
      return;
    }
    const existing = pendingTranscriptRef.current;
    const next = !existing
      ? text
      : existing.includes(text)
        ? existing
        : text.includes(existing)
          ? text
          : `${existing} ${text}`;
    pendingTranscriptRef.current = next;
    pendingTranscriptSourceRef.current = source;
    setPendingTranscript(next);
    setAnswerRetryRequired(false);
    // Start planning while the candidate reviews the amber transcript. This
    // keeps the plan off the critical submit path; if it is not ready, the
    // final interviewer call still proceeds without blocking on planning.
    const planSessionId = sessionIdRef.current;
    const planRevision = sessionRevisionRef.current;
    if (planSessionId) {
      const planKey = `${planSessionId}:${planRevision}:${next}`;
      if (!turnPlanCacheRef.current.has(planKey)) {
        void apiFetch("/api/interview/turn-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: planSessionId, revision: planRevision, answer: next }),
        }).then(async (response) => {
          if (!response.ok) return;
          const data = await response.json();
          if (data.plan && typeof data.token === "string") {
            turnPlanCacheRef.current.set(planKey, { plan: data.plan, token: data.token });
          }
        }).catch(() => undefined);
      }
    }
    setLiveTranscript("");
    setVoiceActive(false);
    setRecording(false);
    if (autoSubmitTimerRef.current) window.clearTimeout(autoSubmitTimerRef.current);
    // Adjacent ASR finals can belong to one spoken answer. Merge them briefly
    // before the hands-free flow submits the complete response.
    autoSubmitTimerRef.current = window.setTimeout(() => {
      autoSubmitTimerRef.current = null;
      submitPendingTranscriptRef.current();
    }, AUTO_SUBMIT_SETTLE_MS);
  };

  const submitPendingTranscript = async () => {
    const text = pendingTranscriptRef.current.trim();
    if (!text || answerSubmittingRef.current || streamingRef.current) return;
    if (autoSubmitTimerRef.current) {
      window.clearTimeout(autoSubmitTimerRef.current);
      autoSubmitTimerRef.current = null;
    }
    answerSubmittingRef.current = true;
    setLiveTranscript("");
    recognizingRef.current = true;
    setRecognizing(true);
    const submitted = await submitAnswer(text, pendingTranscriptSourceRef.current);
    if (submitted) {
      pendingTranscriptRef.current = "";
      setPendingTranscript("");
      setAnswerRetryRequired(false);
    } else {
      pendingTranscriptRef.current = text;
      setPendingTranscript(text);
      setAnswerRetryRequired(true);
    }
    answerSubmittingRef.current = false;
    recognizingRef.current = false;
    setRecognizing(false);
  };

  useEffect(() => {
    submitPendingTranscriptRef.current = () => {
      void submitPendingTranscript();
    };
  });

  const discardPendingTranscript = () => {
    if (autoSubmitTimerRef.current) {
      window.clearTimeout(autoSubmitTimerRef.current);
      autoSubmitTimerRef.current = null;
    }
    pendingTranscriptRef.current = "";
    setPendingTranscript("");
    setAnswerRetryRequired(false);
    setLiveTranscript("");
  };

  // 处理麦克风错误（细分类型，给出可操作引导）
  const handleMicError = (err: unknown) => {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") setMicErrorKind("denied");
    else if (name === "NotFoundError" || name === "OverconstrainedError") setMicErrorKind("nodevice");
    else if (name === "NotReadableError" || name === "AbortError") setMicErrorKind("busy");
    else setMicErrorKind("unknown");
    setMicError(true);
  };

  // 录音转文字并提交回答
  const recognizeBlob = async (blob: Blob) => {
    recognizingRef.current = true;
    setRecognizing(true);
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );
      const res = await apiFetch("/api/interview/asr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64: base64, audioMimeType: blob.type, language: interviewLanguageRef.current, sessionId: sessionIdRef.current }),
      });
      if (!res.ok) throw new Error("ASR failed");
      const data = await res.json();
      const text = (data.text || "").trim();
      if (text) {
        stageRecognizedTranscript(text, "asr_fallback");
      } else {
        // 未检测到有效语音：轻提示，不当作失败
        setNoSpeech(true);
        setTimeout(() => setNoSpeech(false), 3000);
      }
    } catch {
      alert(t("mockInterview.sendFailed"));
    } finally {
      recognizingRef.current = false;
      setRecognizing(false);
    }
  };

  // 实时模式：浏览器持续发送 PCM16，服务端 VAD 返回中间结果和最终结果。
  // 最终结果只会填入候选人的待提交稿。用户确认后才调用面试模型，
  // 因此自然停顿或环境声不能抢占本轮作答。
  useEffect(() => {
    if (!listening || stage !== "interview" || realtimeFallback) return;
    let cancelled = false;
    let socket: WebSocket | null = null;
    let micStream: MediaStream | null = null;
    let localCtx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let processor: ScriptProcessorNode | null = null;
    let muteGain: GainNode | null = null;
    let ready = false;
    let intentionalClose = false;
    let heartbeat: number | null = null;
    let localSpeechOpen = false;
    let localLastVoiceAt = 0;
    let localLoudFrames = 0;

    const sendClientEvent = (payload: Record<string, unknown>) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
    };

    const stopCapture = () => {
      processor?.disconnect();
      source?.disconnect();
      muteGain?.disconnect();
      processor = null;
      source = null;
      muteGain = null;
      if (localCtx) {
        localCtx.close().catch(() => {});
        localCtx = null;
      }
      realtimeAudioCtxRef.current = null;
      realtimeProcessorRef.current = null;
    };

    const activate = async () => {
      try {
        micStream = await getMicStream();
        if (cancelled) return;
        const Ctor = window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) throw new Error("当前浏览器不支持实时音频采集");

        const ticket = await getRealtimeTicket("asr");
        socket = createInterviewASRSocket(ticket);
        realtimeSocketRef.current = socket;
        const readyPromise = new Promise<void>((resolve, reject) => {
          let settled = false;
          const fail = (error: Error) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            if (realtimeSocketRef.current === socket) realtimeSocketRef.current = null;
            if (socket!.readyState === WebSocket.CONNECTING || socket!.readyState === WebSocket.OPEN) socket!.close();
            reject(error);
          };
          const timeout = window.setTimeout(() => fail(new Error("实时 ASR 连接超时")), 12000);
           socket!.onopen = () => sendClientEvent({ type: "start", language: interviewLanguageRef.current, sessionId: sessionIdRef.current });
          socket!.onmessage = (event) => {
            let data: {
              type?: string;
              itemId?: string;
              text?: string;
              error?: string;
            };
            try {
              data = JSON.parse(String(event.data));
            } catch {
              return;
            }
            if (data.type === "ready") {
              settled = true;
              window.clearTimeout(timeout);
              ready = true;
              heartbeat = window.setInterval(() => sendClientEvent({ type: "ping" }), 25_000);
              resolve();
              return;
            }
            if (data.type === "speech_started") {
              if (!candidateTurnRef.current) return;
              setVoiceActive(true);
              setRecording(true);
              return;
            }
            if (data.type === "speech_stopped") {
              if (!candidateTurnRef.current) return;
              setVoiceActive(false);
              setRecording(false);
              return;
            }
            if (data.type === "partial") {
              if (!candidateTurnRef.current) return;
              setLiveTranscript(data.text || "");
              return;
            }
            if (data.type === "final") {
              if (!candidateTurnRef.current) return;
              const text = (data.text || "").trim();
              const itemId = data.itemId || `final:${text}`;
              if (!text || submittedAsrItemsRef.current.has(itemId)) return;
              submittedAsrItemsRef.current.add(itemId);
              realtimeItemRef.current = data.itemId || null;
              stageRecognizedTranscript(text);
              return;
            }
            if (data.type === "error" && !ready) {
              fail(new Error(data.error || "实时 ASR 失败"));
            }
          };
          socket!.onerror = () => {
            if (!ready) {
              fail(new Error("实时 ASR 连接失败"));
            }
          };
          socket!.onclose = () => {
            if (!cancelled && !intentionalClose && ready) setRealtimeFallback(true);
            if (!ready) {
              fail(new Error("实时 ASR 连接已关闭"));
            }
          };
        });

        await readyPromise;
        if (cancelled) return;

        localCtx = new Ctor({ sampleRate: 16000 });
        realtimeAudioCtxRef.current = localCtx;
        if (localCtx.state === "suspended") await localCtx.resume();
        const audioOnlyStream = new MediaStream(micStream.getAudioTracks());
        source = localCtx.createMediaStreamSource(audioOnlyStream);
        processor = localCtx.createScriptProcessor(4096, 1, 1);
        muteGain = localCtx.createGain();
        muteGain.gain.value = 0;
        realtimeProcessorRef.current = processor;
        source.connect(processor);
        processor.connect(muteGain);
        muteGain.connect(localCtx.destination);
          processor.onaudioprocess = (event) => {
          if (
            cancelled ||
            socket?.readyState !== WebSocket.OPEN ||
            !candidateTurnRef.current ||
            speakingRef.current ||
            streamingRef.current ||
            recognizingRef.current
          ) return;
          const input = event.inputBuffer.getChannelData(0);
          let power = 0;
          for (let index = 0; index < input.length; index += 1) power += input[index] * input[index];
          const rms = Math.sqrt(power / input.length);
          const now = Date.now();
          if (rms >= ASR_SEND_RMS_THRESHOLD) {
            localLoudFrames += 1;
            if (localLoudFrames >= 2) {
              localSpeechOpen = true;
              localLastVoiceAt = now;
            }
          } else {
            localLoudFrames = 0;
          }
          if (!localSpeechOpen) return;
          if (now - localLastVoiceAt > 1200) {
            localSpeechOpen = false;
            return;
          }
          const pcm = downsampleToPCM16(input, localCtx?.sampleRate || 16000, 16000);
          if (pcm.byteLength > 0) socket.send(pcm);
        };
      } catch (error) {
        if (!cancelled) {
          console.warn("[mock-interview] realtime ASR unavailable, falling back to HTTP ASR", error);
          setRealtimeFallback(true);
        }
      }
    };

    void activate();
    return () => {
      cancelled = true;
      intentionalClose = true;
      if (heartbeat !== null) window.clearInterval(heartbeat);
      stopCapture();
      if (socket?.readyState === WebSocket.OPEN) {
        sendClientEvent({ type: "stop" });
        socket.close(1000, "capture stopped");
      }
      if (realtimeSocketRef.current === socket) realtimeSocketRef.current = null;
      setVoiceActive(false);
      setRecording(false);
    };
    // Transcript staging/getMicStream are stable for the lifetime of this page render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, stage, realtimeFallback, sessionId, getRealtimeTicket]);

  // Fallback keeps one VAD graph for the session. Non-answer phases only gate
  // recording, so a render transition cannot repeatedly acquire the microphone.
  useEffect(() => {
    if (!listening || stage !== "interview" || !realtimeFallback) return;
    let cancelled = false;
    let localCtx: AudioContext | null = null;
    let vadSource: MediaStreamAudioSourceNode | null = null;
    let vadAnalyser: AnalyserNode | null = null;
    let recorder: MediaRecorder | null = null;

    const run = async () => {
      try {
        const stream = await getMicStream();
        if (cancelled) return;
        setMicError(false);
        setMicErrorKind(null);
        // 优先复用全局 AudioContext（免提按钮手势中已创建并激活）；
        // 自建的 AudioContext 若处于 suspended 状态，频谱/波形数据被冻结，RMS 恒为 0（说话检测不到）
        ensureAudioGraph();
        let ctx = audioCtxRef.current;
        if (!ctx) {
          const Ctor = window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!Ctor) return;
          ctx = new Ctor();
          localCtx = ctx; // 仅自建的由本 effect 负责关闭
        }
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        vadSource = source;
        vadAnalyser = analyser;
        analyser.fftSize = 512;
        source.connect(analyser); // 不接 destination，避免回放自己的声音
        const data = new Uint8Array(analyser.fftSize);
        let hasVoice = false;
        let silenceStart: number | null = null;
        let voiceOnset: number | null = null;

        const loop = () => {
          if (cancelled) return;
          if (!candidateTurnRef.current) {
            hasVoice = false;
            silenceStart = null;
            voiceOnset = null;
            if (recorder && recorder.state === "recording") {
              recorder.onstop = null;
              recorder.stop();
              recorder = null;
            }
            setVoiceActive(false);
            setRecording(false);
            vadRafRef.current = requestAnimationFrame(loop);
            return;
          }
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / data.length);
          const now = Date.now();
          if (rms > ASR_SEND_RMS_THRESHOLD) {
            // 检测到语音：开始/继续录音
            hasVoice = true;
            silenceStart = null;
            voiceOnset = null;
            setVoiceActive(true);
            if (!recorder || recorder.state === "inactive") {
              audioChunksRef.current = [];
              const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
              try {
                // 用纯音频流录音：摄像头开启时 getMicStream 返回的是视频轨+音轨合并流，
                // 视频轨与 audio/* 容器冲突会导致 start() 抛 NotSupportedError
                const audioOnlyStream = new MediaStream(stream.getAudioTracks());
                const rec = new MediaRecorder(audioOnlyStream, { mimeType });
                rec.ondataavailable = (e) => {
                  if (e.data.size > 0) audioChunksRef.current.push(e.data);
                };
                rec.start();
                recorder = rec;
                setRecording(true);
              } catch {
                // 录音启动失败：终止监听循环并提示，避免 rAF 内反复抛错
                cancelled = true;
                setRecording(false);
                setVoiceActive(false);
                handleMicError(new Error("MediaRecorder start failed"));
                setListening(false);
                return;
              }
            }
          } else {
            voiceOnset = null;
            setVoiceActive(false);
            if (hasVoice && recorder && recorder.state === "recording") {
              if (silenceStart === null) silenceStart = now;
              if (now - silenceStart > 1200) {
                // 停顿超时：说完一段话，停止录音并送识别
                hasVoice = false;
                silenceStart = null;
                setRecording(false);
                const rec = recorder;
                recorder = null;
                rec.onstop = () => {
                  const blob = new Blob(audioChunksRef.current, { type: rec.mimeType });
                  if (blob.size >= 1000) recognizeBlob(blob);
                };
                rec.stop();
              }
            }
          }
          vadRafRef.current = requestAnimationFrame(loop);
        };
        loop();
      } catch (err) {
        if (!cancelled) {
          handleMicError(err);
          setListening(false);
        }
      }
    };
    run();

    return () => {
      cancelled = true;
      if (vadRafRef.current) cancelAnimationFrame(vadRafRef.current);
      // 断开分析节点（共享 ctx 时仅断开连接；自建的 ctx 才关闭）
      try {
        vadSource?.disconnect();
        vadAnalyser?.disconnect();
      } catch {
        // 节点可能已断开：忽略
      }
      localCtx?.close().catch(() => {});
      if (recorder && recorder.state === "recording") {
        recorder.onstop = null;
        recorder.stop(); // 丢弃未完成的录音
      }
      setVoiceActive(false);
      setRecording(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, stage, realtimeFallback]);

  const switchToNextInterviewer = useCallback(async () => {
    setOrganizing(true);
    await sleep(ROUND_HANDOFF_DELAY_MS);
    setOrganizing(false);
    const next = await streamInterviewer({ sessionId, switchNext: true });
    await waitForAudioDrain();
    return next;
  }, [sessionId, streamInterviewer, waitForAudioDrain]);

  // 提交回答
  const submitAnswer = async (text: string, inputSource: "asr" | "asr_fallback"): Promise<boolean> => {
    if (!text.trim() || streamingRef.current || !sessionIdRef.current) return false;
    if (timeoutEscalateRef.current) clearTimeout(timeoutEscalateRef.current);
    timeoutFiredRef.current = false;
    const previousRevision = sessionRevisionRef.current;
    const existingRequest = pendingAnswerRequestRef.current;
    const requestId = existingRequest?.text === text
      ? existingRequest.requestId
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
    pendingAnswerRequestRef.current = { text, requestId };
    setMessages((prev) => prev.some((message) => message.role === "candidate" && message.requestId === requestId)
      ? prev
      : [...prev, { role: "candidate", content: text, requestId }]);
    try {
      const planKey = `${sessionIdRef.current}:${previousRevision}:${text}`;
      // B strategy: planning starts as soon as ASR produces a final draft.
      // Never wait for it here. A fast submit should enter the interviewer
      // stream immediately; the full context prompt is the quality fallback.
      const plan = turnPlanCacheRef.current.get(planKey);
      const requestPayload = {
        sessionId: sessionIdRef.current,
        answer: text,
        inputSource,
        clientRequestId: requestId,
        ...(plan ? { turnPlan: plan.plan, turnPlanToken: plan.token } : {}),
      };
      let result;
      try {
        result = await streamInterviewer(requestPayload);
      } catch (error) {
        const typed = error as Error & { code?: string; revision?: number };
        if (typed.code !== "REVISION_CONFLICT" || typeof typed.revision !== "number") throw error;
        // An ASR final can land immediately after the preceding SSE frame. The
        // server is authoritative: sync its revision and replay this exact
        // idempotent request once instead of dropping the recognised answer.
        sessionRevisionRef.current = typed.revision;
        setSessionRevision(typed.revision);
        result = await streamInterviewer({ ...requestPayload, revision: typed.revision });
      }
      const { completedInfo, roundEnded } = result;
      pendingAnswerRequestRef.current = null;
      setMessages((prev) => prev.map((message) => (
        message.requestId === requestId ? { ...message, requestId: undefined } : message
      )));
      if (completedInfo) {
        setInterviewCompleted(true);
        setListening(false);
        stopCamera();
        clearPressure();
        // Generate in the background while the final closing sentence plays;
        // wait only to switch views so the closing audio is never cut off.
        void generateSummary(false);
        await waitForAudioDrain();
        setStage("summary");
        return true;
      }
      await waitForAudioDrain();
      if (roundEnded) {
        // 面试官主动结束本轮：自然停顿后由下一位开场
        await switchToNextInterviewer();
      }
      return true;
    } catch (error) {
      setMessages((prev) => {
        // The ASR draft remains below for retry. Remove only text streamed by
        // this failed request; a same-text answer from another turn is never
        // touched by this cleanup.
        return prev.filter((message) => message.requestId !== requestId);
      });
      const typed = error as Error & { code?: string };
      if (typed.code !== "REQUEST_IN_FLIGHT") alert(t("mockInterview.sendFailed"));
      return false;
    }
  };

  // 生成评估报告（SSE 流式）；失败或超时进入可重试状态。
  const generateSummary = async (showSummaryImmediately = true) => {
    const targetSessionId = sessionIdRef.current ?? sessionId;
    if (!targetSessionId || summaryRunningRef.current) return;
    summaryRunningRef.current = true;
    const controller = new AbortController();
    summaryAbortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), SUMMARY_CLIENT_TIMEOUT_MS);
    setEnding(true);
    setReportError(false);
    if (showSummaryImmediately) setStage("summary");
    setSummary("");
    setReport(null);
    setReportStats(null);
    setReportHistory([]);
    setReportChars(0);
    try {
      const res = await apiFetch("/api/interview/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: targetSessionId, language }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error("failed");
      const reader = res.body?.getReader();
      if (!reader) throw new Error("no reader");
      const decoder = new TextDecoder();
      let buffer = "";
      let reportReceived = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.content) {
              // 生成中：仅更新进度字符数（原始 JSON 不直接展示）
              setReportChars((c) => c + String(data.content).length);
            }
            if (data.report) {
              reportReceived = true;
              setReport(data.report as InterviewReport);
              if (data.stats) setReportStats(data.stats as ReportStats);
              if (Array.isArray(data.history)) setReportHistory(data.history as HistoryPoint[]);
              if (data.score) setOverallScore(data.score);
            }
            if (data.error) throw new Error(data.error);
          } catch (e) {
            if (e instanceof Error && e.message !== "failed") throw e;
          }
        }
      }
      // 流正常结束但未收到报告：视为失败（理论上后端总会发 report 或 error）
      if (!reportReceived && summaryAbortRef.current === controller) setReportError(true);
    } catch {
      if (summaryAbortRef.current === controller) setReportError(true);
    } finally {
      window.clearTimeout(timeout);
      if (summaryAbortRef.current === controller) {
        summaryAbortRef.current = null;
        setEnding(false);
      }
      summaryRunningRef.current = false;
    }
  };

  // Stage timeout asks the server to close the round. The client only reacts to structured events.
  const handleStageTimeout = useCallback(async () => {
    if (!sessionId || ending || timeoutFiredRef.current) return;
    timeoutFiredRef.current = true;
    try {
      const { completedInfo, roundEnded } = await streamInterviewer({ sessionId, timeout: true });
      if (completedInfo) {
        setInterviewCompleted(true);
        setListening(false);
        stopCamera();
        clearPressure();
        void generateSummary(false);
        await waitForAudioDrain();
        setStage("summary");
        return;
      }
      await waitForAudioDrain();
      if (roundEnded) {
        await switchToNextInterviewer();
        return;
      }
      timeoutEscalateRef.current = setTimeout(() => {
        timeoutEscalateRef.current = null;
        void generateSummary();
      }, 30000);
    } catch {
      timeoutFiredRef.current = false;
    }
  }, [sessionId, ending, streamInterviewer, waitForAudioDrain, switchToNextInterviewer, generateSummary, clearPressure, stopCamera]);

  useEffect(() => {
    if (roundSecondsLeft !== 0 || !sessionId || stage !== "interview" || streaming || ending || organizing) return;
    const timer = setTimeout(() => {
      void handleStageTimeout();
    }, 600);
    return () => clearTimeout(timer);
  }, [roundSecondsLeft, sessionId, stage, streaming, ending, organizing, handleStageTimeout]);

  // 结束面试
  const handleEnd = async () => {
    if (ending) return;
    if (!confirm(t("mockInterview.endConfirm"))) return;
    interviewAliveRef.current = false;
    setEnding(true);
    setListening(false);
    stopCamera();
    clearPressure();
    audioRef.current?.pause();
    setSpeaking(false);

    // 会话尚未创建（开场流还没返回 sessionId）：无需生成总结，直接回设置页
    if (!sessionId) {
      setEnding(false);
      handleRestart();
      return;
    }

    // 全程未作答：不生成 AI 评估，标记会话结束后直接返回设置页
    const hasAnswer = messages.some((m) => m.role === "candidate" && m.content.trim());
    if (!hasAnswer) {
      try {
        const res = await apiFetch("/api/interview/summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, language }),
        });
        await res.text(); // 排空响应流（后端秒回 skipped）
      } catch {
        // 忽略网络异常：会话残留为 in_progress 无副作用
      }
      setEnding(false);
      alert(t("mockInterview.noAnswerSkip"));
      handleRestart();
      return;
    }

    await generateSummary();
  };

  // 提交真实度问卷：评分分流（<6 低真实度进人工审查队列 / >=6 高质量案例沉淀为训练数据）
  const submitFeedback = async () => {
    if (!sessionId || realismScore === null) return;
    setFeedbackSubmitting(true);
    try {
      await apiFetch("/api/interview/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          realismScore,
          feedbackText: realismScore < 6 ? feedbackText.trim() || undefined : undefined,
        }),
      });
    } catch {
      // 静默失败：问卷不打断用户流程
    }
    setFeedbackSubmitting(false);
    setFeedbackDone(true);
    setFeedbackOpen(false);
  };

  const handleRestart = () => {
    summaryAbortRef.current?.abort();
    summaryAbortRef.current = null;
    summaryRunningRef.current = false;
    if (autoSubmitTimerRef.current) {
      window.clearTimeout(autoSubmitTimerRef.current);
      autoSubmitTimerRef.current = null;
    }
    interviewAliveRef.current = false;
    setEnding(false);
    setStreaming(false);
    setStage("setup");
    setMessages([]);
    setSummary("");
    setReport(null);
    setReportView("coach");
    setReportStats(null);
    setReportError(false);
    setReportHistory([]);
    setReportChars(0);
    setAnswerRetryRequired(false);
    setOverallScore(null);
    sessionIdRef.current = null;
    setSessionId(null);
    sessionRevisionRef.current = 0;
    setSelectedCompany("");
    setSelectedJobId(null);
    setSelectedResumeId(null);
    setCurrentRound(1);
    setCurrentInterviewer(null);
    setOrganizing(false);
    setRoundRoleLabel(null);
    setInterviewCompleted(false);
    setFeedbackOpen(false);
    setFeedbackDone(false);
    setRealismScore(null);
    setFeedbackText("");
    setListening(false);
    setSetupOpen(true);
    clearPressure();
  };

  const qaCount = messages.filter((m) => m.role === "candidate").length;

  // ========== 面试设置阶段 ==========
  if (stage === "setup") {
    return (
        <div className="min-h-screen bg-white dark:bg-black">
          <Header1 />
          <main className="py-8 md:py-12">
            <div className="container mx-auto px-4 max-w-3xl">
              <PageBackButton fallbackHref="/" className="mb-3" />
              <div className="mb-8 text-center">
                <div className="inline-flex items-center justify-center h-12 w-12 rounded-2xl bg-zinc-900 dark:bg-white mb-3">
                  <Bot className="h-6 w-6 text-white dark:text-zinc-900" />
                </div>
                <h1 className="text-3xl md:text-4xl font-light text-black dark:text-white mb-2">
                  {t("mockInterview.title")}
                </h1>
                <p className="text-gray-500 dark:text-gray-400">{t("mockInterview.subtitle")}</p>
              </div>

              {/* Modal 被关闭后的重新打开入口 */}
              {!setupOpen && (
                <div className="flex justify-center">
                  <Button
                    onClick={() => setSetupOpen(true)}
                    variant="outline"
                    className="rounded-full h-11 px-6"
                  >
                    <ClipboardList className="h-4 w-4 mr-2" />
                    {t("mockInterview.openSettings")}
                  </Button>
                </div>
              )}
            </div>
          </main>

          {/* 面试设置表单：桌面居中 Dialog / 移动端底部 Drawer（响应式 Modal） */}
          <Modal open={setupOpen} onOpenChange={setSetupOpen}>
            <ModalContent
              popoverProps={{ className: "p-0 gap-0 sm:max-w-2xl max-h-[88vh] flex flex-col overflow-hidden" }}
            >
              <ModalHeader className="px-6 pt-6 pb-2 text-left">
                <ModalTitle>{t("mockInterview.setupTitle")}</ModalTitle>
                <ModalDescription>{t("mockInterview.subtitle")}</ModalDescription>
              </ModalHeader>
              <ModalBody className="px-6 py-4 flex-1 overflow-y-auto min-h-0">

                {/* 公司/岗位筛选 */}
                <div className="grid md:grid-cols-2 gap-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {t("mockInterview.selectCompany")}
                    </label>
                    <OptionSelect
                      icon={Building2}
                      label={t("mockInterview.selectCompany")}
                      placeholder={t("mockInterview.companyPlaceholder")}
                      options={companies.map((c) => ({ value: c, text: c }))}
                      value={selectedCompany}
                      onChange={setSelectedCompany}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {t("mockInterview.selectJob")}
                    </label>
                    <OptionSelect
                      icon={Briefcase}
                      label={t("mockInterview.selectJob")}
                      placeholder={t("mockInterview.jobPlaceholder")}
                      options={jobs.map((j) => ({ value: String(j.id), text: j.title }))}
                      value={selectedJobId ? String(selectedJobId) : ""}
                      onChange={(v) => setSelectedJobId(v ? Number(v) : null)}
                      disabled={!selectedCompany}
                      loading={jobsLoading}
                    />
                  </div>
                </div>

                {/* 简历选择 */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t("mockInterview.resume")}
                  </label>
                  <OptionSelect
                    icon={FileText}
                    label={t("mockInterview.resume")}
                    placeholder={t("mockInterview.resumePlaceholder")}
                    options={resumes.map((r) => ({ value: String(r.id), text: r.file_name }))}
                    value={selectedResumeId ? String(selectedResumeId) : ""}
                    onChange={(v) => setSelectedResumeId(v ? Number(v) : null)}
                  />
                  <p className="text-xs text-gray-400 mt-1.5">{t("mockInterview.resumeHint")}</p>
                </div>

                {/* 企业面试基因预览卡：展示目标公司的考察重心与风格，传递"这家公司特有问法"的差异感 */}
                {(dnaLoading || dnaPreview) && (
                  <div className="mb-6 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-4 animate-in fade-in duration-300">
                    {dnaLoading && !dnaPreview ? (
                      <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {t("mockInterview.dnaLoading")}
                      </div>
                    ) : dnaPreview ? (
                      <>
                        <div className="flex items-center gap-2 mb-1.5">
                          <Building2 className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
                          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {dnaPreview.company} · {t("mockInterview.dnaTitle")}
                          </span>
                          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">
                            {dnaPreview.source === "curated"
                              ? t("mockInterview.dnaCurated")
                              : dnaPreview.source === "cached"
                                ? t("mockInterview.dnaCached")
                                : t("mockInterview.dnaGenerated")}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2.5">{dnaPreview.tagline}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {dnaPreview.focusAreas.map((f) => (
                            <span
                              key={f.dimension}
                              className={`text-[11px] px-2 py-1 rounded-full border ${
                                f.weight === "core"
                                  ? "border-zinc-900 dark:border-zinc-200 text-zinc-900 dark:text-zinc-100 font-medium"
                                  : "border-zinc-300 dark:border-zinc-600 text-zinc-500 dark:text-zinc-400"
                              }`}
                            >
                              {f.dimension}
                            </span>
                          ))}
                        </div>
                      </>
                    ) : null}
                  </div>
                )}

              </ModalBody>
              <ModalFooter className="px-6 pb-6 pt-2">
                {micError && (
                  <div className="w-full mb-3 flex flex-col items-center gap-1 px-4 text-center">
                    <p className="text-xs text-red-400">
                      {micErrorKind === "denied"
                        ? t("mockInterview.micDenied")
                        : micErrorKind === "nodevice"
                          ? t("mockInterview.micNoDevice")
                          : micErrorKind === "busy"
                            ? t("mockInterview.micBusy")
                            : t("mockInterview.micError")}
                    </p>
                    {micErrorKind === "denied" && (
                      <p className="text-zinc-500 text-[11px] max-w-md leading-relaxed">
                        {t("mockInterview.micDeniedGuide")}
                      </p>
                    )}
                    {micError && inIframe && (
                      <button
                        onClick={() => window.open(window.location.href, "_blank")}
                        className="mt-1 px-3 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-[11px] transition-colors"
                      >
                        {t("mockInterview.openInNewTab")}
                      </button>
                    )}
                  </div>
                )}
                <Button
                  onClick={handleStart}
                  disabled={streaming}
                  className="w-full h-12 rounded-full bg-zinc-900 hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 text-white text-base shadow-md transition-colors"
                >
                  {streaming ? (
                    <><Loader2 className="h-5 w-5 mr-2 animate-spin" />{t("mockInterview.starting")}</>
                  ) : (
                    <><Mic className="h-5 w-5 mr-2" />{t("mockInterview.start")}</>
                  )}
                </Button>
              </ModalFooter>
            </ModalContent>
          </Modal>
        </div>
  );
}

  // ========== 面试进行阶段（视频面试间） ==========
  if (stage === "interview") {
    const statusText = organizing
      ? t("mockInterview.organizing")
      : speaking
        ? t("mockInterview.speaking")
        : streaming
          ? t("mockInterview.thinking")
          : recognizing
            ? t("mockInterview.recognizing")
            : candidateTurn
              ? t("mockInterview.micAlwaysOn")
              : t("mockInterview.thinking");
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col">
          {/* TTS 播放元素（固定元素，供音波频谱分析） */}
          <audio ref={audioRef} className="hidden" />
          {interviewCompleted && (
            <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950/95 backdrop-blur animate-in fade-in duration-500">
              <div className="h-16 w-16 rounded-full bg-zinc-500/10 border border-zinc-500/20 flex items-center justify-center mb-6">
                <Check className="h-7 w-7 text-zinc-300" />
              </div>
              <h2 className="text-xl font-semibold text-zinc-100 mb-2">
                {t("mockInterview.wrapUpTitle")}
              </h2>
              <p className="text-sm text-zinc-400 mb-8 max-w-sm text-center px-6">
                {t("mockInterview.wrapUpDesc")}
              </p>
              <Loader2 className="h-6 w-6 text-zinc-500 animate-spin" />
            </div>
          )}
          {/* 顶部栏 */}
          <div className="flex items-center justify-between px-4 md:px-6 py-3 bg-zinc-900/80 backdrop-blur border-b border-zinc-800">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[#C46A4A] to-[#B5BEB0] flex items-center justify-center">
                <Bot className="h-4 w-4 text-white" />
              </div>
              <div>
                <p className="text-white text-sm font-medium">
                  {currentInterviewer ? currentInterviewer.name : t("mockInterview.title")}
                </p>
                <p className="text-zinc-400 text-xs">
                  {currentInterviewer
                    ? `${currentInterviewer.title ? (language.startsWith("zh") ? currentInterviewer.title.zh : currentInterviewer.title.en) + " · " : ""}${currentInterviewer.company}`
                    : t("mockInterview.qaCount").replace("{count}", String(qaCount))}
                </p>
              </div>
            </div>
            {/* 自动流程阶段进度 */}
            <div className="hidden md:flex items-center gap-2">
                {Array.from({ length: totalRounds }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-2 rounded-full transition-all ${
                      i + 1 < currentRound
                        ? "w-6 bg-[#B5BEB0]"
                        : i + 1 === currentRound
                          ? "w-8 bg-[#C46A4A]"
                          : "w-6 bg-zinc-700"
                    }`}
                  />
                ))}
                <span className="text-zinc-400 text-xs ml-2">
                  {t("mockInterview.roundProgress").replace("{current}", String(currentRound)).replace("{total}", String(totalRounds))}
                </span>
                {roundRoleLabel && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-zinc-400 border border-white/10">
                    {language.startsWith("zh") ? roundRoleLabel.zh : roundRoleLabel.en}
                  </span>
                )}
                {roundSecondsLeft !== null && (
                  <span className={`flex items-center gap-1 text-xs font-mono tabular-nums ${roundSecondsLeft < 60 ? "text-red-400 animate-pulse" : "text-zinc-400"}`}>
                    <Timer className="h-3.5 w-3.5" />
                    {`${Math.floor(roundSecondsLeft / 60).toString().padStart(2, "0")}:${(roundSecondsLeft % 60).toString().padStart(2, "0")}`}
                  </span>
                )}
            </div>
            <div className="flex items-center gap-2">
              {roundSecondsLeft !== null && (
                <span className={`md:hidden flex items-center gap-1 text-xs font-mono tabular-nums ${roundSecondsLeft < 60 ? "text-red-400 animate-pulse" : "text-zinc-400"}`}>
                  <Timer className="h-3.5 w-3.5" />
                  {`${Math.floor(roundSecondsLeft / 60)}:${String(roundSecondsLeft % 60).padStart(2, "0")}`}
                </span>
              )}
              <button
                onClick={() => setShowSubtitle((v) => !v)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  showSubtitle ? "bg-[#C46A4A] text-white" : "bg-zinc-800 text-zinc-400"
                }`}
              >
                {t("mockInterview.subtitleOn")}
              </button>
              <Button
                onClick={handleEnd}
                disabled={ending}
                variant="destructive"
                className="rounded-full h-9"
              >
                <PhoneOff className="h-4 w-4 mr-1.5" />
                {ending ? t("mockInterview.ending") : t("mockInterview.endInterview")}
              </Button>
            </div>
          </div>

          {/* 视频区域 */}
          <div className="flex-1 flex flex-col md:flex-row gap-3 p-3 md:p-4 max-w-7xl w-full mx-auto">
            {/* AI 面试官画面 */}
            <div className="flex-1 relative rounded-3xl overflow-hidden bg-gradient-to-br from-zinc-900 to-zinc-800 border border-zinc-800" style={{ aspectRatio: "16/9" }}>
              <div className="absolute inset-0 flex flex-col items-center justify-center px-6">
                {/* 面试官音波图（真实音频频谱驱动） */}
                <canvas
                  ref={waveCanvasRef}
                  width={560}
                  height={128}
                  className="w-full max-w-sm md:max-w-md h-20 md:h-28"
                />
                {currentInterviewer && (
                  <p className="text-white text-sm md:text-base font-medium mt-4">{currentInterviewer.name}</p>
                )}
                <p className="text-zinc-400 text-sm mt-2">{statusText}</p>
              </div>
              <div className="absolute bottom-3 left-3 px-3 py-1 rounded-full bg-black/50 text-white text-xs">
                {currentInterviewer
                  ? `${currentInterviewer.title ? (language.startsWith("zh") ? currentInterviewer.title.zh : currentInterviewer.title.en) + " · " : ""}${currentInterviewer.name} · ${currentInterviewer.company}`
                  : t("mockInterview.interviewer")}
              </div>

            </div>

            {/* 候选人画面（摄像头） */}
            <div className="flex-1 relative rounded-3xl overflow-hidden bg-black border border-zinc-800" style={{ aspectRatio: "16/9" }}>
              {/* video 始终渲染，CSS 控制显隐（WebRTC 规范） */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${cameraOn ? "block" : "hidden"}`}
              />
              {!cameraOn && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500">
                  {cameraError ? (
                    <>
                      <VideoOff className="h-12 w-12 mb-3" />
                      <p className="text-sm px-4 text-center">{t("mockInterview.cameraError")}</p>
                    </>
                  ) : (
                    <>
                      <User className="h-12 w-12 mb-3" />
                      <p className="text-sm">{t("mockInterview.cameraOff")}</p>
                    </>
                  )}
                  <Button onClick={startCamera} variant="outline" className="mt-4 rounded-full border-zinc-700 text-zinc-300 hover:bg-zinc-800">
                    <Video className="h-4 w-4 mr-2" />
                    {t("mockInterview.start")}
                  </Button>
                </div>
              )}
              <div className="absolute bottom-3 left-3 px-3 py-1 rounded-full bg-black/50 text-white text-xs">
                {t("mockInterview.you")}
              </div>
              {recording && (
                <div className="absolute top-3 right-3 flex items-center gap-2 px-3 py-1 rounded-full bg-red-600 text-white text-xs">
                  <span className="h-2 w-2 rounded-full bg-white animate-ping" />
                  REC
                </div>
              )}
            </div>
          </div>

          {/* 字幕区域 */}
          {showSubtitle && (
            <div className="px-4 md:px-6 pb-2">
              <div className="max-w-4xl mx-auto rounded-2xl bg-zinc-900/80 backdrop-blur border border-zinc-800 px-4 py-3 max-h-28 overflow-y-auto">
                {messages.length === 0 ? (
                  <p className="text-zinc-500 text-sm text-center">{t("mockInterview.emptyHint")}</p>
                ) : (
                  <div className="space-y-2">
                    {messages.slice(-4).map((m, i) => (
                      <p key={i} className="text-sm">
                        <span className={`font-medium mr-2 ${m.role === "interviewer" ? "text-[#C46A4A]" : "text-[#B5BEB0]"}`}>
                          {m.role === "interviewer" ? (currentInterviewer?.name || t("mockInterview.interviewer")) : t("mockInterview.you")}:
                        </span>
                        <span className="text-zinc-300">{m.content || (streaming && i === messages.slice(-4).length - 1 ? "..." : "")}</span>
                      </p>
                    ))}
                    {liveTranscript && (
                      <p className="text-sm text-zinc-400 italic border-t border-zinc-800 pt-2">
                        {liveTranscript}
                      </p>
                    )}
                    {pendingTranscript && (
                      <div className="border-t border-amber-400/25 pt-2">
                        <p className="text-sm text-amber-100">{pendingTranscript}</p>
                        <p className="mt-1 text-[11px] text-amber-300/80">
                          {answerRetryRequired
                            ? (interviewLanguageRef.current === "en" ? "Sending failed. Retry or discard this transcript." : "发送失败：可重试或丢弃本次识别结果。")
                            : (interviewLanguageRef.current === "en" ? "Recognized. Sending automatically…" : "已识别，正在自动提交…")}
                        </p>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 底部语音状态：系统在候选人作答窗口自动采集。 */}
          <div className="px-4 md:px-6 pb-5 pt-2">
            <div className="max-w-4xl mx-auto flex flex-col items-center gap-3">
              {(micError || (noSpeech && !micError)) && (
                <div className="flex flex-col items-center gap-1 px-4 text-center">
                  <p className={`text-xs ${micError ? "text-red-400" : "text-amber-400"}`}>
                    {micError
                      ? micErrorKind === "denied"
                        ? t("mockInterview.micDenied")
                        : micErrorKind === "nodevice"
                          ? t("mockInterview.micNoDevice")
                          : micErrorKind === "busy"
                            ? t("mockInterview.micBusy")
                            : t("mockInterview.micError")
                      : t("mockInterview.noSpeech")}
                  </p>
                  {micError && micErrorKind === "denied" && (
                    <p className="text-zinc-500 text-[11px] max-w-md leading-relaxed">
                      {t("mockInterview.micDeniedGuide")}
                    </p>
                  )}
                  {micError && inIframe && (
                    <button
                      onClick={() => window.open(window.location.href, "_blank")}
                      className="mt-1 px-3 py-1 rounded-full bg-white/10 hover:bg-white/15 text-zinc-200 text-[11px] transition-colors"
                    >
                      {t("mockInterview.openInNewTab")}
                    </button>
                  )}
                </div>
              )}
              <button
                onClick={() => {
                  if (answerRetryRequired && pendingTranscript) {
                    void submitPendingTranscript();
                  } else if (speaking) {
                    interruptInterviewer();
                  }
                }}
                disabled={(!speaking && !answerRetryRequired) || recognizing}
                title={speaking
                  ? (language === "zh" ? "打断面试官" : "Interrupt interviewer")
                  : answerRetryRequired
                    ? (interviewLanguageRef.current === "en" ? "Retry answer" : "重试发送")
                  : candidateTurn
                    ? t("mockInterview.micAlwaysOn")
                    : t("mockInterview.thinking")}
                className={`h-16 w-16 md:h-20 md:w-20 rounded-full flex items-center justify-center transition-all select-none ${
                  answerRetryRequired
                    ? "bg-amber-500 hover:bg-amber-400 shadow-lg shadow-amber-500/30"
                    : candidateTurn
                    ? voiceActive
                      ? "bg-red-500 scale-110 shadow-lg shadow-red-500/40"
                      : "bg-red-500/80 shadow-lg shadow-red-500/30 animate-pulse"
                    : streaming || recognizing || speaking || organizing
                      ? "bg-zinc-800 cursor-not-allowed"
                      : "bg-zinc-800"
                }`}
              >
                {recognizing ? (
                  <Loader2 className="h-7 w-7 text-white animate-spin" />
                ) : answerRetryRequired ? (
                  <RotateCcw className="h-7 w-7 text-white" />
                ) : candidateTurn ? (
                  <Mic className="h-7 w-7 text-white" />
                ) : speaking ? (
                  <VolumeX className="h-7 w-7 text-white" />
                ) : (
                  <MicOff className="h-7 w-7 text-zinc-500" />
                )}
              </button>
              <p className="text-zinc-400 text-xs">
                {answerRetryRequired
                  ? (interviewLanguageRef.current === "en" ? "Retry sending" : "重试发送")
                  : candidateTurn
                  ? voiceActive
                    ? t("mockInterview.voiceDetected")
                    : t("mockInterview.micAlwaysOn")
                  : recognizing
                    ? t("mockInterview.recognizing")
                    : speaking
                      ? t("mockInterview.tapToSpeak")
                      : t("mockInterview.thinking")}
              </p>
              {answerRetryRequired && pendingTranscript && (
                <button
                  type="button"
                  onClick={discardPendingTranscript}
                  className="text-[11px] text-zinc-500 hover:text-zinc-300 underline underline-offset-4"
                >
                  {interviewLanguageRef.current === "en" ? "Discard and continue speaking" : "丢弃并继续作答"}
                </button>
              )}
            </div>
          </div>
        </div>
    );
  }

  // ========== 总结阶段（面试委员会评议报告） ==========
  const annotationMap = new Map<number, Array<{ label: string; note: string }>>();
  report?.annotations?.forEach((a) => {
    if (typeof a.msgIndex !== "number") return;
    const arr = annotationMap.get(a.msgIndex) || [];
    arr.push({ label: a.label, note: a.note });
    annotationMap.set(a.msgIndex, arr);
  });
  const fmtDuration = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

  return (
    <div className="min-h-screen bg-white dark:bg-black">
        <Header1 />
        <main className="py-8 md:py-12">
          <div className="container mx-auto px-4 max-w-4xl">
            <div className="mb-8 text-center print:mb-4">
              <div className="inline-flex items-center justify-center h-12 w-12 rounded-2xl bg-gradient-to-br from-[#C46A4A] to-[#B5BEB0] mb-3">
                <ClipboardList className="h-6 w-6 text-white" />
              </div>
              <h1 className="text-3xl md:text-4xl font-light text-black dark:text-white">
                {t("mockInterview.summaryTitle")}
              </h1>
            </div>

            {!report ? (
              reportError ? (
                /* 报告生成失败：提供重试 */
                <div className="rounded-3xl border border-red-200 dark:border-red-900/50 bg-red-50/60 dark:bg-red-950/20 shadow-lg p-12 flex flex-col items-center">
                  <p className="text-red-600 dark:text-red-400 text-sm mb-6">{t("mockInterview.summaryFailed")}</p>
                  <div className="flex gap-3">
                    <Button
                      onClick={() => generateSummary()}
                      disabled={ending}
                      className="rounded-full bg-zinc-900 hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 text-white px-6"
                    >
                      {ending ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t("mockInterview.reportWriting")}</>
                      ) : (
                        <><RotateCcw className="h-4 w-4 mr-2" />{t("mockInterview.retrySummary")}</>
                      )}
                    </Button>
                    <Button onClick={handleRestart} variant="outline" className="rounded-full px-6">
                      {t("mockInterview.restart")}
                    </Button>
                  </div>
                </div>
              ) : (
                /* 报告生成中 */
                <div className="rounded-3xl bg-gradient-to-br from-[#C46A4A]/5 via-white to-[#E2D0B8]/10 dark:from-[#C46A4A]/10 dark:via-zinc-900 dark:to-[#E2D0B8]/5 shadow-lg p-12 flex flex-col items-center">
                  <Loader2 className="h-10 w-10 animate-spin text-[#C46A4A] mb-5" />
                  <p className="text-gray-700 dark:text-gray-300 text-sm mb-1">{t("mockInterview.reportWriting")}</p>
                  {reportChars > 0 && (
                    <p className="text-gray-400 text-xs">{t("mockInterview.reportRecorded").replace("{n}", String(reportChars))}</p>
                  )}
                </div>
              )
            ) : (
               <div className="space-y-8">
                 <div className="flex justify-center gap-2 print:hidden">
                   <Button
                     type="button"
                     variant={reportView === "coach" ? "default" : "outline"}
                     className="rounded-full"
                     onClick={() => setReportView("coach")}
                   >
                     {language === "en" ? "Training Coach" : "训练教练"}
                   </Button>
                   <Button
                     type="button"
                     variant={reportView === "committee" ? "default" : "outline"}
                     className="rounded-full"
                     onClick={() => setReportView("committee")}
                   >
                     {language === "en" ? "Hiring Committee" : "招聘评估"}
                   </Button>
                 </div>
                 {reportView === "coach" && report.coach && (
                   <section className="rounded-3xl border border-[#C46A4A]/25 bg-[#C46A4A]/5 dark:bg-[#C46A4A]/10 p-6 md:p-8">
                     <h2 className="text-lg font-medium text-zinc-900 dark:text-white mb-4">
                       {language === "en" ? "Training diagnosis" : "训练诊断"}
                     </h2>
                     <div className="space-y-4">
                       {report.highlights?.mistakes?.map((mistake, index) => (
                         <div key={`${mistake.title}-${index}`} className="border-l-2 border-[#C46A4A] pl-4">
                           <p className="text-sm font-medium text-zinc-900 dark:text-white">{mistake.title}</p>
                           <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-1">{mistake.coach}</p>
                         </div>
                       ))}
                       <div>
                         <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">
                           {language === "en" ? "Next drills" : "下一步训练"}
                         </p>
                         <ul className="space-y-2">
                           {(report.actionPlan?.practice || []).map((item, index) => (
                             <li key={`${item}-${index}`} className="text-sm text-zinc-700 dark:text-zinc-300">{index + 1}. {item}</li>
                           ))}
                         </ul>
                       </div>
                     </div>
                   </section>
                 )}
                 {reportView === "committee" && (
                 <>
                {/* ===== 模块一：总体战报 ===== */}
                <section className={`rounded-3xl border shadow-lg p-6 md:p-8 ${
                  report.verdict.pass
                    ? "border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-950/20"
                    : "border-red-500/30 bg-red-50/60 dark:bg-red-950/20"
                }`}>
                  <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                    <div>
                      <p className={`text-2xl md:text-3xl font-semibold ${report.verdict.pass ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                        {report.verdict.pass ? t("mockInterview.verdictPass") : t("mockInterview.verdictFail")}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
                          {report.verdict.hireLevel}
                        </span>
                        {report.verdict.vote && (
                          <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                            {t("mockInterview.vote")} {report.verdict.vote}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">{t("mockInterview.overallGrade")}</p>
                      <p className={`text-5xl font-bold leading-none ${gradeColor(report.verdict.grade)}`}>{report.verdict.grade}</p>
                      {overallScore !== null && (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{overallScore} / 100</p>
                      )}
                    </div>
                  </div>
                  {report.verdict.headline && (
                    <p className="text-sm text-zinc-700 dark:text-zinc-300 border-l-2 border-[#C46A4A] pl-3 mb-5">{report.verdict.headline}</p>
                  )}
                  {reportStats && (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
                      {[
                        { label: t("mockInterview.statDuration"), value: fmtDuration(reportStats.durationSec) },
                         { label: language === "en" ? "Characters" : "字符数", value: String(reportStats.totalCharacters) },
                        { label: t("mockInterview.statTurns"), value: String(reportStats.turns) },
                        { label: language === "en" ? "Questions" : "问题数", value: String(reportStats.questions) },
                        { label: t("mockInterview.statAvgResponse"), value: reportStats.avgResponseSec !== null ? `${reportStats.avgResponseSec}${t("mockInterview.statSeconds")}` : "—" },
                      ].map((s) => (
                        <div key={s.label} className="rounded-2xl bg-white/70 dark:bg-zinc-900/60 p-3 text-center">
                          <p className="text-lg font-semibold text-zinc-900 dark:text-white">{s.value}</p>
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">{s.label}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">{t("mockInterview.panel")}</p>
                    <div className="flex flex-wrap gap-2">
                      {report.committee.map((c) => (
                        <span key={c.interviewerId} className="px-3 py-1.5 rounded-full text-xs bg-white/80 dark:bg-zinc-900/70 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
                          {c.name} · {c.company}
                        </span>
                      ))}
                    </div>
                  </div>
                </section>

                {/* ===== 模块二：面试官委员会评语（横向滑动卡片） ===== */}
                 <section>
                  <h2 className="text-lg font-medium text-zinc-900 dark:text-white mb-4">{t("mockInterview.committeeTitle")}</h2>
                  <div className="flex gap-4 overflow-x-auto pb-3 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:thin]">
                    {report.committee.map((c) => (
                      <div key={c.interviewerId} className="snap-start shrink-0 w-[85%] md:w-[420px] rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-md p-5">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="h-11 w-11 rounded-full bg-gradient-to-br from-[#C46A4A] to-[#B5BEB0] flex items-center justify-center shrink-0">
                            <span className="text-white text-lg font-light">{c.name.charAt(0).toUpperCase()}</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">{c.name}</p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                              {c.company} · {t("mockInterview.roundN").replace("{n}", String(c.round))} · {c.roleLabel}
                            </p>
                          </div>
                          <span className={`text-2xl font-bold ${gradeColor(c.grade)}`}>{c.grade}</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] bg-[#C46A4A]/10 text-[#C46A4A]">{c.archetypeLabel}</span>
                          {(c.tags || []).map((tag) => (
                            <span key={tag} className="px-2 py-0.5 rounded-full text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">{tag}</span>
                          ))}
                          <span className="px-2 py-0.5 rounded-full text-[10px] bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">{c.attitude}</span>
                        </div>
                        <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed mb-4">{c.comment}</p>
                        {c.keyMoment?.question && (
                          <div className="rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 p-3">
                            <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">{t("mockInterview.keyMoment")}</p>
                            <p className="text-xs text-zinc-800 dark:text-zinc-200 mb-2">Q: {c.keyMoment.question}</p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">{t("mockInterview.yourAnswer")}: {c.keyMoment.answer}</p>
                            {c.keyMoment.note && (
                              <p className="text-[11px] text-[#C46A4A]">{c.keyMoment.note}</p>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                 </section>

                {/* ===== 模块三：能力拆解雷达图 ===== */}
                {report.radar?.length > 0 && (
                  <section className="rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-md p-6">
                    <h2 className="text-lg font-medium text-zinc-900 dark:text-white mb-4">{t("mockInterview.radarTitle")}</h2>
                    <div className="grid md:grid-cols-2 gap-6 items-center">
                      <RadarChart dims={report.radar} />
                      <div className="space-y-3">
                        {report.radar.map((d) => (
                          <div key={d.dimension} className="flex items-start gap-2.5">
                            <span className={`mt-1.5 h-2.5 w-2.5 rounded-full shrink-0 ${gradeDot(d.grade)}`} />
                            <div className="min-w-0">
                              <p className="text-sm text-zinc-900 dark:text-white">
                                <span className="font-medium">{d.dimension}</span>
                                <span className={`ml-2 font-semibold ${gradeColor(d.grade)}`}>{d.grade}</span>
                              </p>
                              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{d.diagnosis}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </section>
                )}

                {/* ===== 模块四：关键时刻回放 ===== */}
                {report.highlights && (
                  <section>
                    <h2 className="text-lg font-medium text-zinc-900 dark:text-white mb-4">{t("mockInterview.highlightsTitle")}</h2>
                    <div className="space-y-4">
                      {(report.highlights.mistakes || []).map((m, i) => (
                        <div key={i} className="rounded-3xl border border-red-500/25 bg-red-50/50 dark:bg-red-950/15 p-5">
                          <p className="text-xs font-medium text-red-500 mb-1">{t("mockInterview.fatalMistakes")} {i + 1}</p>
                          <p className="text-sm font-medium text-zinc-900 dark:text-white mb-2">{m.title}</p>
                          <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-2">{m.scene}</p>
                          <p className="text-xs text-red-600 dark:text-red-400 mb-2">{t("mockInterview.consequence")}: {m.consequence}</p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 border-l-2 border-[#C46A4A] pl-2.5">{t("mockInterview.coach")}: {m.coach}</p>
                        </div>
                      ))}
                      {report.highlights.best?.title && (
                        <div className="rounded-3xl border border-emerald-500/25 bg-emerald-50/50 dark:bg-emerald-950/15 p-5">
                          <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 mb-1">{t("mockInterview.bestMoment")}</p>
                          <p className="text-sm font-medium text-zinc-900 dark:text-white mb-2">{report.highlights.best.title}</p>
                          <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-2">{report.highlights.best.scene}</p>
                          <p className="text-xs text-emerald-600 dark:text-emerald-400 mb-2">{t("mockInterview.effect")}: {report.highlights.best.effect}</p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 border-l-2 border-[#B5BEB0] pl-2.5">{t("mockInterview.coach")}: {report.highlights.best.coach}</p>
                        </div>
                      )}
                    </div>
                  </section>
                )}

                {/* ===== 模块五：AI 私人教练行动清单 ===== */}
                 {report.actionPlan && (
                  <section className="rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-md p-6">
                    <h2 className="text-lg font-medium text-zinc-900 dark:text-white mb-4">{t("mockInterview.actionPlanTitle")}</h2>
                    <div className="grid md:grid-cols-3 gap-5">
                      <div>
                        <p className="text-xs font-medium text-[#C46A4A] mb-2">{t("mockInterview.immediate")}</p>
                        <ul className="space-y-2">
                          {(report.actionPlan.immediate || []).map((item, i) => (
                            <li key={i} className="flex gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                              <span className="text-[#C46A4A] font-medium shrink-0">{i + 1}.</span>{item}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-[#8a9685] dark:text-[#B5BEB0] mb-2">{t("mockInterview.practice")}</p>
                        <ul className="space-y-2">
                          {(report.actionPlan.practice || []).map((item, i) => (
                            <li key={i} className="flex gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                              <span className="text-[#B5BEB0] shrink-0">▸</span>{item}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-[#b3946d] dark:text-[#E2D0B8] mb-2">{t("mockInterview.reading")}</p>
                        <ul className="space-y-2">
                          {(report.actionPlan.reading || []).map((item, i) => (
                            <li key={i} className="flex gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                              <span className="text-[#E2D0B8] shrink-0">▸</span>{item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </section>
                 )}
                 </>
                 )}

                {/* ===== 模块六：完整笔录 + 导出 + 历史趋势 ===== */}
                <section className="rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-md p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-medium text-zinc-900 dark:text-white">{t("mockInterview.transcriptTitle")}</h2>
                    <Button
                      onClick={() => window.print()}
                      variant="outline"
                      className="rounded-full h-9 print:hidden"
                    >
                      <FileText className="h-4 w-4 mr-1.5" />
                      {t("mockInterview.exportReport")}
                    </Button>
                  </div>
                  {(reportHistory.length > 0 || overallScore !== null) && (
                    <div className="mb-5 pb-5 border-b border-zinc-100 dark:border-zinc-800">
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">{t("mockInterview.trend")}</p>
                      <TrendChart points={reportHistory} current={overallScore} />
                    </div>
                  )}
                  <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                    {messages.map((m, idx) => {
                      const anns = annotationMap.get(idx);
                      return (
                        <div key={idx} className={`rounded-2xl p-3.5 ${m.role === "interviewer" ? "bg-zinc-50 dark:bg-zinc-800/60" : "bg-[#C46A4A]/5 dark:bg-[#C46A4A]/10 ml-6"}`}>
                          <p className="text-[11px] font-medium text-zinc-400 mb-1">
                            {m.role === "interviewer" ? t("mockInterview.interviewer") : t("mockInterview.you")}
                          </p>
                          <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">{m.content}</p>
                          {anns && anns.map((a, i) => (
                            <div key={i} className="mt-2 flex items-start gap-1.5">
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#E2D0B8]/40 text-[#8a6d4a] dark:text-[#E2D0B8] shrink-0">{a.label}</span>
                              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{a.note}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </section>

                <div className="flex justify-center print:hidden">
                  <Button
                    onClick={handleRestart}
                    className="rounded-full bg-gradient-to-r from-[#C46A4A] to-[#B5BEB0] hover:opacity-90 text-white px-8 h-11"
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    {t("mockInterview.restart")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* 真实度问卷：评分驱动基因迭代闭环（<6 进人工审查，>=6 沉淀训练数据） */}
        <Modal open={feedbackOpen} onOpenChange={setFeedbackOpen}>
          <ModalContent className="sm:max-w-md">
            <ModalHeader className="px-6 pt-6 pb-2 text-left">
              <ModalTitle className="text-lg">{t("mockInterview.feedbackTitle")}</ModalTitle>
              <ModalDescription className="text-sm text-gray-500 dark:text-gray-400">
                {t("mockInterview.feedbackSubtitle")}
              </ModalDescription>
            </ModalHeader>
            <ModalBody className="px-6 py-4">
              {/* 1-10 评分 */}
              <div className="grid grid-cols-10 gap-1.5 mb-2">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRealismScore(n)}
                    className={`h-9 rounded-lg text-sm font-medium transition-colors border ${
                      realismScore === n
                        ? "bg-zinc-900 text-white border-zinc-900 dark:bg-white dark:text-zinc-900 dark:border-white"
                        : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-zinc-400"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="flex justify-between text-[11px] text-zinc-400 mb-4">
                <span>{t("mockInterview.feedbackScoreLow")}</span>
                <span>{t("mockInterview.feedbackScoreHigh")}</span>
              </div>
              {/* 低分追问差异点（人工审查的关键输入） */}
              {realismScore !== null && realismScore < 6 && (
                <Textarea
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  placeholder={t("mockInterview.feedbackLowPlaceholder")}
                  rows={3}
                  className="rounded-xl animate-in fade-in duration-200"
                />
              )}
            </ModalBody>
            <ModalFooter className="px-6 pb-6 pt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => { setFeedbackOpen(false); setFeedbackDone(true); }}
                className="text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
              >
                {t("mockInterview.feedbackSkip")}
              </button>
              <Button
                onClick={submitFeedback}
                disabled={realismScore === null || feedbackSubmitting}
                className="flex-1 h-11 rounded-full bg-zinc-900 hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 text-white"
              >
                {feedbackSubmitting ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t("mockInterview.feedbackSubmitting")}</>
                ) : (
                  t("mockInterview.feedbackSubmit")
                )}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </div>
  );
}

export default function MockInterviewPage() {
  return (
    <AuthGuard>
      <MockInterviewContent />
    </AuthGuard>
  );
}

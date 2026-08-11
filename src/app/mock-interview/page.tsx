"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Header1 } from "@/components/header1";
import { AuthGuard } from "@/components/auth-guard";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Modal, ModalBody, ModalContent, ModalDescription,
  ModalFooter, ModalHeader, ModalTitle,
} from "@/components/ui/modal";
import { useLanguage } from "@/lib/language-context";
import { getCurrentSession } from "@/lib/supabase-browser";
import { createInterviewASRSocket, downsampleToPCM16 } from "@/lib/interview-asr-client";
import { createInterviewTTSSocket } from "@/lib/interview-tts-client";
import {
  Bot, Loader2, RotateCcw, ClipboardList,
  Mic, Square, PhoneOff, Video, VideoOff, User,
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
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  placeholder: string;
  options: { value: string; text: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          disabled={disabled}
          className="w-full h-11 inline-flex items-center gap-2 px-4 rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-black dark:text-white hover:border-zinc-400 dark:hover:border-zinc-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Icon className="h-4 w-4 text-gray-400 flex-shrink-0" />
          <span className={`flex-1 text-left truncate ${selected ? "" : "text-gray-400 dark:text-gray-500"}`}>
            {selected ? selected.text : placeholder}
          </span>
          <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-1 max-h-64 overflow-y-auto" align="start">
        <div className="space-y-0.5">
          <button
            onClick={() => { onChange(""); setOpen(false); }}
            className={`w-full flex items-center gap-2 text-left px-3 py-2 rounded-md text-sm transition-colors ${
              !value ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "hover:bg-muted"
            }`}
          >
            {!value && <Check className="h-3.5 w-3.5" />}
            <span className={!value ? "" : "pl-5"}>{placeholder}</span>
          </button>
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full flex items-center gap-2 text-left px-3 py-2 rounded-md text-sm transition-colors ${
                value === opt.value ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "hover:bg-muted"
              }`}
            >
              {value === opt.value && <Check className="h-3.5 w-3.5 flex-shrink-0" />}
              <span className={value === opt.value ? "" : "pl-5"}>{opt.text}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

type Stage = "setup" | "interview" | "summary";

interface Message {
  role: "interviewer" | "candidate";
  content: string;
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

function splitSpeechSentences(pending: string): { complete: string[]; rest: string } {
  const matches = pending.match(/[^.!?。！？\n]+[.!?。！？\n]*/g) || [];
  if (matches.length === 0) return { complete: [], rest: pending };
  const complete = matches.slice(0, -1).map((s) => s.trim()).filter(Boolean);
  const last = matches[matches.length - 1];
  if (/[.!?。！？]$/.test(last.trim()) || last.endsWith("\n")) {
    complete.push(last.trim());
    return { complete: complete.filter(Boolean), rest: "" };
  }
  const rest = last;
  return { complete, rest };
}

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
  totalWords: number;
  turns: number;
  probes: number;
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
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [jd, setJd] = useState("");
  const [targetCompanyInput, setTargetCompanyInput] = useState(""); // 手动 JD 时的目标公司
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
  const [overallScore, setOverallScore] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [ending, setEnding] = useState(false);
  const [summary, setSummary] = useState("");

  // 结构化面试报告（委员会评议）
  const [report, setReport] = useState<InterviewReport | null>(null);
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
    pauseMs?: number;
    title?: { zh: string; en: string } | null;
  } | null>(null);
  const [roundRoleLabel, setRoundRoleLabel] = useState<{ zh: string; en: string } | null>(null);
  // 闯关轮末淘汰：面试官判定表现不达标，面试提前结束（自动进入评估）
  const [eliminated, setEliminated] = useState(false);
  const [eliminatedRound, setEliminatedRound] = useState<number | null>(null);
  // 面试官判断整场面试聊完，主动收尾（自动进入评估）
  const [interviewWrapped, setInterviewWrapped] = useState(false);

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
  const [realtimeFallback, setRealtimeFallback] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [showSubtitle, setShowSubtitle] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const realtimeItemRef = useRef<string | null>(null);
  const realtimeSocketRef = useRef<WebSocket | null>(null);
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
  const audioQueueRef = useRef<Array<{
    text: string;
    speaker?: string;
    speechRate?: number;
    loudnessRate?: number;
    pauseMs?: number;
  }>>([]);
  const audioDrainingRef = useRef(false);
  const audioWaitersRef = useRef<Array<() => void>>([]);
  const interruptRef = useRef(false);
  const timeoutFiredRef = useRef(false);
  const timeoutEscalateRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ttsCacheRef = useRef(new Map<string, ArrayBuffer>());
  const interviewAliveRef = useRef(false);

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

  useEffect(() => {
    speakingRef.current = speaking;
  }, [speaking]);

  // 加载公司列表
  useEffect(() => {
    apiFetch("/api/interview/jobs")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCompanies(d.companies || []))
      .catch(() => {});
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
      return;
    }
    apiFetch(`/api/interview/jobs?company=${encodeURIComponent(selectedCompany)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setJobs(d.jobs || []))
      .catch(() => {});
    setSelectedJobId(null);
  }, [selectedCompany]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, summary]);

  // 报告生成完成后自动弹出真实度问卷（每场面试一次）
  useEffect(() => {
    if (report && sessionId && !feedbackDone && !feedbackOpen) {
      const timer = setTimeout(() => setFeedbackOpen(true), 800);
      return () => clearTimeout(timer);
    }
  }, [report, sessionId, feedbackDone, feedbackOpen]);

  // 企业面试基因预览：目标公司变化后防抖拉取（选岗位用岗位公司，手动 JD 用输入公司）
  useEffect(() => {
    const company = (selectedJobId ? selectedCompany : targetCompanyInput).trim();
    if (company.length < 2) {
      setDnaPreview(null);
      setDnaLoading(false);
      return;
    }
    setDnaLoading(true);
    const timer = setTimeout(async () => {
      try {
      const res = await apiFetch(`/api/company-dna?name=${encodeURIComponent(company)}`);
        if (res.ok) {
          setDnaPreview(await res.json());
        } else {
          setDnaPreview(null);
        }
      } catch {
        setDnaPreview(null);
      } finally {
        setDnaLoading(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [selectedJobId, selectedCompany, targetCompanyInput]);

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

  // 组件卸载清理
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      audioRef.current?.pause();
    };
  }, []);

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
    const audio = audioRef.current;
    audio?.pause();
    audio?.onended?.call(audio, new Event("ended"));
    setOrganizing(false);
    setRoundSecondsLeft(null);
    stopAmbience();
  }, []);

  const fetchTtsAudio = useCallback(
    async (item: { text: string; speaker?: string; speechRate?: number; loudnessRate?: number }) => {
      try {
        const res = await apiFetch("/api/interview/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: item.text,
            language,
            speaker: item.speaker,
            speechRate: item.speechRate,
            loudnessRate: item.loudnessRate,
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

  const playSingleTts = useCallback(
    async (item: { text: string; speaker?: string; speechRate?: number; loudnessRate?: number }) => {
      try {
        const playRealtime = async (): Promise<void> => {
          const session = await getCurrentSession();
          if (!session?.access_token) throw new Error("登录状态已失效");
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

          const socket = createInterviewTTSSocket(session.access_token);
          socket.binaryType = "arraybuffer";
          let hasAudio = false;
          let finished = false;
          let timer: number | null = null;
          const schedulePCM = (data: ArrayBuffer) => {
            if (!ctx || data.byteLength < 2) return;
            const samples = new Int16Array(data);
            const audioBuffer = ctx.createBuffer(1, samples.length, 44100);
            const channel = audioBuffer.getChannelData(0);
            for (let i = 0; i < samples.length; i += 1) channel[i] = samples[i] / 0x8000;
            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            ttsSourcesRef.current.add(source);
            source.onended = () => ttsSourcesRef.current.delete(source);
            if (analyserRef.current) source.connect(analyserRef.current);
            else source.connect(ctx.destination);
            const startAt = Math.max(ctx.currentTime + 0.03, ttsNextTimeRef.current);
            source.start(startAt);
            ttsNextTimeRef.current = startAt + audioBuffer.duration;
          hasAudio = true;
          };

          await new Promise<void>((resolve, reject) => {
            const finish = () => {
              if (finished) return;
              finished = true;
              if (timer !== null) window.clearTimeout(timer);
              socket.close(1000, "tts complete");
              resolve();
            };
            const stop = () => {
              ttsSourcesRef.current.forEach((source) => {
                try {
                  source.stop();
                } catch {
                  // The source may already have ended.
                }
              });
              ttsSourcesRef.current.clear();
              finish();
            };
            activeTTSStopRef.current = stop;
            const fail = (error: Error) => {
              if (finished) return;
              if (hasAudio) {
                finish();
                return;
              }
              finished = true;
              if (timer !== null) window.clearTimeout(timer);
              socket.close();
              reject(error);
            };
            timer = window.setTimeout(() => fail(new Error("Cartesia TTS stream timeout")), 30000);
            socket.onopen = () => socket.send(JSON.stringify({
              type: "speak",
              text: item.text,
              language,
              speaker: item.speaker,
              speechRate: item.speechRate,
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
                const data = JSON.parse(String(event.data)) as { type?: string; error?: string };
                if (data.type === "done") {
                  const waitMs = Math.max(0, (ttsNextTimeRef.current - ctx!.currentTime) * 1000 + 60);
                  timer = window.setTimeout(finish, waitMs);
                } else if (data.type === "error") {
                  fail(new Error(data.error || "Cartesia TTS failed"));
                }
              } catch {
                fail(new Error("Cartesia TTS response invalid"));
              }
            };
            socket.onerror = () => fail(new Error("Cartesia TTS connection failed"));
            socket.onclose = () => {
              if (!finished && !hasAudio) fail(new Error("Cartesia TTS connection closed"));
            };
          }).finally(() => {
            activeTTSStopRef.current = null;
          });
        };

        try {
          await playRealtime();
        } catch {
          // 实时 TTS 未配置或连接失败时，保留 HTTP MP3 兜底，避免面试无声。
          const cacheKey = `${item.speaker || ""}|${item.text}`;
          const buf = ttsCacheRef.current.get(cacheKey) || await fetchTtsAudio(item);
          ttsCacheRef.current.delete(cacheKey);
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
    [ensureAudioGraph, fetchTtsAudio, language]
  );

  const drainAudioQueue = useCallback(async () => {
    if (audioDrainingRef.current) return;
    audioDrainingRef.current = true;
    try {
      while (audioQueueRef.current.length > 0 && !interruptRef.current) {
        const item = audioQueueRef.current.shift();
        if (!item) break;
        const next = audioQueueRef.current[0];
        if (next) {
          const cacheKey = `${next.speaker || ""}|${next.text}`;
          void fetchTtsAudio(next).then((audio) => {
            if (audio && ttsCacheRef.current.size < 4) {
              ttsCacheRef.current.set(cacheKey, audio);
            }
          }).catch(() => {});
        }
        setSpeaking(true);
        await playSingleTts(item);
        if (!interruptRef.current && item.pauseMs) await sleep(item.pauseMs);
      }
    } finally {
      audioDrainingRef.current = false;
      setSpeaking(false);
      const waiters = audioWaitersRef.current.splice(0);
      waiters.forEach((resolve) => resolve());
    }
  }, [playSingleTts, fetchTtsAudio]);

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
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.onended?.call(audio, new Event("ended"));
    }
  }, []);

  const enqueueInterviewerAudio = useCallback(
    (text: string, speaker?: string, speechRate?: number, loudnessRate?: number, pauseMs?: number) => {
      if (!text.trim()) return;
      interruptRef.current = false;
      audioQueueRef.current.push({ text, speaker, speechRate, loudnessRate, pauseMs });
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
      const res = await apiFetch("/api/interview/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, ...payload }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "request failed");
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("no reader");
      const decoder = new TextDecoder();
      let fullContent = "";
      let buffer = "";
      let newSessionId: number | null = null;
      let activeInterviewer: typeof currentInterviewer = null;
      let eliminatedInfo: { round: number } | null = null; // 淘汰信息
      let roundEnded = false; // 面试官主动结束本轮（衔接下一位）
      let wrappedUp = false; // 面试官判断整场面试结束（进入评估）
      let speechPending = "";

      // 先插入一条空的面试官消息用于流式填充
      setMessages((prev) => [...prev, { role: "interviewer", content: "" }]);
      setStreaming(true);

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
              setSessionId(data.sessionId);
            }
            if (data.eliminated) {
              // 淘汰：面试官单方面终止面试
              eliminatedInfo = { round: data.round || 1 };
            }
            if (data.roundEnd) {
              // 本轮自然结束：面试官主动收尾，需自动衔接下一位
              roundEnded = true;
            }
            if (data.wrapUp) {
              // 整场面试自然结束：面试官判断聊完了
              wrappedUp = true;
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
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = { role: "interviewer", content: fullContent };
                return next;
              });
              const { complete, rest } = splitSpeechSentences(speechPending + data.content);
              speechPending = rest;
              const speaker = (activeInterviewer ?? currentInterviewer)?.voice;
              const speechRate = (activeInterviewer ?? currentInterviewer)?.speechRate;
              const loudnessRate = (activeInterviewer ?? currentInterviewer)?.loudnessRate;
              const pauseMs = (activeInterviewer ?? currentInterviewer)?.pauseMs;
              for (const sentence of complete) {
                enqueueInterviewerAudio(sentence, speaker, speechRate, loudnessRate, pauseMs);
              }
            }
          } catch {
            // ignore parse error
          }
        }
      }
      if (!interviewAliveRef.current) {
        setStreaming(false);
        return { fullContent: "", newSessionId: null, activeInterviewer: null, eliminatedInfo: null, roundEnded: false, wrappedUp: false };
      }
      const tail = speechPending.trim();
      if (tail) {
        enqueueInterviewerAudio(
          tail,
          (activeInterviewer ?? currentInterviewer)?.voice,
          (activeInterviewer ?? currentInterviewer)?.speechRate,
          (activeInterviewer ?? currentInterviewer)?.loudnessRate,
          (activeInterviewer ?? currentInterviewer)?.pauseMs
        );
      }
      setStreaming(false);
      return { fullContent, newSessionId, activeInterviewer, eliminatedInfo, roundEnded, wrappedUp };
    },
    [language, startRoundTimer, enqueueInterviewerAudio, currentInterviewer]
  );

  // 开始面试
  const handleStart = async () => {
    // 目标公司：选岗位时用岗位所属公司，手动 JD 时用用户输入——本场所有面试官均来自该公司
    const targetCompany = (selectedJobId ? selectedCompany : targetCompanyInput).trim();
    if (!targetCompany) {
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
    setSessionId(null);
    setCurrentRound(1);
    setCurrentInterviewer(null);
    setRealtimeFallback(false);
    setLiveTranscript("");
    realtimeItemRef.current = null;
    setStage("interview");
    await startCamera();
    setListening(true);
    startAmbience();
    try {
      await streamInterviewer({
        jobDescription: jd || undefined,
        jobId: selectedJobId || undefined,
        resumeId: selectedResumeId || undefined,
        mode: "gauntlet",
        totalRounds,
        targetCompany,
      });
      await waitForAudioDrain();
    } catch {
      if (interviewAliveRef.current) {
        alert(t("mockInterview.startFailed"));
        setStage("setup");
        setListening(false);
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
    setRecognizing(true);
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );
      const res = await apiFetch("/api/interview/asr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64: base64, audioMimeType: blob.type, language }),
      });
      if (!res.ok) throw new Error("ASR failed");
      const data = await res.json();
      const text = (data.text || "").trim();
      if (text) {
        await submitAnswer(text);
      } else {
        // 未检测到有效语音：轻提示，不当作失败
        setNoSpeech(true);
        setTimeout(() => setNoSpeech(false), 3000);
      }
    } catch {
      alert(t("mockInterview.sendFailed"));
    } finally {
      setRecognizing(false);
    }
  };

  // 实时模式：浏览器持续发送 PCM16，服务端 VAD 返回中间结果和最终结果。
  // 最终结果是唯一的提交点，避免重复调用面试 LLM。
  useEffect(() => {
    if (!listening || stage !== "interview" || realtimeFallback || speaking || streaming || recognizing) return;
    let cancelled = false;
    let socket: WebSocket | null = null;
    let micStream: MediaStream | null = null;
    let localCtx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let processor: ScriptProcessorNode | null = null;
    let muteGain: GainNode | null = null;
    let ready = false;
    let intentionalClose = false;

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
        const session = await getCurrentSession();
        if (!session?.access_token) throw new Error("登录状态已失效");

        micStream = await getMicStream();
        if (cancelled) return;
        const Ctor = window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) throw new Error("当前浏览器不支持实时音频采集");

        socket = createInterviewASRSocket(session.access_token);
        realtimeSocketRef.current = socket;
        const readyPromise = new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error("实时 ASR 连接超时")), 12000);
          socket!.onopen = () => sendClientEvent({ type: "start", language });
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
              window.clearTimeout(timeout);
              ready = true;
              resolve();
              return;
            }
            if (data.type === "speech_started") {
              setVoiceActive(true);
              setRecording(true);
              return;
            }
            if (data.type === "speech_stopped") {
              setVoiceActive(false);
              setRecording(false);
              return;
            }
            if (data.type === "partial") {
              setLiveTranscript(data.text || "");
              return;
            }
            if (data.type === "final") {
              const text = (data.text || "").trim();
              if (!text || (data.itemId && realtimeItemRef.current === data.itemId)) return;
              realtimeItemRef.current = data.itemId || null;
              setLiveTranscript("");
              setVoiceActive(false);
              setRecording(false);
              setRecognizing(true);
              void submitAnswer(text).finally(() => setRecognizing(false));
              return;
            }
            if (data.type === "error" && !ready) {
              window.clearTimeout(timeout);
              reject(new Error(data.error || "实时 ASR 失败"));
            }
          };
          socket!.onerror = () => {
            if (!ready) {
              window.clearTimeout(timeout);
              reject(new Error("实时 ASR 连接失败"));
            }
          };
          socket!.onclose = () => {
            if (!cancelled && !intentionalClose && ready) setRealtimeFallback(true);
            if (!ready) {
              window.clearTimeout(timeout);
              reject(new Error("实时 ASR 连接已关闭"));
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
          if (cancelled || socket?.readyState !== WebSocket.OPEN) return;
          const input = event.inputBuffer.getChannelData(0);
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
      stopCapture();
      if (socket?.readyState === WebSocket.OPEN) {
        sendClientEvent({ type: "stop" });
        socket.close(1000, "capture stopped");
      }
      if (realtimeSocketRef.current === socket) realtimeSocketRef.current = null;
      setVoiceActive(false);
      setRecording(false);
    };
    // submitAnswer/getMicStream are stable for the lifetime of this page render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, stage, realtimeFallback, speaking, streaming, recognizing]);

  // fallback：实时 WebSocket 不可用时，使用现有 MediaRecorder + Base64 HTTP ASR。
  // 面试官说话/思考/识别期间自动暂停监听，结束后自动恢复。
  useEffect(() => {
    if (!listening || stage !== "interview" || !realtimeFallback) return;
    if (speaking || streaming || recognizing) return;
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
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / data.length);
          const now = Date.now();
          if (rms > 0.02) {
            // 检测到语音：开始/继续录音
            hasVoice = true;
            silenceStart = null;
            if (speakingRef.current) {
              if (voiceOnset === null) voiceOnset = now;
              if (now - voiceOnset > 400) {
                // 候选人连续发声超过 400ms：打断面试官并进入正常录音
                voiceOnset = null;
                interruptInterviewer();
              }
            } else {
              voiceOnset = null;
            }
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
  }, [listening, stage, realtimeFallback, speaking, streaming, recognizing, interruptInterviewer]);

  const switchToNextInterviewer = useCallback(async () => {
    setOrganizing(true);
    await sleep(2500 + Math.random() * 1500);
    setOrganizing(false);
    const next = await streamInterviewer({ sessionId, switchNext: true });
    await waitForAudioDrain();
    return next;
  }, [sessionId, streamInterviewer, waitForAudioDrain]);

  // 提交回答
  const submitAnswer = async (text: string) => {
    if (!text.trim() || streaming) return;
    if (timeoutEscalateRef.current) clearTimeout(timeoutEscalateRef.current);
    timeoutFiredRef.current = false;
    setMessages((prev) => [...prev, { role: "candidate", content: text }]);
    try {
      const { eliminatedInfo, roundEnded, wrappedUp } = await streamInterviewer({ sessionId, answer: text });
      await waitForAudioDrain();
      if (eliminatedInfo) {
        // 淘汰：面试官单方面终止面试——结束语播完后进入评估
        setEliminated(true);
        setEliminatedRound(eliminatedInfo.round);
        setListening(false);
        stopCamera();
        clearPressure();
        await generateSummary(eliminatedInfo.round);
        return;
      }
      if (wrappedUp) {
        // 整场自然结束：收尾语播完后进入评估
        setInterviewWrapped(true);
        setListening(false);
        stopCamera();
        clearPressure();
        await generateSummary();
        return;
      }
      if (roundEnded) {
        // 面试官主动结束本轮：自然停顿后由下一位开场
        await switchToNextInterviewer();
      }
    } catch {
      alert(t("mockInterview.sendFailed"));
    }
  };

  // 生成评估报告（SSE 流式）；失败时进入可重试状态
  const generateSummary = async (eliminatedAtRound?: number) => {
    if (!sessionId) return;
    setEnding(true);
    setReportError(false);
    try {
      const res = await apiFetch("/api/interview/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, language, eliminatedRound: eliminatedAtRound ?? eliminatedRound ?? undefined }),
      });
      if (!res.ok) throw new Error("failed");
      const reader = res.body?.getReader();
      if (!reader) throw new Error("no reader");
      const decoder = new TextDecoder();
      let buffer = "";
      let reportReceived = false;
      setStage("summary");
      setSummary("");
      setReport(null);
      setReportStats(null);
      setReportHistory([]);
      setReportChars(0);
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
      if (!reportReceived) setReportError(true);
    } catch {
      setReportError(true);
    } finally {
      setEnding(false);
    }
  };

  // 阶段倒计时归零：通知后端收尾；若 30 秒仍未收到收尾标记，前端兜底进入评估
  const handleStageTimeout = useCallback(async () => {
    if (!sessionId || ending || timeoutFiredRef.current) return;
    timeoutFiredRef.current = true;
    try {
      const { eliminatedInfo, roundEnded, wrappedUp } = await streamInterviewer({ sessionId, timeout: true });
      await waitForAudioDrain();
      if (eliminatedInfo) {
        setEliminated(true);
        setEliminatedRound(eliminatedInfo.round);
        setListening(false);
        stopCamera();
        clearPressure();
        await generateSummary(eliminatedInfo.round);
        return;
      }
      if (wrappedUp) {
        setInterviewWrapped(true);
        setListening(false);
        stopCamera();
        clearPressure();
        await generateSummary();
        return;
      }
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
    interviewAliveRef.current = false;
    setEnding(false);
    setStreaming(false);
    setStage("setup");
    setMessages([]);
    setSummary("");
    setReport(null);
    setReportStats(null);
    setReportError(false);
    setReportHistory([]);
    setReportChars(0);
    setOverallScore(null);
    setSessionId(null);
    setJd("");
    setTargetCompanyInput("");
    setSelectedCompany("");
    setSelectedJobId(null);
    setSelectedResumeId(null);
    setCurrentRound(1);
    setCurrentInterviewer(null);
    setOrganizing(false);
    setRoundRoleLabel(null);
    setEliminated(false);
    setEliminatedRound(null);
    setInterviewWrapped(false);
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

                {/* 手动 JD（未选岗位时） */}
                {!selectedJobId && (
                  <div className="mb-6">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {t("mockInterview.targetCompany")} <span className="text-red-500">*</span>
                    </label>
                    <Input
                      value={targetCompanyInput}
                      onChange={(e) => setTargetCompanyInput(e.target.value)}
                      placeholder={t("mockInterview.targetCompanyPlaceholder")}
                      className="rounded-xl mb-4"
                    />
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {t("mockInterview.jd")}
                    </label>
                    <Textarea
                      value={jd}
                      onChange={(e) => setJd(e.target.value)}
                      placeholder={t("mockInterview.jdPlaceholder")}
                      rows={4}
                      className="rounded-xl"
                    />
                  </div>
                )}

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
            : listening
              ? t("mockInterview.micAlwaysOn")
              : t("mockInterview.tapToSpeak");
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col">
          {/* TTS 播放元素（固定元素，供音波频谱分析） */}
          <audio ref={audioRef} className="hidden" />
          {/* 轮末淘汰覆盖层：面试官提前结束面试，自动进入评估 */}
          {eliminated && (
            <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950/95 backdrop-blur animate-in fade-in duration-500">
              <div className="h-16 w-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-6">
                <PhoneOff className="h-7 w-7 text-red-400" />
              </div>
              <h2 className="text-xl font-semibold text-zinc-100 mb-2">
                {t("mockInterview.eliminatedTitle")}
              </h2>
              <p className="text-sm text-zinc-400 mb-8 max-w-sm text-center px-6">
                {t("mockInterview.eliminatedDesc")}
              </p>
              <Loader2 className="h-6 w-6 text-zinc-500 animate-spin" />
            </div>
          )}
          {interviewWrapped && (
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
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 底部控制栏：按住说话 */}
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
                  // 借用户手势激活 AudioContext（自动播放策略要求）
                  ensureAudioGraph();
                  if (audioCtxRef.current?.state === "suspended") {
                    audioCtxRef.current.resume().catch(() => {});
                  }
                  if (speaking) {
                    activeTTSStopRef.current?.();
                    audioRef.current?.pause();
                    setSpeaking(false);
                    setListening(true);
                    return;
                  }
                  setListening((v) => !v);
                }}
                disabled={!listening && (streaming || recognizing)}
                title={speaking ? t("mockInterview.tapToSpeak") : listening ? t("mockInterview.micAlwaysOn") : t("mockInterview.tapToSpeak")}
                className={`h-16 w-16 md:h-20 md:w-20 rounded-full flex items-center justify-center transition-all select-none ${
                  listening
                    ? voiceActive
                      ? "bg-red-500 scale-110 shadow-lg shadow-red-500/40"
                      : "bg-red-500/80 shadow-lg shadow-red-500/30 animate-pulse"
                    : streaming || recognizing || speaking
                      ? "bg-zinc-800 cursor-not-allowed"
                      : "bg-gradient-to-br from-[#C46A4A] to-[#B5BEB0] hover:scale-105 shadow-lg"
                }`}
              >
                {recognizing ? (
                  <Loader2 className="h-7 w-7 text-white animate-spin" />
                ) : listening ? (
                  <Square className="h-6 w-6 text-white" />
                ) : (
                  <Mic className="h-7 w-7 text-white" />
                )}
              </button>
              <p className="text-zinc-400 text-xs">
                {listening
                  ? voiceActive
                    ? t("mockInterview.voiceDetected")
                    : t("mockInterview.micAlwaysOn")
                  : recognizing
                    ? t("mockInterview.recognizing")
                    : t("mockInterview.tapToSpeak")}
              </p>
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
                        { label: t("mockInterview.statWords"), value: String(reportStats.totalWords) },
                        { label: t("mockInterview.statTurns"), value: String(reportStats.turns) },
                        { label: t("mockInterview.statProbes"), value: String(reportStats.probes) },
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

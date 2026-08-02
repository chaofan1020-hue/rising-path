"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Header1 } from "@/components/header1";
import { AccessGuard, useAccessCode } from "@/components/access-guard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLanguage } from "@/lib/language-context";
import {
  Bot, Loader2, RotateCcw, ClipboardList, Code2, MessagesSquare,
  Puzzle, Layers, Mic, Square, PhoneOff, Video, VideoOff, User,
  Building2, Briefcase, FileText, ChevronDown, Check, Timer, Zap,
} from "lucide-react";
import { startAmbience, stopAmbience, playNotify } from "@/lib/interview-audio";

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
  icon: React.ElementType;
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
          className="w-full h-11 inline-flex items-center gap-2 px-4 rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-black dark:text-white hover:border-[#C46A4A]/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
              !value ? "bg-primary text-primary-foreground" : "hover:bg-muted"
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
                value === opt.value ? "bg-primary text-primary-foreground" : "hover:bg-muted"
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

type InterviewType = "technical" | "behavioral" | "case" | "mixed";
type Stage = "setup" | "interview" | "summary";

interface Message {
  role: "interviewer" | "candidate";
  content: string;
}

interface ResumeItem {
  id: number;
  file_name: string;
}

interface JobItem {
  id: number;
  title: string;
  company: string;
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

const TYPE_ICONS: Record<InterviewType, React.ReactNode> = {
  technical: <Code2 className="h-6 w-6" />,
  behavioral: <MessagesSquare className="h-6 w-6" />,
  case: <Puzzle className="h-6 w-6" />,
  mixed: <Layers className="h-6 w-6" />,
};

export default function MockInterviewPage() {
  const { t, locale } = useLanguage();
  const { accessCodeId: contextAccessCodeId } = useAccessCode();
  // 兜底：Context 未就绪时从 localStorage 读取（登录时 access-guard 会写入 access_code_id）
  const [accessCodeId, setAccessCodeId] = useState<number | null>(contextAccessCodeId);

  useEffect(() => {
    if (contextAccessCodeId) {
      setAccessCodeId(contextAccessCodeId);
      return;
    }
    const stored = typeof window !== "undefined" ? localStorage.getItem("access_code_id") : null;
    if (stored) {
      const id = parseInt(stored, 10);
      if (!isNaN(id)) setAccessCodeId(id);
    }
  }, [contextAccessCodeId]);
  const [stage, setStage] = useState<Stage>("setup");
  const [interviewType, setInterviewType] = useState<InterviewType>("mixed");

  // 设置项
  const [companies, setCompanies] = useState<string[]>([]);
  const [selectedCompany, setSelectedCompany] = useState("");
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [jd, setJd] = useState("");
  const [targetCompanyInput, setTargetCompanyInput] = useState(""); // 手动 JD 时的目标公司
  const [resumes, setResumes] = useState<ResumeItem[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState<number | null>(null);

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

  // 闯关模式状态
  const [interviewMode, setInterviewMode] = useState<"single" | "gauntlet">("single");
  const [totalRounds, setTotalRounds] = useState(3);
  const [currentRound, setCurrentRound] = useState(1);
  const [currentInterviewer, setCurrentInterviewer] = useState<{
    id: number;
    name: string;
    company: string;
    personality: string;
    voice?: string;
    speechRate?: number;
    title?: { zh: string; en: string } | null;
  } | null>(null);
  const [roundTransition, setRoundTransition] = useState(false);
  const [roundRoleLabel, setRoundRoleLabel] = useState<{ zh: string; en: string } | null>(null);

  // 轮次间"等待焦虑"状态
  const [waitingNextRound, setWaitingNextRound] = useState(false);
  const [earlyReady, setEarlyReady] = useState(false);
  // 每轮倒计时（秒）
  const [roundSecondsLeft, setRoundSecondsLeft] = useState<number | null>(null);

  // 视频/语音状态
  const [cameraOn, setCameraOn] = useState(false);
  const [micError, setMicError] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [noSpeech, setNoSpeech] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [showSubtitle, setShowSubtitle] = useState(true);
  const [currentSubtitle, setCurrentSubtitle] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const waitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const earlyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waitResolveRef = useRef<(() => void) | null>(null);
  const roundTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const interviewTypes: InterviewType[] = ["technical", "behavioral", "case", "mixed"];
  const language = locale === "en" ? "en" : "zh";

  // 加载公司列表（无需 accessCodeId，独立加载）
  useEffect(() => {
    fetch("/api/interview/jobs")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCompanies(d.companies || []))
      .catch(() => {});
  }, []);

  // 加载简历列表（依赖 accessCodeId）
  useEffect(() => {
    if (!accessCodeId) return;
    fetch(`/api/resume?access_code_id=${accessCodeId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        console.log("[mock-interview] accessCodeId:", accessCodeId, "resumes:", d?.resumes?.length);
        if (d) setResumes(d.resumes || []);
      })
      .catch((e) => console.error("[mock-interview] fetch resumes error:", e));
  }, [accessCodeId]);

  // 公司变化时加载岗位
  useEffect(() => {
    if (!selectedCompany) {
      setJobs([]);
      setSelectedJobId(null);
      return;
    }
    fetch(`/api/interview/jobs?company=${encodeURIComponent(selectedCompany)}`)
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

  // 开启摄像头（遵循 WebRTC 规范：始终渲染 video，等待 loadedmetadata）
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true,
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

  // 结束"等待焦虑"，进入下一轮（计时器到期或用户点击"立即进入"）
  const finishRoundWait = useCallback(() => {
    if (waitTimerRef.current) {
      clearTimeout(waitTimerRef.current);
      waitTimerRef.current = null;
    }
    if (earlyTimerRef.current) {
      clearTimeout(earlyTimerRef.current);
      earlyTimerRef.current = null;
    }
    setWaitingNextRound(false);
    setEarlyReady(false);
    setRoundTransition(true);
    setTimeout(() => setRoundTransition(false), 2500);
    waitResolveRef.current?.();
    waitResolveRef.current = null;
  }, []);

  // 启动每轮倒计时（8 分钟）
  const startRoundTimer = useCallback(() => {
    if (roundTimerRef.current) clearInterval(roundTimerRef.current);
    setRoundSecondsLeft(8 * 60);
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
    if (waitTimerRef.current) clearTimeout(waitTimerRef.current);
    if (earlyTimerRef.current) clearTimeout(earlyTimerRef.current);
    if (roundTimerRef.current) clearInterval(roundTimerRef.current);
    waitTimerRef.current = null;
    earlyTimerRef.current = null;
    roundTimerRef.current = null;
    waitResolveRef.current?.();
    waitResolveRef.current = null;
    setWaitingNextRound(false);
    setEarlyReady(false);
    setRoundSecondsLeft(null);
    stopAmbience();
  }, []);

  // 播放面试官语音（TTS，支持面试官专属音色与人格语速）
  const playInterviewerAudio = useCallback(
    async (text: string, speaker?: string, speechRate?: number) => {
      if (!accessCodeId || !text.trim()) return;
      try {
        setSpeaking(true);
        const res = await fetch("/api/interview/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessCodeId, text, language, speaker, speechRate }),
        });
        if (!res.ok) throw new Error("TTS failed");
        const data = await res.json();
        if (data.audioUri) {
          if (audioRef.current) {
            audioRef.current.pause();
          }
          const audio = new Audio(data.audioUri);
          audioRef.current = audio;
          audio.onended = () => setSpeaking(false);
          audio.onerror = () => setSpeaking(false);
          await audio.play();
        } else {
          setSpeaking(false);
        }
      } catch {
        setSpeaking(false);
      }
    },
    [accessCodeId, language]
  );

  // 流式请求面试官（复用逻辑：开始面试 / 提交回答）
  const streamInterviewer = useCallback(
    async (payload: Record<string, unknown>) => {
      const res = await fetch("/api/interview/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCodeId, language, ...payload }),
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
      let holding = false; // 等待焦虑期间：内容后台累积不显示

      // 先插入一条空的面试官消息用于流式填充
      setMessages((prev) => [...prev, { role: "interviewer", content: "" }]);
      setStreaming(true);
      setCurrentSubtitle("");

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
            if (data.sessionId) {
              newSessionId = data.sessionId;
              setSessionId(data.sessionId);
            }
            if (data.roundStart && data.interviewer) {
              activeInterviewer = data.interviewer;
              setCurrentInterviewer(data.interviewer);
              setRoundRoleLabel(data.roundRoleLabel || null);
              startRoundTimer();
              if (data.round > 1) {
                // 轮次切换：进入"等待焦虑"——内容后台累积，随机 15-40 秒等待
                setCurrentRound(data.round);
                holding = true;
                setWaitingNextRound(true);
                setEarlyReady(false);
                playNotify();
                const waitMs = 15000 + Math.random() * 25000;
                // 35% 概率面试官"提前准备好"
                if (Math.random() < 0.35) {
                  earlyTimerRef.current = setTimeout(() => {
                    setEarlyReady(true);
                    playNotify();
                  }, 5000);
                }
                waitTimerRef.current = setTimeout(() => finishRoundWait(), waitMs);
              } else {
                setCurrentRound(1);
              }
            }
            if (data.content) {
              fullContent += data.content;
              if (!holding) {
                setMessages((prev) => {
                  const next = [...prev];
                  next[next.length - 1] = { role: "interviewer", content: fullContent };
                  return next;
                });
                setCurrentSubtitle(fullContent);
              }
            }
          } catch {
            // ignore parse error
          }
        }
      }
      // 等待焦虑中：内容已收齐，挂起直到等待结束再一次性展示
      if (holding) {
        await new Promise<void>((resolve) => {
          waitResolveRef.current = resolve;
        });
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "interviewer", content: fullContent };
          return next;
        });
        setCurrentSubtitle(fullContent);
      }
      setStreaming(false);
      return { fullContent, newSessionId, activeInterviewer };
    },
    [accessCodeId, language, startRoundTimer, finishRoundWait]
  );

  // 开始面试
  const handleStart = async () => {
    if (!accessCodeId) return;
    // 目标公司：选岗位时用岗位所属公司，手动 JD 时用用户输入——本场所有面试官均来自该公司
    const targetCompany = (selectedJobId ? selectedCompany : targetCompanyInput).trim();
    if (!targetCompany) {
      alert(t("mockInterview.companyRequired"));
      return;
    }
    setMessages([]);
    setSummary("");
    setOverallScore(null);
    setSessionId(null);
    setCurrentRound(1);
    setCurrentInterviewer(null);
    setStage("interview");
    startCamera();
    startAmbience();
    try {
      const { fullContent, activeInterviewer } = await streamInterviewer({
        interviewType,
        jobDescription: jd || undefined,
        jobId: selectedJobId || undefined,
        resumeId: selectedResumeId || undefined,
        mode: interviewMode,
        totalRounds: interviewMode === "gauntlet" ? totalRounds : 1,
        targetCompany,
      });
      playInterviewerAudio(fullContent, activeInterviewer?.voice, activeInterviewer?.speechRate);
    } catch {
      alert(t("mockInterview.startFailed"));
      setStage("setup");
      stopCamera();
    }
  };

  // 开始录音（按住说话）
  const startRecording = async () => {
    if (streaming || recognizing || speaking) return;
    try {
      let stream = streamRef.current;
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
      }
      audioChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.start();
      setRecording(true);
      setMicError(false);
    } catch {
      setMicError(true);
    }
  };

  // 结束录音并识别
  const stopRecording = async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setRecording(false);
    recorder.stop();
    await new Promise((resolve) => {
      recorder.onstop = resolve;
    });
    const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType });
    if (blob.size < 1000) return; // 录音太短忽略

    setRecognizing(true);
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );
      const res = await fetch("/api/interview/asr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCodeId, audioBase64: base64 }),
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

  // 提交回答
  const submitAnswer = async (text: string) => {
    if (!text.trim() || streaming) return;
    setMessages((prev) => [...prev, { role: "candidate", content: text }]);
    try {
      const { fullContent, activeInterviewer } = await streamInterviewer({ sessionId, answer: text });
      playInterviewerAudio(fullContent, activeInterviewer?.voice, activeInterviewer?.speechRate);
    } catch {
      alert(t("mockInterview.sendFailed"));
    }
  };

  // 结束面试
  const handleEnd = async () => {
    if (!sessionId || ending) return;
    if (!confirm(t("mockInterview.endConfirm"))) return;
    setEnding(true);
    stopCamera();
    clearPressure();
    audioRef.current?.pause();
    setSpeaking(false);
    try {
      const res = await fetch("/api/interview/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCodeId, sessionId, language }),
      });
      if (!res.ok) throw new Error("failed");
      const reader = res.body?.getReader();
      if (!reader) throw new Error("no reader");
      const decoder = new TextDecoder();
      let buffer = "";
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
    } catch {
      alert(t("mockInterview.summaryFailed"));
    } finally {
      setEnding(false);
    }
  };

  const handleRestart = () => {
    setStage("setup");
    setMessages([]);
    setSummary("");
    setReport(null);
    setReportStats(null);
    setReportHistory([]);
    setReportChars(0);
    setOverallScore(null);
    setSessionId(null);
    setJd("");
    setTargetCompanyInput("");
    setSelectedCompany("");
    setSelectedJobId(null);
    setSelectedResumeId(null);
    setCurrentSubtitle("");
    setCurrentRound(1);
    setCurrentInterviewer(null);
    setRoundTransition(false);
    setRoundRoleLabel(null);
    clearPressure();
  };

  const qaCount = messages.filter((m) => m.role === "candidate").length;

  // ========== 面试设置阶段 ==========
  if (stage === "setup") {
    return (
      <AccessGuard>
        <div className="min-h-screen bg-white dark:bg-black">
          <Header1 />
          <main className="py-8 md:py-12">
            <div className="container mx-auto px-4 max-w-3xl">
              <div className="mb-8 text-center">
                <div className="inline-flex items-center justify-center h-12 w-12 rounded-2xl bg-gradient-to-br from-[#C46A4A] to-[#B5BEB0] mb-3">
                  <Bot className="h-6 w-6 text-white" />
                </div>
                <h1 className="text-3xl md:text-4xl font-light text-black dark:text-white mb-2">
                  {t("mockInterview.title")}
                </h1>
                <p className="text-gray-500 dark:text-gray-400">{t("mockInterview.subtitle")}</p>
              </div>

              <div className="rounded-3xl border-0 bg-gradient-to-br from-[#C46A4A]/5 via-white to-[#E2D0B8]/10 dark:from-[#C46A4A]/10 dark:via-zinc-900 dark:to-[#E2D0B8]/5 shadow-lg p-6 md:p-8">
                <h2 className="text-xl font-semibold text-black dark:text-white mb-6">
                  {t("mockInterview.setupTitle")}
                </h2>

                {/* 面试类型 */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                    {t("mockInterview.interviewType")}
                  </label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {interviewTypes.map((type) => (
                      <button
                        key={type}
                        onClick={() => setInterviewType(type)}
                        className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${
                          interviewType === type
                            ? "border-[#C46A4A] bg-[#C46A4A]/5 text-[#C46A4A]"
                            : "border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-gray-400 hover:border-[#C46A4A]/50"
                        }`}
                      >
                        {TYPE_ICONS[type]}
                        <span className="text-sm font-medium">{t(`mockInterview.type${type.charAt(0).toUpperCase() + type.slice(1)}`)}</span>
                        <span className="text-xs text-center opacity-70">{t(`mockInterview.type${type.charAt(0).toUpperCase() + type.slice(1)}Desc`)}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 面试模式 */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                    {t("mockInterview.interviewMode")}
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setInterviewMode("single")}
                      className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${
                        interviewMode === "single"
                          ? "border-[#C46A4A] bg-[#C46A4A]/5 text-[#C46A4A]"
                          : "border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-gray-400 hover:border-[#C46A4A]/50"
                      }`}
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <span className="text-sm font-medium">{t("mockInterview.modeSingle")}</span>
                      <span className="text-xs text-center opacity-70">{t("mockInterview.modeSingleDesc")}</span>
                    </button>
                    <button
                      onClick={() => setInterviewMode("gauntlet")}
                      className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${
                        interviewMode === "gauntlet"
                          ? "border-[#C46A4A] bg-[#C46A4A]/5 text-[#C46A4A]"
                          : "border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-gray-400 hover:border-[#C46A4A]/50"
                      }`}
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      <span className="text-sm font-medium">{t("mockInterview.modeGauntlet")}</span>
                      <span className="text-xs text-center opacity-70">{t("mockInterview.modeGauntletDesc")}</span>
                    </button>
                  </div>

                  {/* 闯关轮数 */}
                  {interviewMode === "gauntlet" && (
                    <div className="mt-4 flex items-center gap-3">
                      <span className="text-sm text-gray-600 dark:text-gray-400">{t("mockInterview.rounds")}:</span>
                      <div className="flex gap-2">
                        {[3, 5, 7].map((n) => (
                          <button
                            key={n}
                            onClick={() => setTotalRounds(n)}
                            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                              totalRounds === n
                                ? "bg-gradient-to-r from-[#C46A4A] to-[#B5BEB0] text-white shadow-md"
                                : "bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-zinc-700"
                            }`}
                          >
                            {n} {t("mockInterview.roundUnit")}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

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
                      {t("mockInterview.targetCompany")} <span className="text-[#C46A4A]">*</span>
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

                <Button
                  onClick={handleStart}
                  disabled={streaming}
                  className="w-full h-12 rounded-full bg-gradient-to-r from-[#C46A4A] to-[#B5BEB0] hover:opacity-90 text-white text-base shadow-md"
                >
                  {streaming ? (
                    <><Loader2 className="h-5 w-5 mr-2 animate-spin" />{t("mockInterview.starting")}</>
                  ) : (
                    <><Video className="h-5 w-5 mr-2" />{t("mockInterview.start")}</>
                  )}
                </Button>
              </div>
            </div>
          </main>
        </div>
      </AccessGuard>
    );
  }

  // ========== 面试进行阶段（视频面试间） ==========
  if (stage === "interview") {
    return (
      <AccessGuard>
        <div className="min-h-screen bg-zinc-950 flex flex-col">
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
            {/* 闯关模式：轮次进度 */}
            {interviewMode === "gauntlet" && (
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
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">
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
            )}
            <div className="flex items-center gap-2">
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
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className={`h-24 w-24 md:h-32 md:w-32 rounded-full bg-gradient-to-br from-[#C46A4A] to-[#B5BEB0] flex items-center justify-center transition-transform ${speaking ? "scale-110" : "scale-100"}`}>
                  {currentInterviewer ? (
                    <span className="text-white text-3xl md:text-5xl font-light">
                      {currentInterviewer.name.charAt(0).toUpperCase()}
                    </span>
                  ) : (
                    <Bot className="h-12 w-12 md:h-16 md:w-16 text-white" />
                  )}
                </div>
                {currentInterviewer && (
                  <p className="text-white text-sm md:text-base font-medium mt-3">{currentInterviewer.name}</p>
                )}
                {/* 语音波纹动画 */}
                {speaking && (
                  <div className="flex items-end gap-1 mt-6 h-8">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <span
                        key={i}
                        className="w-1.5 rounded-full bg-[#C46A4A] animate-pulse"
                        style={{ height: `${12 + (i % 3) * 8}px`, animationDelay: `${i * 0.15}s` }}
                      />
                    ))}
                  </div>
                )}
                <p className="text-zinc-400 text-sm mt-4">
                  {speaking ? t("mockInterview.speaking") : streaming ? t("mockInterview.thinking") : recognizing ? t("mockInterview.recognizing") : t("mockInterview.listening")}
                </p>
              </div>
              <div className="absolute bottom-3 left-3 px-3 py-1 rounded-full bg-black/50 text-white text-xs">
                {currentInterviewer ? `${currentInterviewer.name} · ${currentInterviewer.company}` : t("mockInterview.interviewer")}
              </div>

              {/* 轮次切换覆盖层 */}
              {roundTransition && currentInterviewer && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-zinc-950/95 backdrop-blur animate-in fade-in duration-300">
                  <p className="text-[#C46A4A] text-xs font-medium tracking-widest uppercase mb-2">
                    {t("mockInterview.roundProgress").replace("{current}", String(currentRound)).replace("{total}", String(totalRounds))}
                  </p>
                  <p className="text-zinc-500 text-xs mb-4">{t("mockInterview.newInterviewer")}</p>
                  <div className="h-16 w-16 rounded-full bg-gradient-to-br from-[#C46A4A] to-[#B5BEB0] flex items-center justify-center mb-3">
                    <span className="text-white text-2xl font-light">{currentInterviewer.name.charAt(0).toUpperCase()}</span>
                  </div>
                  <p className="text-white text-xl font-medium">{currentInterviewer.name}</p>
                  <p className="text-zinc-400 text-sm">
                    {currentInterviewer.title ? `${language.startsWith("zh") ? currentInterviewer.title.zh : currentInterviewer.title.en} · ` : ""}{currentInterviewer.company}
                  </p>
                </div>
              )}

              {/* 等待焦虑覆盖层：面试官正在撰写评价 */}
              {waitingNextRound && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-zinc-950/95 backdrop-blur animate-in fade-in duration-500">
                  <Loader2 className="h-10 w-10 text-[#C46A4A] animate-spin mb-5" />
                  <p className="text-zinc-300 text-sm mb-2">{t("mockInterview.writingEvaluation")}</p>
                  <p className="text-zinc-600 text-xs mb-8">
                    {t("mockInterview.roundProgress").replace("{current}", String(currentRound - 1)).replace("{total}", String(totalRounds))}
                  </p>
                  {earlyReady && (
                    <button
                      onClick={finishRoundWait}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#C46A4A] text-white text-sm font-medium animate-pulse hover:bg-[#b05a3c] transition-colors"
                    >
                      <Zap className="h-4 w-4" />
                      {t("mockInterview.earlyReady")}
                    </button>
                  )}
                </div>
              )}
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
                          {m.role === "interviewer" ? t("mockInterview.interviewer") : t("mockInterview.you")}:
                        </span>
                        <span className="text-zinc-300">{m.content || (streaming && i === messages.slice(-4).length - 1 ? "..." : "")}</span>
                      </p>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 底部控制栏：按住说话 */}
          <div className="px-4 md:px-6 pb-5 pt-2">
            <div className="max-w-4xl mx-auto flex flex-col items-center gap-3">
              {micError && <p className="text-red-400 text-xs">{t("mockInterview.micError")}</p>}
              {noSpeech && !micError && <p className="text-amber-400 text-xs">{t("mockInterview.noSpeech")}</p>}
              <button
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onMouseLeave={() => recording && stopRecording()}
                onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
                onTouchEnd={(e) => { e.preventDefault(); stopRecording(); }}
                disabled={streaming || recognizing || speaking}
                className={`h-16 w-16 md:h-20 md:w-20 rounded-full flex items-center justify-center transition-all select-none touch-none ${
                  recording
                    ? "bg-red-500 scale-110 shadow-lg shadow-red-500/40"
                    : streaming || recognizing || speaking
                      ? "bg-zinc-800 cursor-not-allowed"
                      : "bg-gradient-to-br from-[#C46A4A] to-[#B5BEB0] hover:scale-105 shadow-lg"
                }`}
              >
                {recognizing ? (
                  <Loader2 className="h-7 w-7 text-white animate-spin" />
                ) : recording ? (
                  <Square className="h-6 w-6 text-white" />
                ) : (
                  <Mic className="h-7 w-7 text-white" />
                )}
              </button>
              <p className="text-zinc-400 text-xs">
                {recording ? t("mockInterview.recording") : recognizing ? t("mockInterview.recognizing") : t("mockInterview.tapToSpeak")}
              </p>
            </div>
          </div>
        </div>
      </AccessGuard>
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
    <AccessGuard>
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
              /* 报告生成中 */
              <div className="rounded-3xl bg-gradient-to-br from-[#C46A4A]/5 via-white to-[#E2D0B8]/10 dark:from-[#C46A4A]/10 dark:via-zinc-900 dark:to-[#E2D0B8]/5 shadow-lg p-12 flex flex-col items-center">
                <Loader2 className="h-10 w-10 animate-spin text-[#C46A4A] mb-5" />
                <p className="text-gray-700 dark:text-gray-300 text-sm mb-1">{t("mockInterview.reportWriting")}</p>
                {reportChars > 0 && (
                  <p className="text-gray-400 text-xs">{t("mockInterview.reportRecorded").replace("{n}", String(reportChars))}</p>
                )}
              </div>
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
      </div>
    </AccessGuard>
  );
}

"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Header1 } from "@/components/header1";
import { AccessGuard, useAccessCode } from "@/components/access-guard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLanguage } from "@/lib/language-context";
import {
  Bot, Loader2, Sparkles, RotateCcw, ClipboardList, Code2, MessagesSquare,
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
  const [resumes, setResumes] = useState<ResumeItem[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState<number | null>(null);

  // 面试状态
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [overallScore, setOverallScore] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [ending, setEnding] = useState(false);
  const [summary, setSummary] = useState("");

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

  // 播放面试官语音（TTS，支持面试官专属音色）
  const playInterviewerAudio = useCallback(
    async (text: string, speaker?: string) => {
      if (!accessCodeId || !text.trim()) return;
      try {
        setSpeaking(true);
        const res = await fetch("/api/interview/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessCodeId, text, language, speaker }),
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
      });
      playInterviewerAudio(fullContent, activeInterviewer?.voice);
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
      playInterviewerAudio(fullContent, activeInterviewer?.voice);
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
      let fullContent = "";
      let buffer = "";
      setStage("summary");
      setSummary("");
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
              fullContent += data.content;
              setSummary(fullContent);
            }
            if (data.score) setOverallScore(data.score);
          } catch {
            // ignore
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
    setOverallScore(null);
    setSessionId(null);
    setJd("");
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
                  {currentInterviewer ? currentInterviewer.company : t("mockInterview.qaCount").replace("{count}", String(qaCount))}
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
                  <p className="text-zinc-400 text-sm">{currentInterviewer.company}</p>
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

  // ========== 总结阶段 ==========
  return (
    <AccessGuard>
      <div className="min-h-screen bg-white dark:bg-black">
        <Header1 />
        <main className="py-8 md:py-12">
          <div className="container mx-auto px-4 max-w-3xl">
            <div className="mb-8 text-center">
              <div className="inline-flex items-center justify-center h-12 w-12 rounded-2xl bg-gradient-to-br from-[#C46A4A] to-[#B5BEB0] mb-3">
                <ClipboardList className="h-6 w-6 text-white" />
              </div>
              <h1 className="text-3xl md:text-4xl font-light text-black dark:text-white mb-2">
                {t("mockInterview.summaryTitle")}
              </h1>
              {overallScore !== null && (
                <div className="inline-flex items-center gap-2 mt-2 px-5 py-2 rounded-full bg-gradient-to-r from-[#C46A4A] to-[#B5BEB0] text-white">
                  <Sparkles className="h-4 w-4" />
                  <span className="text-2xl font-semibold">{overallScore}</span>
                  <span className="text-sm opacity-80">/ 100</span>
                </div>
              )}
            </div>

            <div className="rounded-3xl border-0 bg-gradient-to-br from-[#C46A4A]/5 via-white to-[#E2D0B8]/10 dark:from-[#C46A4A]/10 dark:via-zinc-900 dark:to-[#E2D0B8]/5 shadow-lg p-6 md:p-8">
              {summary ? (
                <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-gray-800 dark:text-gray-200">
                  {summary}
                </div>
              ) : (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-[#C46A4A]" />
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-center">
              <Button
                onClick={handleRestart}
                className="rounded-full bg-gradient-to-r from-[#C46A4A] to-[#B5BEB0] hover:opacity-90 text-white px-8 h-11"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                {t("mockInterview.restart")}
              </Button>
            </div>
          </div>
        </main>
      </div>
    </AccessGuard>
  );
}

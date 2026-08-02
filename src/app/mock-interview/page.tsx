"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Header1 } from "@/components/header1";
import { AccessGuard, useAccessCode } from "@/components/access-guard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/lib/language-context";
import { Bot, Send, User, Loader2, Sparkles, RotateCcw, ClipboardList, Code2, MessagesSquare, Puzzle, Layers } from "lucide-react";

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

const TYPE_ICONS: Record<InterviewType, React.ReactNode> = {
  technical: <Code2 className="h-6 w-6" />,
  behavioral: <MessagesSquare className="h-6 w-6" />,
  case: <Puzzle className="h-6 w-6" />,
  mixed: <Layers className="h-6 w-6" />,
};

export default function MockInterviewPage() {
  const { t, locale } = useLanguage();
  const { accessCodeId } = useAccessCode();
  const [stage, setStage] = useState<Stage>("setup");
  const [interviewType, setInterviewType] = useState<InterviewType>("mixed");
  const [jd, setJd] = useState("");
  const [resumes, setResumes] = useState<ResumeItem[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [overallScore, setOverallScore] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [ending, setEnding] = useState(false);
  const [summary, setSummary] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const interviewTypes: InterviewType[] = ["technical", "behavioral", "case", "mixed"];

  // 加载简历列表
  useEffect(() => {
    if (!accessCodeId) return;
    const fetchResumes = async () => {
      try {
        const res = await fetch(`/api/resume?access_code_id=${accessCodeId}`);
        if (res.ok) {
          const data = await res.json();
          setResumes(data.resumes || []);
        }
      } catch {
        // ignore
      }
    };
    fetchResumes();
  }, [accessCodeId]);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, summary]);

  // 处理 SSE 流读取
  const readStream = useCallback(async (res: Response, onChunk: (data: { content?: string; sessionId?: number; error?: string }) => void) => {
    if (!res.ok || !res.body) {
      throw new Error("request failed");
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          onChunk(parsed);
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
  }, []);

  // 流式请求面试官回复（开始或继续面试）
  const streamInterviewerReply = useCallback(async (currentSessionId: number | null, answer?: string) => {
    if (!accessCodeId) return;
    setStreaming(true);
    // 先插入一条空的面试官消息用于流式填充
    setMessages((prev) => [...prev, { role: "interviewer", content: "" }]);

    try {
      const res = await fetch("/api/interview/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessCodeId,
          sessionId: currentSessionId || undefined,
          interviewType,
          jobDescription: jd || undefined,
          resumeId: selectedResumeId || undefined,
          answer,
          language: locale === "en" ? "en" : "zh",
        }),
      });

      await readStream(res, (data) => {
        if (data.sessionId) {
          setSessionId(data.sessionId);
        }
        if (data.content) {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            next[next.length - 1] = {
              ...last,
              content: last.content + data.content,
            };
            return next;
          });
        }
        if (data.error) {
          throw new Error(data.error);
        }
      });
    } catch {
      setMessages((prev) => {
        const next = [...prev];
        if (next[next.length - 1]?.content === "") {
          next.pop();
        }
        return next;
      });
      alert(t("mockInterview.sendFailed"));
    } finally {
      setStreaming(false);
    }
  }, [accessCodeId, interviewType, jd, selectedResumeId, locale, t, readStream]);

  // 开始面试
  const handleStart = async () => {
    setMessages([]);
    setSummary("");
    setSessionId(null);
    setStage("interview");
    await streamInterviewerReply(null);
  };

  // 提交回答
  const handleSubmit = async () => {
    const answer = input.trim();
    if (!answer || streaming || !sessionId) return;
    setMessages((prev) => [...prev, { role: "candidate", content: answer }]);
    setInput("");
    await streamInterviewerReply(sessionId, answer);
    textareaRef.current?.focus();
  };

  // 结束面试，流式生成总结
  const handleEnd = async () => {
    if (streaming || ending || !accessCodeId || !sessionId) return;
    setEnding(true);
    setStage("summary");
    setSummary("");

    try {
      const res = await fetch("/api/interview/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessCodeId,
          sessionId,
          language: locale === "en" ? "en" : "zh",
        }),
      });

      await readStream(res, (data) => {
        if (data.content) {
          setSummary((prev) => prev + data.content);
        }
        if (typeof (data as { score?: number }).score === "number") {
          setOverallScore((data as { score?: number }).score ?? null);
        }
        if (data.error) {
          throw new Error(data.error);
        }
      });
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
    setInput("");
    setSessionId(null);
    setOverallScore(null);
  };

  const qaCount = messages.filter((m) => m.role === "candidate").length;

  return (
    <AccessGuard>
      <div className="min-h-screen bg-white dark:bg-black flex flex-col">
        <Header1 />

        {/* 设置阶段 */}
        {stage === "setup" && (
          <main className="flex-1 py-8 md:py-12">
            <div className="container mx-auto px-4 max-w-3xl">
              {/* 标题 */}
              <div className="text-center mb-8 md:mb-12">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-[#C46A4A] to-[#B5BEB0] mb-4 shadow-md">
                  <Bot className="h-7 w-7 text-white" />
                </div>
                <h1 className="text-2xl md:text-3xl font-light text-black dark:text-white mb-2">
                  {t("mockInterview.title")}
                </h1>
                <p className="text-sm md:text-base text-gray-600 dark:text-gray-400 max-w-xl mx-auto">
                  {t("mockInterview.subtitle")}
                </p>
              </div>

              {/* 设置卡片 */}
              <div className="rounded-3xl border-0 bg-gradient-to-br from-[#C46A4A]/5 via-[#E2D0B8]/10 to-[#B5BEB0]/5 shadow-lg p-6 md:p-8">
                <h2 className="text-lg font-medium text-black dark:text-white mb-6">
                  {t("mockInterview.setupTitle")}
                </h2>

                {/* 面试类型 */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-black dark:text-white mb-3">
                    {t("mockInterview.interviewType")}
                  </label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {interviewTypes.map((type) => (
                      <button
                        key={type}
                        onClick={() => setInterviewType(type)}
                        className={`flex flex-col items-center gap-2 p-4 rounded-2xl transition-all duration-200 ${
                          interviewType === type
                            ? "bg-gradient-to-br from-[#C46A4A] to-[#B5BEB0] text-white shadow-md scale-105"
                            : "bg-white dark:bg-zinc-900 text-gray-700 dark:text-gray-300 shadow hover:shadow-md hover:scale-105"
                        }`}
                      >
                        {TYPE_ICONS[type]}
                        <span className="text-sm font-medium">
                          {t(`mockInterview.type${type.charAt(0).toUpperCase() + type.slice(1)}`)}
                        </span>
                        <span
                          className={`text-xs text-center ${
                            interviewType === type ? "text-white/80" : "text-gray-500 dark:text-gray-400"
                          }`}
                        >
                          {t(`mockInterview.type${type.charAt(0).toUpperCase() + type.slice(1)}Desc`)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* JD */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-black dark:text-white mb-2">
                    {t("mockInterview.jd")}
                  </label>
                  <Textarea
                    value={jd}
                    onChange={(e) => setJd(e.target.value)}
                    placeholder={t("mockInterview.jdPlaceholder")}
                    className="min-h-[100px] rounded-xl resize-y bg-white dark:bg-zinc-900"
                  />
                </div>

                {/* 简历选择 */}
                {resumes.length > 0 && (
                  <div className="mb-6">
                    <label className="block text-sm font-medium text-black dark:text-white mb-2">
                      {t("mockInterview.resume")}
                    </label>
                    <select
                      value={selectedResumeId ?? ""}
                      onChange={(e) => setSelectedResumeId(e.target.value ? Number(e.target.value) : null)}
                      className="w-full h-11 rounded-xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 text-sm text-black dark:text-white"
                    >
                      <option value="">{t("mockInterview.resumePlaceholder")}</option>
                      {resumes.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.file_name}
                        </option>
                      ))}
                    </select>
                    {selectedResumeId && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 flex items-center gap-1">
                        <Sparkles className="h-3 w-3 text-[#C46A4A]" />
                        {t("mockInterview.resumeHint")}
                      </p>
                    )}
                  </div>
                )}

                <Button
                  onClick={handleStart}
                  className="w-full h-12 rounded-xl bg-gradient-to-r from-[#C46A4A] to-[#B5BEB0] hover:from-[#B35A3A] hover:to-[#A5AEA0] text-white text-base shadow-md hover:shadow-lg transition-all duration-300"
                >
                  <Bot className="h-5 w-5 mr-2" />
                  {t("mockInterview.start")}
                </Button>
              </div>
            </div>
          </main>
        )}

        {/* 面试进行阶段 - 聊天式界面 */}
        {stage === "interview" && (
          <main className="flex-1 flex flex-col container mx-auto px-4 max-w-3xl py-6">
            {/* 顶部状态栏 */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#C46A4A] to-[#B5BEB0] flex items-center justify-center shadow">
                  <Bot className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="font-medium text-black dark:text-white text-sm">
                    {t("mockInterview.interviewer")}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t("mockInterview.qaCount").replace("{count}", String(qaCount))}
                  </p>
                </div>
              </div>
              <Button
                onClick={handleEnd}
                disabled={streaming || ending || qaCount === 0}
                variant="outline"
                className="rounded-xl border-[#C46A4A]/30 text-[#C46A4A] hover:bg-[#C46A4A]/10 hover:text-[#C46A4A]"
              >
                <ClipboardList className="h-4 w-4 mr-1.5" />
                {t("mockInterview.endInterview")}
              </Button>
            </div>

            {/* 消息区域 */}
            <div className="flex-1 rounded-3xl bg-gradient-to-br from-[#C46A4A]/5 via-[#E2D0B8]/10 to-[#B5BEB0]/5 shadow-inner p-4 md:p-6 overflow-y-auto min-h-[400px] max-h-[55vh]">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-500 dark:text-gray-400 gap-3">
                  <Bot className="h-10 w-10 text-[#C46A4A]/50 animate-pulse" />
                  <p className="text-sm">{t("mockInterview.emptyHint")}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex gap-3 ${msg.role === "candidate" ? "flex-row-reverse" : ""}`}
                    >
                      <div
                        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow ${
                          msg.role === "interviewer"
                            ? "bg-gradient-to-br from-[#C46A4A] to-[#B5BEB0]"
                            : "bg-gray-700 dark:bg-gray-600"
                        }`}
                      >
                        {msg.role === "interviewer" ? (
                          <Bot className="h-4 w-4 text-white" />
                        ) : (
                          <User className="h-4 w-4 text-white" />
                        )}
                      </div>
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-3 shadow ${
                          msg.role === "interviewer"
                            ? "bg-white dark:bg-zinc-900 text-black dark:text-white rounded-tl-sm"
                            : "bg-gradient-to-br from-[#C46A4A] to-[#B35A3A] text-white rounded-tr-sm"
                        }`}
                      >
                        {msg.content === "" && streaming && idx === messages.length - 1 ? (
                          <span className="flex items-center gap-2 text-gray-400">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {t("mockInterview.thinking")}
                          </span>
                        ) : (
                          <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* 输入区域 */}
            <div className="mt-4 flex gap-3 items-end">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                placeholder={t("mockInterview.answerPlaceholder")}
                disabled={streaming}
                className="flex-1 min-h-[60px] max-h-[160px] rounded-2xl resize-none bg-white dark:bg-zinc-900 shadow"
              />
              <Button
                onClick={handleSubmit}
                disabled={!input.trim() || streaming}
                className="h-[60px] w-[60px] rounded-2xl bg-gradient-to-br from-[#C46A4A] to-[#B5BEB0] hover:from-[#B35A3A] hover:to-[#A5AEA0] text-white shadow-md hover:shadow-lg transition-all duration-300"
              >
                {streaming ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Send className="h-5 w-5" />
                )}
              </Button>
            </div>
          </main>
        )}

        {/* 总结阶段 */}
        {stage === "summary" && (
          <main className="flex-1 py-8 md:py-12">
            <div className="container mx-auto px-4 max-w-3xl">
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-[#C46A4A] to-[#B5BEB0] mb-4 shadow-md">
                  <ClipboardList className="h-7 w-7 text-white" />
                </div>
                <h2 className="text-2xl md:text-3xl font-light text-black dark:text-white mb-2">
                  {t("mockInterview.summaryTitle")}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("mockInterview.qaCount").replace("{count}", String(qaCount))}
                </p>
                {overallScore !== null && (
                  <div className="mt-4 inline-flex items-center gap-2 px-5 py-2 rounded-full bg-gradient-to-r from-[#C46A4A] to-[#B5BEB0] text-white shadow-md">
                    <Sparkles className="h-4 w-4" />
                    <span className="text-lg font-semibold">{overallScore}</span>
                    <span className="text-sm opacity-90">/ 100</span>
                  </div>
                )}
              </div>

              <div className="rounded-3xl border-0 bg-gradient-to-br from-[#C46A4A]/5 via-[#E2D0B8]/10 to-[#B5BEB0]/5 shadow-lg p-6 md:p-8 mb-6">
                {ending && summary === "" ? (
                  <div className="flex items-center justify-center gap-3 py-12 text-gray-500 dark:text-gray-400">
                    <Loader2 className="h-6 w-6 animate-spin text-[#C46A4A]" />
                    <span>{t("mockInterview.ending")}</span>
                  </div>
                ) : (
                  <div className="prose prose-sm dark:prose-invert max-w-none text-black dark:text-white whitespace-pre-wrap leading-relaxed">
                    {summary}
                  </div>
                )}
              </div>

              <Button
                onClick={handleRestart}
                disabled={ending}
                className="w-full h-12 rounded-xl bg-gradient-to-r from-[#C46A4A] to-[#B5BEB0] hover:from-[#B35A3A] hover:to-[#A5AEA0] text-white text-base shadow-md hover:shadow-lg transition-all duration-300"
              >
                <RotateCcw className="h-5 w-5 mr-2" />
                {t("mockInterview.restart")}
              </Button>
            </div>
          </main>
        )}
      </div>
    </AccessGuard>
  );
}

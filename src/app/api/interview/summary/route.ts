import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { interviewSummaryRequestSchema } from '@/lib/interview-contracts';
import { createTextProviderClient } from '@/lib/ai/text-provider';
import { consumeTrackedTextStream } from '@/lib/ai-usage';
import { INTERVIEWERS, getPersona, ARCHETYPE_PARAMS, ROUND_ROLE_INFO, GAUNTLET_SCRIPTS } from '@/lib/interviewers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { untrustedBusinessDataBlock, untrustedBusinessDataPolicy } from '@/lib/prompt-safety';

interface ChatMessage {
  role: 'interviewer' | 'candidate';
  content: string;
  round?: number;
  interviewerId?: number;
  ts?: number;
}

const GRADE_SCORE: Record<string, number> = {
  'A+': 97, 'A': 93, 'A-': 90, 'B+': 87, 'B': 83, 'B-': 80,
  'C+': 77, 'C': 73, 'C-': 70, 'D': 60,
};
const SUMMARY_JOB_CONTEXT_MAX_CHARS = 3_200;
const SUMMARY_TRANSCRIPT_MAX_CHARS = 8_000;

function boundSummaryContext(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const head = Math.floor(maxChars * 0.45);
  const tail = Math.max(0, maxChars - head - 64);
  return `${value.slice(0, head)}\n[...earlier detail omitted for speed...]\n${value.slice(-tail)}`;
}

// 从消息记录计算真实统计数据
interface InterviewTurnRow {
  role: 'interviewer' | 'candidate';
  content: string;
  created_at: string;
}

async function computeStats(
  client: SupabaseClient,
  userId: string,
  sessionId: number,
  messages: ChatMessage[],
  createdAt: string,
  updatedAt: string,
) {
  const { data: turnRows, error: turnError } = await client
    .from('interview_turns')
    .select('role, content, created_at')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .order('turn_index');
  const turns = !turnError && turnRows && turnRows.length > 0
    ? turnRows as InterviewTurnRow[]
    : messages.map((message) => ({
      role: message.role,
      content: message.content,
      created_at: message.ts ? new Date(message.ts).toISOString() : '',
    }));
  const { count: questionCount, error: questionError } = await client
    .from('interview_questions')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('user_id', userId);
  const candidate = messages.filter((m) => m.role === 'candidate');
  const candidateTurns = turns.filter((turn) => turn.role === 'candidate');
  const totalCharacters = candidateTurns.reduce((sum, turn) => sum + turn.content.length, 0);

  // 时长：优先消息时间戳首尾差，否则用会话创建/更新时间
  const tsList = turns.map((turn) => Date.parse(turn.created_at)).filter((value) => Number.isFinite(value));
  let durationSec: number;
  if (tsList.length >= 2) {
    durationSec = Math.max(0, Math.round((Math.max(...tsList) - Math.min(...tsList)) / 1000));
  } else {
    durationSec = Math.max(0, Math.round((new Date(updatedAt).getTime() - new Date(createdAt).getTime()) / 1000));
  }

  // 平均反应速度：候选人消息与其上一条面试官消息的时间差
  const responseTimes: number[] = [];
  for (let i = 1; i < turns.length; i++) {
    const cur = turns[i];
    const prev = turns[i - 1];
    const currentTs = Date.parse(cur.created_at);
    const previousTs = Date.parse(prev.created_at);
    if (cur.role === 'candidate' && prev.role === 'interviewer' && Number.isFinite(currentTs) && Number.isFinite(previousTs)) {
      const dt = (currentTs - previousTs) / 1000;
      if (dt > 0 && dt < 3600) responseTimes.push(dt);
    }
  }
  const avgResponseSec = responseTimes.length
    ? Math.round((responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) * 10) / 10
    : null;

  return {
    durationSec,
    totalCharacters,
    turns: candidateTurns.length || candidate.length,
    questions: questionError || questionCount === null
      ? turns.filter((turn) => turn.role === 'interviewer').length
      : questionCount,
    avgResponseSec,
  };
}

function extractJson(text: string): unknown | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  const end = text.lastIndexOf('}');
  if (end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const gradeSchema = z.enum(['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D']);
const reportText = z.string().trim().min(1).max(4_000);
const reportSchema = z.object({
  verdict: z.object({
    pass: z.boolean(),
    vote: z.string().trim().min(1).max(40),
    grade: gradeSchema,
    hireLevel: z.enum(['Strong Hire', 'Hire', 'Lean Hire', 'No Hire']),
    headline: reportText.max(500),
  }).strict(),
  committee: z.array(z.object({
    interviewerId: z.number().int().positive(),
    tags: z.array(z.string().trim().min(1).max(80)).min(1).max(5),
    grade: gradeSchema,
    attitude: z.string().trim().min(1).max(80),
    comment: reportText,
    keyMoment: z.object({ question: reportText, answer: reportText, note: reportText.max(800) }).strict(),
  }).strict()).min(1).max(4),
  radar: z.array(z.object({
    dimension: z.string().trim().min(1).max(80),
    score: z.number().int().min(0).max(100),
    grade: gradeSchema,
    diagnosis: reportText.max(800),
  }).strict()).length(6),
  highlights: z.object({
    mistakes: z.array(z.object({ title: reportText.max(200), scene: reportText, consequence: reportText, coach: reportText }).strict()).min(1).max(2),
    best: z.object({ title: reportText.max(200), scene: reportText, effect: reportText, coach: reportText }).strict(),
  }).strict(),
  actionPlan: z.object({
    immediate: z.array(reportText.max(800)).min(1).max(5),
    practice: z.array(reportText.max(800)).min(1).max(4),
    reading: z.array(reportText.max(800)).min(1).max(4),
  }).strict(),
  annotations: z.array(z.object({
    msgIndex: z.number().int().min(0), label: z.string().trim().min(1).max(100), note: reportText.max(800),
  }).strict()).min(1).max(8),
}).strict();

type StoredInterviewReport = z.infer<typeof reportSchema> & {
  version: number;
  mode: string;
  metrics: Record<string, unknown>;
  coach: Record<string, unknown>;
  committee: Array<z.infer<typeof reportSchema>['committee'][number] & {
    name: string;
    company: string;
    round: number;
    roleLabel: string;
    archetypeLabel: string;
  }>;
};
type StoredCommitteeItem = StoredInterviewReport['committee'][number];

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const parsedRequest = interviewSummaryRequestSchema.safeParse(await request.json());
    if (!parsedRequest.success) return new Response(JSON.stringify({ error: '总结参数无效' }), { status: 400 });
    const { sessionId, language } = parsedRequest.data;

    const { data: session, error: sessionError } = await client
      .from('interview_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('user_id', auth.user.id)
      .single();

    if (sessionError || !session) {
      return new Response(JSON.stringify({ error: '面试会话不存在' }), { status: 404 });
    }
    const eliminatedRound = session.ended_reason === 'eliminated' ? session.current_round : null;

    const messages = (session.messages as ChatMessage[]) || [];

    // 用户全程未作答：不生成 AI 评估，直接将会话标记为已完成（不写入报告与分数）
    const hasCandidateAnswer = messages.some((m) => m.role === 'candidate' && m.content?.trim());
    if (!hasCandidateAnswer) {
      await client
        .from('interview_sessions')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', sessionId);
      const skipped = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ skipped: true, done: true })}\n\n`));
          controller.close();
        },
      });
      return new Response(skipped, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    if (messages.length < 2) {
      return new Response(JSON.stringify({ error: '面试内容太少，无法生成报告' }), { status: 400 });
    }

    const [stats, historyResult] = await Promise.all([
      computeStats(client, auth.user.id, sessionId, messages, session.created_at, session.updated_at),
      // 历史趋势：该用户所有已完成且有分数的会话（不含本场）
      client
        .from('interview_sessions')
        .select('id, overall_score, report_grade, created_at')
        .eq('user_id', auth.user.id)
        .eq('status', 'completed')
        .not('overall_score', 'is', null)
        .neq('id', sessionId)
        .order('created_at', { ascending: true })
        .limit(10),
    ]);
    const historyRows = historyResult.data;
    const history = (historyRows || []).map((r) => ({
      date: r.created_at,
      score: r.overall_score as number,
      grade: (r.report_grade as string) || null,
    }));

    // 委员会档案（轮次/角色/人设），供 prompt 与结果回填共用
    // 公司统一使用本场目标公司（画像库仅提供性格参考）
    const isGauntlet = session.mode === 'gauntlet' && (session.total_rounds || 1) > 1;
    const rounds: number = session.total_rounds || 1;
    const interviewerIds: number[] = (session.interviewer_ids as number[]) || [];
    const script = isGauntlet ? GAUNTLET_SCRIPTS[rounds] ?? null : null;
    const sessionCompany: string = session.target_company || '';
    const panel = interviewerIds
      .map((id, idx) => {
        const it = INTERVIEWERS.find((i) => i.id === id);
        if (!it) return null;
        const role = script ? script[idx] : null;
        const roleLabel = role
          ? (language === 'en' ? ROUND_ROLE_INFO[role].labelEn : ROUND_ROLE_INFO[role].labelZh)
          : (language === 'en' ? 'Sole interviewer' : '唯一面试官');
        const persona = getPersona(it.id);
        const archetypeLabel = language === 'en'
          ? ARCHETYPE_PARAMS[persona.archetype].labelEn
          : ARCHETYPE_PARAMS[persona.archetype].labelZh;
        return { id: it.id, name: it.name, company: sessionCompany || it.company, personality: it.personality, round: idx + 1, roleLabel, archetypeLabel };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    const sseHeaders = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    };
    const encoder = new TextEncoder();

    // ===== 缓存命中：直接返回已生成报告 =====
    if (session.report) {
      const cached = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ report: session.report, stats, history, done: true })}\n\n`));
          controller.close();
        },
      });
      return new Response(cached, { headers: sseHeaders });
    }

    // ===== 构建 LLM prompt =====
    const dossier = panel
      .map((p) => (language === 'en'
        ? `[id=${p.id}] Round ${p.round} (${p.roleLabel}): ${p.name} from ${p.company}. Persona: ${p.personality} Archetype: ${p.archetypeLabel}.`
        : `[id=${p.id}] 第 ${p.round} 轮（${p.roleLabel}）：${p.name}，来自${p.company}。人设：${p.personality} 原型：${p.archetypeLabel}。`))
      .join('\n');

    const getInterviewerLabel = (m: ChatMessage) => {
      if (m.role !== 'interviewer') return language === 'en' ? 'Candidate' : '候选人';
      const p = panel.find((x) => x.id === m.interviewerId);
      return p ? `${p.name} (${p.company})` : (language === 'en' ? 'Interviewer' : '面试官');
    };
    const transcript = boundSummaryContext(messages
      .map((m, idx) => `[#${idx}] ${getInterviewerLabel(m)}: ${(m.content || '').slice(0, 600)}`)
      .join('\n\n'), SUMMARY_TRANSCRIPT_MAX_CHARS);

    const systemPrompt = language === 'en'
      ? `You are the secretary of a hiring committee at a top company. You compile brutally honest, multi-perspective evaluation reports in structured JSON. Each interviewer speaks in their own persona voice. You are sharp, specific and never generic.\n\n${untrustedBusinessDataPolicy('en')}`
      : `你是顶级公司面试委员会的记录秘书，负责以结构化 JSON 输出多视角评议报告。每位面试官以自己的人设口吻发言。你尖锐、具体、毫不客气，就像真实的大厂内部评议。\n\n${untrustedBusinessDataPolicy('zh')}`;

    const jsonSpec = language === 'en'
      ? `Output ONLY a single JSON object (no markdown fences, no extra text) with EXACTLY this structure:
{
  "verdict": { "pass": true|false, "vote": "e.g. 2:1", "grade": "one of A+/A/A-/B+/B/B-/C+/C/C-/D", "hireLevel": "one of Strong Hire/Hire/Lean Hire/No Hire", "headline": "one sharp sentence summarizing the outcome" },
  "committee": [ { "interviewerId": <must be one of the panel ids above>, "tags": ["2-3 behavior tags e.g. High-Pressure, Detail-Obsessed"], "grade": "A+~D", "attitude": "one of Strongly Recommend/Recommend/Neutral/Not Recommend/Strongly Oppose", "comment": "2-4 sentences in THIS interviewer's own persona voice, citing specific moments", "keyMoment": { "question": "the single most sweat-inducing question from this interviewer (quote)", "answer": "the candidate's answer at that moment (quote)", "note": "one-line comment" } } ],
  "radar": [ { "dimension": "...", "score": 0-100 integer, "grade": "A+~D", "diagnosis": "one sentence" } ],  // EXACTLY 6 dimensions: Technical/Professional Skills, Logical & Structured Thinking, Stress & Emotional Control, Communication & Empathy, Culture/Values Fit, Role Readiness
  "highlights": { "mistakes": [ { "title": "short", "scene": "recreate the moment with quotes", "consequence": "what it cost", "coach": "AI coach analysis" } ], "best": { "title": "...", "scene": "...", "effect": "...", "coach": "..." } },  // 1-2 fatal mistakes
  "actionPlan": { "immediate": ["3-5 things to do NOW if the real interview were tomorrow"], "practice": ["2-3 targeted drills on this platform"], "reading": ["1-3 external books/articles"] },
  "annotations": [ { "msgIndex": <message number from transcript, 0-based>, "label": "short tag e.g. Vague Wording / Missing Data / Highlight", "note": "one-line annotation" } ]  // 3-5 items, only key moments
}`
      : `只输出一个 JSON 对象（不要用 markdown 代码块，不要输出任何其他文字），严格按以下结构：
{
  "verdict": { "pass": true或false, "vote": "如 2:1", "grade": "A+/A/A-/B+/B/B-/C+/C/C-/D 之一", "hireLevel": "Strong Hire/Hire/Lean Hire/No Hire 之一", "headline": "一句话战报结论，尖锐直接" },
  "committee": [ { "interviewerId": <必须是上面委员会成员的 id>, "tags": ["2-3个行为标签，如 高压型、细节控"], "grade": "A+~D", "attitude": "强烈推荐/推荐/保留意见/不推荐/强烈反对 之一", "comment": "以该面试官【自己人设口吻】写 2-4 句尖锐评语，引用记录中的具体瞬间", "keyMoment": { "question": "该面试官最让候选人冒冷汗的一个问题（引用原文）", "answer": "候选人当时的回答（引用原文）", "note": "一句点评" } } ],
  "radar": [ { "dimension": "维度名", "score": 0-100整数, "grade": "A+~D", "diagnosis": "一句话诊断" } ],  // 恰好 6 个维度：技术/专业硬实力、逻辑与结构化表达、抗压与情绪控制、沟通与共情、文化/价值观匹配、岗位准备度
  "highlights": { "mistakes": [ { "title": "短标题", "scene": "场景还原（引用对话原文）", "consequence": "造成的后果", "coach": "AI教练分析" } ], "best": { "title": "...", "scene": "...", "effect": "...", "coach": "..." } },  // 致命失误 1-2 个
  "actionPlan": { "immediate": ["3-5条：如果明天就要面目标公司，立即要做的事"], "practice": ["2-3条平台内专项练习推荐"], "reading": ["1-3本/篇外部阅读推荐"] },
  "annotations": [ { "msgIndex": <面试记录消息序号，从0开始>, "label": "短标签，如 模糊词汇/数据缺失/高光时刻", "note": "一句标注" } ]  // 3-5 条，只标关键时刻
}`;

    // 淘汰上下文：闯关轮末被卡掉时，评议结论必须体现提前淘汰（pass=false，评级下调）
    const eliminatedNote = eliminatedRound
      ? (language === 'en'
          ? `\n\nIMPORTANT: The candidate was ELIMINATED by the interviewer at the end of round ${eliminatedRound} — the interview ended early. The verdict must reflect this early elimination: pass must be false, and grades should be calibrated accordingly.`
          : `\n\n重要：候选人在第 ${eliminatedRound} 轮结束时被面试官淘汰，面试提前终止。最终结论必须体现这次提前淘汰——pass 必须为 false，评级相应下调。`)
      : '';

    const userPrompt = language === 'en'
      ? `A ${isGauntlet ? `${rounds}-round gauntlet` : 'single-round'} mock interview (${session.interview_type}) is complete.${eliminatedNote}

Job Description:
${untrustedBusinessDataBlock('job_description', session.job_description || '', SUMMARY_JOB_CONTEXT_MAX_CHARS)}

Interview Panel:
${dossier || 'One interviewer'}

Transcript (messages numbered from 0):
${untrustedBusinessDataBlock('interview_transcript', transcript, SUMMARY_TRANSCRIPT_MAX_CHARS)}

${jsonSpec}

Requirements: committee array must cover EVERY panel member in round order; every interviewer's voice must match their persona; cite real transcript moments. Keep the complete JSON compact: 1-2 short sentences per comment, 1 mistake, 3 annotations, exactly 3 immediate actions, 2 practice drills and 2 reading items.`
      : `一场${isGauntlet ? `${rounds}轮闯关` : '单轮'}模拟面试（${session.interview_type}）已结束。${eliminatedNote}

岗位描述：
${untrustedBusinessDataBlock('job_description', session.job_description || '', SUMMARY_JOB_CONTEXT_MAX_CHARS)}

面试委员会成员：
${dossier || '一位面试官'}

面试记录（消息序号从 0 开始）：
${untrustedBusinessDataBlock('interview_transcript', transcript, SUMMARY_TRANSCRIPT_MAX_CHARS)}

${jsonSpec}

要求：committee 数组必须按轮次顺序覆盖委员会【每一位】成员；每位面试官口吻必须符合其人设，并引用真实记录瞬间。完整 JSON 必须紧凑：每条评语 1-2 句短句、致命失误只写 1 条、标注恰好 3 条、立即行动恰好 3 条、专项练习 2 条、阅读建议 2 条。`;

    const llmClient = createTextProviderClient({ requestHeaders: request.headers, timeoutMs: 32_000 });
    let fullContent = '';

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ phase: 'writing' })}\n\n`));
          await consumeTrackedTextStream(llmClient, [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ], {
            temperature: 0.45,
            thinking: 'disabled',
            responseFormat: { name: 'interview_summary', schema: { type: 'object' } },
          }, {
            userId: auth.user.id,
            feature: 'interview_summary',
            resumeId: session.resume_id,
            interviewSessionId: sessionId,
            metadata: { language, eliminated_round: eliminatedRound ?? null },
          }, (text) => {
            fullContent += text;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: text })}\n\n`));
          });


          const parsedReport = reportSchema.safeParse(extractJson(fullContent));
          if (!parsedReport.success) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: '报告解析失败，请重试' })}\n\n`));
            controller.close();
            return;
          }
          const rawReport = parsedReport.data;
          const panelIds = new Set(panel.map((member) => member.id));
          const reportIds = rawReport.committee.map((member) => member.interviewerId);
          const hasExpectedCommittee = panelIds.size === reportIds.length
            && reportIds.length === new Set(reportIds).size
            && reportIds.every((id) => panelIds.has(id));
          const hasValidAnnotations = rawReport.annotations.every((annotation) => annotation.msgIndex < messages.length);
          if (!hasExpectedCommittee || !hasValidAnnotations) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: '报告引用与本场面试不一致，请重试' })}\n\n`));
            controller.close();
            return;
          }
          // Attach trusted static panel data after model output passes schema validation.
          const committee: StoredCommitteeItem[] = rawReport.committee.map((c) => {
            const p = panel.find((x) => x.id === c.interviewerId);
            // `hasExpectedCommittee` above proves this path is unreachable for valid data.
            if (!p) throw new Error('报告引用了未知面试官');
            return {
              ...c,
              interviewerId: p.id,
              name: p.name,
              company: p.company,
              round: p.round,
              roleLabel: p.roleLabel,
              archetypeLabel: p.archetypeLabel,
            };
          });
          const report: StoredInterviewReport = {
            ...rawReport,
            committee,
            version: 1,
            mode: session.evaluation_mode || 'dual',
            metrics: { ...stats },
            coach: {
              diagnosis: rawReport.highlights,
              actionPlan: rawReport.actionPlan,
              annotations: rawReport.annotations,
            },
          };

          // 综合得分：雷达均分（与等级映射取较高一致性的均分）
          const radarScores = (report.radar || []).map((r) => r.score).filter((s) => typeof s === 'number');
          const gradeScore = GRADE_SCORE[report.verdict.grade];
          const overallScore = radarScores.length
            ? Math.round(radarScores.reduce((a, b) => a + b, 0) / radarScores.length)
            : gradeScore;

          await client
            .from('interview_sessions')
            .update({
              status: 'completed',
              report,
              summary: report.verdict.headline || '',
              overall_score: overallScore,
              report_grade: report.verdict.grade || null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', sessionId);

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ report, stats, history, score: overallScore, done: true })}\n\n`));
          controller.close();
        } catch (error) {
          console.error('Summary stream error:', error);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: '报告生成失败，请重试' })}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(readableStream, { headers: sseHeaders });
  } catch (error) {
    console.error('Interview summary error:', error);
    return new Response(JSON.stringify({ error: '服务器错误' }), { status: 500 });
  }
}

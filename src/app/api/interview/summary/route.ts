import { NextRequest } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { INTERVIEWERS, getPersona, ARCHETYPE_PARAMS, ROUND_ROLE_INFO, GAUNTLET_SCRIPTS } from '@/lib/interviewers';

interface ChatMessage {
  role: 'interviewer' | 'candidate';
  content: string;
  round?: number;
  interviewerId?: number;
  ts?: number;
}

interface ReportCommitteeItem {
  interviewerId: number;
  tags: string[];
  grade: string;
  attitude: string;
  comment: string;
  keyMoment: { question: string; answer: string; note: string };
}

interface InterviewReport {
  verdict: { pass: boolean; vote: string; grade: string; hireLevel: string; headline: string };
  committee: ReportCommitteeItem[];
  radar: Array<{ dimension: string; score: number; grade: string; diagnosis: string }>;
  highlights: {
    mistakes: Array<{ title: string; scene: string; consequence: string; coach: string }>;
    best: { title: string; scene: string; effect: string; coach: string };
  };
  actionPlan: { immediate: string[]; practice: string[]; reading: string[] };
  annotations: Array<{ msgIndex: number; label: string; note: string }>;
}

const GRADE_SCORE: Record<string, number> = {
  'A+': 97, 'A': 93, 'A-': 90, 'B+': 87, 'B': 83, 'B-': 80,
  'C+': 77, 'C': 73, 'C-': 70, 'D': 60, 'F': 50,
};

// 按均分反推合法等级（LLM 偶尔输出枚举外等级如 F/E 时钳制）
function scoreToGrade(s: number): string {
  if (s >= 95) return 'A+';
  if (s >= 92) return 'A';
  if (s >= 89) return 'A-';
  if (s >= 86) return 'B+';
  if (s >= 82) return 'B';
  if (s >= 79) return 'B-';
  if (s >= 76) return 'C+';
  if (s >= 72) return 'C';
  if (s >= 69) return 'C-';
  return 'D';
}

// 从消息记录计算真实统计数据
function computeStats(messages: ChatMessage[], createdAt: string, updatedAt: string) {
  const candidate = messages.filter((m) => m.role === 'candidate');
  const interviewers = messages.filter((m) => m.role === 'interviewer');
  const totalWords = candidate.reduce((s, m) => s + (m.content?.length || 0), 0);

  // 时长：优先消息时间戳首尾差，否则用会话创建/更新时间
  const tsList = messages.map((m) => m.ts).filter((t): t is number => typeof t === 'number');
  let durationSec: number;
  if (tsList.length >= 2) {
    durationSec = Math.max(0, Math.round((Math.max(...tsList) - Math.min(...tsList)) / 1000));
  } else {
    durationSec = Math.max(0, Math.round((new Date(updatedAt).getTime() - new Date(createdAt).getTime()) / 1000));
  }

  // 平均反应速度：候选人消息与其上一条面试官消息的时间差
  const responseTimes: number[] = [];
  for (let i = 1; i < messages.length; i++) {
    const cur = messages[i];
    const prev = messages[i - 1];
    if (cur.role === 'candidate' && prev.role === 'interviewer' && cur.ts && prev.ts) {
      const dt = (cur.ts - prev.ts) / 1000;
      if (dt > 0 && dt < 3600) responseTimes.push(dt);
    }
  }
  const avgResponseSec = responseTimes.length
    ? Math.round((responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) * 10) / 10
    : null;

  return {
    durationSec,
    totalWords,
    turns: candidate.length,
    probes: interviewers.length, // 面试官提问/追问总次数
    avgResponseSec,
  };
}

// 从 LLM 输出中容错提取 JSON 对象
function extractJson(text: string): InterviewReport | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  const raw = text.slice(start);
  // 完整解析优先
  try {
    return JSON.parse(raw) as InterviewReport;
  } catch {
    // 继续走抢救流程
  }
  // 截断抢救：LLM 输出达到 token 上限时 JSON 不完整，
  // 回退到上一个完整元素边界并补全未闭合括号，保住已生成的 verdict/committee/radar 等主体
  return salvageJson(raw) as InterviewReport | null;
}

// 清理 LLM 常见格式瑕疵：尾逗号
function parseLoose(json: string): unknown | null {
  try {
    return JSON.parse(json.replace(/,\s*([}\]])/g, '$1'));
  } catch {
    return null;
  }
}

// 截断 JSON 抢救：扫描括号栈（跳过字符串内容），回退未完成的尾部片段后按栈补全闭合
function salvageJson(raw: string): unknown | null {
  const scan = (end: number): { stack: string[]; lastSafe: number } => {
    const stack: string[] = [];
    let inStr = false;
    let escaped = false;
    let lastSafe = -1;
    for (let i = 0; i < end; i++) {
      const ch = raw[i];
      if (inStr) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{' || ch === '[') { stack.push(ch); continue; }
      if (ch === '}' || ch === ']') {
        if (!stack.pop()) return { stack: [], lastSafe: -2 }; // 括号不平衡，放弃
        lastSafe = i; // 一个完整元素的边界，可在此安全截断
      }
    }
    return { stack, lastSafe };
  };

  const { stack, lastSafe } = scan(raw.length);
  if (lastSafe === -2) return null;
  if (stack.length === 0) {
    // 结构完整但含非法内容：截取到最后一个闭合括号再试
    return lastSafe >= 0 ? parseLoose(raw.slice(0, lastSafe + 1)) : null;
  }
  if (lastSafe < 0) return null; // 连一个完整元素都没有，无法抢救
  // 回退到上一个完整元素边界，补全该点仍未闭合的括号
  const { stack: remaining } = scan(lastSafe + 1);
  let fixed = raw.slice(0, lastSafe + 1);
  for (let i = remaining.length - 1; i >= 0; i--) {
    fixed += remaining[i] === '{' ? '}' : ']';
  }
  return parseLoose(fixed);
}

export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { accessCodeId, sessionId, language = 'zh', eliminatedRound } = await request.json();

    if (!accessCodeId || !sessionId) {
      return new Response(JSON.stringify({ error: '缺少必要参数' }), { status: 400 });
    }

    const { data: session, error: sessionError } = await client
      .from('interview_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('access_code_id', accessCodeId)
      .single();

    if (sessionError || !session) {
      return new Response(JSON.stringify({ error: '面试会话不存在' }), { status: 404 });
    }

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

    const stats = computeStats(messages, session.created_at, session.updated_at);

    // 历史趋势：该用户所有已完成且有分数的会话（不含本场）
    const { data: historyRows } = await client
      .from('interview_sessions')
      .select('id, overall_score, report_grade, created_at')
      .eq('access_code_id', accessCodeId)
      .eq('status', 'completed')
      .not('overall_score', 'is', null)
      .neq('id', sessionId)
      .order('created_at', { ascending: true })
      .limit(10);
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
    const transcript = messages
      .map((m, idx) => `[#${idx}] ${getInterviewerLabel(m)}: ${(m.content || '').slice(0, 600)}`)
      .join('\n\n');

    const systemPrompt = language === 'en'
      ? 'You are the secretary of a hiring committee at a top company. You compile brutally honest, multi-perspective evaluation reports in structured JSON. Each interviewer speaks in their own persona voice. You are sharp, specific and never generic.'
      : '你是顶级公司面试委员会的记录秘书，负责以结构化 JSON 输出多视角评议报告。每位面试官以自己的人设口吻发言。你尖锐、具体、毫不客气，就像真实的大厂内部评议。';

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
${session.job_description}

Interview Panel:
${dossier || 'One interviewer'}

Transcript (messages numbered from 0):
${transcript}

${jsonSpec}

Requirements: committee array must cover EVERY panel member in round order; every interviewer's voice must match their persona; be brutally specific, cite real transcript moments; keep each comment under 120 words to ensure complete JSON output.`
      : `一场${isGauntlet ? `${rounds}轮闯关` : '单轮'}模拟面试（${session.interview_type}）已结束。${eliminatedNote}

岗位描述：
${session.job_description}

面试委员会成员：
${dossier || '一位面试官'}

面试记录（消息序号从 0 开始）：
${transcript}

${jsonSpec}

要求：committee 数组必须按轮次顺序覆盖委员会【每一位】成员；每位面试官口吻必须符合其人设；评议尖锐具体，引用真实记录瞬间；每条评语控制在 120 字以内，确保 JSON 完整输出。`;

    const llmClient = new LLMClient(new Config(), HeaderUtils.extractForwardHeaders(request.headers));
    let fullContent = '';

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          const stream = llmClient.stream([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ], { temperature: 0.7 });

          for await (const chunk of stream) {
            if (chunk.content) {
              const text = chunk.content.toString();
              fullContent += text;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: text })}\n\n`));
            }
          }

          const report = extractJson(fullContent);
          if (!report || !report.verdict || !Array.isArray(report.committee) || report.committee.length === 0) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: '报告解析失败，请重试' })}\n\n`));
            controller.close();
            return;
          }

          // 截断抢救可能导致尾部字段缺失：兜底默认值，保证报告可用
          report.radar = Array.isArray(report.radar) ? report.radar : [];
          report.highlights = report.highlights && typeof report.highlights === 'object'
            ? report.highlights
            : { mistakes: [], best: { title: '', scene: '', effect: '', coach: '' } };
          report.highlights.mistakes = Array.isArray(report.highlights.mistakes) ? report.highlights.mistakes : [];
          report.actionPlan = report.actionPlan && typeof report.actionPlan === 'object'
            ? report.actionPlan
            : { immediate: [], practice: [], reading: [] };
          report.actionPlan.immediate = Array.isArray(report.actionPlan.immediate) ? report.actionPlan.immediate : [];
          report.actionPlan.practice = Array.isArray(report.actionPlan.practice) ? report.actionPlan.practice : [];
          report.actionPlan.reading = Array.isArray(report.actionPlan.reading) ? report.actionPlan.reading : [];
          report.annotations = Array.isArray(report.annotations) ? report.annotations : [];

          // 回填面试官静态信息，防止 LLM 编造
          report.committee = report.committee.map((c) => {
            const p = panel.find((x) => x.id === c.interviewerId) || panel[0];
            if (!p) return c;
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

          // 综合得分：雷达均分（与等级映射取较高一致性的均分）
          const radarScores = (report.radar || []).map((r) => r.score).filter((s) => typeof s === 'number');
          const gradeScore = GRADE_SCORE[report.verdict.grade] ?? null;
          const overallScore = radarScores.length
            ? Math.round(radarScores.reduce((a, b) => a + b, 0) / radarScores.length)
            : gradeScore;

          // 等级钳制：LLM 输出枚举外等级（如 F/E）时按均分反推合法等级
          if (!report.verdict.grade || !(report.verdict.grade in GRADE_SCORE) || report.verdict.grade === 'F') {
            report.verdict.grade = scoreToGrade(overallScore ?? 60);
          }

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

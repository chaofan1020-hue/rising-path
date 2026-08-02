import { NextRequest } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { INTERVIEWERS, getPersona, ROUND_ROLE_INFO, GAUNTLET_SCRIPTS } from '@/lib/interviewers';

interface ChatMessage {
  role: 'interviewer' | 'candidate';
  content: string;
  round?: number;
  interviewerId?: number;
}

export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { accessCodeId, sessionId, language = 'zh' } = await request.json();

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
    if (messages.length < 2) {
      return new Response(JSON.stringify({ error: '面试内容太少，无法生成报告' }), { status: 400 });
    }

    // 构建面试委员会成员档案（含轮次角色与人设）
    const isGauntlet = session.mode === 'gauntlet' && (session.total_rounds || 1) > 1;
    const rounds: number = session.total_rounds || 1;
    const interviewerIds: number[] = (session.interviewer_ids as number[]) || [];
    const script = isGauntlet ? GAUNTLET_SCRIPTS[rounds] ?? null : null;
    const dossier = interviewerIds
      .map((id, idx) => {
        const it = INTERVIEWERS.find((i) => i.id === id);
        if (!it) return null;
        const role = script ? script[idx] : null;
        const roleLabel = role
          ? (language === 'en' ? ROUND_ROLE_INFO[role].labelEn : ROUND_ROLE_INFO[role].labelZh)
          : (language === 'en' ? 'Sole interviewer' : '唯一面试官');
        const persona = getPersona(it.id);
        return language === 'en'
          ? `Round ${idx + 1} (${roleLabel}): ${it.name} from ${it.company}. Persona: ${it.personality} Archetype: ${persona.archetype}.`
          : `第 ${idx + 1} 轮（${roleLabel}）：${it.name}，来自${it.company}。人设：${it.personality} 原型：${persona.archetype}。`;
      })
      .filter(Boolean)
      .join('\n');
    const getInterviewerLabel = (m: ChatMessage) => {
      if (m.role !== 'interviewer') return language === 'en' ? 'Candidate' : '候选人';
      if (m.interviewerId) {
        const it = INTERVIEWERS.find((i) => i.id === m.interviewerId);
        if (it) return `${it.name} (${it.company})`;
      }
      return language === 'en' ? 'Interviewer' : '面试官';
    };
    const transcript = messages
      .map((m) => `${getInterviewerLabel(m)}: ${m.content}`)
      .join('\n\n');

    const systemPrompt = language === 'en'
      ? 'You are the secretary of a hiring committee at a top company. You compile brutally honest, multi-perspective evaluation reports from each interviewer. Your reports are sharp, specific and never generic — like real internal hiring committee notes.'
      : '你是顶级公司面试委员会的记录秘书，负责汇总每位面试官的真实评议。你的报告尖锐、具体、毫不客气，就像真实的大厂内部面试评议记录。';

    const userPrompt = language === 'en'
      ? `Below is a ${isGauntlet ? `${rounds}-round gauntlet` : 'single-round'} mock interview transcript for a ${session.interview_type} interview.

Job Description:
${session.job_description}

Interview Panel:
${dossier || 'One interviewer'}

Transcript:
${transcript}

Generate a HIRING COMMITTEE evaluation report in Markdown with this exact structure:

## Committee Verdict Overview
(One paragraph: the interview format, panel composition, and the overall atmosphere of the candidate's performance)

## Individual Evaluations
(For EACH interviewer on the panel, in round order:)
### Round N · [Round Role] — Interviewer Name (Company)
(In this interviewer's OWN voice and persona, 2-4 sentences of sharp, honest commentary on what they observed — specific moments from the transcript, not generic feedback)
- Score: one of A+ / A / B+ / B / C+ / C / D
- Recommendation: Strongly Recommend / Recommend / Neutral / Not Recommend / Strongly Oppose

## Final Decision
- Verdict: PASS or FAIL
- Decisive factors: (which dimensions drove the decision, e.g. "cultural fit", "attention to detail", "technical depth")
- Committee consensus: (2-3 sentences)

## Style Adaptability
(How consistently the candidate performed across different interviewer personalities and pressure styles)

## Preparation Advice
- (3-5 concrete, actionable suggestions)

Be specific, cite real moments from the transcript, and keep each interviewer's voice true to their persona.`
      : `以下是一场${isGauntlet ? `${rounds}轮闯关` : '单轮'}模拟面试的完整记录，岗位类型：${session.interview_type}。

岗位描述：
${session.job_description}

面试委员会成员：
${dossier || '一位面试官'}

面试记录：
${transcript}

请生成一份面试委员会评议报告，使用 Markdown，严格按以下结构：

## 委员会总览
（一段话：本场面试形式、委员会构成，以及候选人整体表现氛围）

## 各面试官评议
（按轮次顺序，为委员会中【每一位】面试官输出：）
### 第 N 轮 · [轮次角色] — 面试官姓名（公司）
（以该面试官【自己的口吻与人设】写 2-4 句尖锐真实的评议——引用记录中的具体瞬间，不要泛泛而谈）
- 评分：A+ / A / B+ / B / C+ / C / D 之一
- 态度：强烈推荐 / 推荐 / 保留意见 / 不推荐 / 强烈反对

## 综合决议
- 决议：通过 或 未通过
- 关键决定因素：（如"文化匹配度""细节严谨度""专业深度"等维度）
- 委员会共识：（2-3 句话）

## 风格适应度分析
（候选人在不同性格、不同压力风格的面试官面前，表现的稳定性与适应力）

## 备考建议
- （3-5 条具体可落地的建议）

要求：引用记录中的真实瞬间，每位面试官的口吻必须符合其人设，评议要尖锐直接，不怕得罪人。`;

    const llmClient = new LLMClient(new Config(), HeaderUtils.extractForwardHeaders(request.headers));
    const encoder = new TextEncoder();
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

          // 提取总分（尝试从文本中解析数字分数）
          let overallScore: number | null = null;
          const scoreMatch = fullContent.match(/(\d{1,3})\s*(?:\/\s*100|分)/);
          if (scoreMatch) {
            const parsed = parseInt(scoreMatch[1], 10);
            if (parsed >= 0 && parsed <= 100) overallScore = parsed;
          }

          // 更新会话状态
          await client
            .from('interview_sessions')
            .update({
              status: 'completed',
              summary: fullContent,
              overall_score: overallScore,
              updated_at: new Date().toISOString(),
            })
            .eq('id', sessionId);

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, score: overallScore })}\n\n`));
          controller.close();
        } catch (error) {
          console.error('Summary stream error:', error);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: '报告生成失败，请重试' })}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Interview summary error:', error);
    return new Response(JSON.stringify({ error: '服务器错误' }), { status: 500 });
  }
}

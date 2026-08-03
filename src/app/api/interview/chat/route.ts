import { NextRequest } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import {
  INTERVIEWERS,
  selectRoundInterviewers,
  selectScriptInterviewers,
  getInterviewerVoice,
  getInterviewerSpeechRate,
  getPersona,
  assignToCompany,
  ARCHETYPE_PARAMS,
  ROUND_ROLE_INFO,
  ROLE_TITLES,
  GAUNTLET_SCRIPTS,
  ROUND_QUESTION_QUOTA,
  ROUND_TIME_LIMIT,
  type Interviewer,
  type RoundRole,
} from '@/lib/interviewers';

interface ChatMessage {
  role: 'interviewer' | 'candidate';
  content: string;
  round?: number;
  interviewerId?: number;
  ts?: number; // 消息时间戳（毫秒），用于统计反应速度
}

const QUESTIONS_PER_ROUND = 2;

// 任意环节淘汰判定：每次候选人作答后，面试官都有权单方面立即终止面试，无需等轮末节点。
// 判定基于本场全程表现（避免仅因一句话误杀）；严格性控制：prompt 明确"默认继续"，
// 仅在回答明显空洞敷衍、答非所问、消极放弃、或完全无法胜任时才终止；判定失败同样默认继续。
async function judgeElimination(
  llmClient: LLMClient,
  jobDescription: string,
  transcriptMessages: ChatMessage[],
  round: number,
  totalRounds: number,
  language: string
): Promise<boolean> {
  const transcript = transcriptMessages
    .map((m) => {
      const who = m.role === 'interviewer'
        ? (language === 'en' ? 'Interviewer' : '面试官')
        : (language === 'en' ? 'Candidate' : '候选人');
      return `${who}: ${m.content.slice(0, 300)}`;
    })
    .join('\n');
  const prompt = language === 'en'
    ? `You are a strict but fair interviewer, currently interviewing a candidate for this position (round ${round} of ${totalRounds}):\n${jobDescription.slice(0, 800)}\n\nInterview transcript so far:\n${transcript}\n\nDecide: should this interview be TERMINATED immediately?\nIMPORTANT: Default to "pass" — as long as the candidate is still answering earnestly and there is anything left worth probing, the interview must continue. Only choose "eliminate" when the candidate's answers are clearly empty or perfunctory, severely off-topic, show a giving-up attitude, or demonstrate they are fundamentally unfit for the role. Termination is an irreversible severe verdict — use it sparingly.\nReply with JSON only: {"decision":"pass"} or {"decision":"eliminate"}`
    : `你是一位严格但公正的面试官，正在对候选人进行以下岗位的面试（共 ${totalRounds} 轮，当前第 ${round} 轮）：\n${jobDescription.slice(0, 800)}\n\n截至目前的面试对话：\n${transcript}\n\n请裁决：是否立即终止本场面试？\n重要：默认继续面试（pass）——只要候选人仍在认真作答、尚有可考察的价值，就必须继续。仅当回答明显空洞敷衍、严重答非所问、表现出消极放弃态度、或显示出完全无法胜任该岗位时，才立即终止（eliminate）。终止是不可逆的严厉裁决，慎用。\n只输出 JSON：{"decision":"pass"} 或 {"decision":"eliminate"}`;
  try {
    let out = '';
    const stream = llmClient.stream([{ role: 'user', content: prompt }], { temperature: 0.2 });
    for await (const chunk of stream) {
      if (chunk.content) out += chunk.content.toString();
    }
    return /"decision"\s*:\s*"eliminate"/.test(out);
  } catch {
    return false;
  }
}

const TYPE_LABELS: Record<string, { zh: string; en: string }> = {
  technical: { zh: '技术面试', en: 'Technical Interview' },
  behavioral: { zh: '行为面试', en: 'Behavioral Interview' },
  case: { zh: '案例面试', en: 'Case Interview' },
  mixed: { zh: '综合面试', en: 'Mixed Interview' },
};

function buildSystemPrompt(
  interviewType: string,
  jobDescription: string,
  language: string,
  interviewer: Interviewer | null,
  isNewInterviewer: boolean,
  roundRole: RoundRole | null
) {
  const typeLabel = TYPE_LABELS[interviewType]?.[language === 'en' ? 'en' : 'zh'] || interviewType;
  const persona = interviewer ? getPersona(interviewer.id) : null;
  const archetype = persona ? ARCHETYPE_PARAMS[persona.archetype] : null;
  const roleInfo = roundRole ? ROUND_ROLE_INFO[roundRole] : null;

  if (language === 'en') {
    const title = roundRole ? ROLE_TITLES[roundRole].en : 'Interviewer';
    const personaBlock = interviewer
      ? `\n\nYOUR PERSONA:\nYou are ${interviewer.name}, ${title} at ${interviewer.company}.
Personality & interview style: ${interviewer.personality}
You appreciate: ${interviewer.likes}
You dislike: ${interviewer.dislikes}`
      : '';
    const behaviorBlock = archetype ? `\n\nHOW YOU BEHAVE:\n${archetype.behaviorEn}` : '';
    const missionBlock = roleInfo ? `\n\nTHIS ROUND'S MISSION:\n${roleInfo.missionEn}` : '';
    const switchNote = isNewInterviewer && interviewer
      ? `\nYou are a NEW interviewer taking over this round. Reference the previous topic in one sentence WITHOUT evaluating it, briefly introduce yourself (name + company), then ask your first question.`
      : '';

    return `You are conducting a ${typeLabel} for the following position:

${jobDescription}
${personaBlock}${behaviorBlock}${missionBlock}${switchNote}

Rules you MUST follow (this is a REAL interview):
1. Stay fully in character as ${interviewer ? interviewer.name : 'a professional interviewer'} — your persona defines how you speak, probe, and apply pressure.
2. Conduct the interview entirely in English.
3. NEVER evaluate, score, praise, or criticize the candidate's answers. Do not say "good answer", "that's correct", or analyze whether they are right. Real interviewers reveal nothing. You only listen, then based on your persona: probe deeper, demand clarification, or move to the next question.
4. Keep transitions minimal — one or two words in your persona's style ("Mm.", "Okay.", "Go on."), or skip any transition and press on directly if you are the high-pressure type.
5. Ask exactly ONE question per turn. Every question must be anchored in ${interviewer ? interviewer.company : 'the company'}'s actual business and the day-to-day work of this role — ask what a real interviewer at this company would ask. NO generic template questions ("What are your strengths and weaknesses?", "Why do you want to join us?", "Tell me about yourself").
6. Talk like a real person: mostly short sentences; natural fillers ("Mm-hmm.", "I see.", "Right.") and quick interrupting follow-ups are welcome. Plain conversational text only — no headings, no bullet lists, no bracketed markers, no essay structures ("Firstly... Secondly..."), no stacked formalities.
7. Keep each response under 80 words — real interviewers are crisp and never lecture.
8. If the candidate fails twice in a row to get to the point on a topic, drop it decisively and move to the next area — real interviewers don't flog a dead horse.
9. NEVER repeat a question that has already been asked in this interview (including earlier rounds), and do not re-ask the same topic in different wording. Each of your questions must cover NEW ground.`;
  }

  const zhTitle = roundRole ? ROLE_TITLES[roundRole].zh : '面试官';
  const personaBlock = interviewer
    ? `\n\n【你的人设】\n你是 ${interviewer.company} 的${zhTitle} ${interviewer.name}。
性格与面试风格：${interviewer.personality}
你欣赏：${interviewer.likes}
你厌恶：${interviewer.dislikes}`
    : '';
  const behaviorBlock = archetype ? `\n\n【你的行为方式】\n${archetype.behaviorZh}` : '';
  const missionBlock = roleInfo ? `\n\n【本轮任务】\n${roleInfo.missionZh}` : '';
  const switchNote = isNewInterviewer && interviewer
    ? `\n你是本轮新接手的面试官。用一句话提及刚才的话题作为衔接（不作任何评价），简短自我介绍（姓名+公司），然后提出你的第一个问题。`
    : '';

  return `你正在为以下岗位进行一场${typeLabel}：

${jobDescription}
${personaBlock}${behaviorBlock}${missionBlock}${switchNote}

你必须遵守以下规则（这是真实面试）：
1. 完全沉浸在${interviewer ? `「${interviewer.name}」` : '资深面试官'}的角色中，你的性格决定你的说话、追问与施压方式。
2. 全程使用中文进行面试。
3. 【绝对不要】对候选人的回答做任何评价、打分、总结或反馈——不说"答得好""这个思路不错""我认为"之类的话，不分析对错。真实面试官不会透露任何态度。你只做：倾听，然后按你的性格选择追问细节、要求澄清、或直接进入下一个问题。
4. 过渡要极简：用符合你人设的一两个词承接（如"嗯。""好。""继续。"），高压型人设可以不承接直接追问。
5. 每次只问一个问题。提问必须锚定${interviewer ? `「${interviewer.company}」的业务方向` : '该公司业务'}与这个岗位的实际工作场景——问这家公司真实面试官会问的问题，拒绝放之四海皆准的模板题（如"你的优缺点是什么""你为什么想来我们公司""介绍一下你自己"）。
6. 说人话：短句为主，允许自然的语气词（嗯、好、这样啊）和打断式短追问；纯对话文本输出，禁止任何标题、列表、方括号标记，禁止"首先/其次/综上所述"这类书面语结构，禁止客套话堆砌。
7. 每轮回复控制在100字以内——真实面试官说话短促有力，从不长篇大论。
8. 候选人连续两次答不到点上：果断放弃这个话题，转入下一个考察点。真实面试官不会在榨不出内容的问题上纠缠。
9. 严禁重复本场面试中已经问过的问题（包括之前轮次），也不得换种说法重问同一主题，每次提问必须覆盖新的考察点。`;
}

function interviewerPayload(interviewer: Interviewer, round: number, totalRounds: number, role: RoundRole | null, sessionInterviewers?: Interviewer[]) {
  const persona = getPersona(interviewer.id);
  const archetype = ARCHETYPE_PARAMS[persona.archetype];
  return {
    round,
    totalRounds,
    roundRole: role,
    roundRoleLabel: role ? { zh: ROUND_ROLE_INFO[role].labelZh, en: ROUND_ROLE_INFO[role].labelEn } : null,
    // 本轮倒计时（分钟）：按角色差异化——深挖面给足，初筛/终面短促
    timeLimit: role ? ROUND_TIME_LIMIT[role] : 8,
    interviewer: {
      id: interviewer.id,
      name: interviewer.name,
      company: interviewer.company,
      title: role ? { zh: ROLE_TITLES[role].zh, en: ROLE_TITLES[role].en } : null,
      personality: interviewer.personality,
      gender: interviewer.gender,
      voice: getInterviewerVoice(interviewer, sessionInterviewers),
      speechRate: getInterviewerSpeechRate(interviewer),
      archetype: persona.archetype,
      archetypeLabel: { zh: archetype.labelZh, en: archetype.labelEn },
    },
  };
}

export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const body = await request.json();
    const {
      accessCodeId,
      sessionId,
      interviewType,
      jobDescription,
      jobId,
      resumeId,
      answer,
      language = 'zh',
      mode = 'single',
      totalRounds = 1,
      targetCompany,
    } = body;

    if (!accessCodeId) {
      return new Response(JSON.stringify({ error: '未授权的访问' }), { status: 401 });
    }

    const isGauntlet = mode === 'gauntlet' && totalRounds > 1;

    if (!sessionId) {
      // ===== 开始新面试 =====
      if (!interviewType) {
        return new Response(JSON.stringify({ error: '缺少面试类型' }), { status: 400 });
      }

      let jdText = jobDescription || '';
      let selectedJobId: number | null = null;
      let jobCompany = '';
      if (jobId) {
        const { data: job } = await client
          .from('jobs')
          .select('id, title, company, description, requirements')
          .eq('id', jobId)
          .single();
        if (job) {
          selectedJobId = job.id;
          jobCompany = job.company || '';
          jdText = `${job.company} - ${job.title}\n\n${language === 'en' ? 'Job Description' : '岗位描述'}:\n${job.description || ''}\n\n${language === 'en' ? 'Requirements' : '岗位要求'}:\n${job.requirements || ''}`;
        }
      }
      if (!jdText) {
        jdText = language === 'en' ? 'General position (no specific JD provided)' : '通用岗位（未提供具体 JD）';
      }

      // 目标公司：本场所有面试官均来自该公司（画像库仅提供性格参考）
      const company = String(targetCompany || jobCompany || '').trim();
      if (!company) {
        return new Response(JSON.stringify({ error: '缺少目标公司' }), { status: 400 });
      }

      let resumeContext = '';
      if (resumeId) {
        const { data: resume } = await client
          .from('resumes')
          .select('parsed_content, file_name')
          .eq('id', resumeId)
          .eq('access_code_id', accessCodeId)
          .single();
        if (resume?.parsed_content) {
          resumeContext = language === 'en'
            ? `\n\nCandidate's resume:\n${resume.parsed_content}\n\nUse this resume to ask personalized questions about the candidate's specific experiences and projects.`
            : `\n\n候选人简历：\n${resume.parsed_content}\n\n请结合简历中候选人的具体经历和项目进行针对性提问。`;
        }
      }

      // 闯关模式：按剧本角色抽取 N 位面试官；单面模式：随机 1 位
      // 抽出的性格画像全部分配到目标公司（同一场面试所有面试官来自同一家公司）
      const rounds = isGauntlet ? totalRounds : 1;
      const interviewers = (isGauntlet ? selectScriptInterviewers(rounds) : selectRoundInterviewers(rounds))
        .map((it) => assignToCompany(it, company));
      const firstInterviewer = interviewers[0];
      const script = isGauntlet ? GAUNTLET_SCRIPTS[rounds] ?? null : null;
      const firstRole: RoundRole | null = script ? script[0] : null;

      const systemPrompt = buildSystemPrompt(interviewType, jdText + resumeContext, language, firstInterviewer, false, firstRole);
      const llmMessages = [
        { role: 'system' as const, content: systemPrompt },
        {
          role: 'user' as const,
          content: language === 'en'
            ? 'The candidate has arrived. Briefly introduce yourself (name + company) and ask your first interview question.'
            : '候选人已到，请简短自我介绍（姓名+公司）并提出你的第一个面试问题。',
        },
      ];

      const { data: session, error: insertError } = await client
        .from('interview_sessions')
        .insert({
          access_code_id: accessCodeId,
          interview_type: interviewType,
          job_description: jdText,
          job_id: selectedJobId,
          target_company: company,
          messages: [],
          mode: isGauntlet ? 'gauntlet' : 'single',
          total_rounds: rounds,
          current_round: 1,
          interviewer_ids: interviewers.map((i) => i.id),
        })
        .select('id')
        .single();

      if (insertError || !session) {
        return new Response(JSON.stringify({ error: '创建面试会话失败' }), { status: 500 });
      }

      const currentSessionId = session.id;
      const llmClient = new LLMClient(new Config(), HeaderUtils.extractForwardHeaders(request.headers));
      const encoder = new TextEncoder();
      let fullContent = '';

      const readableStream = new ReadableStream({
        async start(controller) {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ sessionId: currentSessionId })}\n\n`));
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ roundStart: true, ...interviewerPayload(firstInterviewer, 1, rounds, firstRole, interviewers) })}\n\n`)
            );

            const stream = llmClient.stream(llmMessages, { temperature: 0.8 });
            for await (const chunk of stream) {
              if (chunk.content) {
                const text = chunk.content.toString();
                fullContent += text;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: text })}\n\n`));
              }
            }

            const newMessages: ChatMessage[] = [
              { role: 'interviewer', content: fullContent, round: 1, interviewerId: firstInterviewer.id, ts: Date.now() },
            ];
            await client
              .from('interview_sessions')
              .update({ messages: newMessages, updated_at: new Date().toISOString() })
              .eq('id', currentSessionId);

            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
            controller.close();
          } catch (error) {
            console.error('Interview stream error:', error);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: '面试生成失败，请重试' })}\n\n`));
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
    }

    // ===== 继续面试 =====
    const { data: session, error: sessionError } = await client
      .from('interview_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('access_code_id', accessCodeId)
      .single();

    if (sessionError || !session) {
      return new Response(JSON.stringify({ error: '面试会话不存在' }), { status: 404 });
    }

    if (session.status !== 'in_progress') {
      return new Response(JSON.stringify({ error: '面试已结束' }), { status: 400 });
    }

    const messages: ChatMessage[] = (session.messages as ChatMessage[]) || [];
    const sessionMode = session.mode || 'single';
    const rounds: number = session.total_rounds || 1;
    const interviewerIds: number[] = (session.interviewer_ids as number[]) || [];
    const currentRound: number = session.current_round || 1;
    const sessionCompany: string = session.target_company || '';

    // 追加候选人回答（归属当前轮）
    const currentInterviewerId = interviewerIds[currentRound - 1] || null;
    messages.push({ role: 'candidate', content: answer, round: currentRound, interviewerId: currentInterviewerId ?? undefined, ts: Date.now() });

    const script = sessionMode === 'gauntlet' ? GAUNTLET_SCRIPTS[rounds] ?? null : null;

    // 判断本轮是否答满题数（闯关模式轮末节点；题数配额按轮次角色差异化：
    // HR 初筛 2 题、业务深挖 3 题、交叉面 2 题、高管终面 1 题）
    const answersThisRound = messages.filter((m) => m.role === 'candidate' && m.round === currentRound).length;
    const currentRole: RoundRole | null = script ? script[currentRound - 1] ?? null : null;
    const questionQuota = currentRole ? ROUND_QUESTION_QUOTA[currentRole] : QUESTIONS_PER_ROUND;
    const reachedRoundEnd =
      sessionMode === 'gauntlet' && answersThisRound >= questionQuota && currentRound < rounds;

    const llmClient = new LLMClient(new Config(), HeaderUtils.extractForwardHeaders(request.headers));

    // 任意环节淘汰判定：每次候选人作答后，面试官都有权单方面立即终止面试（无需等轮末）。
    // 判定基于本场全程对话，默认继续——仅明显不达标才淘汰（见 judgeElimination）
    const eliminated = await judgeElimination(
      llmClient,
      session.job_description || '',
      messages,
      currentRound,
      rounds,
      language
    );
    const shouldSwitch = reachedRoundEnd && !eliminated;
    const nextRound = shouldSwitch ? currentRound + 1 : currentRound;
    const nextInterviewerId = interviewerIds[nextRound - 1] || currentInterviewerId;
    const rawInterviewer =
      INTERVIEWERS.find((i) => i.id === (shouldSwitch ? nextInterviewerId : currentInterviewerId)) || null;
    // 性格画像分配到本场目标公司（兼容无 target_company 的历史会话）
    const activeInterviewer: Interviewer | null =
      rawInterviewer && sessionCompany ? assignToCompany(rawInterviewer, sessionCompany) : rawInterviewer;

    const activeRole: RoundRole | null = script ? script[nextRound - 1] ?? null : null;

    let systemPrompt = buildSystemPrompt(
      session.interview_type,
      session.job_description || '',
      language,
      activeInterviewer,
      shouldSwitch,
      activeRole
    );
    if (eliminated) {
      // 淘汰：以面试官人设体面收尾，不评价、不说明理由、不再提问
      systemPrompt += language === 'en'
        ? `\n\nIMPORTANT: You have decided to end this interview early — the candidate's performance in your round did not meet the bar. In your persona's tone, wrap up gracefully in 2-3 sentences (e.g. "That's all for today. Thank you for your time — our HR will be in touch about next steps."). Do NOT evaluate their performance, do NOT give reasons, and do NOT ask any more questions.`
        : `\n\n【重要】你已决定提前结束本场面试——候选人在本轮的表现未达到通过标准。用你人设的语气，2-3 句话体面收尾（例如"今天的面试就到这里，感谢你的时间，后续 HR 会与你联系"）。不要评价表现，不要说明理由，不要再提问。`;
    }

    // 构建 LLM 消息历史（保留最近 30 条，控制上下文）
    const llmMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];
    const recent = messages.slice(-30);
    for (const msg of recent) {
      llmMessages.push({
        role: msg.role === 'interviewer' ? 'assistant' : 'user',
        content: msg.content,
      });
    }

    // 全量已问问题清单：历史窗口可能截断早期对话，显式列出防止重复提问
    const askedQuestions = messages
      .filter((m) => m.role === 'interviewer')
      .map((m, i) => `${i + 1}. ${m.content}`)
      .join('\n');
    const noRepeatNote = language === 'en'
      ? `\n\nQuestions already asked (including previous rounds). Do NOT repeat them or re-ask the same topic in different wording — but you MAY probe details the candidate just mentioned:\n${askedQuestions}`
      : `\n\n【已问过的问题（含之前轮次）】禁止重复提问或换种说法重问同一主题；但可以针对候选人刚才回答中未展开的细节追问：\n${askedQuestions}`;

    llmMessages.push({
      role: 'user',
      content: eliminated
        ? (language === 'en'
            ? 'The candidate has finished answering. Now close the interview in character — no more questions.'
            : '候选人已作答完毕。请以你的人设结束本场面试，不要再提问。')
        : shouldSwitch
        ? (language === 'en'
            ? 'The previous round is over. You are the new interviewer for the next round — begin now.'
            : '上一轮已结束，你是下一轮的新面试官，请开始。') + noRepeatNote
        : (language === 'en'
            ? 'The candidate has answered. Continue the interview in character — probe deeper or ask your next question. Do NOT evaluate the answer.'
            : '候选人已回答。请以你的人设继续面试——追问细节或提出下一个问题，不要评价回答。') + noRepeatNote,
    });

    const encoder = new TextEncoder();
    let fullContent = '';

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          if (activeInterviewer) {
            // 每次回复都携带面试官信息（含场次去重后的音色与语速）——
            // 否则同轮追问时前端拿不到音色，TTS 会回落默认音色导致"同一面试官声音不停变"
            const sessionInterviewers = interviewerIds
              .map((id) => INTERVIEWERS.find((i) => i.id === id))
              .filter((i): i is Interviewer => Boolean(i));
            const payload = interviewerPayload(activeInterviewer, nextRound, rounds, activeRole, sessionInterviewers);
            if (eliminated) {
              // 淘汰帧：前端收到后展示"面试提前结束"并自动进入评估流程（不发 roundStart，避免误触发轮间等待）
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ eliminated: true, round: currentRound, interviewer: payload.interviewer })}\n\n`)
              );
            } else if (shouldSwitch) {
              // 轮次切换帧
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ roundStart: true, ...payload })}\n\n`)
              );
            } else {
              // 同轮追问帧：仅携带面试官信息，刷新音色/语速
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ interviewer: payload.interviewer })}\n\n`)
              );
            }
          }

          const stream = llmClient.stream(llmMessages, { temperature: 0.8 });
          for await (const chunk of stream) {
            if (chunk.content) {
              const text = chunk.content.toString();
              fullContent += text;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: text })}\n\n`));
            }
          }

          const newMessages: ChatMessage[] = [
            ...messages,
            {
              role: 'interviewer',
              content: fullContent,
              round: nextRound,
              interviewerId: activeInterviewer?.id,
              ts: Date.now(),
            },
          ];
          await client
            .from('interview_sessions')
            .update({
              messages: newMessages,
              current_round: nextRound,
              // 淘汰即结束：直接标记完成，后续评估流程只读
              ...(eliminated ? { status: 'completed' } : {}),
              updated_at: new Date().toISOString(),
            })
            .eq('id', sessionId);

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
          controller.close();
        } catch (error) {
          console.error('Interview stream error:', error);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: '面试生成失败，请重试' })}\n\n`));
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
    console.error('Interview chat error:', error);
    return new Response(JSON.stringify({ error: '服务器错误' }), { status: 500 });
  }
}

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
5. Ask exactly ONE question per turn, realistic for this role and the job description.
6. Plain conversational text only. No headings, no bullet lists, no bracketed markers like [Question]. Speak like a real person.
7. Keep each response under 120 words.`;
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
5. 每次只问一个问题，问题要贴合该岗位的真实面试场景。
6. 纯对话文本输出，禁止任何标题、列表、方括号标记（如[提问]）。像真人说话一样。
7. 每轮回复控制在150字以内。`;
}

function interviewerPayload(interviewer: Interviewer, round: number, totalRounds: number, role: RoundRole | null) {
  const persona = getPersona(interviewer.id);
  const archetype = ARCHETYPE_PARAMS[persona.archetype];
  return {
    round,
    totalRounds,
    roundRole: role,
    roundRoleLabel: role ? { zh: ROUND_ROLE_INFO[role].labelZh, en: ROUND_ROLE_INFO[role].labelEn } : null,
    interviewer: {
      id: interviewer.id,
      name: interviewer.name,
      company: interviewer.company,
      title: role ? { zh: ROLE_TITLES[role].zh, en: ROLE_TITLES[role].en } : null,
      personality: interviewer.personality,
      gender: interviewer.gender,
      voice: getInterviewerVoice(interviewer),
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
              encoder.encode(`data: ${JSON.stringify({ roundStart: true, ...interviewerPayload(firstInterviewer, 1, rounds, firstRole) })}\n\n`)
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

    // 判断是否需要切换到下一面试官
    const answersThisRound = messages.filter((m) => m.role === 'candidate' && m.round === currentRound).length;
    const shouldSwitch =
      sessionMode === 'gauntlet' && answersThisRound >= QUESTIONS_PER_ROUND && currentRound < rounds;
    const nextRound = shouldSwitch ? currentRound + 1 : currentRound;
    const nextInterviewerId = interviewerIds[nextRound - 1] || currentInterviewerId;
    const rawInterviewer =
      INTERVIEWERS.find((i) => i.id === (shouldSwitch ? nextInterviewerId : currentInterviewerId)) || null;
    // 性格画像分配到本场目标公司（兼容无 target_company 的历史会话）
    const activeInterviewer: Interviewer | null =
      rawInterviewer && sessionCompany ? assignToCompany(rawInterviewer, sessionCompany) : rawInterviewer;

    const script = sessionMode === 'gauntlet' ? GAUNTLET_SCRIPTS[rounds] ?? null : null;
    const activeRole: RoundRole | null = script ? script[nextRound - 1] ?? null : null;

    const systemPrompt = buildSystemPrompt(
      session.interview_type,
      session.job_description || '',
      language,
      activeInterviewer,
      shouldSwitch,
      activeRole
    );

    // 构建 LLM 消息历史（仅保留最近 12 条，控制上下文）
    const llmMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];
    const recent = messages.slice(-12);
    for (const msg of recent) {
      llmMessages.push({
        role: msg.role === 'interviewer' ? 'assistant' : 'user',
        content: msg.content,
      });
    }
    llmMessages.push({
      role: 'user',
      content: shouldSwitch
        ? (language === 'en'
            ? 'The previous round is over. You are the new interviewer for the next round — begin now.'
            : '上一轮已结束，你是下一轮的新面试官，请开始。')
        : (language === 'en'
            ? 'The candidate has answered. Continue the interview in character — probe deeper or ask your next question. Do NOT evaluate the answer.'
            : '候选人已回答。请以你的人设继续面试——追问细节或提出下一个问题，不要评价回答。'),
    });

    const llmClient = new LLMClient(new Config(), HeaderUtils.extractForwardHeaders(request.headers));
    const encoder = new TextEncoder();
    let fullContent = '';

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          // 切换轮次时先发送 roundStart 事件
          if (shouldSwitch && activeInterviewer) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ roundStart: true, ...interviewerPayload(activeInterviewer, nextRound, rounds, activeRole) })}\n\n`)
            );
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

import { NextRequest } from 'next/server';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { buildDNABlock } from '@/lib/company-dna';
import { getCompanyDNA } from '@/lib/company-dna-service';
import { buildSegmentBlock, type UserSegmentation } from '@/lib/user-segmentation';
import { buildRegionBlock } from '@/lib/region-dna';

// 分层标尺块：候选人分层（评估标尺）+ 目标地区招聘逻辑（地区为分层第一权重）
function buildSegmentationBlock(seg: UserSegmentation | null | undefined, language: string): string {
  if (!seg) return '';
  const lang = language === 'en' ? 'en' as const : 'zh' as const;
  const parts = [buildSegmentBlock(seg, lang)];
  const region = seg.regions?.[0];
  if (region) parts.push(buildRegionBlock(region, lang));
  return parts.join('\n\n');
}
import {
  INTERVIEWERS,
  selectRoundInterviewers,
  selectScriptInterviewers,
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
import { getInterviewerVoiceConfig, type VoiceLanguage } from '@/lib/voice-config';

interface ChatMessage {
  role: 'interviewer' | 'candidate';
  content: string;
  round?: number;
  interviewerId?: number;
  ts?: number; // 消息时间戳（毫秒），用于统计反应速度
}

const QUESTIONS_PER_ROUND = 2;

// ===== 面试官节奏控制标记协议 =====
// 面试官（LLM）在回复最后一行输出标记来自主推进面试：
// [ROUND_END] 本轮考察足够（切换下一面试官）；[ELIMINATE] 单方面终止面试（淘汰）；
// [WRAP_UP] 整场面试自然结束（最后一轮/单面可用）。候选人在前端看不到这些标记。
type ControlMarker = 'round_end' | 'eliminate' | 'wrap_up';

// 流式安全分割：把"可能是控制标记（或其前缀）"的尾部扣下不发，其余内容立即下发。
// 面试官可能输出协议标记 [ROUND_END]/[ELIMINATE]/[WRAP_UP]，也可能自创其他大写方括号标记（如 [WAIT]）——
// 两者都必须对候选人不可见：完整标记在此直接剥离（语义记入 markerState），疑似未闭合前缀扣住等待更多数据。
function splitMarkerSafe(pending: string, markerState: { marker: ControlMarker | null }): [string, string] {
  // 剥离完整的大写方括号标记（>=2 字符，避免误吞正文中的单字母选项如 [A]）；未知标记同样吞掉不泄漏
  const stripped = pending.replace(/\[([A-Z_]{2,})\]/g, (_m, name: string) => {
    if (name === 'ROUND_END') markerState.marker = 'round_end';
    else if (name === 'ELIMINATE') markerState.marker = 'eliminate';
    else if (name === 'WRAP_UP') markerState.marker = 'wrap_up';
    return '';
  });
  const idx = stripped.lastIndexOf('[');
  if (idx === -1) return [stripped, ''];
  const tail = stripped.slice(idx);
  // 尾部若是未闭合的疑似标记前缀（"[", "[W", "[ROUND_EN"…），扣住等更多数据再判断
  if (/^\[[A-Z_]*$/.test(tail)) return [stripped.slice(0, idx), tail];
  return [stripped, ''];
}

// 流末清理：pendingTail 只剩未闭合残片（如 "[ROUND_EN"），无法判断语义，剥离丢弃
function cleanTail(pending: string): string {
  return pending.replace(/\[[A-Z_]*$/, '').trimEnd();
}

// 各角色轮次的参考节奏（写进 prompt 供面试官参考，不再是机械硬约束）
const PACE_HINTS: Record<RoundRole, string> = {
  screener: '2-3',
  griller: '4-5',
  cross: '2-3',
  executive: '1-2',
};

const TYPE_LABELS: Record<string, { zh: string; en: string }> = {
  technical: { zh: '技术面试', en: 'Technical Interview' },
  behavioral: { zh: '行为面试', en: 'Behavioral Interview' },
  case: { zh: '案例面试', en: 'Case Interview' },
  mixed: { zh: '综合面试', en: 'Mixed Interview' },
};

function inferInterviewType(jd: string): string {
  const text = jd.toLowerCase();
  if (/(consulting|case study|case interview|strategy|business analysis|咨询|案例分析|案例面试|战略|商业分析|management consulting)/.test(text)) {
    return 'case';
  }
  if (/(engineer|software|developer|data|infrastructure|algorithm|python|java|sql|cloud|前端|后端|工程师|开发|算法|数据|技术|架构)/.test(text)) {
    return 'technical';
  }
  if (/(leadership|communication|teamwork|collaboration|领导力|沟通|团队|协作)/.test(text)) {
    return 'behavioral';
  }
  return 'mixed';
}

function buildSystemPrompt(
  interviewType: string,
  jobDescription: string,
  language: string,
  interviewer: Interviewer | null,
  isNewInterviewer: boolean,
  roundRole: RoundRole | null,
  isLastRound: boolean,
  dnaBlock = '',
  segmentBlock = ''
) {
  const typeLabel = TYPE_LABELS[interviewType]?.[language === 'en' ? 'en' : 'zh'] || interviewType;
  const persona = interviewer ? getPersona(interviewer.id) : null;
  const archetype = persona ? ARCHETYPE_PARAMS[persona.archetype] : null;
  const roleInfo = roundRole ? ROUND_ROLE_INFO[roundRole] : null;
  const dnaSection = dnaBlock ? `\n\n${dnaBlock}` : '';
  const segmentSection = segmentBlock ? `\n\n${segmentBlock}` : '';

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
    const speechBlock = roleInfo ? `\n\nSPEECH SIGNATURE:\n${roleInfo.speechEn}` : '';
    const switchNote = isNewInterviewer && interviewer
      ? `\nYou are a NEW interviewer taking over this round. Reference the previous topic in one sentence WITHOUT evaluating it, briefly introduce yourself (name + company), then ask your first question.`
      : '';

    return `You are conducting a ${typeLabel} for the following position:

${jobDescription}${dnaSection}${segmentSection}
${personaBlock}${behaviorBlock}${missionBlock}${speechBlock}${switchNote}

Rules you MUST follow (this is a REAL interview):
1. Stay fully in character as ${interviewer ? interviewer.name : 'a professional interviewer'} — your persona defines how you speak, probe, and apply pressure.
2. Conduct the interview entirely in English.${dnaBlock ? '\n2.5 The COMPANY INTERVIEW DNA block above (written in Chinese) is your highest-priority behavioral instruction: your questions, follow-ups, pacing and angles MUST embody it. Never produce a generic interview that merely wears this company\'s name.' : ''}${segmentBlock ? '\n2.6 The CANDIDATE SEGMENTATION block calibrates your evaluation bar: a junior (pre-internship) candidate, a new-grad and an experienced hire are judged by DIFFERENT standards — adjust question difficulty, probing depth and what counts as a satisfying answer accordingly. Never apply one-size-fits-all expectations.' : ''}
3. NEVER evaluate, score, praise, or criticize the candidate's answers. Do not say "good answer", "that's correct", or analyze whether they are right. Real interviewers reveal nothing. You only listen, then based on your persona: probe deeper, demand clarification, or move to the next question.
4. Keep transitions minimal — one or two words in your persona's style ("Mm.", "Okay.", "Go on."), or skip any transition and press on directly if you are the high-pressure type.
5. Ask exactly ONE question per turn. Every question must be anchored in ${interviewer ? interviewer.company : 'the company'}'s actual business and the day-to-day work of this role — ask what a real interviewer at this company would ask. NO generic template questions ("What are your strengths and weaknesses?", "Why do you want to join us?", "Tell me about yourself").
6. Talk like a real person: mostly short sentences; natural fillers ("Mm-hmm.", "I see.", "Right.") and quick interrupting follow-ups are welcome. Plain conversational text only — no headings, no bullet lists, no bracketed markers, no essay structures ("Firstly... Secondly..."), no stacked formalities.
7. Keep each response under 80 words — real interviewers are crisp and never lecture.
8. If the candidate fails twice in a row to get to the point on a topic, drop it decisively and move to the next area — real interviewers don't flog a dead horse.
9. NEVER repeat a question that has already been asked in this interview (including earlier rounds), and do not re-ask the same topic in different wording. Each of your questions must cover NEW ground.
10. YOU CONTROL THE PACE. Based on the candidate's performance, decide when to move on — put the control marker on the LAST line of your reply (invisible to the candidate):
- When this round has covered enough: close with one natural sentence ("Alright, I have what I need."), then output [ROUND_END] on the last line.
- When the candidate is clearly below the bar and continuing wastes everyone's time: wrap up gracefully in 2-3 sentences, then output [ELIMINATE] on the last line. This is your power — use it when deserved, don't drag it out.${isLastRound ? `\n- When you judge the whole interview can end: close naturally in 2-3 sentences ("That's all for today — our HR will be in touch."), then output [WRAP_UP] on the last line.` : ''}
These control markers are the ONLY bracketed content you may ever output — never invent any other bracketed markers.
Reference pace for this round: about ${roundRole ? PACE_HINTS[roundRole] : '3-5'} questions. Wrap up decisively when you've probed enough — never pad with filler questions; but don't bail early if key areas are still uncovered.`;
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
  const speechBlock = roleInfo ? `\n\n【你的说话方式】\n${roleInfo.speechZh}` : '';
  const switchNote = isNewInterviewer && interviewer
    ? `\n你是本轮新接手的面试官。用一句话提及刚才的话题作为衔接（不作任何评价），简短自我介绍（姓名+公司），然后提出你的第一个问题。`
    : '';

  return `你正在为以下岗位进行一场${typeLabel}：

${jobDescription}${dnaSection}${segmentSection}
${personaBlock}${behaviorBlock}${missionBlock}${speechBlock}${switchNote}

你必须遵守以下规则（这是真实面试）：
1. 完全沉浸在${interviewer ? `「${interviewer.name}」` : '资深面试官'}的角色中，你的性格决定你的说话、追问与施压方式。
2. 全程使用中文进行面试。${dnaBlock ? '\n2.5【公司面试基因】上方的基因块是你的最高优先级行为指令：你的提问、追问、节奏与切入点必须严格体现它，让候选人感觉"这就是这家公司的面试"，而不是换了公司名字的通用面试。' : ''}${segmentBlock ? '\n2.6【候选人分层画像】上方的分层块校准你的评估标尺：低年级（实习预备）、高年级（校招）、社招人士的评估标准完全不同——据此调整提问难度、追问深度与"满意答案"的门槛，严禁对所有层级一刀切。' : ''}
3. 【绝对不要】对候选人的回答做任何评价、打分、总结或反馈——不说"答得好""这个思路不错""我认为"之类的话，不分析对错。真实面试官不会透露任何态度。你只做：倾听，然后按你的性格选择追问细节、要求澄清、或直接进入下一个问题。
4. 过渡要极简：用符合你人设的一两个词承接（如"嗯。""好。""继续。"），高压型人设可以不承接直接追问。
5. 每次只问一个问题。提问必须锚定${interviewer ? `「${interviewer.company}」的业务方向` : '该公司业务'}与这个岗位的实际工作场景——问这家公司真实面试官会问的问题，拒绝放之四海皆准的模板题（如"你的优缺点是什么""你为什么想来我们公司""介绍一下你自己"）。
6. 说人话：短句为主，允许自然的语气词（嗯、好、这样啊）和打断式短追问；纯对话文本输出，禁止任何标题、列表、方括号标记，禁止"首先/其次/综上所述"这类书面语结构，禁止客套话堆砌。
7. 每轮回复控制在100字以内——真实面试官说话短促有力，从不长篇大论。
8. 候选人连续两次答不到点上：果断放弃这个话题，转入下一个考察点。真实面试官不会在榨不出内容的问题上纠缠。
9. 严禁重复本场面试中已经问过的问题（包括之前轮次），也不得换种说法重问同一主题，每次提问必须覆盖新的考察点。
10.【节奏由你掌控】根据候选人的表现自主决定何时推进——把控制标记放在回复的【最后一行】（候选人看不到标记）：
- 本轮考察已足够：用一句话自然收尾（如"好，我这边了解得差不多了"），最后一行输出 [ROUND_END]
- 候选人明显不达标、继续只是浪费时间：用 2-3 句话体面结束，最后一行输出 [ELIMINATE]——这是你的权力，该用就用，不要硬撑${isLastRound ? '\n- 你认为整场面试可以结束时：用 2-3 句话自然收尾（如"今天就到这里，后续 HR 会与你联系"），最后一行输出 [WRAP_UP]' : ''}
除上述控制标记外，严禁输出任何其他方括号内容，不要自创标记。
本轮参考节奏：一般 ${roundRole ? PACE_HINTS[roundRole] : '3-5'} 个问题左右收尾。聊透了就果断结束，不为凑数而追问；关键考察点没覆盖到就继续，不草率收场。`;
}

function interviewerPayload(
  interviewer: Interviewer,
  round: number,
  totalRounds: number,
  role: RoundRole | null,
  language: VoiceLanguage,
  sessionInterviewers?: Interviewer[]
) {
  const persona = getPersona(interviewer.id);
  const archetype = ARCHETYPE_PARAMS[persona.archetype];
  const voiceConfig = getInterviewerVoiceConfig(interviewer, language, sessionInterviewers);
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
      voice: voiceConfig.voice,
      speechRate: voiceConfig.speechRate,
      loudnessRate: voiceConfig.loudnessRate,
      pauseMs: voiceConfig.pauseMs,
      archetype: persona.archetype,
      archetypeLabel: { zh: archetype.labelZh, en: archetype.labelEn },
    },
  };
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const body = await request.json();
    const {
      sessionId,
      jobDescription,
      jobId,
      resumeId,
      answer,
      language = 'zh',
      mode = 'single',
      totalRounds = 1,
      targetCompany,
      timeout = false,
    } = body;

    const isGauntlet = mode === 'gauntlet' && totalRounds > 1;

    if (!sessionId) {
      // ===== 开始新面试 =====
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
      const interviewType = inferInterviewType(jdText);

      // 目标公司：本场所有面试官均来自该公司（画像库仅提供性格参考）
      const company = String(targetCompany || jobCompany || '').trim();
      if (!company) {
        return new Response(JSON.stringify({ error: '缺少目标公司' }), { status: 400 });
      }

      let resumeContext = '';
      let resumeSegmentation: UserSegmentation | null = null;
      if (resumeId) {
        const { data: resume } = await client
          .from('resumes')
          .select('parsed_content, file_name, segmentation')
          .eq('id', resumeId)
          .eq('user_id', auth.user.id)
          .single();
        if (resume?.parsed_content) {
          resumeContext = language === 'en'
            ? `\n\nCandidate's resume:\n${resume.parsed_content}\n\nUse this resume to ask personalized questions about the candidate's specific experiences and projects.`
            : `\n\n候选人简历：\n${resume.parsed_content}\n\n请结合简历中候选人的具体经历和项目进行针对性提问。`;
        }
        resumeSegmentation = (resume?.segmentation as UserSegmentation | null) ?? null;
      }

      // 闯关模式：按剧本角色抽取 N 位面试官；单面模式：随机 1 位
      // 抽出的性格画像全部分配到目标公司（同一场面试所有面试官来自同一家公司）
      const rounds = isGauntlet ? totalRounds : 1;
      const interviewers = (isGauntlet ? selectScriptInterviewers(rounds) : selectRoundInterviewers(rounds))
        .map((it) => assignToCompany(it, company));
      const firstInterviewer = interviewers[0];
      const script = isGauntlet ? GAUNTLET_SCRIPTS[rounds] ?? null : null;
      const firstRole: RoundRole | null = script ? script[0] : null;

      const dnaResult = await getCompanyDNA(company, request.headers).catch(() => null);
      const dnaBlock = dnaResult ? buildDNABlock(dnaResult.dna) : '';
      const segmentBlock = buildSegmentationBlock(resumeSegmentation, language);
      const systemPrompt = buildSystemPrompt(interviewType, jdText + resumeContext, language, firstInterviewer, false, firstRole, rounds === 1, dnaBlock, segmentBlock);
      const llmMessages = [
        { role: 'system' as const, content: systemPrompt },
        {
          role: 'user' as const,
          content: language === 'en'
            ? 'The candidate has arrived. Briefly introduce yourself (name + company) and ask your first interview question. Do NOT output any control markers — the interview has just begun.'
            : '候选人已到，请简短自我介绍（姓名+公司）并提出你的第一个面试问题。本场面试刚刚开始，不要输出任何控制标记。',
        },
      ];

      const { data: session, error: insertError } = await client
        .from('interview_sessions')
        .insert({
          user_id: auth.user.id,
          interview_type: interviewType,
          job_description: jdText,
          job_id: selectedJobId,
          target_company: company,
          messages: [],
          mode: isGauntlet ? 'gauntlet' : 'single',
          total_rounds: rounds,
          current_round: 1,
          interviewer_ids: interviewers.map((i) => i.id),
          resume_id: resumeId ? Number(resumeId) : null,
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
              encoder.encode(`data: ${JSON.stringify({ roundStart: true, ...interviewerPayload(firstInterviewer, 1, rounds, firstRole, language === 'en' ? 'en' : 'zh', interviewers) })}\n\n`)
            );

            const stream = llmClient.stream(llmMessages, { temperature: 0.8 });
            // 流式输出：剥离控制标记（开场白阶段不存在合法标记，一律过滤丢弃）
            let pendingTail = '';
            const openingMarkerState: { marker: ControlMarker | null } = { marker: null };
            for await (const chunk of stream) {
              if (chunk.content) {
                pendingTail += chunk.content.toString();
                const [emit, rest] = splitMarkerSafe(pendingTail, openingMarkerState);
                pendingTail = rest;
                if (emit) {
                  fullContent += emit;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: emit })}\n\n`));
                }
              }
            }
            const openingTail = cleanTail(pendingTail);
            if (openingTail) {
              fullContent += openingTail;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: openingTail })}\n\n`));
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
      .eq('user_id', auth.user.id)
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

    const currentInterviewerId = interviewerIds[currentRound - 1] || null;
    // switchNext：上一轮面试官主动收尾（[ROUND_END]）后，前端请求下一位面试官开场——无候选人新回答
    const isSwitchNext = body.switchNext === true;
    const isTimeout = timeout === true && !isSwitchNext;
    if (!isSwitchNext && !isTimeout) {
      if (!answer || !String(answer).trim()) {
        return new Response(JSON.stringify({ error: '缺少回答内容' }), { status: 400 });
      }
      // 追加候选人回答（归属当前轮）
      messages.push({ role: 'candidate', content: String(answer), round: currentRound, interviewerId: currentInterviewerId ?? undefined, ts: Date.now() });
    }

    const script = sessionMode === 'gauntlet' ? GAUNTLET_SCRIPTS[rounds] ?? null : null;
    const llmClient = new LLMClient(new Config(), HeaderUtils.extractForwardHeaders(request.headers));

    // 面试官自主掌控节奏：淘汰、轮末收尾、整场结束全部由面试官（LLM）通过
    // 标记协议决定——不再有机械题数切换，也没有独立于面试官人格的淘汰裁判
    const rawInterviewer = INTERVIEWERS.find((i) => i.id === currentInterviewerId) || null;
    // 性格画像分配到本场目标公司（兼容无 target_company 的历史会话）
    const activeInterviewer: Interviewer | null =
      rawInterviewer && sessionCompany ? assignToCompany(rawInterviewer, sessionCompany) : rawInterviewer;

    const activeRole: RoundRole | null = script ? script[currentRound - 1] ?? null : null;
    const isLastRound = currentRound >= rounds;

    // 企业面试基因：每次回复都注入（精调/缓存秒回，生成的公司已写回缓存）
    const dnaResult = sessionCompany ? await getCompanyDNA(sessionCompany, request.headers).catch(() => null) : null;
    const dnaBlock = dnaResult ? buildDNABlock(dnaResult.dna) : '';
    // 候选人分层标尺：从会话关联简历读取（与新会话路径保持同一评估标尺）
    let resumeSegmentation: UserSegmentation | null = null;
    if (session.resume_id) {
      const { data: resume } = await client
        .from('resumes')
        .select('segmentation')
        .eq('id', session.resume_id)
        .single();
      resumeSegmentation = (resume?.segmentation as UserSegmentation | null) ?? null;
    }
    const segmentBlock = buildSegmentationBlock(resumeSegmentation, language);
    const systemPrompt = buildSystemPrompt(
      session.interview_type,
      session.job_description || '',
      language,
      activeInterviewer,
      isSwitchNext,
      activeRole,
      isLastRound,
      dnaBlock,
      segmentBlock
    );

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

    // 兜底催促：超出参考节奏仍未主动收尾时，强制要求本条回复收尾（防失控，正常不会触发）
    const answersThisRound = messages.filter((m) => m.role === 'candidate' && m.round === currentRound).length;
    const questionQuota = activeRole ? ROUND_QUESTION_QUOTA[activeRole] : QUESTIONS_PER_ROUND + 1;
    const overdueNote = !isSwitchNext && !isTimeout && answersThisRound > questionQuota
      ? (language === 'en'
          ? `\n\n[System note] This round is running way over pace. You MUST wrap up in this reply and put ${isLastRound ? '[WRAP_UP]' : '[ROUND_END]'} on the last line.`
          : `\n\n【系统提示】本轮已明显超出参考节奏，你必须在本次回复中收尾，并在最后一行输出 ${isLastRound ? '[WRAP_UP]' : '[ROUND_END]'}。`)
      : '';
    const timeoutNote = isTimeout
      ? (language === 'en'
          ? `The time for this stage is almost up. Do NOT ask a new question. Close the stage naturally in this reply and put ${isLastRound ? '[WRAP_UP]' : '[ROUND_END]'} on the last line.`
          : `本阶段时间即将结束。不要再提出新问题，请在本条回复中用一句自然的话收尾，并在最后一行输出 ${isLastRound ? '[WRAP_UP]' : '[ROUND_END]'}。`)
      : '';

    // 防御：switchNext 正常只在上轮 [ROUND_END] 后触发（轮次已推进）；若本轮面试官已开过场
    // （异常时序/重试），用"继续"文案避免重复自我介绍与重复提问
    const hasOpeningThisRound = messages.some((m) => m.role === 'interviewer' && m.round === currentRound);
    llmMessages.push({
      role: 'user',
      content: isSwitchNext
        ? (hasOpeningThisRound
            ? (language === 'en'
                ? 'Continue the interview — ask your next question (you have already introduced yourself).'
                : '请继续面试，提出你的下一个问题（你已做过自我介绍，不要重复）。')
            : (language === 'en'
                ? 'The previous round is over. You are the new interviewer for this round — begin now. This round has just started; do NOT output any control markers yet.'
                : '上一轮已结束，你是本轮新接手的面试官，请开始。本轮刚刚开始，不要输出任何控制标记。')) + noRepeatNote
        : isTimeout
          ? timeoutNote
          : (language === 'en'
              ? 'The candidate has answered. Continue in character — probe deeper, ask your next question, or close out per your pace control (marker on the last line). Do NOT evaluate the answer.'
              : '候选人已回答。请以你的人设继续面试——追问细节、提出下一个问题，或按你的节奏判断收尾（标记放在最后一行）。不要评价回答。') + noRepeatNote + overdueNote,
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
            const payload = interviewerPayload(activeInterviewer, currentRound, rounds, activeRole, language === 'en' ? 'en' : 'zh', sessionInterviewers);
            if (isSwitchNext) {
              // 下一位面试官开场帧（round > 1 时前端触发轮间等待，开场内容后台累积）
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ roundStart: true, ...payload })}\n\n`)
              );
            } else {
              // 同轮帧：仅携带面试官信息，刷新音色/语速
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ interviewer: payload.interviewer })}\n\n`)
              );
            }
          }

          // 流式输出：剥离控制标记（[ROUND_END]/[ELIMINATE]/[WRAP_UP] 及 LLM 自创的同类标记），候选人永远看不到
          let pendingTail = '';
          const markerState: { marker: ControlMarker | null } = { marker: null };
          const stream = llmClient.stream(llmMessages, { temperature: 0.8 });
          for await (const chunk of stream) {
            if (chunk.content) {
              pendingTail += chunk.content.toString();
              const [emit, rest] = splitMarkerSafe(pendingTail, markerState);
              pendingTail = rest;
              if (emit) {
                fullContent += emit;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: emit })}\n\n`));
              }
            }
          }

          // 流结束：补发尾部正文残片，确定面试官的节奏决定
          const tailText = cleanTail(pendingTail);
          if (tailText) {
            fullContent += tailText;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: tailText })}\n\n`));
          }
          // 防御：最后一轮输出 [ROUND_END] 等同于整场结束
          const finalMarker: ControlMarker | null =
            markerState.marker === 'round_end' && isLastRound ? 'wrap_up' : markerState.marker;

          const newMessages: ChatMessage[] = [...messages];
          if (fullContent.trim()) {
            newMessages.push({
              role: 'interviewer',
              content: fullContent,
              round: currentRound,
              interviewerId: activeInterviewer?.id,
              ts: Date.now(),
            });
          }
          await client
            .from('interview_sessions')
            .update({
              messages: newMessages,
              // 本轮自然结束：轮次推进，下一位面试官待开场
              current_round: finalMarker === 'round_end' ? currentRound + 1 : currentRound,
              // 淘汰/整场结束：会话完成，后续评估流程只读
              ...(finalMarker === 'eliminate' || finalMarker === 'wrap_up' ? { status: 'completed' } : {}),
              updated_at: new Date().toISOString(),
            })
            .eq('id', sessionId);

          // 节奏事件帧（done 之前下发，前端据此自动衔接下一面试官或进入评估）
          if (finalMarker === 'round_end') {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ roundEnd: true, round: currentRound })}\n\n`));
          } else if (finalMarker === 'eliminate') {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ eliminated: true, round: currentRound })}\n\n`));
          } else if (finalMarker === 'wrap_up') {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ wrapUp: true })}\n\n`));
          }
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

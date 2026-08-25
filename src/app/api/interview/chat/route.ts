import { NextRequest } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { consumeAuthRateLimit } from '@/lib/auth-security';
import { createTextProviderClient } from '@/lib/ai/text-provider';
import { consumeTrackedTextStream } from '@/lib/ai-usage';
import { betaEntitlementResponse } from '@/lib/beta-entitlements';
import { buildDNABlock, type CompanyDNA } from '@/lib/company-dna';
import { getCompanyDNA } from '@/lib/company-dna-service';
import { buildSegmentBlock, type UserSegmentation } from '@/lib/user-segmentation';
import { buildRegionBlock } from '@/lib/region-dna';
import { requireConfirmedResume } from '@/lib/resume-access';
import {
  buildQuestionHistoryNote,
  createInterviewSessionSeed,
  getRecentInterviewQuestions,
  hashInterviewQuestion,
  hashInterviewSnapshot,
  classifyInterviewQuestion,
  type PracticeMode,
} from '@/lib/interview-question-history';

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
import { resolveInterviewCompanyContext } from '@/lib/interview-company-context';
import {
  advanceInterviewFactLedger,
  buildInterviewContextDigest,
  buildInterviewMemoryPrompt,
  emptyInterviewFactLedger,
  parseInterviewContextDigest,
  parseInterviewFactLedger,
} from '@/lib/interview-context-memory';
import { interviewChatRequestSchema } from '@/lib/interview-chat-validation';
import { createSseEvent } from '@/lib/interview-contracts';
import { untrustedBusinessDataBlock, untrustedBusinessDataPolicy } from '@/lib/prompt-safety';
import { targetRegionPostgrestClauses } from '@/lib/job-region-scope';
import { buildInterviewTurnPlanPrompt, verifyInterviewTurnPlan } from '@/lib/interview-turn-plan';
import { getAppendedInterviewTurns } from '@/lib/interview-turn-commit';
import {
  buildInterviewRoundClosing,
  decideInterviewTurnAction,
} from '@/lib/interview-round-flow';
import { shouldEndInterviewEarly } from '@/lib/interview-answer-quality';
import { resolveInterviewVoiceRoute } from '@/lib/interview-voice-routing';

interface ChatMessage {
  role: 'interviewer' | 'candidate';
  content: string;
  questionHash?: string;
  round?: number;
  interviewerId?: number;
  ts?: number; // 消息时间戳（毫秒），用于统计反应速度
}

const QUESTIONS_PER_ROUND = 2;
const COMPANY_DNA_LOOKUP_TIMEOUT_MS = 650;
const INTERVIEW_JOB_CONTEXT_MAX_CHARS = 4_500;
const INTERVIEW_RESUME_CONTEXT_MAX_CHARS = 4_500;
const INTERVIEW_DNA_CONTEXT_MAX_CHARS = 2_200;
const INTERVIEW_SEGMENT_CONTEXT_MAX_CHARS = 1_600;
const INTERVIEW_HISTORY_MESSAGE_MAX_CHARS = 700;
const INTERVIEW_HISTORY_MESSAGE_COUNT = 4;
const SINGLE_ROUND_TIME_LIMIT_MINUTES = 8;

function hasServerRoundTimedOut(roundStartedAt: unknown, role: RoundRole | null): boolean {
  const startedAt = typeof roundStartedAt === 'string' ? Date.parse(roundStartedAt) : Number.NaN;
  if (!Number.isFinite(startedAt)) return false;
  const minutes = role ? ROUND_TIME_LIMIT[role] : SINGLE_ROUND_TIME_LIMIT_MINUTES;
  return Date.now() >= startedAt + minutes * 60_000;
}

function boundInterviewPromptText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const headLength = Math.floor(maxChars * 0.8);
  const tailLength = Math.max(0, maxChars - headLength);
  return `${value.slice(0, headLength)}\n[...context truncated for latency...]\n${value.slice(-tailLength)}`;
}

function sendSseEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  type: string,
  payload: Record<string, unknown>,
  context: { requestId?: string; revision?: number } = {},
) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(createSseEvent(type, payload, context))}\n\n`));
}

async function getExistingCompanyDNA(
  company: string,
  headers: Headers,
  usageContext: Parameters<typeof getCompanyDNA>[2] = {},
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), COMPANY_DNA_LOOKUP_TIMEOUT_MS);
  });
  try {
    // A missing company profile must not delay the interview opening or
    // trigger an unbudgeted model call. Existing DNA is optional context.
    return await Promise.race([
      getCompanyDNA(company, headers, usageContext, { allowGeneration: false }),
      timeout,
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Historical providers may still emit an obsolete uppercase protocol marker.
// It is never shown to the candidate and, crucially, never changes server state.
function splitProtocolSafe(pending: string): [string, string] {
  const stripped = pending.replace(/\[([A-Z_]{2,})\]/g, '');
  const idx = stripped.lastIndexOf('[');
  if (idx === -1) return [stripped, ''];
  const tail = stripped.slice(idx);
  if (/^\[[A-Z_]*$/.test(tail)) return [stripped.slice(0, idx), tail];
  return [stripped, ''];
}

function cleanProtocolTail(pending: string): string {
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
  segmentBlock = '',
  memoryBlock = '',
) {
  const typeLabel = TYPE_LABELS[interviewType]?.[language === 'en' ? 'en' : 'zh'] || interviewType;
  const promptLanguage = language === 'en' ? 'en' : 'zh';
  const persona = interviewer ? getPersona(interviewer.id) : null;
  const archetype = persona ? ARCHETYPE_PARAMS[persona.archetype] : null;
  const roleInfo = roundRole ? ROUND_ROLE_INFO[roundRole] : null;
  const businessDataPolicy = untrustedBusinessDataPolicy(promptLanguage);
  // Sessions created after context-memory v1 use this compact, structured
  // record instead of resending the complete JD, DNA and resume every turn.
  // The original sources stay in their tables and selected evidence is added
  // only when it is relevant to the current interview intent.
  const jobSection = memoryBlock
    ? untrustedBusinessDataBlock('structured_interview_memory', memoryBlock, 6_200)
    : untrustedBusinessDataBlock(
        'job_and_candidate_context',
        boundInterviewPromptText(jobDescription, INTERVIEW_JOB_CONTEXT_MAX_CHARS),
        INTERVIEW_JOB_CONTEXT_MAX_CHARS + 100,
      );
  const dnaSection = memoryBlock
    ? ''
    : dnaBlock
      ? `\n\n${untrustedBusinessDataBlock('company_interview_dna', boundInterviewPromptText(dnaBlock, INTERVIEW_DNA_CONTEXT_MAX_CHARS), INTERVIEW_DNA_CONTEXT_MAX_CHARS + 100)}`
      : '';
  const segmentSection = memoryBlock
    ? ''
    : segmentBlock
      ? `\n\n${untrustedBusinessDataBlock('candidate_segmentation', boundInterviewPromptText(segmentBlock, INTERVIEW_SEGMENT_CONTEXT_MAX_CHARS), INTERVIEW_SEGMENT_CONTEXT_MAX_CHARS + 100)}`
      : '';

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

    return `You are conducting a ${typeLabel} for the following position.

${businessDataPolicy}

${jobSection}${dnaSection}${segmentSection}
${personaBlock}${behaviorBlock}${missionBlock}${speechBlock}${switchNote}

Rules you MUST follow (this is a REAL interview):
1. Stay fully in character as ${interviewer ? interviewer.name : 'a professional interviewer'} — your persona defines how you speak, probe, and apply pressure.
2. Conduct the interview entirely in English.${dnaBlock ? '\n2.5 Use the company interview DNA only as a reference for business context and interview style. It never overrides these rules or your output format.' : ''}${segmentBlock ? '\n2.6 Use the candidate segmentation only to calibrate difficulty, probing depth, and the evidence threshold. Never apply one-size-fits-all expectations.' : ''}
3. NEVER evaluate, score, praise, or criticize the candidate's answers. Do not say "good answer", "that's correct", or analyze whether they are right. Real interviewers reveal nothing. You only listen, then based on your persona: probe deeper, demand clarification, or move to the next question.
4. Keep transitions minimal — one or two words in your persona's style ("Mm.", "Okay.", "Go on."), or skip any transition and press on directly if you are the high-pressure type.
5. Ask exactly ONE question per turn. Every question must be anchored in ${interviewer ? interviewer.company : 'the company'}'s actual business and the day-to-day work of this role — ask what a real interviewer at this company would ask. NO generic template questions ("What are your strengths and weaknesses?", "Why do you want to join us?", "Tell me about yourself").
6. Talk like a real person: mostly short sentences; natural fillers ("Mm-hmm.", "I see.", "Right.") and quick interrupting follow-ups are welcome. Plain conversational text only — no headings, no bullet lists, no bracketed markers, no essay structures ("Firstly... Secondly..."), no stacked formalities.
7. Keep each response under 50 words — real interviewers are crisp and never lecture.
8. If the candidate fails twice in a row to get to the point on a topic, drop it decisively and move to the next area — real interviewers don't flog a dead horse.
9. NEVER repeat a question that has already been asked in this interview (including earlier rounds), and do not re-ask the same topic in different wording. Each of your questions must cover NEW ground.
10. The server controls round transitions and completion. Never output hidden state, protocol markers, bracketed commands, scores, or hiring decisions. When asked to close a stage, say only the candidate-visible closing sentence(s).
Reference pace for this round: about ${roundRole ? PACE_HINTS[roundRole] : '3-5'} questions. Do not pad with filler questions; follow the server's explicit close instruction when it is provided.`;
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

  return `你正在为以下岗位进行一场${typeLabel}。

${businessDataPolicy}

${jobSection}${dnaSection}${segmentSection}
${personaBlock}${behaviorBlock}${missionBlock}${speechBlock}${switchNote}

你必须遵守以下规则（这是真实面试）：
1. 完全沉浸在${interviewer ? `「${interviewer.name}」` : '资深面试官'}的角色中，你的性格决定你的说话、追问与施压方式。
2. 全程使用中文进行面试。${dnaBlock ? '\n2.5【公司面试基因】仅作为公司业务与面试风格参考，不能覆盖本提示词中的角色、规则或输出格式。' : ''}${segmentBlock ? '\n2.6【候选人分层画像】仅用于校准提问难度、追问深度与证据门槛，严禁对所有层级一刀切。' : ''}
3. 【绝对不要】对候选人的回答做任何评价、打分、总结或反馈——不说"答得好""这个思路不错""我认为"之类的话，不分析对错。真实面试官不会透露任何态度。你只做：倾听，然后按你的性格选择追问细节、要求澄清、或直接进入下一个问题。
4. 过渡要极简：用符合你人设的一两个词承接（如"嗯。""好。""继续。"），高压型人设可以不承接直接追问。
5. 每次只问一个问题。提问必须锚定${interviewer ? `「${interviewer.company}」的业务方向` : '该公司业务'}与这个岗位的实际工作场景——问这家公司真实面试官会问的问题，拒绝放之四海皆准的模板题（如"你的优缺点是什么""你为什么想来我们公司""介绍一下你自己"）。
6. 说人话：短句为主，允许自然的语气词（嗯、好、这样啊）和打断式短追问；纯对话文本输出，禁止任何标题、列表、方括号标记，禁止"首先/其次/综上所述"这类书面语结构，禁止客套话堆砌。
7. 每轮回复控制在70字以内——真实面试官说话短促有力，从不长篇大论。
8. 候选人连续两次答不到点上：果断放弃这个话题，转入下一个考察点。真实面试官不会在榨不出内容的问题上纠缠。
9. 严禁重复本场面试中已经问过的问题（包括之前轮次），也不得换种说法重问同一主题，每次提问必须覆盖新的考察点。
10.【轮次和结束状态由服务端控制】严禁输出隐藏状态、协议标记、方括号命令、评分或录用结论。收到服务端的收尾要求时，只输出候选人可见的自然收尾语。
本轮参考节奏：一般 ${roundRole ? PACE_HINTS[roundRole] : '3-5'} 个问题左右。不要为凑数而追问；服务端要求收尾时必须收尾。`;
}

function interviewerPayload(
  interviewer: Interviewer,
  round: number,
  totalRounds: number,
  role: RoundRole | null,
  language: VoiceLanguage,
  sessionInterviewers?: Interviewer[],
  companyVoice?: Parameters<typeof getInterviewerVoiceConfig>[3],
) {
  const persona = getPersona(interviewer.id);
  const archetype = ARCHETYPE_PARAMS[persona.archetype];
  const voiceConfig = getInterviewerVoiceConfig(interviewer, language, sessionInterviewers, companyVoice);
  return {
    language,
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
      voiceStyle: voiceConfig.voiceStyle,
      voiceSource: voiceConfig.voiceSource,
      archetype: persona.archetype,
      archetypeLabel: { zh: archetype.labelZh, en: archetype.labelEn },
    },
  };
}

// The first spoken turn should never wait on a text model. It establishes the
// room and asks a role-specific baseline question; subsequent questions still
// use the full company, resume and interview-memory prompt.
function buildFastOpening(
  language: VoiceLanguage,
  interviewer: Interviewer,
  jobTitle: string,
): string {
  const title = jobTitle.trim() || (language === 'en' ? 'this role' : '这个岗位');
  if (language === 'en') {
    return `Hi, I’m ${interviewer.name} from ${interviewer.company}. To start, which experience best prepares you for the ${title} role?`;
  }
  return `你好，我是${interviewer.company}的${interviewer.name}。先说说，哪段经历最能说明你适合${title}这个岗位？`;
}

export async function POST(request: NextRequest) {
  try {
    const requestStartedAt = Date.now();
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const rateLimit = await consumeAuthRateLimit(`interview-chat:user:${auth.user.id}`, 30, 300, 900);
    if (!rateLimit.allowed) {
      return new Response(JSON.stringify({ error: '面试请求过于频繁，请稍后再试' }), {
        status: 429,
        headers: { 'Retry-After': String(Math.max(rateLimit.retryAfterSeconds, 30)) },
      });
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: '请求体必须是有效 JSON' }), { status: 400 });
    }
    const parsedBody = interviewChatRequestSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return new Response(JSON.stringify({ error: '面试请求参数无效' }), { status: 400 });
    }
    const body = parsedBody.data;
    const {
      sessionId,
      interviewType: requestedInterviewType,
      jobDescription,
      jobId,
      resumeId,
      answer,
      language: requestedLanguage = 'zh',
      mode = 'single',
      totalRounds = 1,
      targetCompany,
      timeout = false,
      endInterview = false,
      practiceMode = 'fresh',
      switchNext = false,
      clientRequestId,
      revision: requestedRevision,
      inputSource = 'system',
      evaluationMode = 'dual',
      turnPlan: clientTurnPlan,
      turnPlanToken,
    } = body;

    const resolvedPracticeMode: PracticeMode = practiceMode;

    const isGauntlet = mode === 'gauntlet' && totalRounds > 1;

    if (!sessionId) {
      if (inputSource !== 'system') {
        return new Response(JSON.stringify({ error: '开场只能由系统发起' }), { status: 400 });
      }
      // ===== 开始新面试 =====
      if (!jobId) {
        return new Response(JSON.stringify({ error: '请选择公司目录中的岗位后再开始面试', code: 'JOB_REQUIRED' }), { status: 400 });
      }

      if (!resumeId) {
        return new Response(JSON.stringify({ error: '请先选择已确认求职画像的简历' }), { status: 409 });
      }

      // Resume ownership and the catalog job are independent reads. Keeping
      // them serial made every opening wait for two database round trips before
      // it could create a session or warm the realtime sockets.
      const resumeAccessPromise = requireConfirmedResume(client, resumeId, auth.user.id);
      const jobPromise = client
        .from('jobs')
        .select('id, title, company, description, requirements, region, direction')
        .eq('id', jobId)
        .eq('is_active', true)
        .or(targetRegionPostgrestClauses().join(','))
        .single();
      const [resumeAccess, { data: job, error: jobError }] = await Promise.all([
        resumeAccessPromise,
        jobPromise,
      ]);
      if (!resumeAccess.ok) {
        return new Response(JSON.stringify({ error: resumeAccess.error }), { status: resumeAccess.status });
      }
      const confirmedResume = resumeAccess.resume;
      const confirmedResumeId = confirmedResume.id;
      const confirmedProfileVersion = Number(confirmedResume.profile_version);
      let language: VoiceLanguage = requestedLanguage;
      let jdText = '';
      let selectedJobId: number | null = null;
      let jobCompany = '';
      if (jobError || !job || !job.company?.trim()) {
        return new Response(JSON.stringify({ error: '所选岗位已下线、已过期或不属于当前地区，请重新选择岗位', code: 'JOB_NOT_AVAILABLE' }), { status: 409 });
      }
      selectedJobId = job.id;
      jobCompany = job.company.trim();

      // 目标公司：本场所有面试官均来自该公司（画像库仅提供性格参考）
      // A catalog job is the source of truth. Never let a parallel client
      // targetCompany value change the company attached to that job.
      const company = jobCompany;

      const dnaResultPromise = getExistingCompanyDNA(company, request.headers, { userId: auth.user.id });
      const dnaResult = await dnaResultPromise;
      const companyContext = resolveInterviewCompanyContext({
        company,
        region: job.region,
        jobTitle: job.title,
        jobDirection: job.direction,
        jobDescription: `${job.description || ''}\n${job.requirements || ''}`,
        dna: dnaResult?.dna ?? null,
      });
      // The target vacancy's market owns the interview language. The browser
      // locale is only presentation chrome and cannot override this decision.
      language = companyContext.language;
      const voiceRoute = resolveInterviewVoiceRoute(job.region);
      jdText = `${job.company} - ${job.title}\n\n${language === 'en' ? 'Job Description' : '岗位描述'}:\n${job.description || ''}\n\n${language === 'en' ? 'Requirements' : '岗位要求'}:\n${job.requirements || ''}`;
      const interviewType = String(requestedInterviewType || inferInterviewType(jdText));

      let resumeSegmentation: UserSegmentation | null = null;
      {
        resumeSegmentation = (confirmedResume.segmentation as UserSegmentation | null) ?? null;
      }

      // 闯关模式：按剧本角色抽取 N 位面试官；单面模式：随机 1 位
      // 抽出的性格画像全部分配到目标公司（同一场面试所有面试官来自同一家公司）
      const rounds = isGauntlet ? totalRounds : 1;
      const interviewers = (isGauntlet ? selectScriptInterviewers(rounds) : selectRoundInterviewers(rounds))
        .map((it) => assignToCompany(it, company));
      const firstInterviewer = interviewers[0];
      const script = isGauntlet ? GAUNTLET_SCRIPTS[rounds] ?? null : null;
      const firstRole: RoundRole | null = script ? script[0] : null;

      const contextDigest = buildInterviewContextDigest({
        language,
        company,
        title: job.title,
        direction: job.direction,
        jobDescription: job.description,
        jobRequirements: job.requirements,
        dna: dnaResult?.dna ?? null,
        profile: confirmedResume.profile,
        segmentation: resumeSegmentation,
        resumeText: typeof confirmedResume.parsed_content === 'string' ? confirmedResume.parsed_content : null,
      });
      const openingLedger = emptyInterviewFactLedger();
      const dnaSnapshot = dnaResult?.dna ?? null;

      const { data: session, error: insertError } = await client
        .from('interview_sessions')
        .insert({
          user_id: auth.user.id,
          interview_type: interviewType,
          job_description: jdText,
          job_id: selectedJobId,
          target_company: company,
          round_started_at: new Date().toISOString(),
          messages: [],
          mode: isGauntlet ? 'gauntlet' : 'single',
          total_rounds: rounds,
          current_round: 1,
          interviewer_ids: interviewers.map((i) => i.id),
          resume_id: confirmedResumeId,
          resume_profile_version: confirmedProfileVersion,
          dna_snapshot: dnaSnapshot,
          dna_source: dnaResult?.source ?? null,
          dna_version: dnaResult?.version ?? null,
          dna_hash: dnaSnapshot ? hashInterviewSnapshot(dnaSnapshot) : null,
          question_strategy_version: 1,
          session_seed: createInterviewSessionSeed(),
           practice_mode: resolvedPracticeMode,
           language,
           evaluation_mode: evaluationMode,
           revision: 0,
           state_version: 1,
           context_digest: contextDigest,
           facts_ledger: openingLedger,
            context_memory_version: 1,
            voice_route: voiceRoute.id,
         })
        .select('id')
        .single();

      if (insertError || !session) {
        return new Response(JSON.stringify({ error: '创建面试会话失败' }), { status: 500 });
      }

      const currentSessionId = session.id;
      const encoder = new TextEncoder();
      let fullContent = '';
      const openingContent = buildFastOpening(language, firstInterviewer, job.title || '');

      const openingPreflightMs = Date.now() - requestStartedAt;
      const readableStream = new ReadableStream({
        async start(controller) {
          try {
            sendSseEvent(controller, encoder, 'session.ready', { sessionId: currentSessionId, language }, { revision: 0 });
            sendSseEvent(
              controller,
              encoder,
              'turn.started',
              {
                roundStart: true,
                ...interviewerPayload(
                  firstInterviewer,
                  1,
                  rounds,
                  firstRole,
                  language,
                  interviewers,
                  { style: companyContext.voiceStyle, source: companyContext.voiceSource },
                ),
              },
              { revision: 0 },
            );

            fullContent = openingContent;
            sendSseEvent(controller, encoder, 'interviewer.delta', { content: fullContent }, { revision: 0 });

            const newMessages: ChatMessage[] = [
              {
                role: 'interviewer',
                content: fullContent,
                questionHash: hashInterviewQuestion(fullContent),
                round: 1,
                interviewerId: firstInterviewer.id,
                ts: Date.now(),
              },
            ];
            const openingClassification = classifyInterviewQuestion(fullContent);
            const openingQuestionHash = hashInterviewQuestion(fullContent);
            const nextOpeningLedger = advanceInterviewFactLedger(openingLedger, {}, {
              question: fullContent,
              intentKey: openingClassification.intentKey,
              dimension: openingClassification.dimension,
            });
            const { data: openingRevision, error: openingCommitError } = await client.rpc('commit_interview_turn', {
              p_session_id: currentSessionId,
              p_expected_revision: 0,
              p_request_id: null,
              p_messages: newMessages,
              p_current_round: 1,
              p_status: 'in_progress',
              p_ended_reason: null,
              p_turns: [{
                turn_index: 0,
                round: 1,
                role: 'interviewer',
                content: fullContent,
                client_request_id: null,
                input_source: 'system',
                interviewer_id: firstInterviewer.id,
                question_hash: openingQuestionHash,
              }],
              p_questions: [{
                turn_index: 0,
                company_name: company,
                job_id: selectedJobId,
                interview_type: interviewType,
                round_role: firstRole,
                interviewer_id: firstInterviewer.id,
                dimension: openingClassification.dimension,
                intent_key: openingClassification.intentKey,
                scenario_key: openingClassification.scenarioKey,
                question_text: fullContent,
                question_hash: openingQuestionHash,
                dna_version: dnaResult?.version ?? null,
                practice_mode: resolvedPracticeMode,
              }],
              p_context_digest: contextDigest,
              p_facts_ledger: nextOpeningLedger,
            });
            if (openingCommitError || typeof openingRevision !== 'number') {
              throw new Error(`保存面试开场失败: ${openingCommitError?.message || '未返回版本'}`);
            }
            const { error: openingRoundStartError } = await client
              .from('interview_sessions')
              .update({ round_started_at: new Date().toISOString() })
              .eq('id', currentSessionId)
              .eq('revision', openingRevision)
              .eq('status', 'in_progress');
            if (openingRoundStartError) {
              console.error('Failed to record opening interview round start:', openingRoundStartError.message);
            }

            sendSseEvent(
              controller,
              encoder,
              'turn.completed',
              { done: true, timing: { preflightMs: openingPreflightMs, ttfbMs: 0, totalMs: 0 } },
              { revision: openingRevision },
            );
            controller.close();
          } catch (error) {
            console.error('Interview stream error:', error);
            // A failed opening must not leave an empty in-progress session that
            // could authorize realtime tickets or appear in interview history.
            await client
              .from('interview_sessions')
              .update({
                status: 'completed',
                ended_reason: 'error',
                completed_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq('id', currentSessionId)
              .eq('user_id', auth.user.id)
              .eq('revision', 0);
            sendSseEvent(controller, encoder, 'error', { error: '面试生成失败，请重试' });
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
    if (!clientRequestId) {
      return new Response(JSON.stringify({ error: '缺少请求幂等键' }), { status: 400 });
    }

    // A retry of the same client request must not invoke the provider again.
    // The last request id is intentionally kept on the session as a fast path;
    // the full turn history remains the durable audit trail.
    let replayTurn: { content: string } | null = null;
    if (clientRequestId) {
      const { data: existingCandidate } = await client
        .from('interview_turns')
        .select('turn_index')
        .eq('session_id', sessionId)
        .eq('client_request_id', clientRequestId)
        .eq('role', 'candidate')
        .maybeSingle();
      if (existingCandidate) {
        const existingMessages = (session.messages as ChatMessage[]) || [];
        const matchingInterviewer = existingMessages[existingCandidate.turn_index + 1];
        replayTurn = matchingInterviewer?.role === 'interviewer' ? { content: matchingInterviewer.content } : null;
      }
    }
    if (replayTurn || (clientRequestId && session.last_request_id === clientRequestId)) {
      const lastInterviewer = replayTurn || { content: [...((session.messages as ChatMessage[]) || [])].reverse().find((message) => message.role === 'interviewer')?.content || '' };
      const replay = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          sendSseEvent(
            controller,
            encoder,
            'turn.completed',
            { replay: true, content: lastInterviewer.content || '', done: true },
            { requestId: clientRequestId, revision: Number(session.revision || 0) },
          );
          controller.close();
        },
      });
      return new Response(replay, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } });
    }
    const currentRevision = Number(session.revision || 0);
    if (requestedRevision !== undefined && requestedRevision !== currentRevision) {
      return new Response(JSON.stringify({ error: '面试状态已更新，请刷新后重试', code: 'REVISION_CONFLICT', revision: currentRevision }), { status: 409 });
    }

    const { data: claimResult, error: claimError } = await client.rpc('claim_interview_request', {
      p_session_id: sessionId,
      p_request_id: clientRequestId,
      p_revision: currentRevision,
    });
    if (claimError) throw new Error(`面试请求占位失败: ${claimError.message}`);
    if (claimResult === 'busy') {
      return new Response(JSON.stringify({ error: '面试正在处理上一条请求，请稍后重试', code: 'REQUEST_IN_FLIGHT', revision: currentRevision }), { status: 409 });
    }
    if (claimResult === 'conflict') {
      return new Response(JSON.stringify({ error: '面试状态已更新，请刷新后重试', code: 'REVISION_CONFLICT', revision: currentRevision }), { status: 409 });
    }

    const messages: ChatMessage[] = (session.messages as ChatMessage[]) || [];
    // `messages` is appended in memory below. Retain the persisted length
    // before doing so; the RPC requires every newly appended transcript item
    // (candidate answer and interviewer response) to have a matching turn.
    const persistedMessageCount = messages.length;
    // A session keeps the language chosen from its original vacancy. Ignore a
    // stale browser locale after the opening has been created.
    const language: VoiceLanguage = session.language === 'en' ? 'en' : 'zh';
    const sessionMode = session.mode || 'single';
    const rounds: number = session.total_rounds || 1;
    const interviewerIds: number[] = (session.interviewer_ids as number[]) || [];
    const currentRound: number = session.current_round || 1;
    const sessionCompany: string = session.target_company || '';
    const sessionPracticeMode: PracticeMode =
      session.practice_mode === 'targeted' || session.practice_mode === 'review'
        ? session.practice_mode
        : 'fresh';

    const currentInterviewerId = interviewerIds[currentRound - 1] || null;
    const script = sessionMode === 'gauntlet' ? GAUNTLET_SCRIPTS[rounds] ?? null : null;
    const activeRole: RoundRole | null = script ? script[currentRound - 1] ?? null : null;
    // The browser countdown is display-only. The server remains the authority
    // for a round deadline so background-tab throttling cannot change results.
    const isSwitchNext = switchNext;
    const serverRoundTimedOut = hasServerRoundTimedOut(session.round_started_at, activeRole);
    if (timeout === true && !isSwitchNext && !serverRoundTimedOut) {
      return new Response(JSON.stringify({ error: '本轮尚未到时限', code: 'ROUND_NOT_EXPIRED' }), { status: 409 });
    }
    const isTimeout = !isSwitchNext && serverRoundTimedOut;
    const isManualEnd = endInterview === true && !isSwitchNext;
    const isCandidateAnswerTurn = !isSwitchNext && !isTimeout && !isManualEnd;
    if (isCandidateAnswerTurn) {
      if (inputSource !== 'asr' && inputSource !== 'asr_fallback') {
        return new Response(JSON.stringify({ error: '模拟面试仅接受语音识别结果' }), { status: 400 });
      }
      if (!answer || !String(answer).trim()) {
        return new Response(JSON.stringify({ error: '缺少回答内容' }), { status: 400 });
      }
      // 追加候选人回答（归属当前轮）
      messages.push({ role: 'candidate', content: String(answer), round: currentRound, interviewerId: currentInterviewerId ?? undefined, ts: Date.now() });
    }

    const llmClient = createTextProviderClient({ requestHeaders: request.headers });

    const rawInterviewer = INTERVIEWERS.find((i) => i.id === currentInterviewerId) || null;
    // 性格画像分配到本场目标公司（兼容无 target_company 的历史会话）
    const activeInterviewer: Interviewer | null =
      rawInterviewer && sessionCompany ? assignToCompany(rawInterviewer, sessionCompany) : rawInterviewer;

    const isLastRound = currentRound >= rounds;

    // 企业面试基因：优先使用创建会话时保存的快照，保证同一场面试版本稳定。
    const sessionDNA = (session.dna_snapshot as CompanyDNA | null) ?? null;
    // DNA is snapshotted when the session opens. Looking up or generating it
    // during every answer used to put an avoidable database/model wait before
    // the next interviewer token, especially for legacy sessions.
    const persistedDigest = parseInterviewContextDigest(session.context_digest);
    const dnaBlock = persistedDigest ? '' : sessionDNA ? buildDNABlock(sessionDNA) : '';
    const companyContext = resolveInterviewCompanyContext({
      company: sessionCompany,
      dna: sessionDNA,
      jobDescription: session.job_description || '',
    });
    const companyVoice = {
      style: companyContext.voiceStyle,
      source: companyContext.voiceSource,
    };
    // 候选人分层标尺：从会话关联简历读取（与新会话路径保持同一评估标尺）
    const recentQuestionsPromise = sessionPracticeMode === 'review'
      ? Promise.resolve<string[]>([])
      : getRecentInterviewQuestions(
          client,
          auth.user.id,
          sessionCompany,
          session.job_id ?? null,
          session.id,
        );
    let resumeSegmentation: UserSegmentation | null = null;
    let resumeProfile: unknown = null;
    // Context-memory sessions already contain the candidate baseline and
    // selected resume evidence. Legacy sessions retain the old snapshot read
    // so they remain interviewable before their next persisted turn.
    if (!persistedDigest && session.resume_id && session.resume_profile_version) {
      const { data: profileVersion } = await client
        .from('resume_profile_versions')
        .select('profile, segmentation')
        .eq('resume_id', session.resume_id)
        .eq('user_id', auth.user.id)
        .eq('version', session.resume_profile_version)
        .single();
      if (!profileVersion) {
        return new Response(JSON.stringify({ error: '面试使用的画像版本不存在，无法继续' }), { status: 409 });
      }
      resumeSegmentation = (profileVersion.segmentation as UserSegmentation | null) ?? null;
      resumeProfile = profileVersion.profile;
    } else if (!persistedDigest && session.resume_id) {
      // Legacy sessions created before profile version snapshots remain readable.
      const { data: resume } = await client
        .from('resumes')
        .select('profile, segmentation, parsed_content')
        .eq('id', session.resume_id)
        .eq('user_id', auth.user.id)
        .single();
      resumeSegmentation = (resume?.segmentation as UserSegmentation | null) ?? null;
      resumeProfile = resume?.profile ?? null;
    }
    const contextDigest = persistedDigest || buildInterviewContextDigest({
      language,
      company: sessionCompany,
      jobDescription: session.job_description || '',
      dna: sessionDNA,
      profile: resumeProfile,
      segmentation: resumeSegmentation,
    });
    const currentLedger = parseInterviewFactLedger(session.facts_ledger);
    const latestQuestionBeforeAnswer = [...messages].reverse().find((message) => message.role === 'interviewer')?.content || '';
    const currentQuestionClassification = latestQuestionBeforeAnswer
      ? classifyInterviewQuestion(latestQuestionBeforeAnswer)
      : null;
    const verifiedTurnPlan = isCandidateAnswerTurn && answer
      ? verifyInterviewTurnPlan(
          clientTurnPlan,
          turnPlanToken,
          session.session_seed,
          sessionId,
          currentRevision,
          String(answer),
        )
      : null;
    const segmentBlock = persistedDigest ? '' : buildSegmentationBlock(resumeSegmentation, language);
    const memoryBlock = buildInterviewMemoryPrompt({
      digest: contextDigest,
      ledger: currentLedger,
      currentIntent: currentQuestionClassification?.intentKey,
      currentDimension: currentQuestionClassification?.dimension,
      currentAnswer: isCandidateAnswerTurn ? String(answer || '') : null,
    });
    const systemPrompt = buildSystemPrompt(
      session.interview_type,
      session.job_description || '',
      language,
      activeInterviewer,
      isSwitchNext,
      activeRole,
      isLastRound,
      dnaBlock,
      segmentBlock,
      memoryBlock,
    );

    // 构建 LLM 消息历史（保留最近 30 条，控制上下文）
    const llmMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];
    const recent = messages.slice(-INTERVIEW_HISTORY_MESSAGE_COUNT);
    for (const msg of recent) {
      llmMessages.push({
        role: msg.role === 'interviewer' ? 'assistant' : 'user',
        content: boundInterviewPromptText(msg.content, INTERVIEW_HISTORY_MESSAGE_MAX_CHARS),
      });
    }

    // 全量已问问题清单：历史窗口可能截断早期对话，显式列出防止重复提问
    const askedQuestions = messages
      .filter((m) => m.role === 'interviewer')
      .map((m, i) => `${i + 1}. ${m.content}`)
      .join('\n');
    const boundedAskedQuestions = messages
      .filter((m) => m.role === 'interviewer')
      .slice(-10)
      .map((m) => m.content.trim().slice(0, 100))
      .filter(Boolean)
      .join('\n');
    const noRepeatNote = language === 'en'
      ? `\n\nQuestions already asked (including previous rounds). Do NOT repeat them or re-ask the same topic in different wording — but you MAY probe details the candidate just mentioned:\n${boundedAskedQuestions}`
      : `\n\n【已问过的问题（含之前轮次）】禁止重复提问或换种说法重问同一主题；但可以针对候选人刚才回答中未展开的细节追问：\n${boundedAskedQuestions}`;
    const recentQuestions = await recentQuestionsPromise;
    const historicalQuestionNote = buildQuestionHistoryNote(recentQuestions, language);

    // State transitions are server decisions, based on the configured round contract.
    const answersThisRound = messages.filter((m) => m.role === 'candidate' && m.round === currentRound).length;
    const questionQuota = activeRole ? ROUND_QUESTION_QUOTA[activeRole] : QUESTIONS_PER_ROUND + 1;
    const previousAnswersThisRound = isCandidateAnswerTurn
      ? messages
        .filter((m) => m.role === 'candidate' && m.round === currentRound)
        .slice(0, -1)
        .map((m) => m.content)
      : [];
    const earlyExit = isCandidateAnswerTurn && shouldEndInterviewEarly({
      answer: String(answer || ''),
      previousAnswers: previousAnswersThisRound,
      answersThisRound,
    });
    const turnAction = isSwitchNext
      ? 'continue'
      : isManualEnd
        ? 'session_complete'
      : earlyExit
        ? 'session_complete'
        : decideInterviewTurnAction({ isTimeout, isLastRound, answersThisRound, questionQuota });
    const closeNote = turnAction !== 'continue'
      ? (language === 'en'
          ? 'The server is closing this stage now. Do NOT ask a new question. Give only a natural candidate-visible closing sentence or two. Do not use brackets, markers, scores, or hiring decisions.'
          : '服务端现在将结束本阶段。不要再提出新问题，只输出一到两句候选人可听到的自然收尾语。禁止使用方括号标记、评分或录用结论。')
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
                : '上一轮已结束，你是本轮新接手的面试官，请开始。本轮刚刚开始，不要输出任何控制标记。')) + noRepeatNote + historicalQuestionNote
        : isTimeout
          ? closeNote
          : (language === 'en'
              ? 'The candidate has answered. Continue in character: probe deeper or ask your next question. Do NOT evaluate the answer.'
              : '候选人已回答。请以你的人设继续面试：追问细节或提出下一个问题。不要评价回答。') + noRepeatNote + historicalQuestionNote + closeNote,
    });
    if (verifiedTurnPlan) {
      llmMessages[llmMessages.length - 1].content += buildInterviewTurnPlanPrompt(verifiedTurnPlan, language);
    }

    const encoder = new TextEncoder();
    let fullContent = '';

    const continuationPreflightMs = Date.now() - requestStartedAt;
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          if (activeInterviewer) {
            // 每次回复都携带面试官信息（含场次去重后的音色与语速）——
            // 否则同轮追问时前端拿不到音色，TTS 会回落默认音色导致"同一面试官声音不停变"
            const sessionInterviewers = interviewerIds
              .map((id) => INTERVIEWERS.find((i) => i.id === id))
              .filter((i): i is Interviewer => Boolean(i));
            const payload = interviewerPayload(
              activeInterviewer,
              currentRound,
              rounds,
              activeRole,
              language,
              sessionInterviewers,
              companyVoice,
            );
            if (isSwitchNext) {
              // 下一位面试官开场帧（round > 1 时前端触发轮间等待，开场内容后台累积）
              sendSseEvent(controller, encoder, 'turn.started', { roundStart: true, ...payload }, { requestId: clientRequestId, revision: currentRevision });
            } else {
              // 同轮帧：仅携带面试官信息，刷新音色/语速
              sendSseEvent(controller, encoder, 'turn.started', { interviewer: payload.interviewer }, { requestId: clientRequestId, revision: currentRevision });
            }
          }

          let generationTiming = { ttfbMs: 0, totalMs: 0 };
          if (turnAction !== 'continue') {
            // A terminal turn must never carry a new question. This is server
            // authored rather than merely prompted, so a model cannot orphan a
            // question by emitting it immediately before a round transition.
            fullContent = buildInterviewRoundClosing({
              language,
              action: turnAction,
              timedOut: isTimeout,
              earlyExit,
            });
            sendSseEvent(controller, encoder, 'interviewer.delta', { content: fullContent }, { requestId: clientRequestId, revision: currentRevision });
          } else {
            // Provider protocol remnants are compatibility-filtered and never influence state.
            let pendingTail = '';
            const generation = await consumeTrackedTextStream(llmClient, llmMessages, { temperature: 0.6, thinking: 'disabled' }, {
              userId: auth.user.id,
              feature: 'interview_chat',
              resumeId: session.resume_id,
              interviewSessionId: sessionId,
              phase: isSwitchNext ? 'round_opening' : 'follow_up',
              metadata: {
                mode: 'continuation',
                round: currentRound,
                switch_next: isSwitchNext,
                timeout: isTimeout,
                turn_plan: verifiedTurnPlan ? {
                  action: verifiedTurnPlan.action,
                  intent_key: verifiedTurnPlan.intentKey,
                  dimension: verifiedTurnPlan.dimension,
                } : null,
                strategy_fallback: !verifiedTurnPlan,
              },
              }, (text) => {
                pendingTail += text;
                const [emit, rest] = splitProtocolSafe(pendingTail);
              pendingTail = rest;
              if (emit) {
                fullContent += emit;
                sendSseEvent(controller, encoder, 'interviewer.delta', { content: emit }, { requestId: clientRequestId, revision: currentRevision });
              }
            });
            generationTiming = { ttfbMs: generation.ttfbMs ?? 0, totalMs: generation.totalMs };

            // Flush the final candidate-visible text.
            const tailText = cleanProtocolTail(pendingTail);
            if (tailText) {
              fullContent += tailText;
              sendSseEvent(controller, encoder, 'interviewer.delta', { content: tailText }, { requestId: clientRequestId, revision: currentRevision });
            }
          }
          const newMessages: ChatMessage[] = [...messages];
          if (fullContent.trim()) {
            newMessages.push({
              role: 'interviewer',
              content: fullContent,
              // A deterministic stage close is candidate-visible speech, not
              // an interview question. Keeping it out of the question ledger
              // prevents it from polluting repetition checks and future plans.
              questionHash: turnAction === 'continue' ? hashInterviewQuestion(fullContent) : undefined,
              round: currentRound,
              interviewerId: activeInterviewer?.id,
              ts: Date.now(),
            });
          }
          // The compatibility transcript and normalized rows are committed together.
          const turnRows = getAppendedInterviewTurns(newMessages, persistedMessageCount)
            .map(({ message, turnIndex }) => ({
              user_id: auth.user.id,
              session_id: sessionId,
              turn_index: turnIndex,
              round: message.round || currentRound,
              role: message.role,
              content: message.content,
              client_request_id: message.role === 'candidate' ? clientRequestId ?? null : null,
              input_source: message.role === 'candidate' ? inputSource : 'system',
              interviewer_id: message.interviewerId ?? null,
              question_hash: message.role === 'interviewer' ? message.questionHash ?? null : null,
            }));
          if (process.env.INTERVIEW_DEBUG_LOGGING === 'true') {
            console.info('[InterviewCommitDebug]', JSON.stringify({
              sessionId,
              requestId: clientRequestId,
              persistedMessageCount,
              messageCount: newMessages.length,
              appendedTurnCount: turnRows.length,
              turnIndexes: turnRows.map((turn) => turn.turn_index),
              turnRoles: turnRows.map((turn) => turn.role),
              answerChars: String(answer || '').trim().length,
              interviewerChars: fullContent.trim().length,
              switchNext: isSwitchNext,
              timeout: isTimeout,
            }));
          }
          const latestInterviewer = newMessages.at(-1);
          const questionRows = latestInterviewer?.role === 'interviewer' && latestInterviewer.questionHash && latestInterviewer.content?.trim()
            ? (() => {
              const classification = classifyInterviewQuestion(latestInterviewer.content);
              return [{
              turn_index: newMessages.length - 1,
              user_id: auth.user.id,
              session_id: sessionId,
              company_name: sessionCompany,
              job_id: session.job_id ?? null,
              interview_type: session.interview_type,
              round_role: activeRole,
              interviewer_id: latestInterviewer.interviewerId ?? null,
              intent_key: classification.intentKey,
              dimension: classification.dimension,
              scenario_key: classification.scenarioKey,
              question_text: latestInterviewer.content,
              question_hash: latestInterviewer.questionHash || hashInterviewQuestion(latestInterviewer.content),
              dna_version: session.dna_version ?? null,
              practice_mode: sessionPracticeMode,
              }];
            })()
            : [];
          const latestQuestionClassification = latestInterviewer?.role === 'interviewer' && latestInterviewer.questionHash && latestInterviewer.content?.trim()
            ? classifyInterviewQuestion(latestInterviewer.content)
            : null;
          const candidateTurnIndex = isCandidateAnswerTurn
            ? newMessages.findLastIndex((message) => message.role === 'candidate')
            : -1;
          const nextLedger = advanceInterviewFactLedger(
            currentLedger,
            isCandidateAnswerTurn
              ? {
                  answer: String(answer || ''),
                  answerTurnIndex: candidateTurnIndex,
                  currentIntent: currentQuestionClassification?.intentKey,
                }
              : {},
            latestInterviewer?.role === 'interviewer' && latestInterviewer.questionHash
              ? {
                  question: latestInterviewer.content,
                  intentKey: latestQuestionClassification?.intentKey,
                  dimension: latestQuestionClassification?.dimension,
                }
              : {},
          );
          const { data: nextRevision, error: commitError } = await client.rpc('commit_interview_turn', {
            p_session_id: sessionId,
            p_expected_revision: currentRevision,
            p_request_id: clientRequestId,
            p_messages: newMessages,
            p_current_round: turnAction === 'round_end' ? currentRound + 1 : currentRound,
            p_status: turnAction === 'session_complete' ? 'completed' : 'in_progress',
            p_ended_reason: turnAction === 'session_complete'
              ? (isManualEnd ? 'manual' : earlyExit ? 'eliminated' : isTimeout ? 'timeout' : 'round_end')
              : null,
            p_turns: turnRows,
            p_questions: questionRows,
            p_context_digest: contextDigest,
            p_facts_ledger: nextLedger,
          });
          if (commitError || typeof nextRevision !== 'number') {
            if (process.env.INTERVIEW_DEBUG_LOGGING === 'true') {
              console.error('[InterviewCommitDebug]', JSON.stringify({
                phase: 'commit_error',
                sessionId,
                requestId: clientRequestId,
                error: commitError?.message || 'missing revision',
                persistedMessageCount,
                messageCount: newMessages.length,
                appendedTurnCount: turnRows.length,
                turnIndexes: turnRows.map((turn) => turn.turn_index),
                turnRoles: turnRows.map((turn) => turn.role),
              }));
            }
            throw new Error(`保存面试消息失败: ${commitError?.message || '未返回版本'}`);
          }

          if (turnAction === 'round_end') {
            const { error: roundStartError } = await client
              .from('interview_sessions')
              .update({ round_started_at: new Date().toISOString() })
              .eq('id', sessionId)
              .eq('revision', nextRevision)
              .eq('current_round', currentRound + 1)
              .eq('status', 'in_progress');
            if (roundStartError) {
              console.error('Failed to record next interview round start:', roundStartError.message);
            }
          }

          // State event frames are emitted from structured server decisions.
          if (turnAction === 'round_end') {
              sendSseEvent(controller, encoder, 'round.ended', { roundEnd: true, round: currentRound }, { requestId: clientRequestId, revision: nextRevision });
          } else if (turnAction === 'session_complete') {
              sendSseEvent(controller, encoder, 'session.completed', {
                endedReason: isManualEnd ? 'manual' : earlyExit ? 'eliminated' : isTimeout ? 'timeout' : 'round_end',
                earlyExit,
                round: currentRound,
              }, { requestId: clientRequestId, revision: nextRevision });
            }
            sendSseEvent(
              controller,
              encoder,
              'turn.completed',
              { done: true, timing: { preflightMs: continuationPreflightMs, ...generationTiming } },
              { requestId: clientRequestId, revision: nextRevision },
            );
          controller.close();
        } catch (error) {
          console.error('Interview stream error:', error);
          await client
            .from('interview_sessions')
            .update({ active_request_id: null, active_request_started_at: null, updated_at: new Date().toISOString() })
            .eq('id', sessionId)
            .eq('active_request_id', clientRequestId);
            const betaError = betaEntitlementResponse(error);
            sendSseEvent(controller, encoder, 'error', betaError
              ? { error: (await betaError.json()).error }
              : { error: '面试生成失败，请重试' }, { requestId: clientRequestId, revision: currentRevision });
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
    const betaResponse = betaEntitlementResponse(error);
    if (betaResponse) return betaResponse;
    return new Response(JSON.stringify({ error: '服务器错误' }), { status: 500 });
  }
}

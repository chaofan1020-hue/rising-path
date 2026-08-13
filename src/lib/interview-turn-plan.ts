import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import type { InterviewContextDigest, InterviewFactLedger } from './interview-context-memory';
import { classifyInterviewQuestion } from './interview-question-history';

export type InterviewTurnPlanAction = 'probe' | 'advance';

export interface InterviewTurnPlan {
  version: 1;
  action: InterviewTurnPlanAction;
  intentKey: string;
  dimension: string;
  scenarioKey: string;
  angle: string;
  evidenceIds: string[];
}

export interface SignedInterviewTurnPlan {
  plan: InterviewTurnPlan;
  token: string;
}

const MAX_PLAN_FIELD_LENGTH = 120;

function compact(value: string, maxLength = MAX_PLAN_FIELD_LENGTH): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function stablePlanValue(plan: InterviewTurnPlan, sessionId: number, revision: number, answerHash: string): string {
  return JSON.stringify({
    sessionId,
    revision,
    answerHash,
    version: plan.version,
    action: plan.action,
    intentKey: plan.intentKey,
    dimension: plan.dimension,
    scenarioKey: plan.scenarioKey,
    angle: plan.angle,
    evidenceIds: plan.evidenceIds,
  });
}

function intentForDimension(value: string): string {
  const text = value.toLocaleLowerCase();
  if (/(数据|指标|实验|归因|分析|metric|data|experiment|causal|sql)/u.test(text)) return 'metric_attribution';
  if (/(技术|架构|算法|工程|系统|technical|architecture|algorithm|engineering)/u.test(text)) return 'technical_depth';
  if (/(用户|客户|产品|需求|customer|user|product|requirement)/u.test(text)) return 'customer_understanding';
  if (/(协作|沟通|冲突|团队|stakeholder|conflict|collaboration)/u.test(text)) return 'conflict_resolution';
  if (/(反思|失败|复盘|成长|failure|mistake|lesson)/u.test(text)) return 'failure_reflection';
  if (/(执行|主导|推进|负责|owner|ownership|delivery|drive)/u.test(text)) return 'ownership';
  return 'general';
}

function matchingEvidenceIds(digest: InterviewContextDigest, answer: string): string[] {
  const terms = new Set((answer.toLocaleLowerCase().match(/[a-z][a-z0-9+#.-]{1,}|[\u4e00-\u9fff]{2,}/g) || []).slice(0, 24));
  return digest.candidate.evidence
    .map((evidence, index) => ({
      id: evidence.id,
      score: [...terms].reduce(
        (score, term) => score + (evidence.content.toLocaleLowerCase().includes(term) ? 1 : 0),
        evidence.source === 'experience' || evidence.source === 'project' ? 0.1 : -index * 0.01,
      ),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((entry) => entry.id);
}

/**
 * A deterministic planner runs before the candidate presses submit. It never
 * replaces the full interviewer model: it selects what to verify so the final
 * stream can start with a focused question without another planning round-trip.
 */
export function createInterviewTurnPlan(input: {
  digest: InterviewContextDigest;
  ledger: InterviewFactLedger;
  previousQuestion: string;
  answer: string;
}): InterviewTurnPlan {
  const previous = input.previousQuestion ? classifyInterviewQuestion(input.previousQuestion) : null;
  const answer = input.answer.trim();
  const gaps = input.ledger.openGaps;
  const answerNeedsProbe = answer.length < 80 || gaps.length > 0;
  const currentIntent = previous?.intentKey || 'general';

  if (previous && answerNeedsProbe) {
    return {
      version: 1,
      action: 'probe',
      intentKey: currentIntent,
      dimension: previous.dimension,
      scenarioKey: previous.scenarioKey || 'candidate_answer',
      angle: compact(gaps[0] || 'specific decision, evidence, and result'),
      evidenceIds: matchingEvidenceIds(input.digest, answer),
    };
  }

  const focus = input.digest.company.focusAreas.find((area) => {
    const intent = intentForDimension(area.dimension);
    return intent === 'general' || !input.ledger.coveredIntents.includes(intent);
  }) || input.digest.company.focusAreas[0];
  const dimension = compact(focus?.dimension || previous?.dimension || '综合能力');
  const intentKey = intentForDimension(dimension);
  const probe = focus?.probes.find(Boolean) || gaps[0] || 'role-relevant judgment and evidence';
  return {
    version: 1,
    action: 'advance',
    intentKey,
    dimension,
    scenarioKey: 'resume_or_role_scenario',
    angle: compact(probe),
    evidenceIds: matchingEvidenceIds(input.digest, answer),
  };
}

export function hashInterviewAnswer(value: string): string {
  return createHash('sha256').update(value.trim().replace(/\s+/g, ' ')).digest('hex');
}

export function signInterviewTurnPlan(
  plan: InterviewTurnPlan,
  sessionSeed: string,
  sessionId: number,
  revision: number,
  answer: string,
): SignedInterviewTurnPlan {
  const token = createHmac('sha256', sessionSeed)
    .update(stablePlanValue(plan, sessionId, revision, hashInterviewAnswer(answer)))
    .digest('base64url');
  return { plan, token };
}

function isPlan(value: unknown): value is InterviewTurnPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<InterviewTurnPlan>;
  return plan.version === 1
    && (plan.action === 'probe' || plan.action === 'advance')
    && typeof plan.intentKey === 'string' && plan.intentKey.length <= MAX_PLAN_FIELD_LENGTH
    && typeof plan.dimension === 'string' && plan.dimension.length <= MAX_PLAN_FIELD_LENGTH
    && typeof plan.scenarioKey === 'string' && plan.scenarioKey.length <= MAX_PLAN_FIELD_LENGTH
    && typeof plan.angle === 'string' && plan.angle.length <= MAX_PLAN_FIELD_LENGTH
    && Array.isArray(plan.evidenceIds) && plan.evidenceIds.length <= 3
    && plan.evidenceIds.every((id) => typeof id === 'string' && id.length <= 80);
}

export function verifyInterviewTurnPlan(
  plan: unknown,
  token: unknown,
  sessionSeed: unknown,
  sessionId: number,
  revision: number,
  answer: string,
): InterviewTurnPlan | null {
  if (!isPlan(plan) || typeof token !== 'string' || typeof sessionSeed !== 'string' || !sessionSeed) return null;
  const expected = signInterviewTurnPlan(plan, sessionSeed, sessionId, revision, answer).token;
  const supplied = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);
  if (supplied.length !== expectedBuffer.length || !timingSafeEqual(supplied, expectedBuffer)) return null;
  return plan;
}

export function buildInterviewTurnPlanPrompt(plan: InterviewTurnPlan, language: 'zh' | 'en'): string {
  if (language === 'en') {
    return `\n\nSERVER TURN PLAN (already selected, follow it): ${plan.action === 'probe' ? 'probe the current answer' : 'advance to new ground'}. Intent: ${plan.intentKey}. Dimension: ${plan.dimension}. Scenario: ${plan.scenarioKey}. Focus angle: ${plan.angle}. Ask one natural question only; do not expose this plan.`;
  }
  return `\n\n【服务端已规划本轮】${plan.action === 'probe' ? '围绕当前回答继续深挖' : '进入新的考察点'}。考察意图：${plan.intentKey}；维度：${plan.dimension}；场景：${plan.scenarioKey}；聚焦角度：${plan.angle}。只自然地问一个问题，绝不透露这份规划。`;
}

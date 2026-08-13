import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export type PracticeMode = 'fresh' | 'targeted' | 'review';

export interface InterviewQuestionMessage {
  role?: string;
  content?: string;
  questionHash?: string;
  round?: number;
  ts?: number;
}

interface InterviewHistoryRow {
  id: number;
  target_company: string | null;
  job_id: number | null;
  practice_mode: PracticeMode | null;
  messages: InterviewQuestionMessage[] | null;
}

export function normalizeInterviewQuestion(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/\[[a-z_]{2,}\]/g, ' ')
    .replace(/[“”‘’"'`]/g, '')
    .replace(/[，。！？；：、,.!?;:()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^(请问|能不能说说|可以介绍一下|请介绍一下)\s*/u, '')
    .trim();
}

export function hashInterviewQuestion(text: string): string {
  return crypto.createHash('sha256').update(normalizeInterviewQuestion(text)).digest('hex');
}

export function hashInterviewSnapshot(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

export interface InterviewQuestionClassification {
  intentKey: string;
  dimension: string;
  scenarioKey: string;
}

export function classifyInterviewQuestion(text: string): InterviewQuestionClassification {
  const value = text.toLocaleLowerCase();
  if (/(冲突|分歧|同事|团队|conflict|disagree|stakeholder)/u.test(value)) {
    return { intentKey: 'conflict_resolution', dimension: '沟通与协作', scenarioKey: 'team_situation' };
  }
  if (/(失败|复盘|教训|改进|failure|mistake|lesson|retrospective)/u.test(value)) {
    return { intentKey: 'failure_reflection', dimension: '反思与成长', scenarioKey: 'failure_case' };
  }
  if (/(数据|指标|实验|归因|metric|experiment|causal|sql|分析)/u.test(value)) {
    return { intentKey: 'metric_attribution', dimension: '数据与分析', scenarioKey: 'project_or_business_case' };
  }
  if (/(技术|架构|代码|算法|系统|technical|architecture|algorithm|debug)/u.test(value)) {
    return { intentKey: 'technical_depth', dimension: '技术深度', scenarioKey: 'technical_scenario' };
  }
  if (/(客户|用户|需求|customer|user|requirement|产品)/u.test(value)) {
    return { intentKey: 'customer_understanding', dimension: '用户与业务理解', scenarioKey: 'customer_scenario' };
  }
  if (/(主动|负责|推动|owner|ownership|drive|deliver)/u.test(value)) {
    return { intentKey: 'ownership', dimension: '主动性与执行力', scenarioKey: 'project_or_business_case' };
  }
  return { intentKey: 'general', dimension: '综合能力', scenarioKey: 'resume_experience' };
}

export function createInterviewSessionSeed(): string {
  return crypto.randomBytes(16).toString('hex');
}

export async function getRecentInterviewQuestions(
  client: SupabaseClient,
  userId: string,
  company: string,
  jobId: number | null,
  currentSessionId?: number,
  limit = 5,
): Promise<string[]> {
  const { data, error } = await client
    .from('interview_sessions')
    .select('id, target_company, job_id, practice_mode, messages')
    .eq('user_id', userId)
    .eq('target_company', company)
    .order('created_at', { ascending: false })
    .limit(Math.max(limit * 4, 20));

  if (error || !data) return [];

  const rows = data as unknown as InterviewHistoryRow[];
  const result: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (row.id === currentSessionId) continue;
    if (row.job_id !== jobId) continue;
    if (row.practice_mode === 'review') continue;

    for (const message of row.messages || []) {
      if (message.role !== 'interviewer' || !message.content?.trim()) continue;
      const normalized = normalizeInterviewQuestion(message.content);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      result.push(message.content.trim());
      if (result.length >= 30) return result;
    }
  }

  return result;
}

export function buildQuestionHistoryNote(
  questions: string[],
  language: string,
): string {
  if (questions.length === 0) return '';
  const limited = questions
    .map((question) => question.trim().slice(0, 100))
    .filter(Boolean)
    .slice(0, 10);
  let total = 0;
  const bounded: string[] = [];
  for (const question of limited) {
    const line = `${bounded.length + 1}. ${question}`;
    if (total + line.length + (bounded.length ? 1 : 0) > 1500) break;
    bounded.push(line);
    total += line.length + (bounded.length > 1 ? 1 : 0);
  }
  const list = bounded.join('\n');
  if (!list) return '';
  return language === 'en'
    ? `\n\nRecent questions asked to this candidate at the same company and role. Do not repeat them or ask the same intent in different wording. Choose a new dimension, scenario, or angle:\n${list}`
    : `\n\n【该候选人在同一家公司和岗位近期已经被问过的问题】禁止重复这些问题，也不要换一种说法重复相同考察意图；请选择新的维度、场景或角度：\n${list}`;
}

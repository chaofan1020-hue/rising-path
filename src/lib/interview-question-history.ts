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
  const list = questions.map((question, index) => `${index + 1}. ${question}`).join('\n');
  return language === 'en'
    ? `\n\nRecent questions asked to this candidate at the same company and role. Do not repeat them or ask the same intent in different wording. Choose a new dimension, scenario, or angle:\n${list}`
    : `\n\n【该候选人在同一家公司和岗位近期已经被问过的问题】禁止重复这些问题，也不要换一种说法重复相同考察意图；请选择新的维度、场景或角度：\n${list}`;
}

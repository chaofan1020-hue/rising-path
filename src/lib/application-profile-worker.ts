import { getSupabaseClient } from '@/storage/database/supabase-client';
import { runApplicationProfileAiFill } from '@/lib/application-profile-ai';

const WORKER_INTERVAL_MS = 5_000;
const WORKER_BATCH_SIZE = 1;
const MAX_ATTEMPTS = 3;
const STALE_AFTER_MS = 15 * 60_000;

let workerStarted = false;
let workerRunning = false;

type ProfileJob = {
  id: number;
  user_id: string;
  resume_id: number;
  attempt_count: number;
};

async function claimNextJob(client: ReturnType<typeof getSupabaseClient>): Promise<ProfileJob | null> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - STALE_AFTER_MS).toISOString();
  await client
    .from('application_profile_jobs')
    .update({
      status: 'pending',
      started_at: null,
      available_at: now.toISOString(),
      updated_at: now.toISOString(),
      last_error: '任务服务重启后重新排队',
    })
    .eq('status', 'running')
    .lt('started_at', staleBefore);

  const { data: candidates, error: readError } = await client
    .from('application_profile_jobs')
    .select('id, user_id, resume_id, attempt_count')
    .eq('status', 'pending')
    .lte('available_at', now.toISOString())
    .order('created_at', { ascending: true })
    .limit(WORKER_BATCH_SIZE);
  if (readError) throw new Error(`读取 AI 档案任务失败: ${readError.message}`);

  for (const candidate of (candidates || []) as ProfileJob[]) {
    const { data: claimed, error: claimError } = await client
      .from('application_profile_jobs')
      .update({
        status: 'running',
        started_at: now.toISOString(),
        updated_at: now.toISOString(),
        attempt_count: Number(candidate.attempt_count || 0) + 1,
        last_error: null,
      })
      .eq('id', candidate.id)
      .eq('status', 'pending')
      .select('id, user_id, resume_id, attempt_count')
      .maybeSingle();
    if (claimError) throw new Error(`领取 AI 档案任务失败: ${claimError.message}`);
    if (claimed) return claimed as ProfileJob;
  }
  return null;
}

async function processNextJob(): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;
  const client = getSupabaseClient();
  try {
    const job = await claimNextJob(client);
    if (!job) return;

    try {
      const result = await runApplicationProfileAiFill({
        client,
        userId: job.user_id,
        resumeId: job.resume_id,
      });
      const { error } = await client
        .from('application_profile_jobs')
        .update({
          status: 'succeeded',
          result_version: result.version,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('id', job.id)
        .eq('status', 'running');
      if (error) throw new Error(`更新 AI 档案任务状态失败: ${error.message}`);
    } catch (error) {
      const attemptCount = Number(job.attempt_count || 0);
      const retry = attemptCount < MAX_ATTEMPTS;
      const message = error instanceof Error ? error.message : 'AI 档案更新失败';
      await client
        .from('application_profile_jobs')
        .update({
          status: retry ? 'pending' : 'failed',
          available_at: retry ? new Date(Date.now() + 15_000).toISOString() : new Date().toISOString(),
          completed_at: retry ? null : new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_error: message.slice(0, 1000),
        })
        .eq('id', job.id)
        .eq('status', 'running');
      console.error(`[ApplicationProfileWorker] failed job ${job.id}${retry ? ', retrying' : ''}:`, error);
    }
  } catch (error) {
    console.error('[ApplicationProfileWorker] queue poll failed:', error);
  } finally {
    workerRunning = false;
  }
}

export function startApplicationProfileWorker(): void {
  if (workerStarted || process.env.APPLICATION_PROFILE_AUTO_WORKER === 'false') return;
  workerStarted = true;
  const timer = setInterval(() => {
    void processNextJob();
  }, WORKER_INTERVAL_MS);
  timer.unref?.();
  void processNextJob();
}

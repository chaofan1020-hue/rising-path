import { getSupabaseClient } from '@/storage/database/supabase-client';
import { downloadResumeFile } from '@/lib/resume-storage';
import {
  hasSupportedResumeFileSignature,
  isRecord,
  MAX_RESUME_FILE_SIZE_BYTES,
  type ResumeFileOptions,
} from '@/lib/resume-parser';
import { processResume } from '@/lib/resume-processing';
import { RESUME_PROFILE_SCHEMA_VERSION } from '@/lib/resume-types';

const WORKER_INTERVAL_MS = 15_000;
const WORKER_BATCH_SIZE = 3;

let workerStarted = false;
let workerRunning = false;

async function processResumeRow(
  client: ReturnType<typeof getSupabaseClient>,
  row: Record<string, unknown>,
  source: 'initial_parse' | 'reparse',
): Promise<void> {
  if (
    typeof row.id !== 'number'
    || typeof row.user_id !== 'string'
    || typeof row.file_key !== 'string'
  ) {
    return;
  }

  try {
    const buffer = await downloadResumeFile(row.file_key);
    const userInfo = isRecord(row.user_info) ? row.user_info : {};
    const fileOptions: ResumeFileOptions = {
      fileName: typeof row.file_name === 'string' && row.file_name ? row.file_name : 'resume',
      contentType: typeof userInfo.file_type === 'string' ? userInfo.file_type : undefined,
    };
    if (
      buffer.length === 0
      || buffer.length > MAX_RESUME_FILE_SIZE_BYTES
      || !hasSupportedResumeFileSignature(buffer, fileOptions)
    ) {
      throw new Error('Resume file is empty, too large, or has an invalid signature');
    }
    await processResume({
      resumeId: row.id,
      userId: row.user_id,
      buffer,
      fileOptions,
      initialUserInfo: userInfo,
      source,
    });
  } catch (processingError) {
    console.error(`[ResumeWorker] failed to process resume ${row.id}:`, processingError);
    await client
      .from('resumes')
      .update({
        processing_status: 'failed',
        processing_stage: 'error',
        processing_error: 'Background resume processing failed. Please reparse or upload again.',
        processing_finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('user_id', row.user_id)
      .in('processing_status', source === 'reparse'
        ? ['uploaded', 'ready', 'needs_confirmation']
        : ['uploaded']);
  }
}

async function processQueuedResumes(): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;

  try {
    const client = getSupabaseClient();
    const { data: rows, error } = await client
      .from('resumes')
      .select('id, user_id, file_key, file_name, user_info')
      .eq('processing_status', 'uploaded')
      .not('file_key', 'is', null)
      .order('created_at', { ascending: true })
      .limit(WORKER_BATCH_SIZE);
    if (error) throw new Error(`Failed to read resume queue: ${error.message}`);

    for (const row of rows || []) {
      await processResumeRow(client, row, 'initial_parse');
    }

    const { data: legacyRows, error: legacyError } = await client
      .from('resumes')
      .select('id, user_id, file_key, file_name, user_info')
      .in('processing_status', ['ready', 'needs_confirmation'])
      .or(`profile->>schemaVersion.is.null,profile->>schemaVersion.neq.${RESUME_PROFILE_SCHEMA_VERSION}`)
      .order('updated_at', { ascending: true })
      .limit(WORKER_BATCH_SIZE);
    if (legacyError) throw new Error(`Failed to read legacy resume queue: ${legacyError.message}`);

    for (const row of legacyRows || []) {
      await processResumeRow(client, row, 'reparse');
    }
  } catch (error) {
    console.error('[ResumeWorker] queue poll failed:', error);
  } finally {
    workerRunning = false;
  }
}

export function startResumeProcessingWorker(): void {
  if (workerStarted) return;
  workerStarted = true;
  const timer = setInterval(() => {
    void processQueuedResumes();
  }, WORKER_INTERVAL_MS);
  timer.unref?.();
  void processQueuedResumes();
}

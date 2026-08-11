import { getSupabaseClient } from '@/storage/database/supabase-client';
import { downloadResumeFile } from '@/lib/resume-storage';
import {
  hasSupportedResumeFileSignature,
  isRecord,
  MAX_RESUME_FILE_SIZE_BYTES,
  type ResumeFileOptions,
} from '@/lib/resume-parser';
import { processResume } from '@/lib/resume-processing';

const WORKER_INTERVAL_MS = 15_000;
const WORKER_BATCH_SIZE = 3;

let workerStarted = false;
let workerRunning = false;

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
    if (error) throw new Error(`读取简历处理队列失败: ${error.message}`);

    for (const row of rows || []) {
      if (typeof row.id !== 'number' || typeof row.user_id !== 'string' || typeof row.file_key !== 'string') continue;

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
          throw new Error('简历文件为空、超过大小限制或格式签名无效');
        }
        await processResume({
          resumeId: row.id,
          userId: row.user_id,
          buffer,
          fileOptions,
          initialUserInfo: userInfo,
          source: 'initial_parse',
        });
      } catch (processingError) {
        console.error('[ResumeWorker] failed to process queued resume:', row.id, processingError);
        await client
          .from('resumes')
          .update({
            processing_status: 'failed',
            processing_stage: 'error',
            processing_error: '后台简历处理失败，请重新解析或上传',
            processing_finished_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id)
          .eq('user_id', row.user_id)
          .eq('processing_status', 'uploaded');
      }
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

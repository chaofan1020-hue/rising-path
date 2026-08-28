import { getSupabaseClient } from '@/storage/database/supabase-client';
import {
  extractTextFromResumeFile,
  isRecord,
  mergeResumeUserInfo,
  parseResumeText,
  ResumeProfileExtractionError,
  type ResumeFileOptions,
  type ResumeParseResult,
  type ResumeUserInfo,
} from '@/lib/resume-parser';
import {
  RESUME_PROFILE_SCHEMA_VERSION,
  type ResumeProcessingStage,
  type ResumeProcessingStatus,
  type SegmentationOverrides,
} from '@/lib/resume-types';
import { refineCareerPlan } from '@/lib/career-plan-refiner';
import { resolveRegionKey } from '@/lib/region-dna';
import { applyOverrides } from '@/lib/user-segmentation';

export type ResumeProcessingSource = 'initial_parse' | 'reparse';

export class ResumeProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResumeProcessingError';
  }
}

interface ProcessResumeInput {
  resumeId: number;
  userId: string;
  buffer: Buffer;
  fileOptions: ResumeFileOptions;
  initialUserInfo?: Record<string, unknown>;
  source: ResumeProcessingSource;
}

interface ResumeProcessingRow {
  user_info?: unknown;
  segmentation_overrides?: unknown;
  profile_version?: number | null;
  processing_attempts?: number | null;
  processing_status?: ResumeProcessingStatus | null;
}

async function updateProcessingState(
  client: ReturnType<typeof getSupabaseClient>,
  resumeId: number,
  userId: string,
  state: {
    status: ResumeProcessingStatus;
    stage: ResumeProcessingStage;
    error?: string | null;
    attempts?: number;
    startedAt?: string;
    finishedAt?: string;
  },
): Promise<void> {
  const payload: Record<string, unknown> = {
    processing_status: state.status,
    processing_stage: state.stage,
    processing_error: state.error ?? null,
    updated_at: new Date().toISOString(),
  };
  if (state.attempts !== undefined) payload.processing_attempts = state.attempts;
  if (state.startedAt) payload.processing_started_at = state.startedAt;
  if (state.finishedAt) payload.processing_finished_at = state.finishedAt;

  const { error } = await client
    .from('resumes')
    .update(payload)
    .eq('id', resumeId)
    .eq('user_id', userId);
  if (error) throw new Error(`更新简历处理状态失败: ${error.message}`);
}

function getUserInfo(current: unknown, initial?: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(current)) return current;
  return initial || {};
}

export async function processResume(input: ProcessResumeInput): Promise<{
  parsed: ResumeParseResult;
  version: number;
}> {
  const client = getSupabaseClient();
  const { data: current, error: currentError } = await client
    .from('resumes')
    .select('user_info, segmentation_overrides, profile_version, processing_attempts, processing_status')
    .eq('id', input.resumeId)
    .eq('user_id', input.userId)
    .single<ResumeProcessingRow>();

  if (currentError || !current) {
    throw new ResumeProcessingError('简历记录不存在或无权处理');
  }

  const attempts = Math.max(0, Number(current.processing_attempts ?? 0)) + 1;
  const startedAt = new Date().toISOString();

  // Claim the row before any parsing work. This prevents two requests from
  // deriving the same profile version and lets retries distinguish a running
  // job from a failed one.
  const claimableStatuses: ResumeProcessingStatus[] = input.source === 'initial_parse'
    ? ['uploaded']
    : ['uploaded', 'failed', 'needs_confirmation', 'ready'];
  const { data: claimed, error: claimError } = await client
    .from('resumes')
    .update({
      processing_status: 'extracting_text',
      processing_stage: 'text_extraction',
      processing_error: null,
      processing_attempts: attempts,
      processing_started_at: startedAt,
      processing_finished_at: null,
      updated_at: startedAt,
    })
    .eq('id', input.resumeId)
    .eq('user_id', input.userId)
    .in('processing_status', claimableStatuses)
    .select('id')
    .maybeSingle();

  if (claimError) throw new ResumeProcessingError(`简历处理任务抢占失败: ${claimError.message}`);
  if (!claimed) throw new ResumeProcessingError('简历正在处理中，请稍后查看处理状态');

  try {
    const extracted = await extractTextFromResumeFile(input.buffer, input.fileOptions);
    if (!extracted.text.trim()) {
      throw new ResumeProcessingError('简历中没有可读取的文本，请上传可复制文本的 PDF 或 DOCX 文件');
    }

    await updateProcessingState(client, input.resumeId, input.userId, {
      status: 'extracting_profile',
      stage: 'profile_extraction',
      attempts,
      startedAt,
    });

    const parsed = await parseResumeText(extracted.text, extracted.pages, {
      userId: input.userId,
      resumeId: input.resumeId,
    });
    if (!parsed.profile || !parsed.segmentation) {
      throw new ResumeProcessingError('简历文本已读取，但未能提取出有效求职画像，请检查内容后重试');
    }

    const storedOverrides = isRecord(current.segmentation_overrides)
      ? current.segmentation_overrides as SegmentationOverrides
      : null;
    const nextSegmentation = storedOverrides
      ? applyOverrides(parsed.segmentation, storedOverrides)
      : parsed.segmentation;
    const region = nextSegmentation.regions[0]
      ?? resolveRegionKey(parsed.profile.intention?.locations?.[0])
      ?? null;
    const planRefinement = await refineCareerPlan({
      userId: input.userId,
      profile: parsed.profile,
      segmentation: nextSegmentation,
      region,
    });
    const profile = {
      ...parsed.profile,
      schemaVersion: RESUME_PROFILE_SCHEMA_VERSION,
      ...(planRefinement ? { planRefinement } : {}),
    };

    await updateProcessingState(client, input.resumeId, input.userId, {
      status: 'deriving_segmentation',
      stage: 'segmentation',
      attempts,
      startedAt,
    });

    const version = Math.max(0, Number(current.profile_version ?? 0)) + 1;
    const now = new Date().toISOString();
    const userInfo = mergeResumeUserInfo(
      getUserInfo(current.user_info, input.initialUserInfo),
      parsed.user_info as ResumeUserInfo,
    );

    const { error: versionError } = await client.from('resume_profile_versions').insert({
      resume_id: input.resumeId,
      user_id: input.userId,
      version,
      source: input.source,
      profile,
      segmentation: nextSegmentation,
      overrides: storedOverrides ?? {},
      evidence: parsed.profile_evidence,
      confidence: parsed.profile_confidence,
      status: 'draft',
    });
    if (versionError) throw new Error(`保存画像版本失败: ${versionError.message}`);

    const { error: updateError } = await client
      .from('resumes')
      .update({
        parsed_content: parsed.parsed_content,
        user_info: userInfo,
        profile,
        segmentation: nextSegmentation,
        profile_evidence: parsed.profile_evidence,
        profile_confidence: parsed.profile_confidence,
        profile_version: version,
        segmentation_confirmed: false,
        profile_confirmed_at: null,
        profile_confirmed_by: null,
        processing_status: 'needs_confirmation',
        processing_stage: 'confirmation',
        processing_error: null,
        processing_finished_at: now,
        updated_at: now,
      })
      .eq('id', input.resumeId)
      .eq('user_id', input.userId);
    if (updateError) throw new Error(`保存简历画像失败: ${updateError.message}`);

    return { parsed, version };
  } catch (error) {
    const message = error instanceof ResumeProcessingError || error instanceof ResumeProfileExtractionError
      ? error.message
      : '简历解析失败，请重试或检查文件格式是否正确';
    const finishedAt = new Date().toISOString();

    try {
      await updateProcessingState(client, input.resumeId, input.userId, {
        status: 'failed',
        stage: 'error',
        error: message,
        attempts,
        startedAt,
        finishedAt,
      });
    } catch (stateError) {
      console.error('Failed to persist resume processing failure:', stateError);
    }

    throw error;
  }
}

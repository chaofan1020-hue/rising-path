import { randomUUID } from 'node:crypto';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import type {
  TextGenerationOptions,
  TextMessage,
  TextProviderClient,
  TextUsage,
} from '@/lib/ai/text-provider';

export type AiUsageSource = 'actual' | 'estimated' | 'unknown';
export type AiUsageStatus = 'success' | 'error';
export type AiUsageModality = 'text' | 'audio';
export type AiUsageMeasurementSource =
  | 'provider'
  | 'pcm_exact'
  | 'container_estimated'
  | 'request'
  | 'unknown';

export interface AiUsageMetadata {
  provider: string;
  model: string | null;
  requestId: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  usageSource: AiUsageSource;
}

export interface AiUsageContext {
  userId?: string | null;
  feature: string;
  provider: string;
  modality?: AiUsageModality;
  model?: string | null;
  requestId?: string;
  status?: AiUsageStatus;
  usageSource?: AiUsageSource;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  inputAudioSeconds?: number | null;
  outputAudioSeconds?: number | null;
  inputAudioBytes?: number | null;
  outputAudioBytes?: number | null;
  audioTokens?: number | null;
  textCharacters?: number | null;
  billingUnit?: string | null;
  billingUnits?: number | null;
  measurementSource?: AiUsageMeasurementSource;
  resumeId?: number | null;
  jobId?: number | null;
  interviewSessionId?: number | null;
  metadata?: Record<string, unknown>;
  errorCode?: string | null;
  errorMessage?: string | null;
  durationMs?: number | null;
  /** Time from provider invocation to the first visible content chunk. */
  ttfbMs?: number | null;
  /** Kept alongside duration_ms for the interview latency reporting contract. */
  totalMs?: number | null;
  phase?: string | null;
  fallback?: boolean;
  retryCount?: number | null;
}

interface AiModelPrice {
  id: number;
  provider: string;
  model: string;
  currency: string;
  input_token_price_per_million: number | string | null;
  output_token_price_per_million: number | string | null;
  audio_second_price: number | string | null;
  billing_unit_price: number | string | null;
  effective_from: string;
}

export interface TrackedTextGenerationContext {
  userId?: string | null;
  feature: string;
  resumeId?: number | null;
  jobId?: number | null;
  interviewSessionId?: number | null;
  metadata?: Record<string, unknown>;
  phase?: string | null;
  fallback?: boolean;
  retryCount?: number | null;
}

export interface TrackedTextGenerationResult {
  content: string;
  usage: TextUsage | null;
  requestId: string;
  ttfbMs: number | null;
  totalMs: number;
}

export async function invokeTrackedTextGeneration(
  client: TextProviderClient,
  messages: TextMessage[],
  options: TextGenerationOptions,
  context: TrackedTextGenerationContext,
): Promise<TrackedTextGenerationResult> {
  const requestId = createAiUsageRequestId();
  const startedAt = Date.now();

  try {
    const chunk = await client.invoke(messages, { ...options, requestId });
    const usage = chunk.usage || null;
    await recordAiUsageEvent({
      ...context,
      requestId,
      provider: usage?.provider || 'alibaba',
      model: usage?.model || null,
      usageSource: usage?.usageSource || 'unknown',
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      totalTokens: usage?.totalTokens,
      metadata: { ...context.metadata, provider_request_id: usage?.requestId || null },
      durationMs: Date.now() - startedAt,
      totalMs: Date.now() - startedAt,
      ttfbMs: null,
      phase: context.phase,
      fallback: context.fallback,
      retryCount: context.retryCount,
    });
    return { content: chunk.content, usage, requestId, ttfbMs: null, totalMs: Date.now() - startedAt };
  } catch (error) {
    await recordAiUsageError({
      ...context,
      requestId,
      provider: 'alibaba',
      usageSource: 'unknown',
      durationMs: Date.now() - startedAt,
      totalMs: Date.now() - startedAt,
      phase: context.phase,
      fallback: context.fallback,
      retryCount: context.retryCount,
      error,
    });
    throw error;
  }
}

export async function consumeTrackedTextStream(
  client: TextProviderClient,
  messages: TextMessage[],
  options: TextGenerationOptions,
  context: TrackedTextGenerationContext,
  onContent: (content: string) => void | Promise<void>,
): Promise<TrackedTextGenerationResult> {
  const requestId = createAiUsageRequestId();
  const startedAt = Date.now();
  let latestUsage: TextUsage | null = null;
  let content = '';
  let firstContentAt: number | null = null;

  try {
    const stream = client.stream(messages, { ...options, requestId });
    for await (const chunk of stream) {
      if (chunk.content) {
        const text = chunk.content.toString();
        if (firstContentAt === null && text.trim()) firstContentAt = Date.now();
        content += text;
        await onContent(text);
      }
      if (chunk.usage) latestUsage = chunk.usage;
    }

    await recordAiUsageEvent({
      ...context,
      requestId,
      provider: latestUsage?.provider || 'alibaba',
      model: latestUsage?.model || null,
      usageSource: latestUsage?.usageSource || 'unknown',
      inputTokens: latestUsage?.inputTokens,
      outputTokens: latestUsage?.outputTokens,
      totalTokens: latestUsage?.totalTokens,
      metadata: { ...context.metadata, provider_request_id: latestUsage?.requestId || null },
      durationMs: Date.now() - startedAt,
      totalMs: Date.now() - startedAt,
      ttfbMs: firstContentAt === null ? null : firstContentAt - startedAt,
      phase: context.phase,
      fallback: context.fallback,
      retryCount: context.retryCount,
    });

    return {
      content,
      usage: latestUsage,
      requestId,
      ttfbMs: firstContentAt === null ? null : firstContentAt - startedAt,
      totalMs: Date.now() - startedAt,
    };
  } catch (error) {
    await recordAiUsageError({
      ...context,
      requestId,
      provider: latestUsage?.provider || 'alibaba',
      model: latestUsage?.model || null,
      usageSource: latestUsage?.usageSource || 'unknown',
      inputTokens: latestUsage?.inputTokens,
      outputTokens: latestUsage?.outputTokens,
      totalTokens: latestUsage?.totalTokens,
      metadata: { ...context.metadata, provider_request_id: latestUsage?.requestId || null },
      durationMs: Date.now() - startedAt,
      totalMs: Date.now() - startedAt,
      ttfbMs: firstContentAt === null ? null : firstContentAt - startedAt,
      phase: context.phase,
      fallback: context.fallback,
      retryCount: context.retryCount,
      error,
    });
    throw error;
  }
}

export function createAiUsageRequestId(): string {
  return randomUUID();
}

function nonNegativeInteger(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function nonNegativeNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function decimalValue(value: number | string | null): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function resolveUsageCost(input: AiUsageContext, price: AiModelPrice | null): {
  estimatedCost: number | null;
  currency: string;
  priceId: number | null;
  priceSnapshot: Record<string, unknown> | null;
  costSource: 'priced' | 'unpriced';
} {
  if (!price) {
    return { estimatedCost: null, currency: 'USD', priceId: null, priceSnapshot: null, costSource: 'unpriced' };
  }

  const inputPrice = decimalValue(price.input_token_price_per_million);
  const outputPrice = decimalValue(price.output_token_price_per_million);
  const audioSecondPrice = decimalValue(price.audio_second_price);
  const billingUnitPrice = decimalValue(price.billing_unit_price);
  const inputTokens = nonNegativeInteger(input.inputTokens);
  const outputTokens = nonNegativeInteger(input.outputTokens);
  const audioSeconds = (nonNegativeNumber(input.inputAudioSeconds) || 0) + (nonNegativeNumber(input.outputAudioSeconds) || 0);
  const billingUnits = nonNegativeNumber(input.billingUnits);

  let cost = 0;
  let hasPricedMeasurement = false;
  if (inputTokens !== null && inputPrice !== null) {
    cost += (inputTokens / 1_000_000) * inputPrice;
    hasPricedMeasurement = true;
  }
  if (outputTokens !== null && outputPrice !== null) {
    cost += (outputTokens / 1_000_000) * outputPrice;
    hasPricedMeasurement = true;
  }
  if (audioSeconds > 0 && audioSecondPrice !== null) {
    cost += audioSeconds * audioSecondPrice;
    hasPricedMeasurement = true;
  }
  if (billingUnits !== null && billingUnitPrice !== null) {
    cost += billingUnits * billingUnitPrice;
    hasPricedMeasurement = true;
  }

  return {
    estimatedCost: hasPricedMeasurement ? Number(cost.toFixed(8)) : null,
    currency: price.currency,
    priceId: price.id,
    priceSnapshot: {
      provider: price.provider,
      model: price.model,
      currency: price.currency,
      input_token_price_per_million: inputPrice,
      output_token_price_per_million: outputPrice,
      audio_second_price: audioSecondPrice,
      billing_unit_price: billingUnitPrice,
      effective_from: price.effective_from,
    },
    costSource: hasPricedMeasurement ? 'priced' : 'unpriced',
  };
}

async function findActiveAiModelPrice(input: AiUsageContext): Promise<AiModelPrice | null> {
  const model = input.model?.trim();
  if (!model) return null;

  const createdAt = new Date().toISOString();
  const { data, error } = await getSupabaseClient()
    .from('ai_model_prices')
    .select('id, provider, model, currency, input_token_price_per_million, output_token_price_per_million, audio_second_price, billing_unit_price, effective_from')
    .eq('provider', input.provider)
    .eq('model', model)
    .eq('is_active', true)
    .lte('effective_from', createdAt)
    .or(`effective_to.is.null,effective_to.gt.${createdAt}`)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[AI Usage] price lookup failed:', error.message);
    return null;
  }
  return data as AiModelPrice | null;
}

export async function recordAiUsageEvent(input: AiUsageContext): Promise<void> {
  const requestId = input.requestId || createAiUsageRequestId();
  const price = await findActiveAiModelPrice(input);
  const cost = resolveUsageCost(input, price);
  const payload = {
    request_id: requestId,
    user_id: input.userId || null,
    feature: input.feature,
    provider: input.provider,
    modality: input.modality || 'text',
    model: input.model || null,
    status: input.status || 'success',
    usage_source: input.usageSource || 'unknown',
    input_tokens: nonNegativeInteger(input.inputTokens),
    output_tokens: nonNegativeInteger(input.outputTokens),
    total_tokens: nonNegativeInteger(input.totalTokens),
    estimated_cost: cost.estimatedCost,
    currency: cost.currency,
    price_id: cost.priceId,
    price_snapshot: cost.priceSnapshot,
    cost_source: cost.costSource,
    input_audio_seconds: nonNegativeNumber(input.inputAudioSeconds),
    output_audio_seconds: nonNegativeNumber(input.outputAudioSeconds),
    input_audio_bytes: nonNegativeInteger(input.inputAudioBytes),
    output_audio_bytes: nonNegativeInteger(input.outputAudioBytes),
    audio_tokens: nonNegativeInteger(input.audioTokens),
    text_characters: nonNegativeInteger(input.textCharacters),
    billing_unit: input.billingUnit || null,
    billing_units: nonNegativeNumber(input.billingUnits),
    measurement_source: input.measurementSource || 'unknown',
    resume_id: input.resumeId || null,
    job_id: input.jobId || null,
    interview_session_id: input.interviewSessionId || null,
    metadata: input.metadata || {},
    error_code: input.errorCode || null,
    error_message: input.errorMessage ? input.errorMessage.slice(0, 500) : null,
    duration_ms: nonNegativeInteger(input.durationMs),
    ttfb_ms: nonNegativeInteger(input.ttfbMs),
    total_ms: nonNegativeInteger(input.totalMs ?? input.durationMs),
    phase: input.phase?.trim().slice(0, 64) || null,
    fallback: input.fallback ?? false,
    retry_count: nonNegativeInteger(input.retryCount) ?? 0,
  };

  try {
    const client = getSupabaseClient();
    const { error } = await client.from('ai_usage_events').insert(payload);
    if (!error) return;

    // During a rolling deployment, PostgREST can briefly see the old schema.
    // Preserve the usage event even when the optional 0023 cost columns are absent.
    if (error.code === 'PGRST204' || error.code === 'PGRST205') {
      const {
        price_id,
        price_snapshot,
        cost_source,
        ttfb_ms,
        total_ms,
        phase,
        fallback,
        retry_count,
        ...legacyPayload
      } = payload;
      const { error: fallbackError } = await client.from('ai_usage_events').insert(legacyPayload);
      if (!fallbackError) return;
      console.error('[AI Usage] fallback record failed:', fallbackError.message);
      return;
    }
    console.error('[AI Usage] failed to record event:', error.message);
  } catch (error) {
    console.error('[AI Usage] failed to record event:', error);
  }
}

export function countTextCharacters(text: string): number {
  return Array.from(text).length;
}

export function estimatePcmDurationSeconds(
  byteLength: number,
  sampleRate: number,
  channels = 1,
  bitsPerSample = 16,
): number | null {
  if (!Number.isFinite(byteLength) || byteLength < 0 || sampleRate <= 0 || channels <= 0 || bitsPerSample <= 0) {
    return null;
  }
  return byteLength / (sampleRate * channels * (bitsPerSample / 8));
}

export function estimateMp3DurationSeconds(byteLength: number, bitrate = 128_000): number | null {
  if (!Number.isFinite(byteLength) || byteLength < 0 || bitrate <= 0) return null;
  return (byteLength * 8) / bitrate;
}

export async function recordAiUsageError(
  input: Omit<AiUsageContext, 'status'> & { error?: unknown },
): Promise<void> {
  const errorMessage = input.error instanceof Error ? input.error.message : String(input.error || 'AI request failed');
  await recordAiUsageEvent({
    ...input,
    status: 'error',
    errorMessage,
  });
}

export async function runTrackedTextGeneration(
  client: TextProviderClient,
  messages: TextMessage[],
  options: TextGenerationOptions,
  context: TrackedTextGenerationContext,
): Promise<TrackedTextGenerationResult> {
  const requestId = createAiUsageRequestId();
  const startedAt = Date.now();
  let latestUsage: TextUsage | null = null;

  try {
    let content = '';
    const stream = client.stream(messages, { ...options, requestId });
    for await (const chunk of stream) {
      if (chunk.content) content += chunk.content.toString();
      if (chunk.usage) latestUsage = chunk.usage;
    }

    await recordAiUsageEvent({
      ...context,
      requestId,
      provider: latestUsage?.provider || 'alibaba',
      model: latestUsage?.model || null,
      usageSource: latestUsage?.usageSource || 'unknown',
      inputTokens: latestUsage?.inputTokens,
      outputTokens: latestUsage?.outputTokens,
      totalTokens: latestUsage?.totalTokens,
      metadata: {
        ...context.metadata,
        provider_request_id: latestUsage?.requestId || null,
      },
      durationMs: Date.now() - startedAt,
    });

    return {
      content,
      usage: latestUsage,
      requestId,
      ttfbMs: null,
      totalMs: Date.now() - startedAt,
    };
  } catch (error) {
    await recordAiUsageError({
      ...context,
      requestId,
      provider: latestUsage?.provider || 'alibaba',
      model: latestUsage?.model || null,
      usageSource: latestUsage?.usageSource || 'unknown',
      inputTokens: latestUsage?.inputTokens,
      outputTokens: latestUsage?.outputTokens,
      totalTokens: latestUsage?.totalTokens,
      metadata: {
        ...context.metadata,
        provider_request_id: latestUsage?.requestId || null,
      },
      durationMs: Date.now() - startedAt,
      error,
    });
    throw error;
  }
}

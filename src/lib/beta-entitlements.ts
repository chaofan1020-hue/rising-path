import { randomUUID } from 'node:crypto';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export type BetaMetric =
  | 'resume_parse'
  | 'ai_match'
  | 'resume_optimize'
  | 'resume_score'
  | 'interview_turn'
  | 'ai_text'
  | 'asr_minutes'
  | 'tts_minutes';

export interface BetaReservation {
  reservationId: number;
  metric: BetaMetric;
  amount: number;
  remaining: number;
  resetAt: string | null;
}

export class BetaEntitlementError extends Error {
  readonly code: string;
  readonly status: number;
  readonly resetAt: string | null;

  constructor(code: string, message: string, status = 429, resetAt: string | null = null) {
    super(message);
    this.name = 'BetaEntitlementError';
    this.code = code;
    this.status = status;
    this.resetAt = resetAt;
  }
}

export function isBetaAccessEnforced(): boolean {
  return process.env.BETA_ACCESS_ENFORCED?.trim().toLowerCase() === 'true';
}

export function isBetaRealtimeVoiceEnabled(): boolean {
  return process.env.BETA_REALTIME_VOICE_ENABLED?.trim().toLowerCase() === 'true';
}

export function metricForAiFeature(feature: string): BetaMetric {
  if (feature === 'ai_match') return 'ai_match';
  if (feature === 'resume_optimize') return 'resume_optimize';
  if (feature === 'resume_score') return 'resume_score';
  if (feature === 'interview_chat' || feature === 'interview_summary') return 'interview_turn';
  if (feature === 'resume_profile_extraction' || feature === 'resume_profile' || feature === 'resume_parse') return 'resume_parse';
  return 'ai_text';
}

function quotaMessage(code: string): string {
  switch (code) {
    case 'BETA_ACCESS_REQUIRED': return '当前账号尚未开通内测资格';
    case 'BETA_ACCESS_INACTIVE': return '当前内测资格已暂停或已到期';
    case 'BETA_QUOTA_EXCEEDED': return '当前内测额度已用完，请等待额度恢复';
    case 'BETA_METRIC_NOT_CONFIGURED': return '当前能力暂未开放内测';
    default: return '当前内测能力暂时不可用';
  }
}

export async function reserveBetaUsage(input: {
  userId?: string | null;
  metric: BetaMetric;
  amount?: number;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}): Promise<BetaReservation | null> {
  if (!isBetaAccessEnforced() || !input.userId) return null;
  const amount = input.amount ?? 1;
  const { data, error } = await getSupabaseClient().rpc('reserve_beta_usage', {
    p_user_id: input.userId,
    p_metric: input.metric,
    p_amount: amount,
    p_idempotency_key: input.idempotencyKey || randomUUID(),
    p_metadata: input.metadata || {},
  });
  if (error) throw new Error(`内测额度检查失败: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.allowed) {
    const code = String(row?.code || 'BETA_UNAVAILABLE');
    throw new BetaEntitlementError(code, quotaMessage(code), code === 'BETA_ACCESS_REQUIRED' ? 403 : 429, row?.reset_at || null);
  }
  return {
    reservationId: Number(row.reservation_id),
    metric: input.metric,
    amount,
    remaining: Number(row.remaining || 0),
    resetAt: row.reset_at || null,
  };
}

export async function settleBetaUsage(reservation: BetaReservation | null, status: 'committed' | 'released'): Promise<void> {
  if (!reservation) return;
  const { error } = await getSupabaseClient().rpc('settle_beta_usage', {
    p_reservation_id: reservation.reservationId,
    p_status: status,
  });
  if (error) console.error('[Beta Entitlement] settle failed:', error.message);
}

export function betaEntitlementResponse(error: unknown): Response | null {
  if (error instanceof Error && error.name === 'CreditBalanceError') {
    const creditError = error as Error & { code?: string; status?: number; remaining?: number };
    return Response.json({
      data: null,
      error: creditError.message,
      code: creditError.code || 'CREDIT_UNAVAILABLE',
      remaining: Number(creditError.remaining || 0),
    }, { status: creditError.status || 429 });
  }
  if (!(error instanceof BetaEntitlementError)) return null;
  return Response.json({
    data: null,
    error: error.message,
    code: error.code,
    resetAt: error.resetAt,
  }, { status: error.status });
}

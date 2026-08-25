import { randomUUID } from 'node:crypto';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export type CreditMetric =
  | 'resume_parse'
  | 'ai_match'
  | 'resume_optimize'
  | 'resume_score'
  | 'interview_turn'
  | 'asr_minutes'
  | 'tts_minutes'
  | 'application_profile'
  | 'application_prefill'
  | 'career_plan_refine'
  | 'networking_recommendation'
  | 'ai_text';

export interface CreditReservation {
  reservationId: number;
  metric: CreditMetric;
  units: number;
  credits: number;
  remaining: number;
}

export class CreditBalanceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly remaining: number;

  constructor(code: string, message: string, status = 429, remaining = 0) {
    super(message);
    this.name = 'CreditBalanceError';
    this.code = code;
    this.status = status;
    this.remaining = remaining;
  }
}

export function isCreditsEnforced(): boolean {
  return process.env.CREDITS_ENFORCED?.trim().toLowerCase() === 'true';
}

/**
 * The environment value is the fallback for deployments that have not run the
 * settings migration yet. Once present, the database value is the operational
 * switch used by the admin console.
 */
async function isCreditEnforcementEnabled(): Promise<boolean> {
  const fallback = isCreditsEnforced();
  try {
    const { data, error } = await getSupabaseClient()
      .from('platform_settings')
      .select('setting_value')
      .eq('setting_key', 'credits_enforced')
      .maybeSingle();
    if (error) {
      console.error('[Credits] Failed to read enforcement setting:', error.message);
      return fallback;
    }
    const value = data?.setting_value;
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.enabled === 'boolean') {
      return value.enabled;
    }
  } catch (error) {
    console.error('[Credits] Failed to read enforcement setting:', error);
  }
  return fallback;
}

export function metricForFeature(feature: string): CreditMetric {
  if (feature === 'ai_match') return 'ai_match';
  if (feature === 'resume_optimize') return 'resume_optimize';
  if (feature === 'resume_score') return 'resume_score';
  if (feature === 'interview_chat' || feature === 'interview_summary') return 'interview_turn';
  if (feature === 'interview_asr' || feature === 'interview_asr_realtime') return 'asr_minutes';
  if (feature === 'interview_tts' || feature === 'interview_tts_realtime') return 'tts_minutes';
  if (feature === 'application_profile') return 'application_profile';
  if (feature === 'application_prefill') return 'application_prefill';
  if (feature === 'career_plan_refine') return 'career_plan_refine';
  if (feature === 'networking_recommendation') return 'networking_recommendation';
  if (feature === 'resume_profile_extraction' || feature === 'resume_profile' || feature === 'resume_parse') return 'resume_parse';
  return 'ai_text';
}

function messageForCode(code: string): string {
  switch (code) {
    case 'CREDIT_INSUFFICIENT': return '当前积分不足，请联系管理员补充积分';
    case 'CREDIT_METRIC_NOT_CONFIGURED': return '当前能力暂未开放';
    case 'CREDIT_REQUEST_TOO_LARGE': return '本次请求超过单次使用上限';
    default: return '当前积分服务暂时不可用';
  }
}

export async function reserveCredits(input: {
  userId?: string | null;
  metric: CreditMetric;
  units?: number;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}): Promise<CreditReservation | null> {
  if (!input.userId || !(await isCreditEnforcementEnabled())) return null;
  const units = input.units ?? 1;
  const { data, error } = await getSupabaseClient().rpc('reserve_credits', {
    p_user_id: input.userId,
    p_metric: input.metric,
    p_units: units,
    p_idempotency_key: input.idempotencyKey || randomUUID(),
    p_require_beta: false,
    p_metadata: input.metadata || {},
  });
  if (error) throw new Error(`积分检查失败: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.allowed) {
    const code = String(row?.code || 'CREDIT_UNAVAILABLE');
    throw new CreditBalanceError(code, messageForCode(code), 429, Number(row?.remaining || 0));
  }
  return {
    reservationId: Number(row.reservation_id),
    metric: input.metric,
    units,
    credits: Number(row.credits || 0),
    remaining: Number(row.remaining || 0),
  };
}

export async function settleCredits(reservation: CreditReservation | null, status: 'committed' | 'released'): Promise<void> {
  if (!reservation) return;
  const { error } = await getSupabaseClient().rpc('settle_credits', {
    p_reservation_id: reservation.reservationId,
    p_status: status,
  });
  if (error) console.error('[Credits] settle failed:', error.message);
}

export async function settleCreditsActual(
  reservation: CreditReservation | null,
  actualUnits: number,
  status: 'committed' | 'released' = 'committed',
  reason?: string,
): Promise<void> {
  if (!reservation) return;
  const { error } = await getSupabaseClient().rpc('settle_credits_actual', {
    p_reservation_id: reservation.reservationId,
    p_actual_units: Number.isFinite(actualUnits) ? Math.max(0, actualUnits) : 0,
    p_status: status,
    p_reason: reason || null,
  });
  if (error) console.error('[Credits] actual settle failed:', error.message);
}

export async function assertCreditsAvailable(input: {
  userId?: string | null;
  metric: CreditMetric;
  units?: number;
}): Promise<void> {
  if (!input.userId || !(await isCreditEnforcementEnabled())) return;
  const units = input.units ?? 1;
  const client = getSupabaseClient();
  const [{ data: account, error: accountError }, { data: rule, error: ruleError }] = await Promise.all([
    client.from('credit_accounts').select('balance').eq('user_id', input.userId).maybeSingle(),
    client.from('credit_price_rules').select('credit_cost,enabled,max_units_per_request').eq('metric', input.metric).maybeSingle(),
  ]);
  if (accountError || ruleError) throw new Error('积分预检失败');
  if (!rule?.enabled) throw new CreditBalanceError('CREDIT_METRIC_NOT_CONFIGURED', messageForCode('CREDIT_METRIC_NOT_CONFIGURED'));
  if (rule.max_units_per_request !== null && Number(rule.max_units_per_request) < units) {
    throw new CreditBalanceError('CREDIT_REQUEST_TOO_LARGE', messageForCode('CREDIT_REQUEST_TOO_LARGE'));
  }
  const balance = Number(account?.balance || 0);
  const charge = Number(rule.credit_cost || 0) * units;
  if (balance < charge) throw new CreditBalanceError('CREDIT_INSUFFICIENT', messageForCode('CREDIT_INSUFFICIENT'), 429, balance);
}

export function creditResponse(error: unknown): Response | null {
  if (!(error instanceof CreditBalanceError)) return null;
  return Response.json({
    data: null,
    error: error.message,
    code: error.code,
    remaining: error.remaining,
  }, { status: error.status });
}

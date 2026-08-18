import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import {
  FEATURE_CODES,
  type BillingSnapshot,
  type FeatureCode,
  type FeatureEntitlement,
} from './billing-types';

export type { BillingSnapshot, FeatureCode, FeatureEntitlement } from './billing-types';
export { FEATURE_CODES } from './billing-types';

export type FeatureAccessCode =
  | 'OK'
  | 'PLAN_REQUIRED'
  | 'USAGE_EXHAUSTED'
  | 'SERVICE_UNAVAILABLE';

export interface FeatureAccessDecision {
  allowed: boolean;
  code: FeatureAccessCode;
  feature: FeatureCode;
  planCode?: string;
  remaining?: number | null;
  message?: string;
}

function emptyEntitlement(feature: FeatureCode): FeatureEntitlement {
  return {
    feature,
    quotaLimit: null,
    quotaUsed: 0,
    quotaRemaining: null,
    grantLimit: 0,
    grantUsed: 0,
    grantRemaining: 0,
  };
}

function fallbackBasicSnapshot(): BillingSnapshot {
  return {
    planCode: 'basic',
    planName: 'Basic',
    isPro: false,
    features: Object.fromEntries(
      FEATURE_CODES.map((feature) => [feature, emptyEntitlement(feature)])
    ) as Record<FeatureCode, FeatureEntitlement>,
  };
}

function nonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function nullableNonNegativeInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function buildSnapshot(rows: unknown[]): BillingSnapshot {
  let planCode: BillingSnapshot['planCode'] = 'basic';
  let planName = 'Basic';
  const features = Object.fromEntries(
    FEATURE_CODES.map((feature) => [feature, emptyEntitlement(feature)])
  ) as Record<FeatureCode, FeatureEntitlement>;

  for (const row of rows) {
    const item = (row ?? {}) as Record<string, unknown>;
    const feature = item.feature_code as FeatureCode | undefined;
    if (!feature || !FEATURE_CODES.includes(feature)) continue;
    planCode = item.plan_code === 'pro' ? 'pro' : 'basic';
    planName = typeof item.plan_name === 'string' && item.plan_name ? item.plan_name : planName;
    const quotaLimit = nullableNonNegativeInteger(item.quota_limit);
    const quotaUsed = nonNegativeInteger(item.quota_used);
    const grantLimit = nonNegativeInteger(item.grant_limit);
    const grantUsed = nonNegativeInteger(item.grant_used);
    features[feature] = {
      feature,
      quotaLimit,
      quotaUsed,
      quotaRemaining: quotaLimit === null ? null : Math.max(0, quotaLimit - quotaUsed),
      grantLimit,
      grantUsed,
      grantRemaining: Math.max(0, grantLimit - grantUsed),
    };
  }

  return {
    planCode,
    planName,
    isPro: planCode === 'pro',
    features,
  };
}

export async function getBillingSnapshot(
  client: SupabaseClient,
  userId: string,
): Promise<BillingSnapshot> {
  try {
    const { data, error } = await client.rpc('get_user_entitlements', {
      p_user: userId,
    });
    if (error) {
      console.error('[Entitlements] get_user_entitlements failed:', error.message);
      return fallbackBasicSnapshot();
    }
    return buildSnapshot(Array.isArray(data) ? data : []);
  } catch (error) {
    console.error('[Entitlements] billing snapshot failed:', error);
    return fallbackBasicSnapshot();
  }
}

export async function requirePlanFeature(
  client: SupabaseClient,
  userId: string,
  feature: FeatureCode,
): Promise<FeatureAccessDecision> {
  const snapshot = await getBillingSnapshot(client, userId);
  if (snapshot.isPro) {
    return {
      allowed: true,
      code: 'OK',
      feature,
      planCode: snapshot.planCode,
    };
  }
  return {
    allowed: false,
    code: 'PLAN_REQUIRED',
    feature,
    planCode: snapshot.planCode,
    message: '该功能需要 Pro 订阅',
  };
}

export async function consumeFeatureAccess(
  client: SupabaseClient,
  userId: string,
  feature: FeatureCode,
): Promise<FeatureAccessDecision> {
  try {
    const { data, error } = await client.rpc('consume_feature_usage', {
      p_user: userId,
      p_feature: feature,
      p_quantity: 1,
    });
    if (error) {
      console.error('[Entitlements] consume_feature_usage failed:', error.message);
      return {
        allowed: false,
        code: 'SERVICE_UNAVAILABLE',
        feature,
        message: '额度服务暂不可用，请稍后再试',
      };
    }
    const result = (data ?? {}) as Record<string, unknown>;
    if (result.allowed === true) {
      return {
        allowed: true,
        code: 'OK',
        feature,
        planCode: typeof result.plan === 'string' ? result.plan : 'basic',
        remaining: result.remaining === null || result.remaining === undefined
          ? null
          : Number(result.remaining),
      };
    }
    const reason = result.reason === 'USAGE_EXHAUSTED' ? 'USAGE_EXHAUSTED' : 'PLAN_REQUIRED';
    return {
      allowed: false,
      code: reason,
      feature,
      planCode: typeof result.plan === 'string' ? result.plan : 'basic',
      remaining: 0,
      message: reason === 'USAGE_EXHAUSTED'
        ? '免费体验额度已用完，升级 Pro 解锁无限使用'
        : '该功能需要 Pro 订阅',
    };
  } catch (error) {
    console.error('[Entitlements] consume feature failed:', error);
    return {
      allowed: false,
      code: 'SERVICE_UNAVAILABLE',
      feature,
      message: '额度服务暂不可用，请稍后再试',
    };
  }
}

export function entitlementErrorResponse(decision: FeatureAccessDecision): NextResponse {
  return NextResponse.json(
    {
      error: decision.message || '需要 Pro 订阅',
      code: decision.code,
      upgradeUrl: '/pricing',
    },
    { status: 403 },
  );
}

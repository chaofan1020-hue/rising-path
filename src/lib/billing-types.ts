export type FeatureCode =
  | 'ai_match'
  | 'ats_optimize'
  | 'mock_interview'
  | 'networking'
  | 'auto_apply';

export const FEATURE_CODES: FeatureCode[] = [
  'ai_match',
  'ats_optimize',
  'mock_interview',
  'networking',
  'auto_apply',
];

export interface FeatureEntitlement {
  feature: FeatureCode;
  quotaLimit: number | null;
  quotaUsed: number;
  quotaRemaining: number | null;
  grantLimit: number;
  grantUsed: number;
  grantRemaining: number;
}

export interface BillingSnapshot {
  planCode: 'basic' | 'pro';
  planName: string;
  isPro: boolean;
  features: Record<FeatureCode, FeatureEntitlement>;
}

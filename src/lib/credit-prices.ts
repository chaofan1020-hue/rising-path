export type CreditMetricCost = Record<string, number>;

export type CreditPriceRule = {
  metric: string;
  display_name: string;
  unit_name: string;
  creditCost: number;
  maxUnitsPerRequest: number | null;
  notes: string | null;
};

/** Seed defaults used only until the live catalog loads. */
export const CREDIT_COST_FALLBACKS: CreditMetricCost = {
  resume_parse: 20,
  ai_match: 8,
  resume_optimize: 15,
  resume_score: 5,
  interview_turn: 12,
  asr_minutes: 4,
  tts_minutes: 4,
  application_profile: 20,
  application_prefill: 8,
  career_plan_refine: 3,
  networking_recommendation: 3,
};

export function formatCreditCost(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value);
}

export function creditCostFromRules(
  prices: Array<{ metric?: string; creditCost?: number }> | null | undefined,
  metric: string,
  fallback = CREDIT_COST_FALLBACKS[metric],
): number {
  const rule = (prices || []).find((item) => item.metric === metric);
  const next = Number(rule?.creditCost);
  if (Number.isFinite(next) && next > 0) return next;
  return fallback;
}

export function mapCreditPriceRows(
  rows: Array<{
    metric?: string | null;
    display_name?: string | null;
    unit_name?: string | null;
    credit_cost?: number | string | null;
    max_units_per_request?: number | string | null;
    notes?: string | null;
  }> | null | undefined,
): CreditPriceRule[] {
  return (rows || []).flatMap((item) => {
    const metric = typeof item.metric === 'string' ? item.metric.trim() : '';
    const creditCost = Number(item.credit_cost);
    if (!metric || !Number.isFinite(creditCost) || creditCost <= 0) return [];
    const maxRaw = item.max_units_per_request;
    const maxUnits = maxRaw === null || maxRaw === undefined || maxRaw === '' ? null : Number(maxRaw);
    return [{
      metric,
      display_name: typeof item.display_name === 'string' && item.display_name.trim() ? item.display_name : metric,
      unit_name: typeof item.unit_name === 'string' ? item.unit_name : '',
      creditCost,
      maxUnitsPerRequest: Number.isFinite(maxUnits) ? maxUnits : null,
      notes: typeof item.notes === 'string' ? item.notes : null,
    }];
  });
}

export function pricesToCostMap(prices: Array<{ metric: string; creditCost: number }>): CreditMetricCost {
  const next = { ...CREDIT_COST_FALLBACKS };
  for (const item of prices) {
    if (item.metric && Number.isFinite(item.creditCost) && item.creditCost > 0) {
      next[item.metric] = item.creditCost;
    }
  }
  return next;
}

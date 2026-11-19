'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import {
  CREDIT_COST_FALLBACKS,
  formatCreditCost,
  pricesToCostMap,
  type CreditMetricCost,
} from '@/lib/credit-prices';

type PricePayload = { metric?: string; creditCost?: number };

function readPrices(payload: unknown): PricePayload[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = (payload as { data?: { prices?: PricePayload[] } }).data;
  return Array.isArray(data?.prices) ? data.prices : [];
}

function readBalance(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const balance = (payload as { data?: { balance?: number } }).data?.balance;
  return typeof balance === 'number' && Number.isFinite(balance) ? balance : null;
}

export function useCreditPrices() {
  const [costs, setCosts] = useState<CreditMetricCost>(CREDIT_COST_FALLBACKS);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const publicResponse = await fetch('/api/credits/prices', { cache: 'no-store' });
        if (publicResponse.ok) {
          const json = await publicResponse.json();
          if (!cancelled) setCosts(pricesToCostMap(readPrices(json).map((item) => ({
            metric: String(item.metric || ''),
            creditCost: Number(item.creditCost),
          }))));
        }
      } catch {
        // Keep seed fallbacks until the authenticated catalog loads.
      }

      try {
        const response = await apiFetch('/api/credits', { cache: 'no-store' });
        if (response.ok) {
          const json = await response.json();
          if (!cancelled) {
            const prices = readPrices(json);
            if (prices.length > 0) {
              setCosts(pricesToCostMap(prices.map((item) => ({
                metric: String(item.metric || ''),
                creditCost: Number(item.creditCost),
              }))));
            }
            const nextBalance = readBalance(json);
            if (nextBalance !== null) setBalance(nextBalance);
          }
        }
      } catch {
        // Balance stays unknown when the user is signed out.
      }

      if (!cancelled) setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const costFor = useCallback((metric: string) => {
    const live = Number(costs[metric]);
    if (Number.isFinite(live) && live > 0) return live;
    const fallback = Number(CREDIT_COST_FALLBACKS[metric]);
    return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
  }, [costs]);

  const actionLabel = useCallback((action: string, metric: string, unit: string) => {
    const cost = costFor(metric);
    if (!cost) return action;
    return `${action} · ${formatCreditCost(cost)} ${unit}`;
  }, [costFor]);

  return { costFor, actionLabel, formatCost: formatCreditCost, balance, loading, costs };
}

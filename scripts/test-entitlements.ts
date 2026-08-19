import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getBillingSnapshot } from '../src/lib/entitlements';
import type { FeatureCode } from '../src/lib/billing-types';

function fakeClient(data: unknown, error: { message: string } | null = null): SupabaseClient {
  return {
    rpc: async () => ({ data, error }),
  } as unknown as SupabaseClient;
}

const basicRows = [
  { plan_code: 'basic', plan_name: 'Basic', feature_code: 'ai_match' as FeatureCode, quota_used: 1, quota_limit: 3, grant_used: 0, grant_limit: 3 },
  { plan_code: 'basic', plan_name: 'Basic', feature_code: 'mock_interview' as FeatureCode, quota_used: 0, quota_limit: 0, grant_used: 2, grant_limit: 3 },
  { plan_code: 'basic', plan_name: 'Basic', feature_code: 'networking' as FeatureCode, quota_used: 0, quota_limit: 0, grant_used: 0, grant_limit: 0 },
];

async function testBasicSnapshot() {
  const snapshot = await getBillingSnapshot(fakeClient(basicRows), 'user-1');
  assert.equal(snapshot.planCode, 'basic');
  assert.equal(snapshot.isPro, false);
  assert.equal(snapshot.features.ai_match.quotaLimit, 3);
  assert.equal(snapshot.features.ai_match.quotaRemaining, 2);
  assert.equal(snapshot.features.ai_match.grantRemaining, 3);
  assert.equal(snapshot.features.mock_interview.grantRemaining, 1);
  assert.equal(snapshot.features.networking.quotaLimit, 0);
  assert.equal(snapshot.features.auto_apply.quotaLimit, null);
}

async function testProSnapshot() {
  const rows = basicRows.map((row) => ({
    ...row,
    plan_code: 'pro',
    plan_name: 'Pro',
    quota_limit: null,
    quota_used: 0,
    grant_limit: 0,
    grant_used: 0,
  }));
  const snapshot = await getBillingSnapshot(fakeClient(rows), 'user-1');
  assert.equal(snapshot.planCode, 'pro');
  assert.equal(snapshot.isPro, true);
  assert.equal(snapshot.features.mock_interview.quotaLimit, null);
  assert.equal(snapshot.features.mock_interview.quotaRemaining, null);
}

async function testRpcErrorFallback() {
  const snapshot = await getBillingSnapshot(fakeClient(null, { message: 'rpc failed' }), 'user-1');
  assert.equal(snapshot.planCode, 'basic');
  assert.equal(snapshot.isPro, false);
  assert.equal(snapshot.features.ai_match.quotaLimit, null);
}

async function main() {
  await testBasicSnapshot();
  await testProSnapshot();
  await testRpcErrorFallback();
  console.log('entitlements tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

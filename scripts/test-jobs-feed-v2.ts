import assert from 'node:assert/strict';
import { jobContentHash } from '@/lib/job-sync';
import { normalizeFeedItem, normalizeSkipReason, type JobsFeedItem } from '@/lib/jobs-feed';

function item(overrides: Partial<JobsFeedItem> = {}): JobsFeedItem {
  return {
    id: 'stripe-1',
    external_job_id: 'greenhouse:stripe:8247120',
    source_key: 'greenhouse:stripe',
    apply_url: 'https://stripe.com/jobs/search?gh_jid=8247120',
    source_updated_at: '2026-11-24T10:00:00Z',
    snapshot_id: 'greenhouse:stripe:2026-11-24T10:00:00Z',
    source_tier: 'S',
    is_list_only: false,
    first_seen_at: '2026-11-20T10:00:00Z',
    last_seen_at: '2026-11-24T10:00:00Z',
    title: 'Software Engineer',
    company_name: 'Stripe',
    source_url: 'https://stripe.com/jobs/search?gh_jid=8247120',
    location: 'New York, NY, United States',
    country: 'United States',
    description: 'Build payment infrastructure.',
    status: 'open',
    ...overrides,
  };
}

async function main() {
  const record = normalizeFeedItem(item());
  assert.ok(record, 'v2 item should normalize');
  assert.equal(record.source_key, 'greenhouse:stripe');
  assert.equal(record.apply_url, 'https://stripe.com/jobs/search?gh_jid=8247120');
  assert.equal(record.source_tier, 'S');
  assert.equal(record.is_list_only, false);
  assert.equal(record.display_status, 'listed');
  assert.equal(record.first_seen_at, '2026-11-20T10:00:00.000Z');
  assert.equal(record.last_seen_at, '2026-11-24T10:00:00.000Z');
  assert.equal(record.snapshot_id, 'greenhouse:stripe:2026-11-24T10:00:00Z');

  const listOnly = normalizeFeedItem(item({ is_list_only: true, source_tier: 'B' }));
  assert.ok(listOnly);
  assert.equal(listOnly.is_list_only, true);
  assert.equal(listOnly.source_tier, 'B');

  const missingTier = normalizeFeedItem(item({ source_tier: 'Z' }));
  assert.ok(missingTier);
  assert.equal(missingTier.source_tier, null);

  assert.equal(normalizeSkipReason(item()), null);
  assert.equal(normalizeSkipReason(item({ source_key: null })), 'not_ats_source');
  assert.equal(normalizeSkipReason(item({ title: '' })), 'missing_title');

  // The daily heartbeat must not churn the content hash.
  assert.equal(jobContentHash(record), jobContentHash({ ...record, last_seen_at: '2026-11-25T10:00:00.000Z' }));
  // A real source change must churn it.
  assert.notEqual(jobContentHash(record), jobContentHash({ ...record, title: 'Senior Software Engineer' }));

  console.log('jobs-feed-v2: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
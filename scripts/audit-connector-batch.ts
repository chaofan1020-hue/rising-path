import { config as loadDotenv } from 'dotenv';
import { PHASE2_COMPANY_PROFILES, syncConnectorBoard } from '@/lib/job-connectors';

loadDotenv({ path: '.env.local' });

const concurrency = 3;

async function main(): Promise<void> {
  const profiles = PHASE2_COMPANY_PROFILES;
  const results: Array<Record<string, unknown>> = [];
  let next = 0;
  async function worker(): Promise<void> {
    while (next < profiles.length) {
      const profile = profiles[next++];
      try {
        const result = await syncConnectorBoard(profile, { timeoutMs: 30_000 });
        results.push({ company: result.company, connector: result.connector, received: result.received, normalized: result.normalized, filtered_out: result.filtered_out, detail_failed: result.detail_failed, matched: result.collector_feed_match.matched_external_ids, unmatched: result.collector_feed_match.unmatched_official_jobs, active_local: result.collector_feed_match.active_company_jobs, dry_run: result.dry_run });
      } catch (error) {
        results.push({ company: profile.company, connector: profile.connector, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  results.sort((a, b) => String(a.company).localeCompare(String(b.company)));
  console.log(JSON.stringify({ environment: process.env.SUPABASE_URL, count: results.length, results }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

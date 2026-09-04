import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: '.env.local' });

const TARGETS = ['Google', 'Meta', 'Microsoft', 'Jefferies', 'JPMorgan Chase', 'Lazard', 'Oliver Wyman'];

async function main() {
  const client = getSupabaseClient();
  const [sources, reviews, states, runs] = await Promise.all([
    client.from('job_company_sources').select('company_name,status,source_type,source_basis,connector_name,official_careers_url,official_hosts,active_jobs,is_active,last_error,last_attempted_at,last_success_at').in('company_name', TARGETS).eq('is_active', true),
    client.from('job_historical_field_reviews').select('company_name,status,source_family,source_system,cursor_job_id,total_candidates,processed_candidates,remaining_candidates,updated_jobs,failed_jobs,last_error,last_heartbeat_at,next_run_at,lease_owner,lease_expires_at').in('company_name', TARGETS),
    client.from('job_sync_state').select('source_system,cursor,last_attempted_at,last_success_at,next_retry_at,consecutive_failures,lease_owner,lease_expires_at,last_error').or('source_system.like.official:%,source_system.like.historical:%').order('source_system'),
    client.from('job_sync_runs').select('company_name,source_system,mode,status,total_candidates,processed_candidates,remaining_candidates,upserted,row_failures,fatal_failures,error_message,started_at,completed_at').in('company_name', TARGETS).order('started_at', { ascending: false }).limit(100),
  ]);
  for (const result of [sources, reviews, states, runs]) if (result.error) throw new Error(result.error.message);
  console.log(JSON.stringify({ targets: TARGETS, sources: sources.data || [], reviews: reviews.data || [], states: states.data || [], runs: runs.data || [] }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

import { config as loadDotenv } from 'dotenv';
import { abortStaleJobFeedReconcile, getJobFeedState } from '@/lib/job-feed-orchestrator';

loadDotenv({ path: process.env.DOTENV_CONFIG_PATH || '.env.local' });

async function main() {
  const aborted = await abortStaleJobFeedReconcile();
  const state = await getJobFeedState();
  console.log(JSON.stringify({ aborted, state }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

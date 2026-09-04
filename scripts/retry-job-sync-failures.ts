import { config as loadDotenv } from 'dotenv';
import { runJobSyncFailureCycle } from '@/lib/job-sync-failure-worker';

loadDotenv({ path: '.env.local' });

async function main() {
  const result = await runJobSyncFailureCycle();
  console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

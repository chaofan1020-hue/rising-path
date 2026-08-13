import { config as loadDotenv } from 'dotenv';
import { runJobFeedSync, type JobFeedSyncMode } from '@/lib/job-feed-orchestrator';

loadDotenv({ path: '.env.local' });

function parseArguments() {
  const modeArg = process.argv.find((argument) => argument.startsWith('--mode='))?.split('=')[1];
  const pagesArg = process.argv.find((argument) => argument.startsWith('--max-pages='))?.split('=')[1];
  const mode: JobFeedSyncMode = modeArg === 'reconcile' ? 'reconcile' : 'incremental';
  const parsedPages = Number.parseInt(pagesArg || '', 10);
  return {
    mode,
    maxPages: Number.isFinite(parsedPages) ? parsedPages : undefined,
  };
}

async function main() {
  const options = parseArguments();
  const result = await runJobFeedSync(options);
  console.log(JSON.stringify({ phase: 'complete', ...result }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : '岗位同步失败');
  process.exitCode = 1;
});

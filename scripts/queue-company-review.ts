import { config as loadDotenv } from 'dotenv';
import { queueHistoricalFieldReview } from '@/lib/job-historical-field-review-worker';

loadDotenv({ path: process.env.ENV_FILE || '.env.local' });

async function main(): Promise<void> {
  const company = process.argv.find((value) => value.startsWith('--company='))?.slice('--company='.length).trim();
  if (!company) throw new Error('Specify --company=<company>');
  await queueHistoricalFieldReview(company, { reset: false });
  console.log(JSON.stringify({ company, queued: true, reset: false }));
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

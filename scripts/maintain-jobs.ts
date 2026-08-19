import { config as loadDotenv } from 'dotenv';
import { maintainJobLifecycle } from '@/lib/job-maintenance';

loadDotenv({ path: '.env.local' });

maintainJobLifecycle()
  .then((result) => console.log(JSON.stringify(result)))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });

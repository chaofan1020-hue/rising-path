import { runHistoricalFieldReviewCycle } from '@/lib/job-historical-field-review-worker';

runHistoricalFieldReviewCycle({ batchSize: 5 })
  .then((result) => console.log(JSON.stringify(result)))
  .catch((error) => { console.error(error); process.exitCode = 1; });

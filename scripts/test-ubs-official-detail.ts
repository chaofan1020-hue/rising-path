import { fetchSafeExternalPage } from '@/lib/safe-external-fetch';
import { extractOfficialJobDetails } from '@/lib/job-official-detail';

const url = process.argv[2] || 'https://jobs.ubs.com/TGnewUI/Search/home/HomeWithPreLoad?partnerid=25008&siteid=5012&PageType=JobDetails&jobid=350866';

async function main(): Promise<void> {
  const page = await fetchSafeExternalPage(url);
  const details = extractOfficialJobDetails(page);
  const questions = Array.isArray(page.metadata?.brassring_questions) ? page.metadata.brassring_questions : [];
  console.log(JSON.stringify({
    status: page.httpStatus,
    url: page.url,
    content_length: page.content.length,
    brassring_questions: questions.length,
    details,
  }, null, 2));
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; });

import { fetchSafeExternalPage } from '@/lib/safe-external-fetch';
import { extractOfficialJobDetails } from '@/lib/job-official-detail';

const url = 'https://citi.wd5.myworkdayjobs.com/en-US/2/job/Houston-Texas-United-States/Banking---Corporate-Banking--Summer-Analyst--Houston---US--2027_25926650';
(async () => {
  const direct = await fetch(url, {
    redirect: 'follow',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.1',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
  });
  const directText = await direct.text();
  console.log({ direct: { status: direct.status, url: direct.url, length: directText.length, html: directText.includes('Anticipated Posting Close Date') } });
  const page = await fetchSafeExternalPage(url);
  console.log({ status: page.httpStatus, length: page.content.length, metadata: Object.keys(page.metadata || {}), details: extractOfficialJobDetails(page) });
})();

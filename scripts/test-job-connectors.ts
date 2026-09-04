import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkJobUrl,
  fetchConnectorBoard,
  hasMatchingPhenomDetailPayload,
  isRegisteredPhenomJobUrl,
  isOfficialHost,
  parseConnectorBoard,
  parseOracleHcmJob,
  validConnectorUrl,
} from '../src/lib/job-connectors';
import type { ConnectorJob, JobConnector } from '../src/lib/job-connectors/types';
import { extractSalaryFromDescription, parseExperience } from '../src/lib/job-connectors/utils';

interface FixtureItem {
  expected?: {
    category?: string;
    location?: string;
    workplace?: string;
    min?: number | null;
    max?: number | null;
    salary?: string;
    deadline?: string;
  };
  [key: string]: unknown;
}

interface FixtureFile {
  connector: JobConnector;
  company: string;
  board: string;
  items: FixtureItem[];
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function flattenLocation(value: unknown): string {
  if (Array.isArray(value)) return value.map(flattenLocation).filter(Boolean).join(', ');
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).map(flattenLocation).filter(Boolean).join(', ');
  return value == null ? '' : String(value);
}

async function readFixture(connector: JobConnector): Promise<FixtureFile> {
  const filePath = path.join(root, 'fixtures', 'job-connectors', `${connector}.json`);
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as FixtureFile;
}

function assertEvidence(job: ConnectorJob, connector: JobConnector): void {
  assert.ok(job.source_url, 'parsed job must retain its official URL');
  assert.equal(isOfficialHost(job.source_url!, connector), true);
  assert.equal(validConnectorUrl(job.source_url!, connector), true);

  const evidence = job.source_evidence;
  assert.ok(evidence && typeof evidence === 'object' && !Array.isArray(evidence));
  assert.equal(evidence?.source_type, 'official_ats');
  assert.equal(evidence?.connector, connector);
  assert.equal(evidence?.source_url, job.source_url);
  const fields = evidence?.structured_field_sources;
  assert.ok(fields && typeof fields === 'object' && !Array.isArray(fields));
  assert.ok(Object.keys(fields as Record<string, unknown>).length > 0, 'each job needs at least one field source');
}

function assertExpected(job: ConnectorJob, expected: FixtureItem['expected']): void {
  if (!expected) return;
  if (expected.category) assert.equal(job.employment_category, expected.category, `${job.title}: unexpected employment category`);
  if (expected.location) assert.match(flattenLocation(job.location).toLocaleLowerCase(), new RegExp(expected.location.toLocaleLowerCase()));
  if (expected.workplace) assert.equal(job.workplace_type, expected.workplace);
  if ('min' in expected) assert.equal(job.experience_min_years, expected.min, `${job.title}: unexpected minimum experience`);
  if ('max' in expected) assert.equal(job.experience_max_years, expected.max, `${job.title}: unexpected maximum experience`);
  if (expected.salary) assert.match(job.salary_range || '', new RegExp(expected.salary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  if (expected.deadline) assert.ok(job.valid_through?.startsWith(expected.deadline), `expected deadline ${expected.deadline}, got ${job.valid_through}`);
}

async function testFixture(connector: JobConnector): Promise<void> {
  const fixture = await readFixture(connector);
  assert.equal(fixture.connector, connector);
  assert.ok(fixture.items.length >= 20, `${connector} fixture must contain at least 20 samples`);

  const payload = connector === 'lever' ? fixture.items : { jobs: fixture.items };
  const jobs = parseConnectorBoard(connector, payload, {
    companyName: fixture.company,
    boardToken: fixture.board,
  });
  assert.equal(jobs.length, fixture.items.length, `${connector} parser dropped a fixture item`);

  for (const [index, job] of jobs.entries()) {
    assertEvidence(job, connector);
    assertExpected(job, fixture.items[index].expected);
  }

  // Invalid records are skipped without making the board parser throw.
  const withInvalid = connector === 'lever'
    ? [...fixture.items, { title: 'missing required fields' }]
    : { jobs: [...fixture.items, { title: 'missing required fields' }] };
  assert.equal(parseConnectorBoard(connector, withInvalid, {
    companyName: fixture.company,
    boardToken: fixture.board,
  }).length, fixture.items.length);
  console.log(`${connector}: ${jobs.length}/${fixture.items.length} fixture jobs parsed`);
}

async function testSalaryAndExperienceGuards(): Promise<void> {
  const greenhouse = await readFixture('greenhouse');
  const base = greenhouse.items[0];
  const { parseGreenhouseJob } = await import('../src/lib/job-connectors/greenhouse');
  const noCurrency = parseGreenhouseJob({
    ...base,
    metadata: [{ name: 'Salary', value: '120,000 per year' }],
  }, { companyName: greenhouse.company });
  assert.equal(noCurrency?.salary_range, null);

  const skillOnly = parseGreenhouseJob({
    ...base,
    metadata: [],
    content: 'Experience with Python and SQL is required.',
  }, { companyName: greenhouse.company });
  assert.equal(skillOnly?.experience_min_years, null);
  assert.equal(skillOnly?.experience_max_years, null);

  const narrativeSalary = parseGreenhouseJob({
    ...base,
    metadata: [],
    content: 'Estimated pay ranges: $116,960.00 - $146,200.00; $123,760.00 - $154,700.00. Benefits include a 401(k) retirement account.',
  }, { companyName: greenhouse.company });
  assert.equal(narrativeSalary?.salary_range, '$116,960.00 - $146,200.00; $123,760.00 - $154,700.00');

  const businessMetric = extractSalaryFromDescription(
    'Clients have annual revenues of $20-$50 m and portfolios ranging from $50 million to $2 billion.',
  );
  assert.equal(businessMetric, null);

  const labelledPay = extractSalaryFromDescription(
    'Pay range: $150,000.00 - $235,000.00 annualized salary, offers depend on experience.',
  );
  assert.equal(labelledPay, '$150,000.00 - $235,000.00');
}

async function testOracleHcmFixture(): Promise<void> {
  const fixture = await readFixture('oracle_hcm');
  assert.equal(fixture.connector, 'oracle_hcm');
  assert.ok(fixture.items.length >= 20, 'oracle_hcm fixture must contain at least 20 samples');
  const jobs = fixture.items.map((item) => parseOracleHcmJob(item, {
    companyName: fixture.company,
    boardToken: fixture.board,
    sourceUrl: `https://icbpjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/LazardProfessionalCareers/job/${item.Id}`,
  }));
  assert.equal(jobs.filter(Boolean).length, fixture.items.length);
  assert.equal(jobs[0]?.experience_min_years, 3);
  assert.equal(jobs[0]?.salary_range, '$110,000 - $130,000');
  assert.ok(jobs[0]?.valid_through?.startsWith('2026-09-09T23:00:00'));
  assert.equal(validConnectorUrl(jobs[0]!.source_url!, 'oracle_hcm', '6454'), true);
  console.log(`oracle_hcm: ${jobs.length}/${fixture.items.length} fixture jobs parsed`);
}

function testExperienceVariations(): void {
  const encoded = parseExperience(['&lt;li&gt;Minimum 5 years of experience selling technical solutions.&lt;/li&gt;']);
  assert.equal(encoded.min, 5);
  assert.equal(encoded.max, null);
  assert.match(encoded.text || '', /Minimum 5 years of experience/i);

  const mixedRange = parseExperience(['Minimum 6mos-1 year of professional working experience.']);
  assert.equal(mixedRange.min, 0.5);
  assert.equal(mixedRange.max, 1);

  const tenureWindow = parseExperience(['18-24 months before you may be eligible to apply for another role.']);
  assert.equal(tenureWindow.min, null);
  assert.equal(tenureWindow.max, null);

  const extendedTenureWindow = parseExperience([
    'Similar to other roles, this role has a tenure requirement of 18-24 months before you may be eligible to apply for another role.\nMinimum 1 years of professional experience.',
  ]);
  assert.equal(extendedTenureWindow.min, 1);
  assert.equal(extendedTenureWindow.max, null);

  const openEndedRange = parseExperience(['1-3+ years of experience in sales.']);
  assert.equal(openEndedRange.min, 1);
  assert.equal(openEndedRange.max, null);

  const possessive = parseExperience(["Requires five years' experience in enterprise sales."]);
  assert.equal(possessive.min, 5);
  assert.equal(possessive.max, null);

  const skillOnly = parseExperience(['Experience with Python and SQL is required.']);
  assert.equal(skillOnly.min, null);
  assert.equal(skillOnly.max, null);

  const companyHistory = parseExperience([
    'Point72 has more than 30 years of investing experience across asset classes. Summer internship candidates are welcome.',
  ]);
  assert.equal(companyHistory.min, null);
  assert.equal(companyHistory.max, null);
}

async function testGreenhouseCanonicalUrls(): Promise<void> {
  const greenhouse = await readFixture('greenhouse');
  const { parseGreenhouseJob } = await import('../src/lib/job-connectors/greenhouse');
  const canonical = parseGreenhouseJob({
    ...greenhouse.items[0],
    absolute_url: 'https://stripe.com/jobs/search?gh_jid=1001',
  }, { companyName: 'Stripe' });
  assert.ok(canonical, 'Greenhouse employer-hosted canonical URL should parse');
  assert.equal(canonical?.source_url, 'https://stripe.com/jobs/search?gh_jid=1001');
  assert.equal(validConnectorUrl(canonical!.source_url!, 'greenhouse', '1001'), true);
  assert.equal(validConnectorUrl(canonical!.source_url!, 'greenhouse', '9999'), false);

  const structuredDeadline = parseGreenhouseJob({
    ...greenhouse.items[0],
    application_deadline: '2026-10-31T17:00:00-04:00',
    content: 'Role description without a deadline label.',
  }, { companyName: greenhouse.company });
  assert.ok(structuredDeadline?.valid_through, 'structured application deadline should parse');
  const fields = structuredDeadline?.source_evidence?.structured_field_sources as Record<string, unknown>;
  assert.equal(fields.valid_through, 'official_payload');
}

async function testUrlHealthClassification(): Promise<void> {
  const url = 'https://jobs.ashbyhq.com/openai/a001';
  const responseFor = (status: number, responseUrl = url): typeof fetch => async () => new Response(null, { status, headers: { location: responseUrl } });
  assert.equal((await checkJobUrl(url, 'ashby', { fetcher: responseFor(200) })).status, 'valid');
  assert.equal((await checkJobUrl(url, 'ashby', { fetcher: responseFor(404) })).status, 'closed');
  assert.equal((await checkJobUrl(url, 'ashby', { fetcher: responseFor(410) })).status, 'closed');
  assert.equal((await checkJobUrl(url, 'ashby', { fetcher: responseFor(403) })).status, 'blocked');
  assert.equal((await checkJobUrl(url, 'ashby', { fetcher: responseFor(429) })).status, 'blocked');

  let calls = 0;
  const methodFallback: typeof fetch = async (_input, init) => {
    calls += 1;
    return new Response(null, { status: init?.method === 'HEAD' ? 405 : 200 });
  };
  assert.equal((await checkJobUrl(url, 'ashby', { fetcher: methodFallback })).status, 'valid');
  assert.equal(calls, 2);
}

async function testPhenomPaginationAndSelectiveDetails(): Promise<void> {
  const listPage = (jobs: unknown[], totalHits: number) => `<!doctype html><script>phApp.ddo = ${JSON.stringify({
    eagerLoadRefineSearch: { totalHits, data: { jobs } },
  })};</script>`;
  const detailPage = (job: unknown) => `<!doctype html><script>phApp.ddo = ${JSON.stringify({
    jobDetail: { data: { job } },
  })};</script>`;
  const first = {
    jobSeqNo: 'BCG1US100EXTERNALENGLOBAL', title: 'Consultant', location: 'Boston, United States', type: 'Full-Time', jobType: 'Permanent',
  };
  const second = {
    jobSeqNo: 'BCG1US101EXTERNALENGLOBAL', title: 'Intern', location: 'Toronto, Canada', type: 'Full-Time', jobType: 'Internship',
  };
  const requested: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url === 'https://careers.example.com/global/en/search-results') return new Response(listPage([first], 2));
    if (url === 'https://careers.example.com/global/en/search-results?from=1&s=1') return new Response(listPage([second], 2));
    if (url === 'https://careers.example.com/global/en/job/BCG1US100EXTERNALENGLOBAL') {
      return new Response(detailPage({ ...first, description: 'Requires 3 years of relevant experience.' }));
    }
    return new Response('not found', { status: 404 });
  };
  const result = await fetchConnectorBoard({
    connector: 'phenom',
    company: 'Boston Consulting Group',
    board: 'BCG1US',
    phenomSearchUrl: 'https://careers.example.com/global/en/search-results',
  }, {
    fetcher,
    detailJobIds: new Set([first.jobSeqNo]),
  });
  assert.equal(result.received, 2);
  assert.equal(result.jobs.length, 2);
  assert.equal(result.detailRequested, 1);
  assert.equal(result.detailFailed, 0);
  assert.equal(requested.length, 3, 'only the requested matching job should fetch a detail page');
  assert.equal(result.jobs.find((job) => job.external_job_id === first.jobSeqNo)?.experience_min_years, 3);
  assert.equal(result.jobs.find((job) => job.external_job_id === second.jobSeqNo)?.description, null);
}

async function testPhenomFilledDetailIsNotOpen(): Promise<void> {
  const job = {
    jobSeqNo: 'BCG1US102EXTERNALENGLOBAL', title: 'Associate', location: 'New York, United States', type: 'Full-Time', jobType: 'Permanent',
  };
  const listPage = `<!doctype html><script>phApp.ddo = ${JSON.stringify({
    eagerLoadRefineSearch: { totalHits: 1, data: { jobs: [job] } },
  })};</script>`;
  const filledDetail = '<!doctype html><title>Job filled</title><main>We\'re sorry, the job you are trying to apply for has been filled.</main>';
  const result = await fetchConnectorBoard({
    connector: 'phenom',
    company: 'Boston Consulting Group',
    board: 'BCG1US',
    phenomSearchUrl: 'https://careers.example.com/global/en/search-results',
  }, {
    fetcher: async (input) => {
      const url = String(input);
      if (url.endsWith('/search-results')) return new Response(listPage);
      if (url.endsWith(`/job/${job.jobSeqNo}`)) return new Response(filledDetail);
      return new Response('not found', { status: 404 });
    },
    detailJobIds: new Set([job.jobSeqNo]),
  });
  assert.equal(result.detailClosed, 1);
  assert.equal(result.detailFailed, 0);
  assert.equal(result.jobs[0]?.status, 'closed');
  assert.equal(result.jobs[0]?.experience_text, null);
}

async function testPhenomDetailPayloadWinsOverDormantExpiredComponent(): Promise<void> {
  const job = {
    jobSeqNo: 'BCG1US103EXTERNALENGLOBAL', title: 'Consultant', location: 'Boston, United States', type: 'Full-Time', jobType: 'Permanent',
  };
  const listPage = `<!doctype html><script>phApp.ddo = ${JSON.stringify({
    eagerLoadRefineSearch: { totalHits: 1, data: { jobs: [job] } },
  })};</script>`;
  const detailPage = `<!doctype html><main>We're sorry, the job you are trying to apply for has been filled.</main><script>phApp.ddo = ${JSON.stringify({
    jobDetail: { data: { job: { ...job, description: 'Requires 4 years of relevant experience.' } } },
  })};</script>`;
  const result = await fetchConnectorBoard({
    connector: 'phenom',
    company: 'Boston Consulting Group',
    board: 'BCG1US',
    phenomSearchUrl: 'https://careers.example.com/global/en/search-results',
  }, {
    fetcher: async (input) => String(input).endsWith('/search-results')
      ? new Response(listPage)
      : new Response(detailPage),
    detailJobIds: new Set([job.jobSeqNo]),
  });
  assert.equal(result.detailClosed, 0);
  assert.equal(result.detailAmbiguous, 1);
  assert.equal(result.jobs[0]?.status, 'open');
  assert.equal(result.jobs[0]?.experience_min_years, 4);
  assert.equal(hasMatchingPhenomDetailPayload(
    `https://careers.example.com/global/en/job/${job.jobSeqNo}`,
    detailPage,
  ), true);
  assert.equal(hasMatchingPhenomDetailPayload(
    `https://careers.example.com/global/en/job/${job.jobSeqNo}`,
    '<main>We\'re sorry, the job has been filled.</main>',
  ), false);
  assert.equal(hasMatchingPhenomDetailPayload(
    `https://careers.example.com/global/en/job/${job.jobSeqNo}`,
    '<script>phApp.ddo = {"jobDetail":{"status":200,"data":{"job":{"title":"Consultant"',
  ), true, 'a truncated official detail envelope remains valid evidence');
  assert.equal(isRegisteredPhenomJobUrl('Boston Consulting Group', `https://careers.bcg.com/global/en/job/${job.jobSeqNo}`), true);
  assert.equal(isRegisteredPhenomJobUrl('Boston Consulting Group', 'https://example.com/global/en/job/1'), false);
  assert.equal(isRegisteredPhenomJobUrl('Unregistered Company', `https://careers.bcg.com/global/en/job/${job.jobSeqNo}`), false);
}

async function main(): Promise<void> {
  await testFixture('greenhouse');
  await testFixture('ashby');
  await testFixture('lever');
  await testFixture('phenom');
  await testOracleHcmFixture();
  await testSalaryAndExperienceGuards();
  testExperienceVariations();
  await testGreenhouseCanonicalUrls();
  await testUrlHealthClassification();
  await testPhenomPaginationAndSelectiveDetails();
  await testPhenomFilledDetailIsNotOpen();
  await testPhenomDetailPayloadWinsOverDormantExpiredComponent();
  console.log('job connector tests passed');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

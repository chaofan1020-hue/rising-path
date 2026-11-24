import assert from 'node:assert/strict';
import { isTargetRegion } from '@/lib/job-region-scope';
import { checkRobots, isPathAllowed, parseRobots } from '@/lib/ats-discovery/robots';
import { parseProviderPayload } from '@/lib/ats-discovery/providers';

let failures = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`ok ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
await check('robots: default allow and longest disallow', () => {
  const policy = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/public\nCrawl-delay: 2\n');
  assert.equal(policy.crawlDelayMs, 2000);
  assert.equal(isPathAllowed('/', policy.rules), true);
  assert.equal(isPathAllowed('/private/x', policy.rules), false);
  assert.equal(isPathAllowed('/private/public/x', policy.rules), true);
});

await check('robots: wildcard and end anchor', () => {
  const policy = parseRobots('User-agent: *\nDisallow: /*.json$\n');
  assert.equal(isPathAllowed('/a.json', policy.rules), false);
  assert.equal(isPathAllowed('/a.json?x=1', policy.rules), true);
  assert.equal(isPathAllowed('/a.jsonl', policy.rules), true);
});

await check('robots: specific bot group overrides star', () => {
  const policy = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: LiorvixBot\nAllow: /\n');
  assert.equal(isPathAllowed('/v1/jobs', policy.rules), true);
});

await check('robots: empty disallow means allow', () => {
  const policy = parseRobots('User-agent: *\nDisallow:\n');
  assert.equal(isPathAllowed('/anything', policy.rules), true);
});

await check('robots: 404 means no policy', async () => {
  const result = await checkRobots('https://example.com/robots-target', {
    fetchImpl: async () => new Response('not found', { status: 404 }),
  });
  assert.equal(result.verdict, 'allow');
  assert.equal(result.httpStatus, 404);
});

await check('robots: 401 is unknown unless public-api exception', async () => {
  const strict = await checkRobots('https://api.example.com/jobs', {
    fetchImpl: async () => new Response('Unauthorized', { status: 401 }),
  });
  assert.equal(strict.verdict, 'unknown');
  const exception = await checkRobots('https://api.example.com/jobs', {
    allowUnauthorized: true,
    fetchImpl: async () => new Response('Unauthorized', { status: 401 }),
  });
  assert.equal(exception.verdict, 'allow');
});

await check('greenhouse payload', () => {
  const parsed = parseProviderPayload('greenhouse', {
    jobs: [
      {
        id: 123,
        title: 'Software Engineer',
        absolute_url: 'https://boards.greenhouse.io/acme/jobs/123',
        location: { name: 'New York, NY' },
        updated_at: '2026-11-20T10:00:00-05:00',
      },
    ],
    meta: { total: 42 },
  }, 'acme');
  assert.equal(parsed.total, 42);
  assert.equal(parsed.jobs[0].title, 'Software Engineer');
  assert.equal(parsed.jobs[0].location, 'New York, NY');
});

await check('ashby payload', () => {
  const parsed = parseProviderPayload('ashby', {
    jobs: [
      {
        id: 'abc',
        title: 'Product Designer',
        jobUrl: 'https://jobs.ashbyhq.com/acme/abc',
        location: 'London, UK',
        department: 'Design',
        updatedAt: '2026-11-21T08:00:00Z',
      },
    ],
  }, 'acme');
  assert.equal(parsed.total, 1);
  assert.equal(parsed.jobs[0].location, 'London, UK');
});

await check('lever payload', () => {
  const parsed = parseProviderPayload('lever', [
    {
      id: 'lev-1',
      text: 'Data Analyst',
      hostedUrl: 'https://jobs.lever.co/acme/lev-1',
      categories: { location: 'Singapore', department: 'Data' },
      createdAt: 1760000000000,
    },
  ], 'acme');
  assert.equal(parsed.jobs[0].title, 'Data Analyst');
  assert.equal(parsed.jobs[0].location, 'Singapore');
  assert.match(parsed.jobs[0].postedAt ?? '', /^2025-/);
});

await check('region scope', () => {
  assert.equal(isTargetRegion('New York, NY'), true);
  assert.equal(isTargetRegion('London, UK'), true);
  assert.equal(isTargetRegion('Singapore'), true);
  assert.equal(isTargetRegion('Berlin, Germany'), false);
  assert.equal(isTargetRegion('Remote - US'), true);
});

if (failures > 0) {
  console.error(`${failures} test(s) failed`);
  process.exit(1);
}
console.log('all ats-discovery tests passed');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
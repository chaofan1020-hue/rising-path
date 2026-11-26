#!/usr/bin/env node
/**
 * 离线夹具测试：`scripts/probe-ats-boards.cjs` 的状态机、robots 证据、冻结清单。
 * 运行：node scripts/test-probe-ats-boards.cjs
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const work = path.join(process.cwd(), 'tmp', 'probe-test');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

const input = path.join(work, 'candidates.csv');
fs.writeFileSync(input, [
  'vendor,token,posted_count,priority',
  'greenhouse,acme,2,1',
  'ashby,beta,0,2',
  'lever,gamma,0,3',
  'greenhouse,emptyco,0,4',
  'ashby,broken,0,5',
  'smartrecruiters,nope,0,6',
  'greenhouse,acme,2,1', // duplicate, must be de-duplicated
].join('\n'));

const fixture = {
  'https://boards.greenhouse.io/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /embed\n' },
  'https://jobs.ashbyhq.com/robots.txt': { status: 401, body: '' },
  'https://jobs.lever.co/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /\n' },
  'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=false': {
    status: 200,
    body: {
      jobs: [
        { id: 11, title: 'Software Engineer', location: { name: 'San Jose, CA' } },
        { id: 12, title: 'Backend Engineer', location: { name: 'Bangalore, India' } },
      ],
    },
  },
  'https://api.ashbyhq.com/posting-api/job-board/beta': { status: 404, body: {} },
  'https://api.lever.co/v0/postings/gamma?mode=json': { status: 429, body: {} },
  'https://boards-api.greenhouse.io/v1/boards/emptyco/jobs?content=false': { status: 200, body: { jobs: [] } },
  'https://api.ashbyhq.com/posting-api/job-board/broken': { status: 500, body: 'upstream exploded' },
};
const fixtureFile = path.join(work, 'fixture.json');
fs.writeFileSync(fixtureFile, JSON.stringify(fixture, null, 2));

const out = path.join(work, 'probe.jsonl');
const summary = path.join(work, 'probe.summary.json');
const quarantine = path.join(work, 'probe.quarantine.csv');
const active = path.join(work, 'probe.active.csv');

const run = spawnSync(process.execPath, [
  path.join('scripts', 'probe-ats-boards.cjs'),
  `--input=${input}`,
  `--fixture=${fixtureFile}`,
  `--out=${out}`,
  `--summary=${summary}`,
  `--quarantine=${quarantine}`,
  `--active=${active}`,
  '--min-target-ratio=0.5',
  '--concurrency=3',
], { stdio: 'ignore' });

const failures = [];
const check = (label, ok, detail) => {
  if (!ok) failures.push(`${label}${detail ? `: ${detail}` : ''}`);
};
const rows = fs.readFileSync(out, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
const byKey = Object.fromEntries(rows.map((row) => [`${row.vendor}:${row.token}`, row]));
const report = JSON.parse(fs.readFileSync(summary, 'utf8'));
const activeCsv = fs.readFileSync(active, 'utf8').trim().split(/\r?\n/);

check('exit code', run.status === 0, `status=${run.status}`);
check('de-duplicated candidates', report.candidates === 6, `candidates=${report.candidates}`);
check('rows written', rows.length === 6, `rows=${rows.length}`);
check('active greenhouse', byKey['greenhouse:acme'] && byKey['greenhouse:acme'].status === 'active');
check('greenhouse postingCount', byKey['greenhouse:acme'] && byKey['greenhouse:acme'].postingCount === 2);
check('greenhouse targetRatio', byKey['greenhouse:acme'] && byKey['greenhouse:acme'].targetRatio === 0.5);
check('greenhouse sample locations', byKey['greenhouse:acme'] && byKey['greenhouse:acme'].sample.length === 2);
check('greenhouse sample US flag', byKey['greenhouse:acme'] && byKey['greenhouse:acme'].sample[0].targetRegion === true);
check('greenhouse sample India flag', byKey['greenhouse:acme'] && byKey['greenhouse:acme'].sample[1].targetRegion === false);
check('greenhouse robots allow', byKey['greenhouse:acme'] && byKey['greenhouse:acme'].robots.verdict === 'allow');
check('greenhouse robots sha256 present', byKey['greenhouse:acme'] && Boolean(byKey['greenhouse:acme'].robots.sha256));
check('ashby 404 -> not_found', byKey['ashby:beta'] && byKey['ashby:beta'].status === 'not_found');
check('ashby robots 401 -> allow', byKey['ashby:beta'] && byKey['ashby:beta'].robots.verdict === 'allow' && byKey['ashby:beta'].robots.reason === 'public_api_documented_robots_unavailable');
check('lever 429 -> blocked', byKey['lever:gamma'] && byKey['lever:gamma'].status === 'blocked');
check('lever robots disallow recorded', byKey['lever:gamma'] && byKey['lever:gamma'].robots.verdict === 'disallow');
check('empty greenhouse -> empty', byKey['greenhouse:emptyco'] && byKey['greenhouse:emptyco'].status === 'empty');
check('ashby 500 -> error', byKey['ashby:broken'] && byKey['ashby:broken'].status === 'error');
check('unsupported vendor', byKey['smartrecruiters:nope'] && byKey['smartrecruiters:nope'].status === 'error' && /unsupported_vendor/.test(byKey['smartrecruiters:nope'].reason));
check('summary counts', report.statusCounts.active === 1 && report.statusCounts.not_found === 1 && report.statusCounts.blocked === 1 && report.statusCounts.empty === 1 && report.statusCounts.error === 2, JSON.stringify(report.statusCounts));
check('freeze eligible', report.freezeEligible === 1 && report.freezeTargetJobs === 1, `eligible=${report.freezeEligible}`);
check('active csv header+row', activeCsv.length === 2 && activeCsv[0] === 'vendor,token,postingCount,targetCount,targetRatio,estTargetJobs');
check('active csv row', activeCsv[1] === 'greenhouse,acme,2,1,0.5,1', activeCsv[1]);
check('quarantine csv rows', fs.readFileSync(quarantine, 'utf8').trim().split(/\r?\n/).length === 4);

if (failures.length) {
  console.error(`probe contract FAIL (${failures.length})`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('probe contract ok');
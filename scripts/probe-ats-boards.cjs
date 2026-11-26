#!/usr/bin/env node
/**
 * ATS board prober —— 供给扩容的第二段流水线（候选 → 证据 → 冻结清单）。
 *
 * 输入：候选 CSV，必须含 `vendor`（或 `provider`）与 `token` 两列；
 *       可选 `board_url` / `api_url` / `posted_count` / `priority`。
 * 动作：逐个调用 ATS 官方公开 JSON 接口，判定 active / empty / not_found / blocked / error，
 *       记录 robots 证据、抽样最多 50 条岗位地点并按 region-dna 口径估算目标地区占比。
 * 输出：JSONL（逐行证据，可断点续跑）、summary JSON、quarantine CSV、active 候选 CSV。
 *
 * 用法：
 *   node scripts/probe-ats-boards.cjs --input=tmp/boards/candidates-p1-remaining4.csv
 *   node scripts/probe-ats-boards.cjs --input=... --out=... --concurrency=8 --resume
 *   node scripts/probe-ats-boards.cjs --input=... --limit=50 --dry-run
 *   node scripts/probe-ats-boards.cjs --input=fixture.csv --fixture=tmp/probe-fixture.json  # 离线夹具
 *
 * 约束：只使用 ATS 官方公开 JSON 接口；不登录、不绕验证码、不使用聚合站替代官方源。
 * 目标地区正则与 `scripts/discover-ats-boards.cjs` 的 REGION 保持同步（那边改了这里也要改）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const SAMPLE_SIZE = 50;

const VENDORS = {
  greenhouse: {
    api: (t) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(t)}/jobs?content=false`,
    boardHost: 'https://boards.greenhouse.io',
    list: (json) => (json && Array.isArray(json.jobs) ? json.jobs : null),
    location: (job) => (job.location && job.location.name) || '',
    title: (job) => job.title,
    id: (job) => job.id,
  },
  ashby: {
    api: (t) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(t)}`,
    boardHost: 'https://jobs.ashbyhq.com',
    list: (json) => (json && Array.isArray(json.jobs) ? json.jobs : null),
    location: (job) => job.location || '',
    title: (job) => job.title,
    id: (job) => job.id,
  },
  lever: {
    api: (t) => `https://api.lever.co/v0/postings/${encodeURIComponent(t)}?mode=json`,
    boardHost: 'https://jobs.lever.co',
    list: (json) => (Array.isArray(json) ? json : json && Array.isArray(json.postings) ? json.postings : null),
    location: (job) => (job.categories && job.categories.location) || '',
    title: (job) => job.text,
    id: (job) => job.id,
  },
};

// 与 src/lib/job-region-scope.ts / scripts/discover-ats-boards.cjs 的 REGION 同源。
const TARGET_PATTERNS = [
  /\b(north america|north-american|northamerican|americas|united states|usa|u\.s\.?|us|canada|new york|san francisco|los angeles|seattle|chicago|boston|austin|dallas|houston|atlanta|denver|miami|philadelphia|washington|jersey city|newark|palo alto|mountain view|arlington|raleigh|charlotte|tampa|orlando|columbus|wilmington|fort lauderdale|milwaukee|colorado springs|baton rouge|fresno|san antonio|jacksonville|san diego|toronto|vancouver|ottawa|montreal|mississauga|quebec|al|ak|as|az|ar|ca|co|ct|de|dc|fl|ga|gu|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|mp|oh|ok|or|pa|pr|ri|sc|sd|tn|tx|ut|vt|vi|va|wa|wv|wi|wy)\b/i,
  /\b(australia|anz|sydney|melbourne|brisbane|perth|adelaide|canberra|ballarat)\b/i,
  /\b(hong kong|kowloon|hong kong island)\b/i,
  /\bsingapore\b/i,
  /\b(united kingdom|u\.k\.?|uk|england|scotland|wales|northern ireland|london|bournemouth|bristol|manchester|edinburgh|glasgow|birmingham|leeds|cardiff|belfast|cambridge|oxford|southampton|reading|guildford|crawley|aberdeen|newcastle|sheffield|liverpool)\b/i,
];

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

function targetRegion(location) {
  const value = String(location || '');
  if (!value) return false;
  return TARGET_PATTERNS.some((pattern) => pattern.test(value));
}

function parseCsv(text) {
  const rows = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return rows;
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const row = {};
    header.forEach((key, index) => { row[key] = (cells[index] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

const csvCell = (value) => {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const writeCsv = (file, header, rows) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = [header.join(',')].concat(rows.map((row) => header.map((key) => csvCell(row[key])).join(',')));
  fs.writeFileSync(file, `${body.join('\n')}\n`);
};

function fixtureFetch(fixture, url) {
  const entry = fixture[url];
  if (!entry) return { status: 404, text: '', json: null, fixtureMiss: true };
  const text = typeof entry.body === 'string' ? entry.body : JSON.stringify(entry.body);
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: entry.status || 200, text, json };
}

async function httpFetch(url, timeoutMs, fixture) {
  if (fixture) return fixtureFetch(fixture, url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*' }, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, text, json, durationMs: Date.now() - started };
  } catch (error) {
    return { status: 0, text: '', json: null, error: String((error && error.message) || error), durationMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

const robotsCache = new Map();

function robotsVerdict(body, probePath) {
  if (!body) return { verdict: 'allow', reason: 'robots_unavailable' };
  const lines = body.split(/\r?\n/);
  let inStar = false;
  let disallow = [];
  for (const line of lines) {
    const trimmed = line.replace(/#.*$/, '').trim();
    if (!trimmed) continue;
    const [rawKey, ...rest] = trimmed.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') { inStar = value === '*'; continue; }
    if (inStar && key === 'disallow') disallow.push(value);
  }
  const matched = disallow.filter((rule) => rule && probePath.startsWith(rule));
  return matched.length
    ? { verdict: 'disallow', reason: `disallow:${matched.join('|')}` }
    : { verdict: 'allow', reason: 'no_matching_rule' };
}

async function robotsFor(hostBase, probePath, timeoutMs, fixture, evidence) {
  const robotsUrl = `${hostBase}/robots.txt`;
  if (robotsCache.has(hostBase)) {
    const cached = robotsCache.get(hostBase);
    if (evidence) evidence.robots = { ...cached, path: probePath, cached: true };
    return cached;
  }
  const res = await httpFetch(robotsUrl, timeoutMs, fixture);
  const verdict = res.status === 200
    ? robotsVerdict(res.text, probePath)
    : { verdict: 'allow', reason: 'public_api_documented_robots_unavailable' };
  const record = {
    verdict: verdict.verdict,
    reason: verdict.reason,
    robotsUrl,
    httpStatus: res.status,
    checkedAt: new Date().toISOString(),
    sha256: res.text ? sha256(res.text) : null,
    crawlDelayMs: null,
  };
  robotsCache.set(hostBase, record);
  if (evidence) evidence.robots = { ...record, path: probePath };
  return record;
}

async function probeOne(candidate, options) {
  const vendor = String(candidate.vendor || candidate.provider || '').toLowerCase();
  const token = String(candidate.token || '').trim();
  const spec = VENDORS[vendor];
  const started = Date.now();
  const evidence = {
    vendor, token, status: 'error', reason: '', httpStatus: 0,
    postingCount: 0, postingCountIsLowerBound: false, sampleCount: 0,
    targetCount: 0, targetRatio: 0, robots: null, sample: [], error: null,
    durationMs: 0, fetchedAt: '', listOnly: true,
  };
  if (!spec || !token) {
    evidence.reason = spec ? 'empty_token' : `unsupported_vendor:${vendor}`;
    evidence.durationMs = Date.now() - started;
    evidence.fetchedAt = new Date().toISOString();
    return evidence;
  }
  const apiUrl = candidate.api_url || spec.api(token);
  const boardBase = spec.boardHost;
  await robotsFor(boardBase, `/${token}`, options.timeoutMs, options.fixture, evidence);
  const res = await httpFetch(apiUrl, options.timeoutMs, options.fixture);
  evidence.httpStatus = res.status;
  evidence.durationMs = Date.now() - started;
  evidence.fetchedAt = new Date().toISOString();
  if (res.fixtureMiss) {
    evidence.status = 'error';
    evidence.reason = 'fixture_miss';
    evidence.error = `no fixture entry for ${apiUrl}`;
    return evidence;
  }
  if (!res.status) {
    evidence.status = 'error';
    evidence.reason = 'network_error';
    evidence.error = res.error || 'fetch failed';
    return evidence;
  }
  if (res.status === 404 || res.status === 410) {
    evidence.status = 'not_found';
    evidence.reason = 'http_404';
    return evidence;
  }
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    evidence.status = 'blocked';
    evidence.reason = `http_${res.status}`;
    return evidence;
  }
  if (res.status >= 500 || !res.json) {
    evidence.status = 'error';
    evidence.reason = res.status >= 500 ? `http_${res.status}` : 'invalid_json';
    evidence.error = res.text ? res.text.slice(0, 200) : null;
    return evidence;
  }
  const list = spec.list(res.json);
  if (!list) {
    evidence.status = 'error';
    evidence.reason = 'unexpected_schema';
    return evidence;
  }
  evidence.postingCount = list.length;
  if (!list.length) {
    evidence.status = 'empty';
    evidence.reason = 'zero_postings';
    return evidence;
  }
  const sample = list.slice(0, SAMPLE_SIZE);
  evidence.sampleCount = sample.length;
  evidence.targetCount = sample.filter((job) => targetRegion(spec.location(job))).length;
  evidence.targetRatio = Number((evidence.targetCount / sample.length).toFixed(3));
  evidence.sample = sample.map((job) => ({
    id: spec.id(job) != null ? String(spec.id(job)) : null,
    title: spec.title(job) || null,
    url: (candidate.board_url ? `${String(candidate.board_url).replace(/\/$/, '')}/${spec.id(job)}` : null),
    location: spec.location(job) || null,
    targetRegion: targetRegion(spec.location(job)),
  }));
  evidence.status = 'active';
  evidence.reason = 'ok';
  return evidence;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  let done = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index], index);
      done += 1;
      if (done % 25 === 0) process.stderr.write(`  probed ${done}/${items.length}\n`);
    }
  }));
  return out;
}

function loadExisting(file) {
  const seen = new Set();
  if (!file || !fs.existsSync(file)) return seen;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && row.vendor && row.token) seen.add(`${row.vendor}:${row.token}`);
    } catch { /* skip broken line */ }
  }
  return seen;
}

(async () => {
  const input = arg('input');
  if (!input) {
    console.error('usage: node scripts/probe-ats-boards.cjs --input=<candidates.csv> [--out=<jsonl>]');
    process.exit(2);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = arg('out', path.join('output', 'ats-probe', `probe-${stamp}.jsonl`));
  const summaryFile = arg('summary', outFile.replace(/\.jsonl$/, '.summary.json'));
  const quarantineFile = arg('quarantine', outFile.replace(/\.jsonl$/, '.quarantine.csv'));
  const activeFile = arg('active', outFile.replace(/\.jsonl$/, '.active.csv'));
  const fixture = arg('fixture') ? JSON.parse(fs.readFileSync(arg('fixture'), 'utf8')) : null;
  const options = {
    timeoutMs: Number(arg('timeout-ms', '20000')),
    concurrency: Number(arg('concurrency', '8')),
    minTargetRatio: Number(arg('min-target-ratio', '0.5')),
    limit: Number(arg('limit', '0')),
    fixture,
  };
  const dryRun = flag('dry-run');
  const resume = flag('resume');

  const inputText = fs.readFileSync(input, 'utf8');
  let candidates = parseCsv(inputText);
  const seenVendorToken = new Set();
  candidates = candidates.filter((row) => {
    const key = `${String(row.vendor || row.provider || '').toLowerCase()}:${row.token}`;
    if (seenVendorToken.has(key)) return false;
    seenVendorToken.add(key);
    return true;
  });
  if (options.limit) candidates = candidates.slice(0, options.limit);
  if (resume) {
    const done = loadExisting(outFile);
    candidates = candidates.filter((row) => !done.has(`${String(row.vendor || row.provider || '').toLowerCase()}:${row.token}`));
  }
  console.log(`probe: ${candidates.length} candidates from ${input}${resume ? ' (resume)' : ''}`);
  if (dryRun) {
    const byVendor = {};
    for (const row of candidates) byVendor[row.vendor || row.provider] = (byVendor[row.vendor || row.provider] || 0) + 1;
    console.log(`dry-run vendors: ${JSON.stringify(byVendor)}`);
    return;
  }

  const evidenceRows = await mapLimit(candidates, options.concurrency, async (row) => {
    try {
      return await probeOne(row, options);
    } catch (error) {
      return {
        vendor: String(row.vendor || row.provider || ''), token: row.token, status: 'error',
        reason: 'exception', error: String((error && error.message) || error), fetchedAt: new Date().toISOString(),
      };
    }
  });

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const lines = evidenceRows.map((row) => JSON.stringify(row));
  fs.appendFileSync(outFile, `${lines.join('\n')}\n`);

  const counts = {};
  for (const row of evidenceRows) counts[row.status] = (counts[row.status] || 0) + 1;
  const active = evidenceRows.filter((row) => row.status === 'active');
  const quarantine = evidenceRows.filter((row) => row.status === 'blocked' || row.status === 'error');
  const freeze = active
    .filter((row) => row.targetRatio >= options.minTargetRatio)
    .sort((a, b) => b.postingCount * b.targetRatio - a.postingCount * a.targetRatio);

  writeCsv(quarantineFile, ['vendor', 'token', 'status', 'reason', 'httpStatus', 'error'], quarantine);
  writeCsv(activeFile, ['vendor', 'token', 'postingCount', 'targetCount', 'targetRatio', 'estTargetJobs'], freeze.map((row) => ({
    vendor: row.vendor, token: row.token, postingCount: row.postingCount,
    targetCount: row.targetCount, targetRatio: row.targetRatio,
    estTargetJobs: Math.round(row.postingCount * row.targetRatio),
  })));

  const summary = {
    generatedAt: new Date().toISOString(),
    input, inputSha256: sha256(inputText), outFile,
    candidates: candidates.length,
    statusCounts: counts,
    active: active.length,
    freezeEligible: freeze.length,
    freezeTargetJobs: freeze.reduce((sum, row) => sum + Math.round(row.postingCount * row.targetRatio), 0),
    minTargetRatio: options.minTargetRatio,
    files: { jsonl: outFile, quarantine: quarantineFile, active: activeFile },
  };
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
})().catch((error) => {
  console.error('probe failed:', error);
  process.exit(1);
});
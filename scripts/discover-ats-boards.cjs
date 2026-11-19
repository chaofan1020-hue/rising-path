#!/usr/bin/env node
/**
 * ATS 租户批量发现器 —— 岗位供给侧扩容的第一段流水线。
 *
 * 作用：不依赖上游 auto_discover，直接从公开 ATS 枚举出"公司 → 官方 board"映射，
 * 逐个验证 board 是否真实存活、有多少在招岗位、目标地区占比多少，最后输出候选清单。
 *
 * 四个阶段：
 *   1. harvest  从公开职位列表仓库抽取 ATS 租户 token（greenhouse / lever / ashby / smartrecruiters / workday）
 *   2. verify   逐个打官方 ATS 接口，确认存活并统计岗位量
 *   3. sample   抽样地点，按 region-dna 口径估算"目标地区"岗位数
 *   4. emit     与上游 /companies 对照，只输出尚未登记的公司
 *
 * 用法：
 *   node scripts/discover-ats-boards.cjs                       # 全流程，输出 output/ats-candidates.json
 *   node scripts/discover-ats-boards.cjs --skip-harvest        # 复用已有 token 缓存
 *   node scripts/discover-ats-boards.cjs --min-target=200      # 只保留目标地区 >=200 的候选
 *
 * 约束：只使用 ATS 官方公开 JSON 接口；不登录、不绕验证码、不使用聚合站替代官方源。
 */
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const WORK = path.join(process.cwd(), 'output', 'ats-discovery');
const TOKENS = path.join(WORK, 'tokens.json');
const VERIFIED = path.join(WORK, 'verified.json');
const CANDIDATES = path.join(WORK, 'candidates.json');

/** 公开职位列表仓库：只用作"公司 → ATS 租户"的发现线索，不作为岗位数据源。 */
const HARVEST_SOURCES = [
  { name: 'simplify-newgrad', url: 'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/README.md' },
  { name: 'simplify-internships', url: 'https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/README.md' },
  { name: 'vansh-newgrad', url: 'https://raw.githubusercontent.com/vanshb03/New-Grad-2026/main/README.md' },
  { name: 'speedyapply-ai', url: 'https://raw.githubusercontent.com/speedyapply/2026-AI-College-Jobs/main/README.md' },
];

const PATTERNS = {
  greenhouse: /(?:job-)?boards\.greenhouse\.io\/([A-Za-z0-9_.-]+)/g,
  lever: /jobs\.lever\.co\/([A-Za-z0-9_.-]+)/g,
  ashby: /jobs\.ashbyhq\.com\/([A-Za-z0-9_.-]+)/g,
  smartrecruiters: /(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9_.-]+)/g,
  workday: /([A-Za-z0-9_-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/g,
};

const REGION = {
  north_america: /\b(north america|north-american|northamerican|americas|united states|usa|u\.s\.?|canada|new york|san francisco|los angeles|seattle|chicago|boston|austin|dallas|houston|atlanta|denver|miami|philadelphia|washington|jersey city|newark|palo alto|mountain view|arlington|raleigh|charlotte|tampa|orlando|columbus|wilmington|fort lauderdale|milwaukee|colorado springs|baton rouge|fresno|san antonio|jacksonville|san diego|toronto|vancouver|ottawa|montreal|mississauga|quebec|al|ak|as|az|ar|ca|co|ct|de|dc|fl|ga|gu|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|mp|oh|ok|or|pa|pr|ri|sc|sd|tn|tx|ut|vt|vi|va|wa|wv|wi|wy)\b/i,
  united_kingdom: /\b(united kingdom|u\.k\.?|uk|england|scotland|wales|northern ireland|london|manchester|edinburgh|glasgow|birmingham|leeds|cardiff|belfast|cambridge|oxford)\b/i,
  australia: /\b(australia|anz|sydney|melbourne|brisbane|perth|adelaide|canberra)\b/i,
  hong_kong: /\b(hong kong|kowloon)\b/i,
  singapore: /\bsingapore\b/i,
};

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

function ensureDir() { fs.mkdirSync(WORK, { recursive: true }); }

async function httpJson(url, init = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', ...(init.headers || {}) },
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, status: res.status };
    const text = await res.text();
    try { return { ok: true, status: res.status, json: JSON.parse(text) }; } catch { return { ok: true, status: res.status, text }; }
  } catch (error) {
    return { ok: false, status: 0, error: String((error && error.message) || error) };
  } finally { clearTimeout(timer); }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

// ---------------------------------------------------------------- 1. harvest
async function harvest() {
  const buckets = { greenhouse: new Set(), lever: new Set(), ashby: new Set(), smartrecruiters: new Set(), workday: new Set() };
  for (const src of HARVEST_SOURCES) {
    const res = await httpJson(src.url, {}, 60000);
    const text = res.text || '';
    if (!text) { console.log(`  harvest ${src.name}: skipped (status ${res.status})`); continue; }
    for (const [connector, pattern] of Object.entries(PATTERNS)) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(text)) !== null) {
        if (connector === 'workday') buckets.workday.add(`${m[1]}/${m[3]}`);
        else buckets[connector].add(m[1]);
      }
    }
    console.log(`  harvest ${src.name}: ${(text.length / 1024).toFixed(0)}KB`);
  }
  const tokens = Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, [...v].sort()]));
  fs.writeFileSync(TOKENS, JSON.stringify(tokens, null, 2));
  console.log(`  tokens: ${Object.entries(tokens).map(([k, v]) => `${k}=${v.length}`).join(' ')}`);
  return tokens;
}

// ----------------------------------------------------------------- 2. verify
async function verifyGreenhouse(token) {
  const r = await httpJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=false`);
  const jobs = r.json && Array.isArray(r.json.jobs) ? r.json.jobs : null;
  if (!r.ok || !jobs) return null;
  return {
    token, connector: 'greenhouse', jobs: jobs.length,
    sample_title: jobs[0] && jobs[0].title,
    sample_location: jobs[0] && jobs[0].location && jobs[0].location.name,
    locations: jobs.slice(0, 60).map((j) => (j.location && j.location.name) || ''),
  };
}

async function verifyLever(token) {
  const r = await httpJson(`https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`);
  const list = Array.isArray(r.json) ? r.json : (r.json && r.json.postings) || null;
  if (!r.ok || !list) return null;
  return {
    token, connector: 'lever', jobs: list.length,
    sample_title: list[0] && list[0].text,
    locations: list.slice(0, 60).map((j) => (j.categories && j.categories.location) || ''),
  };
}

async function verifyAshby(token) {
  const r = await httpJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`);
  const list = r.json && Array.isArray(r.json.jobs) ? r.json.jobs : null;
  if (!r.ok || !list) return null;
  return {
    token, connector: 'ashby', jobs: list.length,
    sample_title: list[0] && list[0].title,
    locations: list.slice(0, 60).map((j) => j.location || ''),
  };
}

async function verifySmartRecruiters(token) {
  const r = await httpJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings?limit=100`);
  if (!r.ok || !r.json) return null;
  const list = Array.isArray(r.json.content) ? r.json.content : [];
  return {
    token, connector: 'smartrecruiters', jobs: r.json.totalFound || list.length,
    sample_title: list[0] && list[0].name,
    locations: list.map((x) => (x.location ? [x.location.city, x.location.region, x.location.country].filter(Boolean).join(', ') : '')),
  };
}

async function verifyWorkday(spec) {
  const [tenant, site] = spec.split('/');
  for (const n of [1, 3, 5, 103, 12, 2]) {
    const host = `${tenant}.wd${n}.myworkdayjobs.com`;
    const r = await httpJson(`https://${host}/wday/cxs/${tenant}/${site}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' }),
    }, 20000);
    if (r.ok && r.json && typeof r.json.total === 'number') {
      const list = Array.isArray(r.json.jobPostings) ? r.json.jobPostings : [];
      return {
        token: spec, connector: 'workday', host, site, jobs: r.json.total,
        sample_title: list[0] && list[0].title,
        locations: list.map((x) => x.locationsText || ''),
        capped: r.json.total > 2000,
      };
    }
  }
  return null;
}

async function verify(tokens) {
  const plan = [
    ['greenhouse', verifyGreenhouse, 8],
    ['lever', verifyLever, 6],
    ['ashby', verifyAshby, 6],
    ['smartrecruiters', verifySmartRecruiters, 6],
    ['workday', verifyWorkday, 10],
  ];
  const results = [];
  for (const [name, fn, limit] of plan) {
    const list = tokens[name] || [];
    const part = await mapLimit(list, limit, async (token) => {
      try { return await fn(token); } catch { return null; }
    });
    const live = part.filter(Boolean);
    console.log(`  verify ${name}: tokens=${list.length} live=${live.length} jobs=${live.reduce((s, r) => s + r.jobs, 0)}`);
    results.push(...live);
  }
  fs.writeFileSync(VERIFIED, JSON.stringify(results, null, 2));
  return results;
}

// ----------------------------------------------------------------- 3. sample
function classify(location) {
  const value = String(location || '');
  if (!value) return 'unknown';
  for (const [region, pattern] of Object.entries(REGION)) if (pattern.test(value)) return region;
  return 'outside';
}

function regionEstimate(board) {
  const counts = {};
  for (const loc of board.locations || []) counts[classify(loc)] = (counts[classify(loc)] || 0) + 1;
  const sampled = (board.locations || []).length;
  const target = Object.entries(counts).filter(([k]) => k !== 'outside' && k !== 'unknown').reduce((s, [, v]) => s + v, 0);
  const rate = sampled ? target / sampled : 0;
  return { counts, sampled, target_rate: Number(rate.toFixed(3)), target_jobs_est: Math.round(board.jobs * rate) };
}

// ------------------------------------------------------------------- 4. emit
async function emit(verifiedBoards) {
  const feedUrl = process.env.JOBS_FEED_URL;
  const key = process.env.JOBS_FEED_API_KEY;
  let existing = new Set();
  if (feedUrl) {
    const base = new URL(feedUrl);
    const root = base.pathname.replace(/\/integrations\/v1\/jobs\/?$/, '');
    const res = await httpJson(`${base.origin}${root}/dashboard/company-directory`, { headers: { 'X-Integration-Key': key } });
    if (res.json && Array.isArray(res.json)) {
      existing = new Set(res.json.map((c) => String(c.name).toLowerCase().replace(/[^a-z0-9]/g, '')));
      console.log(`  baseline companies: ${existing.size}`);
    }
  }

  const minTarget = Number(arg('min-target', '100'));
  const candidates = verifiedBoards
    .map((b) => ({ ...b, ...regionEstimate(b) }))
    .filter((b) => b.target_jobs_est >= minTarget)
    .filter((b) => !existing.has(String(b.token).toLowerCase().replace(/[^a-z0-9]/g, '')))
    .sort((a, b) => b.target_jobs_est - a.target_jobs_est);

  fs.writeFileSync(CANDIDATES, JSON.stringify(candidates, null, 2));
  console.log(`\n  candidates (target_est>=${minTarget}): ${candidates.length}, est_target_jobs=${candidates.reduce((s, c) => s + c.target_jobs_est, 0)}`);
  for (const c of candidates.slice(0, 40)) {
    console.log(`  ${String(c.connector).padEnd(16)} ${String(c.token).padEnd(36)} jobs=${String(c.jobs).padStart(6)} est=${String(c.target_jobs_est).padStart(6)}  ${c.sample_title || ''}`);
  }
  console.log(`\n  written: ${path.relative(process.cwd(), CANDIDATES)}`);
  return candidates;
}

(async () => {
  ensureDir();
  require('dotenv').config({ path: '.env.local', quiet: true });

  console.log('[1/4] harvest ATS tenants');
  const tokens = flag('skip-harvest') && fs.existsSync(TOKENS)
    ? JSON.parse(fs.readFileSync(TOKENS, 'utf8'))
    : await harvest();

  console.log('[2/4] verify boards');
  const verifiedBoards = flag('skip-verify') && fs.existsSync(VERIFIED)
    ? JSON.parse(fs.readFileSync(VERIFIED, 'utf8'))
    : await verify(tokens);
  console.log(`  live boards=${verifiedBoards.length} total jobs=${verifiedBoards.reduce((s, b) => s + b.jobs, 0)}`);

  console.log('[3/4] sample target-region coverage');
  console.log('[4/4] emit candidates');
  await emit(verifiedBoards);
})().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

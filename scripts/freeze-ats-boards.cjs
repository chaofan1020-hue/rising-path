#!/usr/bin/env node
/**
 * ATS freeze —— 把探测证据冻结成上游 `bulk_boards` 可直接导入的 CSV。
 *
 * 输入：一个或多个 `scripts/probe-ats-boards.cjs` 产出的 JSONL；
 *       可选 upstream 现有 board/company 清单（去重用）。
 * 动作：按目标地区占比与在招量排序 → 补公司名（官方 board 接口 / 公开页面标题）→
 *       与上游已有公司去重 → 输出冻结 CSV（列与 `data/p1-boards.csv` 同构）+ 冻结报告（含 sha256）。
 *
 * 用法：
 *   node scripts/freeze-ats-boards.cjs --probe=tmp/probe/batch1.jsonl,tmp/probe/longtail.jsonl \
 *     --existing=tmp/probe/upstream-boards.csv --existing-companies=tmp/probe/upstream-companies.csv \
 *     --min-target-ratio=0.5 --limit=500 --out=data/p2-boards.csv
 *
 * 约束：只补充公开信息（官方 board JSON / 公开页面 title），不猜测域名。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TIERS = ['S', 'A', 'B', 'C'];
const SUFFIXES = new Set(['inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'plc', 'gmbh', 'sas', 'bv', 'ag', 'sa', 'pte', 'lp', 'llp']);

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const normalizeName = (value) => String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
  .split(' ').filter((part) => part && !SUFFIXES.has(part)).join(' ');

const csvCell = (value) => {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

function readJsonl(files) {
  const rows = [];
  for (const file of files) {
    if (!file || !fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (row && row.vendor && row.token) rows.push(row);
      } catch { /* skip */ }
    }
  }
  return rows;
}

function readCsv(file) {
  if (!file || !fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row = {};
    header.forEach((key, index) => { row[key] = (cells[index] || '').trim(); });
    return row;
  });
}

async function fetchText(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8' }, signal: ctrl.signal });
    return { status: res.status, text: await res.text() };
  } catch (error) {
    return { status: 0, text: '', error: String((error && error.message) || error) };
  } finally {
    clearTimeout(timer);
  }
}

function cleanCompanyName(raw) {
  if (!raw) return null;
  let title = String(raw).replace(/\s+/g, ' ').trim();
  title = title
    .replace(/^(careers?|jobs?)\s+(at|@)\s+/i, '')
    .replace(/\s*[-–|]\s*(careers?|jobs?|job board|open positions|open roles|hiring|career site|careers page|website)\s*$/i, '')
    .replace(/\s+(careers?|jobs?|job board|open positions|open roles|career site|careers page|website)\s*$/i, '')
    .replace(/^internal\s+/i, '')
    .replace(/\s*[-–|]\s*$/, '')
    .trim();
  if (!title || title.length > 90) return null;
  if (/^(internal\s+)?(job board|careers?|jobs?|home|welcome|open positions|website)$/i.test(title)) return null;
  return title;
}

function titleFromHtml(html, token) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html || '');
  if (!match) return null;
  const title = cleanCompanyName(
    match[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"'),
  );
  if (!title || title.toLowerCase() === String(token).toLowerCase()) return null;
  return title;
}

function tokenName(token) {
  return String(token).split(/[-_.]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

async function enrichName(board) {
  const token = String(board.token);
  if (board.vendor === 'greenhouse') {
    const res = await fetchText(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}`);
    try {
      const json = JSON.parse(res.text);
      if (res.status === 200 && json && typeof json.name === 'string') {
        const name = cleanCompanyName(json.name);
        if (name) return { name, source: 'api_name' };
      }
    } catch { /* fall through */ }
  }
  const robots = (board.robots && board.robots.verdict) || 'allow';
  if (robots === 'allow') {
    const boardHost = board.vendor === 'ashby' ? 'https://jobs.ashbyhq.com' : board.vendor === 'lever' ? 'https://jobs.lever.co' : null;
    if (boardHost) {
      const res = await fetchText(`${boardHost}/${encodeURIComponent(token)}`);
      if (res.status === 200) {
        const name = titleFromHtml(res.text, token);
        if (name) return { name, source: 'page_title' };
      }
    }
  }
  return { name: tokenName(token), source: 'token' };
}

function tierFor(postingCount) {
  if (postingCount >= 500) return 'S';
  if (postingCount >= 150) return 'A';
  if (postingCount >= 40) return 'B';
  return 'C';
}

// Board URLs are deterministic per vendor; probe evidence may not carry them.
const BOARD_URLS = {
  greenhouse: (token) => [`https://boards.greenhouse.io/${token}`, `https://boards-api.greenhouse.io/v1/boards/${token}/jobs`],
  ashby: (token) => [`https://jobs.ashbyhq.com/${token}`, `https://api.ashbyhq.com/posting-api/job-board/${token}`],
  lever: (token) => [`https://jobs.lever.co/${token}`, `https://api.lever.co/v0/postings/${token}?mode=json`],
};
function boardUrls(board) {
  if (board.board_url && board.api_url) return [board.board_url, board.api_url];
  const builder = BOARD_URLS[board.vendor];
  return builder ? builder(encodeURIComponent(board.token)) : ['', ''];
}

(async () => {
  const probeFiles = String(arg('probe', 'tmp/probe/batch1.jsonl')).split(',').map((file) => file.trim()).filter(Boolean);
  const outFile = arg('out', 'data/p2-boards.csv');
  const reportFile = arg('report', outFile.replace(/\.csv$/, '.freeze-report.json'));
  const minTargetRatio = Number(arg('min-target-ratio', '0.5'));
  const minPostings = Number(arg('min-postings', '3'));
  const limit = Number(arg('limit', '500'));
  const concurrency = Number(arg('concurrency', '8'));

  const probed = readJsonl(probeFiles);
  const existingBoards = new Set(readCsv(arg('existing')).map((row) => `${String(row.vendor).toLowerCase()}:${row.token}`));
  const existingCompanies = new Set();
  for (const row of readCsv(arg('existing-companies'))) {
    const name = normalizeName(row.name || row.company_name);
    if (name) existingCompanies.add(name);
  }

  const byKey = new Map();
  for (const row of probed) {
    if (row.status !== 'active') continue;
    if (existingBoards.has(`${row.vendor}:${row.token}`)) continue;
    if (!(row.postingCount > 0) || !(row.targetRatio >= minTargetRatio)) continue;
    if (row.postingCount < minPostings) continue;
    const key = `${row.vendor}:${row.token}`;
    const estTargetJobs = Math.round(row.postingCount * row.targetRatio);
    if (!byKey.has(key) || byKey.get(key).estTargetJobs < estTargetJobs) byKey.set(key, { ...row, estTargetJobs });
  }
  const pool = [...byKey.values()].sort((a, b) => b.estTargetJobs - a.estTargetJobs);
  console.log(`freeze pool: ${pool.length} boards (probed ${probed.length}, existing ${existingBoards.size})`);

  const picked = [];
  const pickedNames = new Set();
  let skippedDuplicate = 0;
  const enrichCache = new Map();
  let next = 0;
  const take = async () => {
    while (next < pool.length) {
      const board = pool[next++];
      const cacheKey = `${board.vendor}:${board.token}`;
      let enriched = enrichCache.get(cacheKey);
      if (!enriched) {
        enriched = await enrichName(board);
        enrichCache.set(cacheKey, enriched);
      }
      const normalized = normalizeName(enriched.name);
      if (normalized && (existingCompanies.has(normalized) || pickedNames.has(normalized))) {
        skippedDuplicate += 1;
        continue;
      }
      if (normalized) pickedNames.add(normalized);
      picked.push({ ...board, companyName: enriched.name, nameSource: enriched.source });
      if (picked.length >= limit) return;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, pool.length) }, () => take()));
  // Parallel workers may overshoot `limit`; keep the strongest candidates.
  const finalPicked = picked.sort((a, b) => b.estTargetJobs - a.estTargetJobs).slice(0, limit);

  const frozenAt = new Date().toISOString();
  const header = ['vendor', 'token', 'site', 'company_name', 'company_domain', 'careers_url', 'region_scope',
    'robots_verdict', 'robots_evidence_url', 'robots_checked_at', 'confidence', 'domain_source', 'name_source',
    'tier', 'board_url', 'api_url', 'posting_count', 'posting_count_lower_bound', 'target_count', 'target_ratio', 'frozen_at', 'note'];
  const rows = picked.map((board) => {
    const [boardUrl, apiUrl] = boardUrls(board);
    return {
      vendor: board.vendor,
      token: board.token,
      site: '',
      company_name: board.companyName,
      company_domain: '',
      careers_url: boardUrl,
      region_scope: 'us,uk,ca,au,sg',
      robots_verdict: (board.robots && board.robots.verdict) || 'allow',
      robots_evidence_url: (board.robots && board.robots.robotsUrl) || '',
      robots_checked_at: (board.robots && board.robots.checkedAt) || '',
      confidence: board.nameSource === 'token' ? 'low' : 'medium',
      domain_source: 'none',
      name_source: board.nameSource,
      tier: tierFor(board.postingCount),
      board_url: boardUrl,
      api_url: apiUrl,
      posting_count: board.postingCount,
      posting_count_lower_bound: 'false',
      target_count: board.targetCount,
      target_ratio: board.targetRatio,
      frozen_at: frozenAt,
      note: `name=${board.nameSource};target=${board.estTargetJobs}`,
    };
  });
  rows.sort((a, b) => Number(b.posting_count) - Number(a.posting_count));

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const csv = [header.join(',')].concat(rows.map((row) => header.map((key) => csvCell(row[key])).join(','))).join('\n') + '\n';
  fs.writeFileSync(outFile, csv);

  const byVendor = {};
  for (const row of rows) byVendor[row.vendor] = (byVendor[row.vendor] || 0) + 1;
  const report = {
    generatedAt: frozenAt,
    probeFiles,
    outFile,
    outSha256: sha256(csv),
    rows: rows.length,
    byVendor,
    estTargetJobs: rows.reduce((sum, row) => sum + Number(row.target_count), 0),
    pool: pool.length,
    skippedDuplicate,
    minTargetRatio,
    minPostings,
    limit,
    probeInputSha256: probeFiles.filter((file) => fs.existsSync(file)).map((file) => ({ file, sha256: sha256(fs.readFileSync(file, 'utf8')) })),
  };
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => {
  console.error('freeze failed:', error);
  process.exit(1);
});
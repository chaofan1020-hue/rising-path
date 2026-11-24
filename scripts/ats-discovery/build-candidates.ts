import fs from 'node:fs';
import path from 'node:path';

type Row = Record<string, string>;

const VENDORS = new Set(['greenhouse', 'ashby', 'lever']);

function parseCsv(text: string): Row[] {
  const input = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((cells) => cells.some((cell) => cell.trim() !== ''))
    .map((cells) => Object.fromEntries(header.map((h, idx) => [h, (cells[idx] ?? '').trim()])));
}

function arg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function key(vendor: string, token: string): string {
  return `${vendor.toLowerCase()}:${token.toLowerCase()}`;
}

function boardUrls(vendor: string, token: string): { board: string; api: string } {
  if (vendor === 'greenhouse') {
    return {
      board: `https://boards.greenhouse.io/${token}`,
      api: `https://boards-api.greenhouse.io/v1/boards/${token}/jobs`,
    };
  }
  if (vendor === 'ashby') {
    return {
      board: `https://jobs.ashbyhq.com/${token}`,
      api: `https://api.ashbyhq.com/posting-api/job-board/${token}`,
    };
  }
  return {
    board: `https://jobs.lever.co/${token}`,
    api: `https://api.lever.co/v0/postings/${token}?mode=json`,
  };
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

const allPath = path.resolve(arg('all', 'tmp/boards/all.csv'));
const engineeringPath = path.resolve(arg('engineering', 'tmp/boards/engineering.csv'));
const qualityPath = path.resolve(arg('quality', 'tmp/boards/data-quality.csv'));
const excludePath = path.resolve(arg('exclude', 'tmp/boards/upstream-tokens.csv'));
const outPath = path.resolve(arg('out', 'tmp/boards/candidates.csv'));
const max = Number.parseInt(arg('max', '1500'), 10);
const minPosted = Number.parseInt(arg('min-posted', '0'), 10);
const maxPosted = Number.parseInt(arg('max-posted', '0'), 10);

function postedInRange(value: number): boolean {
  return value >= minPosted && (maxPosted === 0 || value <= maxPosted);
}

const all = parseCsv(fs.readFileSync(allPath, 'utf8'));
const engineering = parseCsv(fs.readFileSync(engineeringPath, 'utf8'));
const quality = parseCsv(fs.readFileSync(qualityPath, 'utf8'));
const exclude = parseCsv(fs.readFileSync(excludePath, 'utf8'));

const excluded = new Set(exclude.map((row) => key(row.vendor, row.token)));
const qualityByKey = new Map(quality.map((row) => [key(row.provider, row.token), row]));
const flaggedQuality = new Set(
  quality
    .filter((row) => Number.parseFloat(row.not_jobs_share || '0') >= 0.5)
    .map((row) => key(row.provider, row.token)),
);

const chosen = new Map<string, { priority: number; vendor: string; token: string; posted: number; note: string; source: string }>();
const stats = {
  excludedUpstream: 0,
  excludedQuality: 0,
  missingVendor: 0,
  engineeringCandidate: 0,
  engineeringAvailable: 0,
  duplicates: 0,
};

for (const row of engineering) {
  const vendor = row.provider.toLowerCase();
  const token = row.token;
  if (!VENDORS.has(vendor) || !token) {
    stats.missingVendor += 1;
    continue;
  }
  stats.engineeringAvailable += 1;
  if (Number.parseInt(row.engineering || '0', 10) <= 0) continue;
  if (!postedInRange(Number.parseInt(row.titles_read || '0', 10))) continue;
  const k = key(vendor, token);
  if (excluded.has(k)) {
    stats.excludedUpstream += 1;
    continue;
  }
  if (flaggedQuality.has(k)) {
    stats.excludedQuality += 1;
    continue;
  }
  if (chosen.has(k)) {
    stats.duplicates += 1;
    continue;
  }
  chosen.set(k, {
    priority: 1,
    vendor,
    token,
    posted: Number.parseInt(row.titles_read || '0', 10),
    note: `engineering_share=${row.engineering_share};stratum=${row.stratum}`,
    source: 'engineering',
  });
  stats.engineeringCandidate += 1;
}

const allCandidates = all
  .filter((row) => VENDORS.has(row.provider.toLowerCase()) && row.token)
  .map((row) => ({
    vendor: row.provider.toLowerCase(),
    token: row.token,
    posted: Number.parseInt(row.open_postings || '0', 10),
    openPostings: row.open_postings,
  }))
  .sort((a, b) => b.posted - a.posted);

for (const row of allCandidates) {
  if (chosen.size >= max) break;
  if (!postedInRange(row.posted)) continue;
  const k = key(row.vendor, row.token);
  if (excluded.has(k)) {
    if (!chosen.has(k)) stats.excludedUpstream += 1;
    continue;
  }
  if (flaggedQuality.has(k)) {
    if (!chosen.has(k)) stats.excludedQuality += 1;
    continue;
  }
  if (chosen.has(k)) {
    stats.duplicates += 1;
    continue;
  }
  chosen.set(k, {
    priority: 2,
    vendor: row.vendor,
    token: row.token,
    posted: row.posted,
    note: `open_postings=${row.openPostings};quality=${qualityByKey.get(k)?.not_jobs_share ?? 'n/a'}`,
    source: 'all',
  });
}

const rows = [...chosen.values()]
  .sort((a, b) => a.priority - b.priority || b.posted - a.posted || a.vendor.localeCompare(b.vendor) || a.token.localeCompare(b.token))
  .map((item) => {
    const urls = boardUrls(item.vendor, item.token);
    return {
      priority: String(item.priority),
      vendor: item.vendor,
      token: item.token,
      board_url: urls.board,
      api_url: urls.api,
      source_list: item.source,
      posted_count: String(item.posted),
      note: item.note,
    };
  });

if (rows.length === 0) {
  console.error('No candidates produced');
  process.exit(1);
}

const header = ['priority', 'vendor', 'token', 'board_url', 'api_url', 'source_list', 'posted_count', 'note'];
const body = [header.join(','), ...rows.map((row) => header.map((h) => csvEscape(row[h as keyof typeof row])).join(','))].join('\n');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${body}\n`, 'utf8');

const byVendor = rows.reduce<Record<string, number>>((acc, row) => {
  acc[row.vendor] = (acc[row.vendor] ?? 0) + 1;
  return acc;
}, {});
console.log(JSON.stringify({
  out: outPath,
  candidates: rows.length,
  byVendor,
  stats,
  engineeringIncluded: rows.filter((r) => r.priority === '1').length,
  allIncluded: rows.filter((r) => r.priority === '2').length,
}, null, 2));
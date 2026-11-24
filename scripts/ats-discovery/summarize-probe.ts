import fs from 'node:fs';
import path from 'node:path';

type Row = Record<string, string>;
type Probe = {
  vendor: string;
  token: string;
  status: 'active' | 'quarantined' | 'error';
  reason: string;
  httpStatus: number | null;
  postingCount: number;
  postingCountIsLowerBound?: boolean;
  sampleCount: number;
  targetCount: number;
  targetRatio: number;
  robots?: { verdict?: string; robotsUrl?: string; checkedAt?: string };
  error: string | null;
  fetchedAt: string;
};

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
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) return [];
  const header = rows[0].map((value) => value.trim());
  return rows.slice(1)
    .filter((cells) => cells.some((cell) => cell.trim() !== ''))
    .map((cells) => Object.fromEntries(header.map((h, idx) => [h, (cells[idx] ?? '').trim()])));
}

function arg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function writeCsv(file: string, header: string[], rows: Row[]): void {
  const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
  fs.writeFileSync(file, `${[header.join(','), ...rows.map((row) => header.map((h) => escape(row[h] ?? '')).join(','))].join('\n')}\n`, 'utf8');
}

const input = path.resolve(arg('input', 'tmp/boards/probe-results-gh-lever.jsonl'));
const candidatesPath = path.resolve(arg('candidates', 'tmp/boards/candidates.csv'));
const activePath = path.resolve(arg('active', 'tmp/boards/active.csv'));
const quarantinePath = path.resolve(arg('quarantine', 'tmp/boards/quarantine.csv'));
const errorsPath = path.resolve(arg('errors', 'tmp/boards/probe-errors.csv'));

const candidateByKey = new Map(parseCsv(fs.readFileSync(candidatesPath, 'utf8')).map((row) => [`${row.vendor}:${row.token}`, row]));
const latest = new Map<string, Probe>();
for (const line of fs.readFileSync(input, 'utf8').split(/\r?\n/)) {
  if (!line.trim()) continue;
  const item = JSON.parse(line) as Probe;
  latest.set(`${item.vendor}:${item.token}`, item);
}

const active: Row[] = [];
const quarantine: Row[] = [];
const errors: Row[] = [];
const reasons: Record<string, number> = {};
const byVendor: Record<string, number> = {};

for (const item of latest.values()) {
  reasons[item.reason] = (reasons[item.reason] ?? 0) + 1;
  byVendor[item.vendor] = (byVendor[item.vendor] ?? 0) + 1;
  const candidate = candidateByKey.get(`${item.vendor}:${item.token}`);
  const base: Row = {
    vendor: item.vendor,
    token: item.token,
    board_url: candidate?.board_url ?? '',
    api_url: candidate?.api_url ?? '',
    posting_count: String(item.postingCount),
    posting_count_lower_bound: item.postingCountIsLowerBound ? 'true' : 'false',
    target_count: String(item.targetCount),
    target_ratio: String(item.targetRatio),
    robots_verdict: item.robots?.verdict ?? '',
    robots_evidence_url: item.robots?.robotsUrl ?? '',
    robots_checked_at: item.robots?.checkedAt ?? '',
    fetched_at: item.fetchedAt,
  };
  if (item.status === 'active') {
    active.push({ ...base, reason: item.reason });
  } else if (item.status === 'quarantined') {
    quarantine.push({ ...base, reason: item.reason, http_status: String(item.httpStatus ?? ''), error: item.error ?? '' });
  } else {
    errors.push({ ...base, reason: item.reason, http_status: String(item.httpStatus ?? ''), error: item.error ?? '' });
  }
}

active.sort((a, b) => Number(b.posting_count) - Number(a.posting_count) || a.vendor.localeCompare(b.vendor));
writeCsv(activePath, ['vendor', 'token', 'board_url', 'api_url', 'posting_count', 'posting_count_lower_bound', 'target_count', 'target_ratio', 'robots_verdict', 'robots_evidence_url', 'robots_checked_at', 'fetched_at', 'reason'], active);
writeCsv(quarantinePath, ['vendor', 'token', 'board_url', 'api_url', 'reason', 'http_status', 'error', 'robots_verdict', 'robots_evidence_url', 'robots_checked_at', 'fetched_at'], quarantine);
writeCsv(errorsPath, ['vendor', 'token', 'board_url', 'api_url', 'reason', 'http_status', 'error', 'robots_verdict', 'robots_evidence_url', 'robots_checked_at', 'fetched_at'], errors);

console.log(JSON.stringify({
  input,
  probed: latest.size,
  active: active.length,
  quarantined: quarantine.length,
  errors: errors.length,
  activeRatio: latest.size ? Math.round((active.length / latest.size) * 10000) / 100 : 0,
  byVendor,
  reasons,
  outputs: { active: activePath, quarantine: quarantinePath, errors: errorsPath },
}, null, 2));
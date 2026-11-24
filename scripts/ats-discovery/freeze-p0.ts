import fs from 'node:fs';
import path from 'node:path';

type Row = Record<string, string>;

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

function normalize(value: string): string {
  return value.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
}

function rootDomain(host: string): string {
  const clean = host.toLowerCase().replace(/^www\./, '');
  const parts = clean.split('.');
  if (parts.length <= 2) return clean;
  const twoLevel = new Set(['co.uk', 'com.au', 'co.nz', 'co.jp', 'com.br', 'com.mx', 'co.in', 'com.sg']);
  const suffix = parts.slice(-2).join('.');
  return twoLevel.has(suffix) ? parts.slice(-3).join('.') : suffix;
}

function companyKey(row: Row): string {
  if (row.company_domain) return `d:${rootDomain(row.company_domain)}`;
  return `n:${normalize(row.company_name)}`;
}

function genericName(value: string): boolean {
  return /^(careers?|jobs?|job openings?|open roles?|hiring|recruiting|browse.*|current job openings?|current openings?|search( for| page)?|home|apply|job search|find jobs|open positions?|careers list|join our team|join us|careers homepage|work with us)$/i.test(value.trim());
}

function tierFor(row: Row): 'S' | 'A' | 'B' | 'C' {
  const posted = Number(row.posting_count || 0);
  const target = Number(row.target_count || 0);
  if (posted >= 500 || target >= 150) return 'S';
  if (posted >= 100 || target >= 50) return 'A';
  if (posted >= 20 || target >= 10) return 'B';
  return 'C';
}

const companiesPath = path.resolve(arg('companies', 'tmp/boards/companies.csv'));
const activePath = path.resolve(arg('active', 'tmp/boards/active.csv'));
const outPath = path.resolve(arg('out', 'data/p0-boards.csv'));
const reviewPath = path.resolve(arg('review', 'tmp/boards/p0-review.csv'));
const reportPath = path.resolve(arg('report', 'tmp/boards/p0-freeze-report.json'));
const limit = Number.parseInt(arg('limit', '500'), 10);
const ghQuota = Number.parseInt(arg('gh', '400'), 10);
const leverQuota = Number.parseInt(arg('lever', '100'), 10);

const activeByKey = new Map(parseCsv(fs.readFileSync(activePath, 'utf8')).map((row) => [`${row.vendor}:${row.token}`, row]));
const all = parseCsv(fs.readFileSync(companiesPath, 'utf8'))
  .map((row) => ({ ...(activeByKey.get(`${row.vendor}:${row.token}`) ?? {}), ...row }));
const rejected: Record<string, number> = {};
const seenCompanies = new Set<string>();
const eligible: Row[] = [];
for (const row of all) {
  if (row.robots_verdict !== 'allow') {
    rejected.robots = (rejected.robots ?? 0) + 1;
    continue;
  }
  if (!row.company_name || row.name_source === 'token_fallback' || genericName(row.company_name)) {
    rejected.name_fallback = (rejected.name_fallback ?? 0) + 1;
    continue;
  }
  if (/\b(staffing|recruiting|recruitment|personnel|talent|employment|placement|manpower)\b/i.test(row.company_name)) {
    rejected.staffing = (rejected.staffing ?? 0) + 1;
    continue;
  }
  const key = companyKey(row);
  if (seenCompanies.has(key)) {
    rejected.duplicate_company = (rejected.duplicate_company ?? 0) + 1;
    continue;
  }
  seenCompanies.add(key);
  eligible.push(row);
}

function pick(vendor: string, quota: number): Row[] {
  return eligible
    .filter((row) => row.vendor === vendor)
    .sort((a, b) => Number(b.posting_count) - Number(a.posting_count))
    .slice(0, quota);
}

let selected = [...pick('greenhouse', ghQuota), ...pick('lever', leverQuota)];
if (selected.length < limit) {
  const used = new Set(selected.map((row) => `${row.vendor}:${row.token}`));
  const rest = eligible
    .filter((row) => !used.has(`${row.vendor}:${row.token}`))
    .sort((a, b) => Number(b.posting_count) - Number(a.posting_count));
  selected = selected.concat(rest.slice(0, limit - selected.length));
}
selected = selected.slice(0, limit).map((row) => ({ ...row, tier: tierFor(row) }));

const header = ['vendor', 'token', 'site', 'company_name', 'company_domain', 'careers_url', 'region_scope', 'robots_verdict', 'robots_evidence_url', 'robots_checked_at', 'confidence', 'domain_source', 'name_source', 'tier', 'board_url', 'api_url', 'posting_count', 'posting_count_lower_bound', 'target_count', 'target_ratio', 'frozen_at', 'note'];
function outputValue(row: Row, headerName: string, frozenAt: string): string {
  if (headerName === 'frozen_at') return frozenAt;
  if (headerName === 'careers_url') return row.careers_url || row.board_url || '';
  if (headerName === 'company_domain') return row.company_domain ? rootDomain(row.company_domain) : '';
  if (headerName === 'region_scope') return 'us,uk,ca,au,sg';
  if (headerName === 'note') return `domain=${row.domain_source};name=${row.name_source};posting=${row.posting_count}`;
  return row[headerName] ?? '';
}

const frozenAt = new Date().toISOString();
const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${[header.join(','), ...selected.map((row) => header.map((h) => escape(outputValue(row, h, frozenAt))).join(','))].join('\n')}\n`, 'utf8');

const stride = Math.max(1, Math.floor(selected.length / 50));
const review = Array.from({ length: Math.min(50, selected.length) }, (_, index) => selected[(index * stride) % selected.length]);
fs.writeFileSync(reviewPath, `${[header.join(','), ...review.map((row) => header.map((h) => escape(outputValue(row, h, frozenAt))).join(','))].join('\n')}\n`, 'utf8');

const counts = (rows: Row[], key: string) => rows.reduce<Record<string, number>>((acc, row) => {
  acc[row[key]] = (acc[row[key]] ?? 0) + 1;
  return acc;
}, {});
const report = {
  input: companiesPath,
  eligible: eligible.length,
  selected: selected.length,
  byVendor: counts(selected, 'vendor'),
  byTier: counts(selected, 'tier'),
  byConfidence: counts(selected, 'confidence'),
  rejected,
  minPosting: Math.min(...selected.map((row) => Number(row.posting_count || 0))),
  maxPosting: Math.max(...selected.map((row) => Number(row.posting_count || 0))),
  duplicateTokenCount: selected.length - new Set(selected.map((row) => `${row.vendor}:${row.token}`)).size,
  missingName: selected.filter((row) => !row.company_name).length,
  missingDomain: selected.filter((row) => !row.company_domain).length,
  outputs: { boards: outPath, review: reviewPath, report: reportPath },
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
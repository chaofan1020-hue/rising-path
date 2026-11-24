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

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const input = path.resolve(arg('input', 'tmp/boards/p0-review.csv'));
const output = path.resolve(arg('output', 'tmp/boards/p0-review-results.csv'));
const rows = parseCsv(fs.readFileSync(input, 'utf8'));
const results: Row[] = [];
let next = 0;
let nextAt = 0;

async function worker(): Promise<void> {
  while (next < rows.length) {
    const row = rows[next];
    next += 1;
    const wait = nextAt - Date.now();
    if (wait > 0) await sleep(wait);
    nextAt = Date.now() + 700;
    const domain = row.company_domain;
    if (!domain) {
      results.push({ ...row, review_verdict: 'no_domain', domain_status: '', page_title: '', title_ok: '' });
      continue;
    }
    let status = '';
    let pageTitle = '';
    let finalUrl = '';
    try {
      const response = await fetch(`https://${domain}`, {
        headers: { 'user-agent': 'LiorvixBot/1.0 (+https://liorvix.com/bot; contact: data@liorvix.com)', accept: 'text/html,*/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
      });
      status = String(response.status);
      finalUrl = response.url;
      const html = (await response.text()).slice(0, 300_000);
      pageTitle = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
    } catch (error) {
      status = error instanceof Error ? error.name : 'error';
    }
    const company = norm(row.company_name);
    const title = norm(pageTitle);
    const tokens = company.split(' ').filter((token) => token.length >= 4);
    const titleOk = tokens.length > 0 && tokens.some((token) => title.includes(token));
    const blocked = ['403', '429', '503', 'TimeoutError', 'AbortError'].includes(status);
    const verdict = blocked ? 'blocked_by_site' : status === '200' && titleOk ? 'pass' : status === '200' ? 'weak_name' : 'domain_fail';
    results.push({ ...row, review_verdict: verdict, domain_status: status, final_url: finalUrl, page_title: pageTitle, title_ok: String(titleOk) });
  }
}

async function main(): Promise<void> {
  await Promise.all(Array.from({ length: 4 }, () => worker()));
  const header = [...Object.keys(rows[0] ?? {}), 'review_verdict', 'domain_status', 'final_url', 'page_title', 'title_ok'];
  const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
  fs.writeFileSync(output, `${[header.join(','), ...results.map((row) => header.map((h) => escape(row[h] ?? '')).join(','))].join('\n')}\n`, 'utf8');
  const counts = results.reduce<Record<string, number>>((acc, row) => {
    acc[row.review_verdict] = (acc[row.review_verdict] ?? 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({ output, rows: results.length, verdicts: counts }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
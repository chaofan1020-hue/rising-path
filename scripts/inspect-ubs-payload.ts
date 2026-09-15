import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: process.env.ENV_FILE || '.env.local' });

function extractArray(source: string, marker: string): unknown[] | null {
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const open = source.indexOf('[', start + marker.length);
  if (open < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(source.slice(open, i + 1)) as unknown[]; } catch { return null; }
      }
    }
  }
  return null;
}

async function main(): Promise<void> {
  const url = process.argv[2] || 'https://jobs.ubs.com/TGnewUI/Search/home/HomeWithPreLoad?partnerid=25008&siteid=5012&PageType=JobDetails&jobid=350866';
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html,application/xhtml+xml' } });
  const raw = (await response.text()).replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
  const questions = extractArray(raw, '"JobDetailQuestions":');
  if (!questions) throw new Error('JobDetailQuestions not found or invalid');
  console.log(JSON.stringify({ status: response.status, bytes: raw.length, questions }, null, 2));
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; });

import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const execFile = promisify(execFileCallback);
const companies = ['Perplexity', 'Robinhood', 'Datadog', 'General Atlantic'];

async function main(): Promise<void> {
  const tsxPath = resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs');
  const results: unknown[] = [];
  for (const company of companies) {
    try {
      const { stdout, stderr } = await execFile(process.execPath, [tsxPath, 'scripts/backfill-connector-fields.ts', `--company=${company}`, '--limit=1'], {
        cwd: process.cwd(),
        env: process.env,
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      });
      const start = Math.max(stdout.lastIndexOf('\n{'), stdout.startsWith('{') ? 0 : -1);
      const parsed = start >= 0 ? JSON.parse(stdout.slice(start === 0 ? 0 : start + 1)) : { raw: stdout };
      results.push(parsed);
      if (stderr.trim()) console.error(`[dry-run:${company}] ${stderr.trim().slice(-500)}`);
    } catch (error) {
      results.push({ company, error: error instanceof Error ? error.message : String(error) });
    }
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

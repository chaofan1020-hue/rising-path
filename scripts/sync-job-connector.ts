import { getCompanySourceProfile } from '../src/lib/job-connectors';
import { syncConnectorBoard } from '../src/lib/job-connectors/sync';

function parseArguments(): { company: string; write: boolean; timeoutMs?: number } {
  const company = process.argv.find((argument) => argument.startsWith('--company='))?.split('=').slice(1).join('=').trim() || '';
  const timeout = process.argv.find((argument) => argument.startsWith('--timeout-ms='))?.split('=').slice(1).join('=').trim() || '';
  const timeoutMs = Number(timeout);
  if (timeout && (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000)) {
    throw new Error('--timeout-ms 必须介于 1000 和 120000 之间');
  }
  return { company, write: process.argv.includes('--write'), timeoutMs: timeout ? timeoutMs : undefined };
}

async function main(): Promise<void> {
  const { company, write, timeoutMs } = parseArguments();
  if (!company) throw new Error('请指定 --company=公司名');
  const profile = getCompanySourceProfile(company);
  if (!profile) throw new Error(`未找到阶段 2 公司配置：${company}`);
  const result = await syncConnectorBoard(profile, { write, timeoutMs });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

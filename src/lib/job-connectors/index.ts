import { parseAshbyBoard, parseAshbyJob } from '@/lib/job-connectors/ashby';
import { parseGreenhouseBoard, parseGreenhouseJob } from '@/lib/job-connectors/greenhouse';
import { parseLeverBoard, parseLeverJob } from '@/lib/job-connectors/lever';
import { parsePhenomBoard, parsePhenomJob } from '@/lib/job-connectors/phenom';
import { parseOracleHcmJob } from '@/lib/job-connectors/oracle-hcm';
import { checkConnectorJobUrl, validConnectorUrl } from '@/lib/job-connectors/utils';
import type {
  ConnectorJob,
  ConnectorParseOptions,
  ConnectorUrlCheckResult,
  JobConnector,
} from '@/lib/job-connectors/types';

export * from '@/lib/job-connectors/types';
export * from '@/lib/job-connectors/utils';
export * from '@/lib/job-connectors/boards';
export * from '@/lib/job-connectors/company-profiles';
export * from '@/lib/job-connectors/sync';
export * from '@/lib/job-connectors/fetch';
export { parseGreenhouseBoard, parseGreenhouseJob } from '@/lib/job-connectors/greenhouse';
export { parseAshbyBoard, parseAshbyJob } from '@/lib/job-connectors/ashby';
export { parseLeverBoard, parseLeverJob } from '@/lib/job-connectors/lever';
export { parsePhenomBoard, parsePhenomJob } from '@/lib/job-connectors/phenom';
export { parseOracleHcmJob, fetchOracleHcmBoard } from '@/lib/job-connectors/oracle-hcm';

export function detectJobConnector(url: string): JobConnector | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (/(^|\.)greenhouse\.io$/.test(hostname)) return 'greenhouse';
    if (/(^|\.)ashbyhq\.com$/.test(hostname)) return 'ashby';
    if (/(^|\.)lever\.co$/.test(hostname)) return 'lever';
    if (/(^|\.)oraclecloud\.com$/.test(hostname) && /\/job\/[^/]+/i.test(new URL(url).pathname)) return 'oracle_hcm';
    if (/\/job\/[^/]+/i.test(new URL(url).pathname)) return 'phenom';
  } catch {
    return null;
  }
  return null;
}

export function parseConnectorJob(
  connector: JobConnector,
  raw: unknown,
  options: ConnectorParseOptions,
): ConnectorJob | null {
  if (connector === 'greenhouse') return parseGreenhouseJob(raw, options);
  if (connector === 'ashby') return parseAshbyJob(raw, options);
  if (connector === 'phenom') return parsePhenomJob(raw, options);
  if (connector === 'oracle_hcm') return parseOracleHcmJob(raw, options);
  return parseLeverJob(raw, options);
}

export function parseConnectorBoard(
  connector: JobConnector,
  payload: unknown,
  options: ConnectorParseOptions,
): ConnectorJob[] {
  if (connector === 'greenhouse') return parseGreenhouseBoard((payload || {}) as { jobs?: unknown[] }, options);
  if (connector === 'ashby') return parseAshbyBoard((payload || {}) as { jobs?: unknown[] }, options);
  if (connector === 'phenom') return parsePhenomBoard((payload || {}) as { jobs?: unknown[] }, options);
  if (connector === 'oracle_hcm') return [];
  return parseLeverBoard(payload, options);
}

export async function checkJobUrl(
  url: string,
  connector = detectJobConnector(url),
  options: { fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<ConnectorUrlCheckResult> {
  if (!connector || !validConnectorUrl(url, connector)) {
    return {
      url,
      status: 'unknown',
      httpStatus: null,
      checkedAt: new Date().toISOString(),
    };
  }
  return checkConnectorJobUrl(url, connector, options);
}

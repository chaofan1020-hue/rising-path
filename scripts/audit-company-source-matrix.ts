import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { config as loadDotenv } from 'dotenv';
import { getCompanySourceProfile } from '@/lib/job-connectors';

type FieldName = 'location' | 'workplace_type' | 'employment_category' | 'experience' | 'salary' | 'deadline';

interface AggregateRow {
  company: string | null;
  host: string | null;
  active_jobs: number | string;
  coverage: Record<FieldName, Partial<FieldTally>>;
  updated_at: string | null;
}

interface RemoteCompany {
  id?: unknown;
  name?: unknown;
}

interface FieldTally {
  verified: number;
  pending_recheck: number;
  rejected_legacy: number;
  unavailable_on_official_source: number;
}

interface CompanyTally {
  company: string;
  active_jobs: number;
  hosts: Map<string, number>;
  source_families: Map<string, number>;
  coverage: Record<FieldName, FieldTally>;
  latest_updated_at: string | null;
}

interface OfficialStateRow {
  source_system: string;
  last_attempted_at: string | null;
  last_success_at: string | null;
  next_retry_at: string | null;
  consecutive_failures: number | string;
  priority: number | string;
  last_error: string | null;
}

const FIELDS: FieldName[] = ['location', 'workplace_type', 'employment_category', 'experience', 'salary', 'deadline'];

// Some companies publish a branded canonical URL while their verified source
// remains an ATS API. Keep this small list limited to sources already
// validated in the project runbook/capture plan; it is not URL guessing.
const DOCUMENTED_OFFICIAL_SOURCE_FAMILIES: Record<string, string> = {
  amazon: 'amazon_jobs',
  apple: 'apple_official_api',
  deloitte: 'deloitte_careers',
  'morgan stanley': 'morgan_stanley_eightfold',
  'goldman sachs': 'goldman_sachs_careers',
  'boston consulting group': 'phenom',
  'oliver wyman': 'phenom',
  lazard: 'oracle_hcm',
  linear: 'ashby',
};

const DOCUMENTED_OFFICIAL_CAREERS: Record<string, string> = {
  deloitte: 'https://www.deloitte.com/us/en/careers.html',
};

const DOCUMENTED_OFFICIAL_HOSTS: Record<string, string[]> = {
  deloitte: ['apply.deloitte.com', 'www.deloitte.com'],
  'morgan stanley': ['morganstanley.eightfold.ai'],
  'goldman sachs': ['higher.gs.com'],
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() || null : null;
}

function hostOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function sourceFamily(host: string | null): string {
  if (!host) return 'missing_source_url';
  if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io' || host.endsWith('.greenhouse.io')) return 'greenhouse';
  if (host === 'jobs.ashbyhq.com' || host.endsWith('.ashbyhq.com')) return 'ashby';
  if (host === 'jobs.lever.co' || host.endsWith('.lever.co')) return 'lever';
  if (host.includes('phenompeople.com') || host.includes('phenom.com')) return 'phenom';
  if (host.includes('myworkdayjobs.com') || host.endsWith('.workday.com')) return 'workday';
  if (host.includes('smartrecruiters.com')) return 'smartrecruiters';
  if (host.includes('icims.com')) return 'icims';
  if (host.includes('taleo.net')) return 'taleo';
  if (host.includes('oraclecloud.com') || host.includes('oracle.com')) return 'oracle_hcm';
  if (host === 'jobs.apple.com') return 'apple_official_api';
  return 'official_custom_or_unclassified';
}

function emptyCoverage(): Record<FieldName, FieldTally> {
  return Object.fromEntries(FIELDS.map((field) => [field, {
    verified: 0,
    pending_recheck: 0,
    rejected_legacy: 0,
    unavailable_on_official_source: 0,
  }])) as Record<FieldName, FieldTally>;
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function add(map: Map<string, number>, value: string | null): void {
  if (!value) return;
  map.set(value, (map.get(value) || 0) + 1);
}

function toSortedObject(values: Map<string, number>, limit = 5): Record<string, number> {
  return Object.fromEntries([...values.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit));
}

function percentage(value: number, total: number): number {
  return total ? Number((value / total * 100).toFixed(1)) : 0;
}

function effectiveSourceFamily(observed: string, connector: string | null, documented: string | undefined) {
  if (connector) return { sourceFamily: connector, basis: 'connector_registry' as const };
  if (documented) return { sourceFamily: documented, basis: 'documented_official_adapter' as const };
  if (observed !== 'official_custom_or_unclassified' && observed !== 'missing_source_url') {
    return { sourceFamily: observed, basis: 'observed_official_host' as const };
  }
  return { sourceFamily: observed, basis: 'discovery_required' as const };
}

function fieldCoverage(tally: FieldTally, total: number) {
  return {
    ...tally,
    verified_percent: percentage(tally.verified, total),
    pending_recheck_percent: percentage(tally.pending_recheck, total),
    rejected_legacy_percent: percentage(tally.rejected_legacy, total),
  };
}

function sourceBase(feedUrl: string): string {
  const endpoint = new URL(feedUrl);
  endpoint.pathname = endpoint.pathname.replace(/\/integrations\/v1\/jobs\/?$/, '');
  endpoint.search = '';
  return endpoint.toString().replace(/\/$/, '');
}

function detailUrlRule(connector: string | null): string | null {
  return connector ? `connector:${connector}` : null;
}

function officialStateKey(company: string, connector: string | null, sourceFamily: string): string {
  const family = connector ? 'registered_connector' : sourceFamily === 'workday' ? 'workday' : sourceFamily === 'deloitte_careers' ? 'official_generic' : null;
  return family ? `official:${family}:${company}`.slice(0, 50) : '';
}

function jsonValue(value: unknown): string {
  return JSON.stringify(value === undefined ? null : value);
}

interface MatrixCompany {
  company: string;
  upstream_company_id: string | null;
  active_jobs: number;
  primary_source_family: string;
  source_family_basis: string;
  observed_primary_source_family: string;
  observed_source_family_distribution: Record<string, number>;
  source_hosts: Record<string, number>;
  registered_connector: string | null;
  connector_board: string | null;
  official_careers_url: string | null;
  official_hosts: string[];
  detail_required: boolean | null;
  region_scope: string | null;
  timezone: string | null;
  external_job_id_field: string | null;
  detail_url_rule: string | null;
  last_attempted_at: string | null;
  last_success_at: string | null;
  next_retry_at: string | null;
  consecutive_failures: number;
  priority: number;
  last_error: string | null;
  latest_updated_at: string | null;
  coverage: Record<string, unknown>;
  discovery_status: string;
}

async function persistSourceMatrix(connectionString: string, companies: MatrixCompany[]): Promise<{ written: number }> {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
  await client.connect();
  try {
    await client.query('begin');
    for (const company of companies) {
      await client.query(`
        insert into public.job_company_sources (
          company_name, is_active, upstream_company_id, active_jobs, official_careers_url,
          official_hosts, source_type, source_basis, external_job_id_field,
          detail_url_rule, detail_required, region_scope, timezone,
          connector_name, connector_board, observed_source_family_distribution,
          source_hosts, field_coverage, last_attempted_at, last_success_at,
          next_retry_at, consecutive_failures, priority, status, last_error,
          last_observed_at, updated_at
        ) values (
          $1, true, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12,
          $13, $14, $15::jsonb, $16::jsonb, $17::jsonb, $18, $19, $20,
          $21, $22, $23, $24, now(), now()
        )
        on conflict (company_name) do update set
          is_active = true,
          upstream_company_id = excluded.upstream_company_id,
          active_jobs = excluded.active_jobs,
          official_careers_url = excluded.official_careers_url,
          official_hosts = excluded.official_hosts,
          source_type = excluded.source_type,
          source_basis = excluded.source_basis,
          external_job_id_field = excluded.external_job_id_field,
          detail_url_rule = excluded.detail_url_rule,
          detail_required = excluded.detail_required,
          region_scope = excluded.region_scope,
          timezone = excluded.timezone,
          connector_name = excluded.connector_name,
          connector_board = excluded.connector_board,
          observed_source_family_distribution = excluded.observed_source_family_distribution,
          source_hosts = excluded.source_hosts,
          field_coverage = excluded.field_coverage,
          last_attempted_at = excluded.last_attempted_at,
          last_success_at = excluded.last_success_at,
          next_retry_at = excluded.next_retry_at,
          consecutive_failures = excluded.consecutive_failures,
          priority = excluded.priority,
          status = excluded.status,
          last_error = excluded.last_error,
          last_observed_at = now(),
          updated_at = now()
      `, [
        company.company,
        company.upstream_company_id,
        company.active_jobs,
        company.official_careers_url,
        jsonValue(company.official_hosts),
        company.primary_source_family,
        company.source_family_basis,
        company.external_job_id_field,
        company.detail_url_rule,
        company.detail_required,
        company.region_scope,
        company.timezone,
        company.registered_connector,
        company.connector_board,
        jsonValue(company.observed_source_family_distribution),
        jsonValue(company.source_hosts),
        jsonValue(company.coverage),
        company.last_attempted_at,
        company.last_success_at,
        company.next_retry_at,
        company.consecutive_failures,
        company.priority,
        company.discovery_status,
        company.last_error,
      ]);
    }
    if (companies.length > 0) {
      await client.query(`
        update public.job_company_sources
           set is_active = false,
               active_jobs = 0,
               status = 'inactive',
               updated_at = now()
         where is_active = true
           and company_name <> all($1::text[])
      `, [companies.map((company) => company.company)]);
    }
    await client.query('commit');
    return { written: companies.length };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function loadRemoteCompanyIds(): Promise<Map<string, string>> {
  const feedUrl = process.env.JOBS_FEED_URL;
  const apiKey = process.env.JOBS_FEED_API_KEY || process.env.INTEGRATION_API_KEY;
  if (!feedUrl || !apiKey) return new Map();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${sourceBase(feedUrl)}/dashboard/company-directory`, {
      headers: { Accept: 'application/json', 'X-Integration-Key': apiKey },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return new Map();
    const rows = await response.json() as RemoteCompany[];
    return new Map(rows
      .map((row) => [text(row.name).toLocaleLowerCase(), text(row.id)] as const)
      .filter(([name, id]) => Boolean(name && id)));
  } catch {
    return new Map();
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const envFile = argument('env-file') || process.env.ENV_FILE || '.env.local';
  loadDotenv({ path: envFile, override: false });
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) throw new Error('缺少 SUPABASE_DB_URL，无法执行聚合审计');
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
  const [remoteCompanyIds, aggregateResult] = await Promise.all([
    loadRemoteCompanyIds(),
    (async () => {
      await client.connect();
      try {
        const aggregate = await client.query<AggregateRow>(`
          WITH active_jobs AS (
            SELECT
              COALESCE(NULLIF(BTRIM(company), ''), '未注明公司') AS company,
              COALESCE(NULLIF(LOWER(SUBSTRING(COALESCE(NULLIF(source_url, ''), NULLIF(job_url, '')) FROM '^[A-Za-z][A-Za-z0-9+.-]*://([^/:?#]+)')), ''), 'missing_source_url') AS host,
              region, location_source, workplace_type, employment_category,
              experience_min_years, experience_max_years, experience_text,
              salary_range, salary_source, valid_through, deadline_source,
              field_evidence, updated_at,
              field_evidence #>> '{fields,location,status}' AS location_status,
              field_evidence #>> '{fields,workplace_type,status}' AS workplace_type_status,
              field_evidence #>> '{fields,employment_category,status}' AS employment_category_status,
              field_evidence #>> '{fields,experience,status}' AS experience_status,
              field_evidence #>> '{fields,salary,status}' AS salary_status,
              field_evidence #>> '{fields,deadline,status}' AS deadline_status
            FROM jobs
            WHERE source_system = 'collector_feed' AND is_active = true
          )
          SELECT
            company,
            host,
            COUNT(*)::int AS active_jobs,
            MAX(updated_at) AS updated_at,
            jsonb_build_object(
              'location', jsonb_build_object(
                'verified', COUNT(*) FILTER (WHERE NULLIF(BTRIM(region), '') IS NOT NULL AND (location_status = 'verified' OR (location_status IS NULL AND LOWER(COALESCE(location_source, '')) IN ('official_payload', 'official_detail_page', 'official_description', 'official_link_valid_through', 'official_link_application_deadline', 'official_link_structured_field', 'official_link_description')))),
                'pending_recheck', COUNT(*) FILTER (WHERE location_status <> 'rejected_legacy' AND NOT (NULLIF(BTRIM(region), '') IS NOT NULL AND (location_status = 'verified' OR LOWER(COALESCE(location_source, '')) IN ('official_payload', 'official_detail_page', 'official_description', 'official_link_valid_through', 'official_link_application_deadline', 'official_link_structured_field', 'official_link_description'))) AND (NULLIF(BTRIM(region), '') IS NOT NULL OR location_status = 'pending_recheck')),
                'rejected_legacy', COUNT(*) FILTER (WHERE location_status = 'rejected_legacy')
              ),
              'workplace_type', jsonb_build_object(
                'verified', COUNT(*) FILTER (WHERE NULLIF(BTRIM(workplace_type), '') IS NOT NULL AND workplace_type_status = 'verified'),
                'pending_recheck', COUNT(*) FILTER (WHERE workplace_type_status <> 'rejected_legacy' AND NOT (NULLIF(BTRIM(workplace_type), '') IS NOT NULL AND workplace_type_status = 'verified') AND (NULLIF(BTRIM(workplace_type), '') IS NOT NULL OR workplace_type_status = 'pending_recheck')),
                'rejected_legacy', COUNT(*) FILTER (WHERE workplace_type_status = 'rejected_legacy')
              ),
              'employment_category', jsonb_build_object(
                'verified', COUNT(*) FILTER (WHERE NULLIF(BTRIM(employment_category), '') IS NOT NULL AND employment_category <> '未知' AND employment_category_status = 'verified'),
                'pending_recheck', COUNT(*) FILTER (WHERE employment_category_status <> 'rejected_legacy' AND NOT (NULLIF(BTRIM(employment_category), '') IS NOT NULL AND employment_category <> '未知' AND employment_category_status = 'verified') AND (NULLIF(BTRIM(employment_category), '') IS NOT NULL AND employment_category <> '未知' OR employment_category_status = 'pending_recheck')),
                'rejected_legacy', COUNT(*) FILTER (WHERE employment_category_status = 'rejected_legacy')
              ),
              'experience', jsonb_build_object(
                'verified', COUNT(*) FILTER (WHERE (experience_min_years IS NOT NULL OR experience_max_years IS NOT NULL OR NULLIF(BTRIM(experience_text), '') IS NOT NULL) AND experience_status = 'verified'),
                'pending_recheck', COUNT(*) FILTER (WHERE experience_status <> 'rejected_legacy' AND NOT ((experience_min_years IS NOT NULL OR experience_max_years IS NOT NULL OR NULLIF(BTRIM(experience_text), '') IS NOT NULL) AND experience_status = 'verified') AND (experience_min_years IS NOT NULL OR experience_max_years IS NOT NULL OR NULLIF(BTRIM(experience_text), '') IS NOT NULL OR experience_status = 'pending_recheck')),
                'rejected_legacy', COUNT(*) FILTER (WHERE experience_status = 'rejected_legacy')
              ),
              'salary', jsonb_build_object(
                'verified', COUNT(*) FILTER (WHERE NULLIF(BTRIM(salary_range), '') IS NOT NULL AND (salary_status = 'verified' OR (salary_status IS NULL AND LOWER(COALESCE(salary_source, '')) IN ('official_payload', 'official_detail_page', 'official_description', 'official_link_valid_through', 'official_link_application_deadline', 'official_link_structured_field', 'official_link_description')))),
                'pending_recheck', COUNT(*) FILTER (WHERE salary_status <> 'rejected_legacy' AND NOT (NULLIF(BTRIM(salary_range), '') IS NOT NULL AND (salary_status = 'verified' OR LOWER(COALESCE(salary_source, '')) IN ('official_payload', 'official_detail_page', 'official_description', 'official_link_valid_through', 'official_link_application_deadline', 'official_link_structured_field', 'official_link_description'))) AND (NULLIF(BTRIM(salary_range), '') IS NOT NULL OR salary_status = 'pending_recheck')),
                'rejected_legacy', COUNT(*) FILTER (WHERE salary_status = 'rejected_legacy')
              ),
              'deadline', jsonb_build_object(
                'verified', COUNT(*) FILTER (WHERE valid_through IS NOT NULL AND (deadline_status = 'verified' OR (deadline_status IS NULL AND LOWER(COALESCE(deadline_source, '')) IN ('official_payload', 'official_detail_page', 'official_description', 'official_link_valid_through', 'official_link_application_deadline', 'official_link_structured_field', 'official_link_description')))),
                'pending_recheck', COUNT(*) FILTER (WHERE deadline_status <> 'rejected_legacy' AND NOT (valid_through IS NOT NULL AND (deadline_status = 'verified' OR LOWER(COALESCE(deadline_source, '')) IN ('official_payload', 'official_detail_page', 'official_description', 'official_link_valid_through', 'official_link_application_deadline', 'official_link_structured_field', 'official_link_description'))) AND (valid_through IS NOT NULL OR deadline_status = 'pending_recheck')),
                'rejected_legacy', COUNT(*) FILTER (WHERE deadline_status = 'rejected_legacy')
              )
            ) AS coverage
          FROM active_jobs
          GROUP BY company, host
          ORDER BY company, host
        `);
        const states = await client.query<OfficialStateRow>(`
          select source_system, last_attempted_at, last_success_at, next_retry_at,
                 consecutive_failures, priority, last_error
            from public.job_sync_state
           where source_system like 'official:%'
        `);
        return { rows: aggregate.rows, states: states.rows };
      } finally {
        await client.end();
      }
    })(),
  ]);
  const rows = aggregateResult.rows;
  const states = new Map(aggregateResult.states.map((row) => [row.source_system, row]));
  const total = rows.reduce((sum, row) => sum + asNumber(row.active_jobs), 0);

  const companies = new Map<string, CompanyTally>();
  for (const row of rows) {
    const company = text(row.company) || '未注明公司';
    const item = companies.get(company) || {
      company,
      active_jobs: 0,
      hosts: new Map<string, number>(),
      source_families: new Map<string, number>(),
      coverage: emptyCoverage(),
      latest_updated_at: null,
    };
    const jobs = asNumber(row.active_jobs);
    item.active_jobs += jobs;
    const host = text(row.host) || 'missing_source_url';
    item.hosts.set(host, (item.hosts.get(host) || 0) + jobs);
    const family = sourceFamily(host);
    item.source_families.set(family, (item.source_families.get(family) || 0) + jobs);
    if (row.updated_at && (!item.latest_updated_at || Date.parse(row.updated_at) > Date.parse(item.latest_updated_at))) {
      item.latest_updated_at = row.updated_at;
    }
    for (const field of FIELDS) {
      const input = row.coverage?.[field] || {};
      const tally = item.coverage[field];
      tally.verified += asNumber(input.verified);
      tally.pending_recheck += asNumber(input.pending_recheck);
      tally.rejected_legacy += asNumber(input.rejected_legacy);
      tally.unavailable_on_official_source += jobs - asNumber(input.verified) - asNumber(input.pending_recheck) - asNumber(input.rejected_legacy);
    }
    companies.set(company, item);
  }

  const report = {
    generated_at: new Date().toISOString(),
    environment: {
      env_file: envFile,
      supabase_project_ref: hostOf(process.env.SUPABASE_URL || null)?.split('.')[0] || null,
      source_system: 'collector_feed',
      company_filter_enabled: process.env.JOBS_FEED_COMPANY_FILTER_ENABLED === 'true',
    },
    totals: {
      active_jobs: total,
      source_host_groups: rows.length,
      active_companies: companies.size,
    },
    companies: [...companies.values()]
      .map((item) => {
        const profile = getCompanySourceProfile(item.company);
        const coverage = Object.fromEntries(FIELDS.map((field) => [field, fieldCoverage(item.coverage[field], item.active_jobs)]));
        const observedPrimarySourceFamily = [...item.source_families.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || 'missing_source_url';
        const source = effectiveSourceFamily(
          observedPrimarySourceFamily,
          profile?.connector || null,
          DOCUMENTED_OFFICIAL_SOURCE_FAMILIES[item.company.toLocaleLowerCase()],
        );
        const schedule = states.get(officialStateKey(item.company, profile?.connector || null, source.sourceFamily));
        return {
          company: item.company,
          upstream_company_id: remoteCompanyIds.get(item.company.toLocaleLowerCase()) || null,
          active_jobs: item.active_jobs,
          primary_source_family: source.sourceFamily,
          source_family_basis: source.basis,
          observed_primary_source_family: observedPrimarySourceFamily,
          observed_source_family_distribution: toSortedObject(item.source_families),
          source_hosts: toSortedObject(item.hosts),
          registered_connector: profile ? profile.connector : null,
          connector_board: profile?.board || null,
          official_careers_url: profile?.careersUrl || DOCUMENTED_OFFICIAL_CAREERS[item.company.toLocaleLowerCase()] || null,
          official_hosts: profile?.officialHosts?.length ? profile.officialHosts : DOCUMENTED_OFFICIAL_HOSTS[item.company.toLocaleLowerCase()] || Object.keys(item.hosts),
          detail_required: profile?.detailRequired ?? null,
          region_scope: profile?.regionScope || null,
          timezone: profile?.timezone || null,
          external_job_id_field: 'external_job_id',
          detail_url_rule: detailUrlRule(profile?.connector || null),
          last_attempted_at: schedule?.last_attempted_at || null,
          last_success_at: schedule?.last_success_at || null,
          next_retry_at: schedule?.next_retry_at || null,
          consecutive_failures: asNumber(schedule?.consecutive_failures),
          priority: asNumber(schedule?.priority),
          last_error: schedule?.last_error || null,
          latest_updated_at: item.latest_updated_at,
          coverage,
          discovery_status: source.basis === 'discovery_required' ? 'discovery_required' : source.basis === 'connector_registry' ? 'configured_connector' : 'source_family_identified',
        };
      })
      .sort((left, right) => right.active_jobs - left.active_jobs || left.company.localeCompare(right.company)),
  };

  const output = JSON.stringify(report, null, 2);
  const outputFile = argument('out');
  const write = process.argv.includes('--write');
  if (write && process.env.SOURCE_MATRIX_WRITE_ENABLED !== 'true') {
    throw new Error('来源矩阵写入默认关闭；请同时设置 SOURCE_MATRIX_WRITE_ENABLED=true 和 --write');
  }
  let matrixWrite: { written: number } | null = null;
  if (write) matrixWrite = await persistSourceMatrix(connectionString, report.companies);
  if (outputFile) {
    const resolved = path.resolve(outputFile);
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, `${output}\n`, 'utf8');
    console.log(JSON.stringify({ ...report.totals, report_file: resolved, generated_at: report.generated_at, matrix_write: matrixWrite }, null, 2));
  } else if (write) {
    console.log(JSON.stringify({ ...report.totals, generated_at: report.generated_at, matrix_write: matrixWrite }, null, 2));
  } else {
    console.log(output);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

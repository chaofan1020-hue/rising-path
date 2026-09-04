import type { JobsFeedItem } from '@/lib/jobs-feed';

export type JobConnector = 'greenhouse' | 'ashby' | 'lever' | 'phenom' | 'oracle_hcm';

export type ConnectorStandardField =
  | 'location'
  | 'workplace_type'
  | 'employment_category'
  | 'experience'
  | 'salary_range'
  | 'deadline';

export type ConnectorSourceLayer = 'structured' | 'list' | 'detail' | 'description';

export interface ConnectorParseOptions {
  companyName: string;
  boardToken?: string;
  sourceUrl?: string | null;
}

export interface ConnectorFixtureExpectation {
  employment_category?: string;
  location_includes?: string[];
  workplace_type?: string;
  experience_min_years?: number | null;
  experience_max_years?: number | null;
  salary_includes?: string;
  deadline?: string;
}

export type ConnectorJob = JobsFeedItem;

export interface ConnectorUrlCheckResult {
  url: string;
  status: 'valid' | 'closed' | 'blocked' | 'timeout' | 'unknown';
  httpStatus: number | null;
  checkedAt: string;
  redirectedUrl?: string | null;
}

export interface ConnectorBoardConfig {
  connector: JobConnector;
  company: string;
  board: string;
  boardAliases?: string[];
  /** Official Phenom search page. Kept company-specific because tenants
   * choose their own locale and route structure. */
  phenomSearchUrl?: string;
  /** Oracle HCM Candidate Experience tenant configuration. */
  oracleApiBaseUrl?: string;
  oracleSiteNumber?: string;
  oracleCareersUrl?: string;
}

export interface CompanySourceProfile extends ConnectorBoardConfig {
  careersUrl: string;
  officialHosts: string[];
  detailRequired: boolean;
  timezone: string;
  regionScope: 'us_ca' | 'global';
  fieldLayers: Record<ConnectorStandardField, ConnectorSourceLayer[]>;
}

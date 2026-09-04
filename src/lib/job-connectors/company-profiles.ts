import type {
  CompanySourceProfile,
  ConnectorStandardField,
  ConnectorSourceLayer,
} from '@/lib/job-connectors/types';
import { PHASE2_CONNECTOR_BOARDS } from '@/lib/job-connectors/boards';

const STANDARD_LAYERS: Record<ConnectorStandardField, ConnectorSourceLayer[]> = {
  location: ['structured', 'list', 'detail'],
  workplace_type: ['structured', 'list', 'detail'],
  employment_category: ['structured', 'list', 'detail', 'description'],
  experience: ['structured', 'detail', 'description'],
  salary_range: ['structured', 'detail'],
  deadline: ['structured', 'detail', 'description'],
};

const CAREERS_URLS: Record<string, string> = {
  Cloudflare: 'https://www.cloudflare.com/careers/jobs/',
  Stripe: 'https://stripe.com/jobs',
  Datadog: 'https://careers.datadoghq.com/',
  Coinbase: 'https://www.coinbase.com/careers',
  Asana: 'https://asana.com/jobs',
  Brex: 'https://www.brex.com/careers',
  Databricks: 'https://www.databricks.com/company/careers/open-positions',
  Figma: 'https://www.figma.com/careers/',
  GitLab: 'https://about.gitlab.com/jobs/',
  Point72: 'https://careers.point72.com/',
  Reddit: 'https://www.redditinc.com/careers',
  Robinhood: 'https://careers.robinhood.com/',
  Twilio: 'https://www.twilio.com/company/jobs',
  Discord: 'https://discord.com/jobs',
  TPG: 'https://www.tpg.com/careers',
  'Bridgewater Associates': 'https://www.bridgewater.com/careers',
  'General Atlantic': 'https://www.generalatlantic.com/careers/',
  Runway: 'https://runwayml.com/careers/',
  OpenAI: 'https://openai.com/careers/search/',
  Cursor: 'https://www.cursor.com/careers',
  Notion: 'https://www.notion.so/careers',
  Perplexity: 'https://www.perplexity.ai/hub/careers',
  Ramp: 'https://ramp.com/careers',
  Vanta: 'https://www.vanta.com/careers',
  Linear: 'https://linear.app/careers',
  Palantir: 'https://www.palantir.com/careers/',
  'Boston Consulting Group': 'https://careers.bcg.com/global/en/search-results',
  'Oliver Wyman': 'https://careers.marsh.com/global/en/search-results',
  Lazard: 'https://icbpjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/LazardProfessionalCareers',
  Jefferies: 'https://hdid.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1',
  'JPMorgan Chase': 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001',
};

const OFFICIAL_HOSTS: Record<string, string[]> = {
  Cloudflare: ['boards.greenhouse.io', 'cloudflare.com'],
  Stripe: ['stripe.com'],
  Datadog: ['datadoghq.com'],
  Coinbase: ['coinbase.com'],
  Asana: ['asana.com'],
  Brex: ['brex.com'],
  Databricks: ['databricks.com'],
  Figma: ['boards.greenhouse.io', 'figma.com'],
  GitLab: ['job-boards.greenhouse.io', 'gitlab.com'],
  Point72: ['boards.greenhouse.io', 'point72.com'],
  Reddit: ['job-boards.greenhouse.io', 'redditinc.com'],
  Robinhood: ['boards.greenhouse.io', 'robinhood.com'],
  Twilio: ['job-boards.greenhouse.io', 'twilio.com'],
  Discord: ['job-boards.greenhouse.io', 'discord.com'],
  TPG: ['job-boards.greenhouse.io', 'tpg.com'],
  'Bridgewater Associates': ['job-boards.greenhouse.io', 'bridgewater.com'],
  'General Atlantic': ['job-boards.greenhouse.io', 'generalatlantic.com'],
  Runway: ['jobs.ashbyhq.com', 'runwayml.com'],
  OpenAI: ['jobs.ashbyhq.com', 'openai.com'],
  Cursor: ['jobs.ashbyhq.com', 'cursor.com'],
  Notion: ['jobs.ashbyhq.com', 'notion.so'],
  Perplexity: ['jobs.ashbyhq.com', 'perplexity.ai'],
  Ramp: ['jobs.ashbyhq.com', 'ramp.com'],
  Vanta: ['jobs.ashbyhq.com', 'vanta.com'],
  Linear: ['jobs.ashbyhq.com', 'linear.app'],
  Palantir: ['jobs.lever.co', 'palantir.com'],
  'Boston Consulting Group': ['careers.bcg.com'],
  'Oliver Wyman': ['careers.marsh.com'],
  Lazard: ['icbpjb.fa.ocs.oraclecloud.com', 'lazard.com'],
  Jefferies: ['hdid.fa.us2.oraclecloud.com', 'jefferies.com'],
  'JPMorgan Chase': ['jpmc.fa.oraclecloud.com', 'jpmorganchase.com', 'careers.jpmorgan.com'],
};

/**
 * Company-specific source metadata. Parsing remains connector-owned; this
 * profile is the contract used for source validation and field QA.
 */
export const PHASE2_COMPANY_PROFILES: CompanySourceProfile[] = PHASE2_CONNECTOR_BOARDS.map((board) => ({
  ...board,
  careersUrl: CAREERS_URLS[board.company] || '',
  officialHosts: OFFICIAL_HOSTS[board.company] || [],
  detailRequired: true,
  // A company's board can contain multiple countries and local cut-offs.
  // Keep this unknown until the detail page provides an explicit timezone.
  timezone: 'unknown',
  regionScope: 'global',
  fieldLayers: STANDARD_LAYERS,
}));

export function getCompanySourceProfile(company: string): CompanySourceProfile | null {
  const normalized = company.trim().toLocaleLowerCase();
  return PHASE2_COMPANY_PROFILES.find((profile) => profile.company.toLocaleLowerCase() === normalized) || null;
}

/**
 * Registered Phenom tenants embed a generic expired-job panel in otherwise
 * valid pages. Their lifecycle is reconciled by the official connector, not
 * by a generic HTML-text link check.
 */
export function isRegisteredPhenomJobUrl(company: string, rawUrl: string): boolean {
  const profile = getCompanySourceProfile(company);
  if (!profile || profile.connector !== 'phenom') return false;
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    const officialHost = profile.officialHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
    return url.protocol === 'https:' && officialHost && /\/job\/[^/]+/i.test(url.pathname);
  } catch {
    return false;
  }
}

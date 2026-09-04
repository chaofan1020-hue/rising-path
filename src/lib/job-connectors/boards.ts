import type { ConnectorBoardConfig } from '@/lib/job-connectors/types';

/** Initial Phase 2 board registry. Tokens are the public ATS board slugs. */
export const PHASE2_CONNECTOR_BOARDS: ConnectorBoardConfig[] = [
  ...[
    ['Cloudflare', 'cloudflare'],
    ['Stripe', 'stripe'],
    ['Datadog', 'datadog'],
    ['Coinbase', 'coinbase'],
    ['Asana', 'asana'],
    ['Brex', 'brex'],
    ['Databricks', 'databricks'],
    ['Figma', 'figma'],
    ['GitLab', 'gitlab'],
    ['Point72', 'point72'],
    ['Reddit', 'reddit'],
    ['Robinhood', 'robinhood'],
    ['Twilio', 'twilio'],
    ['Discord', 'discord'],
    ['TPG', 'tpgcareers'],
    ['Bridgewater Associates', 'bridgewater89'],
    ['General Atlantic', 'generalatlantic'],
    ['MongoDB', 'mongodb'],
    ['Okta', 'okta'],
    ['Elastic', 'elastic'],
    ['Duolingo', 'duolingo'],
    ['Roblox', 'roblox'],
    ['Jane Street', 'janestreet'],
  ].map(([company, board]) => ({ connector: 'greenhouse' as const, company, board })),
  ...[
    { connector: 'ashby' as const, company: 'Runway', board: 'runway', boardAliases: ['runway-ml'] },
    ['OpenAI', 'openai'],
    ['Cursor', 'cursor'],
    ['Notion', 'notion'],
    ['Perplexity', 'perplexity'],
    ['Ramp', 'ramp'],
    ['Vanta', 'vanta'],
    ['Linear', 'linear'],
  ].map((item) => Array.isArray(item) ? ({ connector: 'ashby' as const, company: item[0], board: item[1] }) : item),
  { connector: 'lever', company: 'Palantir', board: 'palantir' },
  {
    connector: 'phenom',
    company: 'Boston Consulting Group',
    board: 'BCG1US',
    phenomSearchUrl: 'https://careers.bcg.com/global/en/search-results',
  },
  {
    connector: 'phenom',
    company: 'Oliver Wyman',
    board: 'MARSHGLOBAL',
    phenomSearchUrl: 'https://careers.marsh.com/global/en/search-results',
  },
  {
    connector: 'oracle_hcm',
    company: 'Lazard',
    board: 'LazardProfessionalCareers',
    oracleApiBaseUrl: 'https://icbpjb.fa.ocs.oraclecloud.com',
    oracleSiteNumber: 'CX_1',
    oracleCareersUrl: 'https://icbpjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/LazardProfessionalCareers',
  },
  {
    connector: 'oracle_hcm',
    company: 'Jefferies',
    board: 'CX_1',
    oracleApiBaseUrl: 'https://hdid.fa.us2.oraclecloud.com',
    oracleSiteNumber: 'CX_1',
    oracleCareersUrl: 'https://hdid.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1',
  },
  {
    connector: 'oracle_hcm',
    company: 'JPMorgan Chase',
    board: 'CX_1001',
    oracleApiBaseUrl: 'https://jpmc.fa.oraclecloud.com',
    oracleSiteNumber: 'CX_1001',
    oracleCareersUrl: 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001',
  },
];

export function getConnectorBoard(company: string): ConnectorBoardConfig | null {
  const normalized = company.trim().toLocaleLowerCase();
  return PHASE2_CONNECTOR_BOARDS.find((item) => item.company.toLocaleLowerCase() === normalized) || null;
}

// 高质量金融岗位列表 - 手动维护的官方招聘链接
// 格式：公司, 岗位URL, 标题

export const HIGH_QUALITY_JOBS = [
  // Goldman Sachs
  ['Goldman Sachs', 'https://www.goldmansachs.com/careers/jobs/python-engineering--1580463', 'Python Engineering'],
  ['Goldman Sachs', 'https://www.goldmansachs.com/careers/jobs/quantitative-engineering--1518267', 'Quantitative Engineering'],
  ['Goldman Sachs', 'https://www.goldmansachs.com/careers/jobs/software-engineering--1620246', 'Software Engineering'],
  
  // Morgan Stanley
  ['Morgan Stanley', 'https://www.morganstanley.com/careers/job/technology--new-york--united-states', 'Technology'],
  ['Morgan Stanley', 'https://www.morganstanley.com/careers/job/software-engineer--new-york--united-states', 'Software Engineer'],
  
  // JPMorgan
  ['JPMorgan', 'https://careers.jpmorgan.com/us/en/professionals/job/software-engineer-2025', 'Software Engineer 2025'],
  ['JPMorgan', 'https://careers.jpmorgan.com/us/en/students/job/quant-research-analyst', 'Quantitative Research Analyst'],
  
  // BlackRock
  ['BlackRock', 'https://www.blackrock.com/careers/job/software-engineer', 'Software Engineer'],
  ['BlackRock', 'https://www.blackrock.com/careers/job/quantitative-developer', 'Quantitative Developer'],
  
  // Citadel
  ['Citadel', 'https://www.citadel.com/careers/open-positions/software-engineer', 'Software Engineer'],
  ['Citadel', 'https://www.citadel.com/careers/open-positions/quantitative-researcher', 'Quantitative Researcher'],
  
  // Two Sigma
  ['Two Sigma', 'https://www.twosigma.com/careers/', 'Software Engineer'],
  
  // Jane Street
  ['Jane Street', 'https://www.janestreet.com/join/jobs/', 'Software Engineer'],
  
  // Bloomberg
  ['Bloomberg', 'https://www.bloomberg.com/careers/positions?search=software', 'Software Engineer'],
  
  // Barclays
  ['Barclays', 'https://home.barclays/careers/search-jobs/?keywords=technology', 'Technology'],
  
  // Wells Fargo
  ['Wells Fargo', 'https://www.wellsfargo.com/careers/jobs?keywords=software+engineer', 'Software Engineer'],
  
  // Bank of America
  ['Bank of America', 'https://careers.bankofamerica.com/en-us/search?keywords=technology', 'Technology'],
  
  // Citi
  ['Citi', 'https://jobs.citi.com/search-jobs/?keyword=technology', 'Technology'],
  
  // DE Shaw
  ['DE Shaw', 'https://www.deshaw.com/careers/positions', 'Positions'],
  
  // AQR
  ['AQR', 'https://www.aqr.com/About-Us/Careers/', 'Careers'],
  
  // IMC Trading
  ['IMC Trading', 'https://www.imc.com/trading-careers', 'Trading Careers'],
  
  // Optiver
  ['Optiver', 'https://optiver.com/working-at-optiver/career-opportunities/', 'Career Opportunities'],
];

// 岗位来源网站 - 可以直接抓取的招聘平台
export const ATS_PLATFORMS = [
  // Greenhouse 招聘平台
  { pattern: /careers\.greenhouse\.io/i, name: 'Greenhouse' },
  // Lever 招聘平台
  { pattern: /careers\.lever\.co/i, name: 'Lever' },
  // Workday 招聘平台
  { pattern: /\.workday\.com/i, name: 'Workday' },
];

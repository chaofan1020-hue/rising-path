import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Sponsor 检测函数
export function detectSponsorship(description: string, company?: string): 'yes' | 'no' | 'unknown' {
  const lowerDesc = description?.toLowerCase() || '';
  
  // 明确表示提供 sponsor 的关键词
  const sponsorYesKeywords = [
    'will sponsor',
    'will provide sponsorship',
    'provide visa sponsorship',
    'provides visa sponsorship',
    'visa sponsorship available',
    'sponsorship available',
    'we will sponsor',
    'eligible for visa sponsorship',
    'h-1b sponsorship',
    'h1b sponsorship',
    'opt sponsorship',
    'curricular practical training',
    'cpt sponsorship',
    'work visa sponsorship',
    'employment authorization',
    'employment-based visa',
    'petition for alien worker',
    'green card sponsorship',
  ];
  
  // 明确表示不提供 sponsor 的关键词
  const sponsorNoKeywords = [
    'does not sponsor',
    'do not sponsor',
    'no visa sponsorship',
    'no sponsorship',
    'not eligible for sponsorship',
    'unable to sponsor',
    'cannot sponsor',
    'will not sponsor',
    'us work authorization required',
    'must be authorized',
    'must have work authorization',
    'requires us work authorization',
    'us citizens only',
    'us work permit required',
    'must be eligible to work in the us',
    'require sponsorship',
    'require sponsorship',
    'will require sponsorship',
    'will need sponsorship',
    'need sponsorship',
    'unable to provide sponsorship',
    'cannot provide sponsorship',
    'not able to sponsor',
  ];
  
  // 检查是否包含"不提供"的关键词（优先判断）
  for (const keyword of sponsorNoKeywords) {
    if (lowerDesc.includes(keyword)) {
      return 'no';
    }
  }
  
  // 检查是否包含"提供"的关键词
  for (const keyword of sponsorYesKeywords) {
    if (lowerDesc.includes(keyword)) {
      return 'yes';
    }
  }
  
  // 检查一些模糊但偏向提供的关键词
  const likelySponsorKeywords = [
    'equal opportunity employer',
    'eoe employer',
    'international applicants',
    'international candidates',
    'global talent',
    'relocation assistance',
  ];
  
  for (const keyword of likelySponsorKeywords) {
    if (lowerDesc.includes(keyword)) {
      return 'yes';
    }
  }
  
  // 根据公司类型推断（description 太短时使用）
  // 美国科技公司通常提供 Sponsor
  if (company && lowerDesc.length < 50) {
    const usTechCompanies = [
      'google', 'meta', 'apple', 'amazon', 'microsoft', 'netflix', 'nvidia',
      'uber', 'stripe', 'airbnb', 'lyft', 'doordash', 'dropbox', 'coinbase',
      'robinhood', 'figma', 'notion', 'palantir', 'databricks', 'snowflake',
      'twilio', 'zoom', 'atlassian', 'confluent', 'mongodb', 'cloudflare',
      'rubrik', 'scale ai', 'openai', 'anthropic', 'instacart', 'discord',
      'plaid', 'brex', 'datadog', 'gitlab', 'slack', 'spotify', 'snap',
      'pinterest', 'linkedin', 'twitter', 'tesla', 'spacex',
      'goldman sachs', 'jpmorgan', 'morgan stanley', 'bank of america', 'citi',
      'blackrock', 'citadel', 'two sigma', 'jane street', 'point72',
      'revolut', 'canva', 'tencent',
    ];
    const lowerCompany = company.toLowerCase();
    if (usTechCompanies.some(c => lowerCompany.includes(c))) {
      // 美国知名科技/金融公司默认提供 Sponsor
      return 'yes';
    }
  }
  
  return 'unknown';
}

import { NextRequest, NextResponse } from 'next/server';
import { SearchClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 美国科技大厂
const TECH_COMPANIES = [
  'Google', 'Apple', 'Microsoft', 'Amazon', 'Meta', 'Netflix', 
  'Tesla', 'NVIDIA', 'Uber', 'Airbnb', 'Stripe', 'Shopify',
  'Salesforce', 'Adobe', 'Oracle', 'LinkedIn', 'Snap', 'Pinterest', 'Twitter', 'X'
];

// 只保留美国主要地区
const US_REGIONS = [
  'San Francisco, CA', 'Seattle, WA', 'New York, NY', 'Los Angeles, CA',
  'Austin, TX', 'Boston, MA', 'Chicago, IL', 'Denver, CO', 'Atlanta, GA',
  'Remote - United States', 'United States'
];

// 严格验证岗位
function isValidJob(title: string, url: string): boolean {
  if (!title || title.length < 15) return false;
  if (!url || url.length < 20) return false;
  
  const titleLower = title.toLowerCase();
  const urlLower = url.toLowerCase();
  
  // 1. 过滤中文
  if (/[\u4e00-\u9fa5]/.test(title)) return false;
  
  // 1.5 过滤非英语语言特征
  const nonEnglishPatterns = [
    /rekrytointi/i,           // 立陶宛语
    /rekrytering/i,           // 瑞典语
    /reclutamiento/i,         // 西班牙语
    /rekrutacja/i,            // 波兰语
    /acquisition/i,           // 可能是猎头
    /recrute/i,              // 法语
    /stellenanzeige/i,        // 德语
    /empleo/i,                // 西班牙语
    /offre d'emploi/i,        // 法语
    /trabajo/i,               // 西班牙语
    /pracownik/i,             // 波兰语
    /mitarbeiter/i,           // 德语
    /Post de /i,              // LinkedIn帖子
  ];
  for (const pattern of nonEnglishPatterns) {
    if (pattern.test(title)) return false;
  }
  
  // 3. 过滤数字开头的标题（通常是薪资范围）
  if (/^\d+[\s,]/.test(title)) return false;
  
  // 4. 过滤太通用的标题
  const genericTitles = [
    'software engineer', 'software developer', 'data scientist',
    'machine learning engineer', 'product manager', 'product designer',
    'frontend engineer', 'backend engineer', 'full stack engineer',
    'full-stack engineer', 'devops engineer', 'cloud engineer', 'data engineer',
    'python developer', 'java developer', 'ai developer', 'ml engineer',
    'ux designer', 'ux researcher', 'product designer', 'engineering manager',
    'senior software engineer', 'senior software developer', 'junior developer'
  ];
  if (genericTitles.includes(titleLower.trim())) return false;
  
  // 4.5 过滤非工程类岗位
  const nonEngineeringKeywords = [
    'fulfillment by amazon', 'fulfillment by', 'selling partner',
    'account executive', 'account manager', 'sales representative', 'recruiter', 'hr manager',
    'marketing manager', 'business development', 'customer success', 'content designer',
    'technical writer', 'program manager', 'scrum master', 'sales director',
    'global agency', 'partner marketing', 'product designer', 'ux/ui',
    'build your career', 'careers', 'job openings', 'open position',
    'engineering manager', ' manager, ', ' director,', 'director', ' roles'
  ];
  for (const keyword of nonEngineeringKeywords) {
    if (titleLower.includes(keyword)) return false;
  }
  
  // 5. 过滤噪音URL
  const noiseUrlPatterns = [
    'blog', 'zhihu', 'baidu', 'qq.com', '163.com', 'sina', 'sohu.com', 
    'liepin.com', '51job.com', 'zhaopin', 'cngold', 'sinaja',
    'company profile', 'casestudy', 'how-to', '/about', '/benefits',
    'pulse', 'fortune', 'medium.com', 'youtube.com'
  ];
  for (const pattern of noiseUrlPatterns) {
    if (urlLower.includes(pattern)) return false;
  }
  
  // 6. 【关键】过滤非美国地区URL - 过滤特定国家的 LinkedIn
  // 例如: in.linkedin.com (印度), cn.linkedin.com (中国), tw.linkedin.com (台湾)
  const countryLinkedinPatterns = [
    /\bin\.linkedin\.com/i,      // 印度
    /\bcn\.linkedin\.com/i,       // 中国
    /\btw\.linkedin\.com/i,       // 台湾
    /\bhk\.linkedin\.com/i,       // 香港
    /\bsg\.linkedin\.com/i,       // 新加坡
    /\buk\.linkedin\.com/i,       // 英国
    /\bde\.linkedin\.com/i,       // 德国
    /\bfr\.linkedin\.com/i,       // 法国
    /\bau\.linkedin\.com/i,       // 澳大利亚
    /\bin\.linkedin\.com/i,       // 印度
    /\bpk\.linkedin\.com/i,       // 巴基斯坦
    /\bjp\.linkedin\.com/i,       // 日本
    /\bkr\.linkedin\.com/i,       // 韩国
  ];
  for (const pattern of countryLinkedinPatterns) {
    if (pattern.test(url)) return false;
  }
  
  // 7. 过滤非美国地区的 Tesla
  if (url.includes('tesla.cn') || url.includes('tesla.com.cn')) return false;
  
  // 7. 过滤猎头/中介公司 - 检查标题中 "at xxx" 格式
  // 如果 "at" 后面的公司名不是目标公司，则为猎头
  const atMatch = title.match(/\sat\s+([A-Za-z\s-]+?)(?:\s*[-|,]|in\s|$)/i);
  if (atMatch) {
    const companyAfterAt = atMatch[1].trim().toLowerCase();
    const expectedCompanies = TECH_COMPANIES.map(c => c.toLowerCase());
    const isKnownCompany = expectedCompanies.some(c => 
      companyAfterAt.includes(c) || c.includes(companyAfterAt)
    );
    if (!isKnownCompany) return false;
  }
  
  // 8. 过滤关键词在 at 后面
  const thirdPartyKeywords = [
    'dubclub', 'zensar', 'chels', 'lazer', 'honeysuckle', 'gelato',
    'w2/c2c', 'w2_c2c', 'contract', 'corp', 'corp-to-cor', 'c2c'
  ];
  for (const keyword of thirdPartyKeywords) {
    if (titleLower.includes(keyword)) return false;
  }
  
  // 9. 过滤非官方招聘页面
  // LinkedIn URL 中带有 refId, trackingId 的是第三方帖子
  if (urlLower.includes('linkedin.com') && (urlLower.includes('refid=') || urlLower.includes('trackingid='))) {
    return false;
  }
  
  // 8. 过滤标题是纯地区名的情况
  if (/^(San Francisco|Seattle|New York|Los Angeles|Austin|Boston|Chicago|Denver|Atlanta|London|Tokyo|Singapore|Hong Kong),?\s*(,|$)/i.test(title)) {
    return false;
  }
  
  return true;
}

// 提取岗位标题
function extractTitle(rawTitle: string): string {
  // 移除 "公司名 hiring" 格式
  let title = rawTitle.replace(new RegExp(`^(Google|Apple|Microsoft|Amazon|Meta|Netflix|Tesla|NVIDIA|Uber|Airbnb|Stripe|Shopify|Salesforce|Adobe|Oracle|LinkedIn|Snap|Pinterest|Twitter|X)\\s+hiring\\s+`, 'i'), '');
  
  // 移除末尾的来源
  title = title.replace(/\s*[-|]\s*(LinkedIn|Glassdoor|Indeed|Jobs|Careers).*$/i, '');
  
  // 移除公司名
  title = title.replace(/\s+at\s+(Google|Apple|Microsoft|Amazon|Meta|Netflix|Tesla|NVIDIA|Uber|Airbnb|Stripe|Shopify|Salesforce|Adobe|Oracle|LinkedIn|Snap|Pinterest|Twitter|X)\s*$/i, '');
  
  // 移除多余空格
  title = title.replace(/\s+/g, ' ').trim();
  
  return title.substring(0, 150);
}

// 验证公司名确实在标题或URL中
function verifyCompanyMatch(title: string, url: string, expectedCompany: string): boolean {
  const titleLower = title.toLowerCase();
  const urlLower = url.toLowerCase();
  const companyLower = expectedCompany.toLowerCase();
  
  // 检查URL是否包含公司域名或名称
  if (urlLower.includes(companyLower)) return true;
  
  // 检查标题是否包含公司名
  if (titleLower.includes(companyLower)) return true;
  
  return false;
}

// 从URL识别来源
function identifySource(url: string): string | null {
  const urlLower = url.toLowerCase();
  if (urlLower.includes('linkedin.com/jobs/view')) return 'LinkedIn';
  if (urlLower.includes('indeed.com')) return 'Indeed';
  if (urlLower.includes('glassdoor.com')) return 'Glassdoor';
  if (urlLower.includes('careers.google.com')) return 'Google';
  if (urlLower.includes('jobs.apple.com')) return 'Apple';
  if (urlLower.includes('careers.microsoft.com')) return 'Microsoft';
  if (urlLower.includes('amazon.jobs')) return 'Amazon';
  if (urlLower.includes('metacareers.com')) return 'Meta';
  if (urlLower.includes('tesla.com/careers')) return 'Tesla';
  if (urlLower.includes('nvidia.com')) return 'NVIDIA';
  if (urlLower.includes('uber.com/careers')) return 'Uber';
  if (urlLower.includes('airbnb.com/careers')) return 'Airbnb';
  if (urlLower.includes('stripe.com/jobs')) return 'Stripe';
  if (urlLower.includes('shopify.com/careers')) return 'Shopify';
  if (urlLower.includes('salesforce.com')) return 'Salesforce';
  if (urlLower.includes('adobe.com/careers')) return 'Adobe';
  if (urlLower.includes('oracle.com')) return 'Oracle';
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const config = new Config();
    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const client = new SearchClient(config, customHeaders);
    const supabase = getSupabaseClient();

    const results = {
      success: 0,
      skipped: 0,
      failed: 0,
      invalid: 0,
      total: 0,
      details: [] as string[],
    };

    const seenUrls = new Set<string>();
    const companyStats: Record<string, { success: number; invalid: number }> = {};

    // 第一步：从大厂官网和招聘平台获取高质量岗位
    for (const company of TECH_COMPANIES) {
      companyStats[company] = { success: 0, invalid: 0 };
      
      const queries = [
        `${company} careers software engineer United States`,
        `${company} senior software engineer job openings`,
        `${company} machine learning engineer jobs available`,
      ];

      for (const query of queries.slice(0, 2)) {
        try {
          const response = await client.webSearch(query, 10, false);

          if (response.web_items && response.web_items.length > 0) {
            for (const item of response.web_items) {
              const url = item.url || '';
              
              if (seenUrls.has(url)) continue;
              seenUrls.add(url);
              
              const source = identifySource(url);
              if (!source) continue;
              
              let title = extractTitle(item.title || '');
              
              // 严格验证
              if (!isValidJob(title, url)) {
                results.invalid++;
                companyStats[company].invalid++;
                continue;
              }
              
              // 验证公司匹配
              if (!verifyCompanyMatch(title, url, company)) {
                results.invalid++;
                companyStats[company].invalid++;
                continue;
              }
              
              results.total++;
              
              const { data: existing } = await supabase
                .from('jobs')
                .select('id')
                .eq('job_url', url)
                .single();

              if (!existing) {
                const region = US_REGIONS[Math.floor(Math.random() * US_REGIONS.length)];
                
                const { error } = await supabase
                  .from('jobs')
                  .insert({
                    title,
                    company,
                    region,
                    direction: 'Tech',
                    audience: '留学生',
                    description: (item.snippet || '').substring(0, 500),
                    requirements: '',
                    salary_range: '',
                    job_url: url,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  });

                if (!error) {
                  results.success++;
                  companyStats[company].success++;
                } else {
                  results.failed++;
                }
              } else {
                results.skipped++;
              }
            }
          }

          await new Promise(resolve => setTimeout(resolve, 600));
          
        } catch (error) {
          console.error(`Search error for ${company}:`, error);
        }
      }
    }

    // 汇总结果
    for (const [company, stats] of Object.entries(companyStats)) {
      if (stats.success > 0) {
        results.details.push(`${company}: ${stats.success} (过滤${stats.invalid})`);
      }
    }

    return NextResponse.json({
      success: true,
      message: `同步完成：新增 ${results.success} 个有效岗位，过滤 ${results.invalid} 个无效岗位`,
      results,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json(
      { error: '同步失败', details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    method: 'POST',
    description: '同步美国科技大厂有效岗位（严格过滤）',
    usage: 'curl -X POST http://localhost:5000/api/jobs/sync-us-tech',
  });
}

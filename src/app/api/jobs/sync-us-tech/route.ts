import { NextRequest, NextResponse } from 'next/server';
import { SearchClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 美国科技大厂列表
const US_TECH_COMPANIES = [
  { name: 'Google', careers: 'careers.google.com', direction: 'Tech' },
  { name: 'Apple', careers: 'jobs.apple.com', direction: 'Tech' },
  { name: 'Microsoft', careers: 'careers.microsoft.com', direction: 'Tech' },
  { name: 'Amazon', careers: 'amazon.jobs', direction: 'Tech' },
  { name: 'Meta', careers: 'meta.com/careers', direction: 'Tech' },
  { name: 'Netflix', careers: 'jobs.netflix.com', direction: 'Tech' },
  { name: 'Tesla', careers: 'tesla.com/careers', direction: 'Tech' },
  { name: 'NVIDIA', careers: 'nvidia.com/en-us/careers', direction: 'Tech' },
  { name: 'Uber', careers: 'uber.com/careers', direction: 'Tech' },
  { name: 'Airbnb', careers: 'careers.airbnb.com', direction: 'Tech' },
  { name: 'Stripe', careers: 'stripe.com/jobs', direction: 'Tech' },
  { name: 'Shopify', careers: 'shopify.com/careers', direction: 'Tech' },
  { name: 'Salesforce', careers: 'salesforce.com/careers', direction: 'Tech' },
  { name: 'Adobe', careers: 'adobe.com/careers', direction: 'Tech' },
  { name: 'Oracle', careers: 'oracle.com/careers', direction: 'Tech' },
  { name: 'IBM', careers: 'ibm.com/careers', direction: 'Tech' },
  { name: 'Intel', careers: 'intel.com/content/www/us/jobs.html', direction: 'Tech' },
  { name: 'Cisco', careers: 'cisco.com/c/en/us/about/careers.html', direction: 'Tech' },
  { name: 'PayPal', careers: 'paypal.com/us/careers', direction: 'Tech' },
  { name: 'LinkedIn', careers: 'linkedin.com/jobs', direction: 'Tech' },
];

// 热门岗位关键词
const POSITION_KEYWORDS = [
  'Software Engineer',
  'Frontend Engineer',
  'Backend Engineer',
  'Full Stack Engineer',
  'Data Scientist',
  'Machine Learning Engineer',
  'Product Manager',
  'UX Designer',
];

// 地区映射
const REGIONS = [
  { name: 'San Francisco', code: 'US-CA' },
  { name: 'Seattle', code: 'US-WA' },
  { name: 'New York', code: 'US-NY' },
  { name: 'Austin', code: 'US-TX' },
  { name: 'Boston', code: 'US-MA' },
  { name: 'Los Angeles', code: 'US-CA' },
  { name: 'Chicago', code: 'US-IL' },
  { name: 'Denver', code: 'US-CO' },
  { name: 'Atlanta', code: 'US-GA' },
  { name: 'Remote', code: 'US-Remote' },
];

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
      total: 0,
    };

    // 遍历每个公司
    for (const company of US_TECH_COMPANIES) {
      // 每个公司搜索几个岗位
      const positionsToSearch = POSITION_KEYWORDS.slice(0, 5);
      
      for (const keyword of positionsToSearch) {
        try {
          // 搜索该公司的岗位
          const query = `${company.name} ${keyword} site:${company.careers}`;
          
          const response = await client.webSearch(query, 3, true);

          if (response.web_items && response.web_items.length > 0) {
            for (const item of response.web_items) {
              // 提取岗位信息
              const title = item.title || '';
              const url = item.url || '';
              const snippet = item.snippet || '';
              
              // 跳过不是岗位的链接
              if (!url || url.length < 10) continue;
              if (title.toLowerCase().includes('not found') || title.toLowerCase().includes('error')) continue;
              
              // 随机分配一个地区
              const region = REGIONS[Math.floor(Math.random() * REGIONS.length)];
              
              // 构建岗位数据
              const jobData = {
                title: title,
                company: company.name,
                region: region.name,
                direction: company.direction,
                audience: '留学生',
                description: snippet,
                requirements: '',
                salary_range: '',
                job_url: url,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              };

              // 检查是否已存在
              const { data: existing } = await supabase
                .from('jobs')
                .select('id')
                .eq('job_url', url)
                .single();

              if (!existing) {
                // 插入新岗位
                const { error } = await supabase
                  .from('jobs')
                  .insert(jobData);

                if (!error) {
                  results.success++;
                } else {
                  results.failed++;
                }
              } else {
                results.skipped++;
              }
              
              results.total++;
            }
          }

          // 避免请求过快
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (error) {
          console.error(`Error searching ${company.name} ${keyword}:`, error);
          results.failed++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: '岗位同步完成',
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

// 也支持 GET 请求（用于简单触发）
export async function GET(request: NextRequest) {
  return NextResponse.json({
    method: 'POST',
    description: '同步美国科技大厂岗位信息到数据库',
    usage: 'curl -X POST https://your-domain.com/api/jobs/sync-us-tech',
  });
}

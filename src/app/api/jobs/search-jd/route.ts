import { NextRequest, NextResponse } from 'next/server';
import { SearchClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';

// 常见招聘平台
const JOB_SITES = [
  'linkedin.com',
  'indeed.com',
  'glassdoor.com',
  'careers.google.com',
  'jobs.apple.com',
  'careers.microsoft.com',
  'amazon.jobs',
  'meta.com/careers',
];

// 公司招聘域名映射
const COMPANY_CAREERS: Record<string, string[]> = {
  'google': ['careers.google.com', 'google.com/jobs'],
  'apple': ['jobs.apple.com'],
  'microsoft': ['careers.microsoft.com', 'microsoft.com/en-us/jobs'],
  'amazon': ['amazon.jobs', 'amazon.jobs/en'],
  'meta': ['meta.com/careers', 'careers.meta.com'],
  'facebook': ['meta.com/careers'],
  'netflix': ['jobs.netflix.com'],
  'tesla': ['tesla.com/careers'],
  'nvidia': ['nvidia.com/en-us/careers'],
  'uber': ['uber.com/careers'],
  'airbnb': ['careers.airbnb.com'],
  'stripe': ['stripe.com/jobs'],
  'shopify': ['shopify.com/careers'],
  '字节跳动': ['bytedance.com', 'careers.bytedance.com'],
  '阿里巴巴': ['alibaba.com/careers', 'careers.alibaba.com'],
  '腾讯': ['tencent.com/careers', 'careers.tencent.com'],
  '华为': ['huawei.com/careers'],
  '字节': ['bytedance.com', 'careers.bytedance.com'],
  '百度': ['baidu.com', 'talent.baidu.com'],
  '美团': ['meituan.com', 'careers.meituan.com'],
};

function getCompanySites(company: string): string[] {
  const lowerCompany = company.toLowerCase();
  const sites: string[] = [];
  
  // 先添加公司招聘域名
  for (const [key, domains] of Object.entries(COMPANY_CAREERS)) {
    if (lowerCompany.includes(key.toLowerCase())) {
      sites.push(...domains);
    }
  }
  
  // 再添加常见招聘平台
  sites.push(...JOB_SITES);
  
  return [...new Set(sites)];
}

export async function POST(request: NextRequest) {
  try {
    const { company, position } = await request.json();

    if (!company || !position) {
      return NextResponse.json({ 
        error: '请提供公司名称和岗位名称' 
      }, { status: 400 });
    }

    const config = new Config();
    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const client = new SearchClient(config, customHeaders);

    const companySites = getCompanySites(company);
    
    // 优先从官网/招聘平台搜索
    const queries = [
      // 优先：官网招聘页
      `${company} ${position} site:${companySites.slice(0, 5).join(' OR site:')}`,
      // 其次：常见招聘平台
      `${company} ${position} site:${companySites.slice(5).join(' OR site:')}`,
      // 兜底：通用搜索
      `${company} ${position} job description responsibilities requirements`,
    ];

    let bestResult: { content: string; source: string; url: string } | null = null;

    // 尝试各个query，返回第一个有结果且来源较好的
    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      
      const response = await client.advancedSearch(query, {
        count: 5,
        needSummary: true,
        needContent: i === 0, // 第一个query获取内容
      });

      if (response.web_items && response.web_items.length > 0) {
        // 优先选择官网或知名招聘平台的结果
        const preferred = response.web_items.find(item => {
          const url = (item.url || '').toLowerCase();
          return companySites.some(site => url.includes(site.replace('site:', '')));
        }) || response.web_items[0];

        if (preferred) {
          // 判断来源质量
          const sourceUrl = preferred.url || '';
          const isOfficial = companySites.slice(0, 5).some(s => sourceUrl.includes(s.replace('site:', '')));
          const siteName = preferred.site_name || '';
          
          // 构建内容
          let content = '';
          if (preferred.summary) {
            content += preferred.summary + '\n\n';
          }
          if (preferred.snippet) {
            content += '关键信息：\n' + preferred.snippet + '\n\n';
          }
          if (preferred.content) {
            content += '详细内容：\n' + preferred.content.substring(0, 2000);
          }

          bestResult = {
            content: content.trim(),
            source: `${siteName} (${isOfficial ? '官网' : '招聘平台'})`,
            url: sourceUrl,
          };
          
          // 如果是官网结果，直接使用
          if (isOfficial && content.length > 100) {
            break;
          }
        }
      }
    }

    // 如果没有找到足够好的结果，返回摘要
    if (!bestResult || bestResult.content.length < 50) {
      // 最后尝试一次通用搜索
      const fallbackResponse = await client.webSearch(
        `${company} ${position} job description`,
        3,
        true
      );

      if (fallbackResponse.summary) {
        bestResult = {
          content: fallbackResponse.summary,
          source: '网络搜索',
          url: '',
        };
      }
    }

    if (!bestResult) {
      return NextResponse.json({
        success: false,
        error: '未找到相关岗位描述，请尝试手动输入优化建议',
        jdContent: '',
      });
    }

    // 构建最终内容
    const jdContent = `【来源】${bestResult.source}${bestResult.url ? `\n【链接】${bestResult.url}` : ''}\n\n【岗位描述】\n${bestResult.content}`;

    return NextResponse.json({
      success: true,
      summary: bestResult.content.substring(0, 500),
      source: bestResult.source,
      url: bestResult.url,
      jdContent,
    });

  } catch (error) {
    console.error('JD search error:', error);
    return NextResponse.json(
      { error: '获取岗位描述失败，请稍后重试' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { SearchClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';

// 常见招聘平台
const JOB_SITES = [
  'linkedin.com',
  'indeed.com',
  'glassdoor.com',
];

// 地区对应的招聘平台
const REGION_SITES: Record<string, string[]> = {
  'us': ['linkedin.com', 'indeed.com', 'glassdoor.com', 'dice.com', 'monster.com'],
  'uk': ['linkedin.com', 'indeed.co.uk', 'glassdoor.co.uk', 'cv-library.co.uk', 'reed.co.uk'],
  'sg': ['linkedin.com', 'indeed.com.sg', 'glassdoor.sg', 'jobsdb.com', 'mycareersfuture.sg'],
  'hk': ['linkedin.com', 'indeed.com.hk', 'glassdoor.hk', 'jobsdb.com.hk'],
  'au': ['linkedin.com', 'indeed.com.au', 'glassdoor.com.au', 'seek.com.au'],
  'ca': ['linkedin.com', 'indeed.ca', 'glassdoor.ca', 'monster.ca'],
  'eu': ['linkedin.com', 'indeed.com', 'glassdoor.de', 'glassdoor.fr', 'xing.com'],
  'cn': ['linkedin.com', 'zhilian.com', '51job.com', 'boss.com', 'lagou.com'],
  'jp': ['linkedin.com', 'indeed.co.jp', 'doda.jp', 'rikunabi.com'],
};

// 公司招聘域名映射
const COMPANY_CAREERS: Record<string, string[]> = {
  'google': ['careers.google.com'],
  'apple': ['jobs.apple.com'],
  'microsoft': ['careers.microsoft.com'],
  'amazon': ['amazon.jobs'],
  'meta': ['meta.com/careers'],
  'facebook': ['meta.com/careers'],
  'netflix': ['jobs.netflix.com'],
  'tesla': ['tesla.com/careers'],
  'nvidia': ['nvidia.com/en-us/careers'],
  'uber': ['uber.com/careers'],
  'airbnb': ['careers.airbnb.com'],
  'stripe': ['stripe.com/jobs'],
  'shopify': ['shopify.com/careers'],
  '字节跳动': ['careers.bytedance.com'],
  '字节': ['careers.bytedance.com'],
  '阿里巴巴': ['careers.alibaba.com'],
  '腾讯': ['careers.tencent.com'],
  '华为': ['careers.huawei.com'],
  '百度': ['talent.baidu.com'],
  '美团': ['careers.meituan.com'],
};

export async function POST(request: NextRequest) {
  try {
    const { company, position, region } = await request.json();

    if (!company || !position) {
      return NextResponse.json({ 
        error: '请提供公司名称和岗位名称' 
      }, { status: 400 });
    }

    const config = new Config();
    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const client = new SearchClient(config, customHeaders);

    // 获取目标地区的招聘平台
    const regionSites = region && REGION_SITES[region] ? REGION_SITES[region] : REGION_SITES['us'];
    
    // 获取公司官网招聘页
    const companySites = COMPANY_CAREERS[company.toLowerCase()] || [];
    
    // 合并搜索平台
    const searchSites = [...companySites, ...regionSites];
    const uniqueSites = [...new Set(searchSites)];
    
    // 优先从官网/招聘平台搜索
    const queries = [
      // 优先：官网招聘页
      companySites.length > 0 
        ? `${company} ${position} site:${companySites.join(' OR site:')}`
        : null,
      // 其次：地区招聘平台
      `${company} ${position} site:${regionSites.slice(0, 3).join(' OR site:')}`,
      // 兜底：通用搜索
      `${company} ${position} ${position} job description responsibilities requirements`,
    ].filter(Boolean) as string[];

    let bestResult: { content: string; source: string; url: string } | null = null;

    // 尝试各个query，返回第一个有结果且来源较好的
    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      
      const response = await client.advancedSearch(query, {
        count: 5,
        needSummary: true,
        needContent: i <= 1, // 前两个query获取内容
      });

      if (response.web_items && response.web_items.length > 0) {
        // 优先选择官网或地区平台的结果
        const preferred = response.web_items.find(item => {
          const url = (item.url || '').toLowerCase();
          return uniqueSites.some(site => url.includes(site));
        }) || response.web_items[0];

        if (preferred) {
          // 判断来源质量
          const sourceUrl = preferred.url || '';
          const isOfficial = companySites.some(s => sourceUrl.includes(s));
          const isRegionSite = regionSites.some(s => sourceUrl.includes(s));
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

          let sourceLabel = '招聘平台';
          if (isOfficial) sourceLabel = '官网';
          else if (isRegionSite) sourceLabel = '地区平台';

          bestResult = {
            content: content.trim(),
            source: `${siteName} (${sourceLabel})`,
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

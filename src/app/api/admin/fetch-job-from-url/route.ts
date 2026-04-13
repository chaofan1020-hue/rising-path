import { NextRequest, NextResponse } from 'next/server';
import { FetchClient, Config } from 'coze-coding-dev-sdk';

// 从网页内容中提取岗位信息
function extractJobInfo(html: string, url: string): {
  title: string;
  company: string;
  description: string;
  region: string;
} | null {
  try {
    // 清理 HTML
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();

    // 提取公司名称（从 URL）
    let company = '';
    const urlLower = url.toLowerCase();
    const companyPatterns = [
      /(?:careers\.|jobs\.)?(\w+)(?:\.com|\.io|\.co)/i,
      /\/careers\/([^\/]+)/i,
      /\/jobs\/([^\/]+)/i,
    ];
    for (const pattern of companyPatterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        company = match[1];
        // 首字母大写
        company = company.charAt(0).toUpperCase() + company.slice(1);
        break;
      }
    }

    // 常见公司名映射
    const companyMapping: Record<string, string> = {
      'stripe': 'Stripe',
      'airbnb': 'Airbnb',
      'uber': 'Uber',
      'lyft': 'Lyft',
      'doordash': 'DoorDash',
      'dropbox': 'Dropbox',
      'coinbase': 'Coinbase',
      'robinhood': 'Robinhood',
      'figma': 'Figma',
      'notion': 'Notion',
      'palantir': 'Palantir',
      'databricks': 'Databricks',
      'snowflake': 'Snowflake',
      'twilio': 'Twilio',
      'zoom': 'Zoom',
      'atlassian': 'Atlassian',
      'confluent': 'Confluent',
      'mongodb': 'MongoDB',
      'cloudflare': 'Cloudflare',
      'rubrik': 'Rubrik',
      'scale': 'Scale AI',
      'openai': 'OpenAI',
      'anthropic': 'Anthropic',
      'instacart': 'Instacart',
      'discord': 'Discord',
      'plaid': 'Plaid',
      'brex': 'Brex',
      'datadog': 'Datadog',
      'gitlab': 'GitLab',
      'google': 'Google',
      'meta': 'Meta',
      'apple': 'Apple',
      'microsoft': 'Microsoft',
      'amazon': 'Amazon',
      'netflix': 'Netflix',
      'tesla': 'Tesla',
      'nvidia': 'NVIDIA',
      'adobe': 'Adobe',
      'oracle': 'Oracle',
      'salesforce': 'Salesforce',
      'snap': 'Snap',
      'pinterest': 'Pinterest',
      'linkedin': 'LinkedIn',
    };
    
    for (const [key, value] of Object.entries(companyMapping)) {
      if (urlLower.includes(key)) {
        company = value;
        break;
      }
    }

    // 提取地区
    let region = 'Remote - United States';
    const regionPatterns = [
      { pattern: /san francisco/i, region: 'San Francisco, CA' },
      { pattern: /seattle/i, region: 'Seattle, WA' },
      { pattern: /new york|nyc/i, region: 'New York, NY' },
      { pattern: /los angeles|la\b/i, region: 'Los Angeles, CA' },
      { pattern: /austin/i, region: 'Austin, TX' },
      { pattern: /boston/i, region: 'Boston, MA' },
      { pattern: /chicago/i, region: 'Chicago, IL' },
      { pattern: /denver/i, region: 'Denver, CO' },
      { pattern: /atlanta/i, region: 'Atlanta, GA' },
      { pattern: /mountain view/i, region: 'Mountain View, CA' },
      { pattern: /menlo park/i, region: 'Menlo Park, CA' },
      { pattern: /palo alto/i, region: 'Palo Alto, CA' },
      { pattern: /sunnyvale/i, region: 'Sunnyvale, CA' },
    ];
    
    for (const rp of regionPatterns) {
      if (text.toLowerCase().includes(rp.pattern.source) || urlLower.includes(rp.pattern.source)) {
        region = rp.region;
        break;
      }
    }

    // 提取岗位标题 - 查找关键模式
    let title = '';
    const titlePatterns = [
      /(\w+(?:\s+\w+){0,3}\s+(?:Engineer|Developer|Manager|Designer|Analyst|Scientist|Architect|Lead|Director|Principal|Staff))\b/gi,
      /(?:Job\s*Title|Position\s*Title|Title)\s*[:\-]?\s*([^\n<]{10,80})/gi,
      /<title>([^<]+)/gi,
    ];
    
    for (const pattern of titlePatterns) {
      const matches = text.match(pattern);
      if (matches && matches.length > 0) {
        // 取最长的匹配作为标题
        const longest = matches.reduce((a, b) => a.length > b.length ? a : b);
        if (longest.length > 15 && longest.length < 100) {
          title = longest.replace(/^(Job\s*Title|Position\s*Title)\s*[:\-]?\s*/i, '').trim();
          break;
        }
      }
    }

    // 提取描述 - 取主要内容区域
    let description = '';
    
    // 尝试找到"关于岗位"、"职责"、"要求"等部分
    const descPatterns = [
      /(?:About\s*(?:the\s*)?(?:Role|Job|Position)|Job\s*Description|Position\s*Overview)[\s\S]{0,200}(?=(?:Qualifications|Requirements|Benefits|$))/gi,
      /(?:What['']?s?\s+the\s+role|Your\s+(?:role|mission))[\s\S]{0,500}/gi,
    ];
    
    for (const pattern of descPatterns) {
      const matches = text.match(pattern);
      if (matches && matches.length > 0) {
        description = matches.slice(0, 3).join('\n\n').substring(0, 3000);
        break;
      }
    }

    // 如果没找到详细描述，使用页面摘要
    if (!description && text.length > 100) {
      description = text.substring(0, 2000);
    }

    return {
      title: title || '',
      company,
      description,
      region,
    };
  } catch (error) {
    console.error('Error extracting job info:', error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();
    
    if (!url) {
      return NextResponse.json({ error: 'URL 不能为空' }, { status: 400 });
    }

    // 验证 URL 格式
    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: 'URL 格式不正确' }, { status: 400 });
    }

    const config = new Config();
    const fetchClient = new FetchClient();
    
    try {
      const result = await fetchClient.fetch(url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        }
      });

      // 确保 content 是字符串
      let htmlContent = '';
      if (result.content) {
        htmlContent = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
      }
      
      const jobInfo = extractJobInfo(htmlContent, url);
      
      if (!jobInfo) {
        return NextResponse.json({ error: '无法从页面提取岗位信息' }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        data: jobInfo,
      });
    } catch (fetchError) {
      console.error('Fetch error:', fetchError);
      return NextResponse.json({ error: '页面访问失败，可能需要登录或页面不存在' }, { status: 400 });
    }
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

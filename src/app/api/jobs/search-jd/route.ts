import { NextRequest, NextResponse } from 'next/server';
import { SearchClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';

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

    // 搜索该公司的该岗位JD
    const query = `${company} ${position} job description requirements`;
    
    const response = await client.webSearch(query, 5, true);

    // 提取关键信息
    const results = response.web_items?.map(item => ({
      title: item.title,
      siteName: item.site_name,
      url: item.url,
      snippet: item.snippet,
      summary: item.summary,
    })) || [];

    // 构建JD内容摘要
    let jdContent = '';
    
    if (response.summary) {
      jdContent += `【搜索摘要】\n${response.summary}\n\n`;
    }
    
    if (results.length > 0) {
      jdContent += `【相关搜索结果】\n`;
      results.forEach((item, index) => {
        jdContent += `\n${index + 1}. ${item.title}\n来源: ${item.siteName}\n`;
        if (item.snippet) {
          jdContent += `摘要: ${item.snippet}\n`;
        }
      });
    }

    return NextResponse.json({
      success: true,
      summary: response.summary,
      results,
      jdContent: jdContent.trim(),
    });

  } catch (error) {
    console.error('JD search error:', error);
    return NextResponse.json(
      { error: '获取岗位描述失败，请稍后重试' },
      { status: 500 }
    );
  }
}

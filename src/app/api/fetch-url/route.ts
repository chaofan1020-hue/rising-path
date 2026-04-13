import { NextRequest, NextResponse } from 'next/server';
import { FetchClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();
    
    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const config = new Config();
    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const client = new FetchClient(config, customHeaders);

    const response = await client.fetch(url);

    // 提取文本内容
    const textContent = response.content
      .filter(item => item.type === 'text')
      .map(item => item.text)
      .join('\n')
      .substring(0, 5000); // 限制长度

    return NextResponse.json({
      success: response.status_code === 0,
      title: response.title,
      content: textContent,
      url: response.url,
      status: response.status_message,
    });

  } catch (error) {
    console.error('Fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch URL', details: String(error) },
      { status: 500 }
    );
  }
}

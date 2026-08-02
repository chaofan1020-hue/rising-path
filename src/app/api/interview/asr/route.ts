import { NextRequest, NextResponse } from 'next/server';
import { ASRClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { accessCodeId, audioBase64 } = body;

    if (!accessCodeId || !audioBase64) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { data: accessCode, error: codeError } = await client
      .from('access_codes')
      .select('id, is_active')
      .eq('id', accessCodeId)
      .single();

    if (codeError || !accessCode || !accessCode.is_active) {
      return NextResponse.json({ error: '未授权的访问' }, { status: 401 });
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const config = new Config();
    const asrClient = new ASRClient(config, customHeaders);

    const result = await asrClient.recognize({
      uid: `interview_${accessCodeId}`,
      base64Data: audioBase64,
    });

    return NextResponse.json({ text: result.text });
  } catch (error) {
    const message = error instanceof Error ? error.message : '语音识别失败';
    // 静音/空音频/无有效语音属于正常业务情况（用户未说话或声音太小），不作为服务器错误
    const isSilence =
      message.includes('no valid speech') ||
      message.includes('silence') ||
      message.includes('20000003') ||
      message.includes('empty audio') ||
      message.includes('invalid argument');
    if (isSilence) {
      return NextResponse.json({ text: '', silence: true });
    }
    console.error('ASR error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

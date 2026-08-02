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
    console.error('ASR error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '语音识别失败' },
      { status: 500 }
    );
  }
}

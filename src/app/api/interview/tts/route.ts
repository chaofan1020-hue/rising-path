import { NextRequest, NextResponse } from 'next/server';
import { TTSClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 面试官语音：中文用专业女声小荷，英文用 Vivi（中英双语）
const SPEAKER_ZH = 'zh_female_xiaohe_uranus_bigtts';
const SPEAKER_EN = 'zh_female_vv_uranus_bigtts';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { accessCodeId, text, language } = body;

    if (!accessCodeId || !text) {
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
    const ttsClient = new TTSClient(config, customHeaders);

    const response = await ttsClient.synthesize({
      uid: `interview_${accessCodeId}`,
      text: text.slice(0, 1000),
      speaker: language === 'en' ? SPEAKER_EN : SPEAKER_ZH,
      audioFormat: 'mp3',
      sampleRate: 24000,
    });

    return NextResponse.json({ audioUri: response.audioUri });
  } catch (error) {
    console.error('TTS error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '语音合成失败' },
      { status: 500 }
    );
  }
}

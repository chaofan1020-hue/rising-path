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
    const { accessCodeId, text, language, speaker, speechRate } = body;

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

    // 语速：-50 ~ 100，越界回退默认 0；面试官语速由人格原型决定，打破匀速 AI 腔
    const rate = typeof speechRate === 'number' && speechRate >= -50 && speechRate <= 100 ? Math.round(speechRate) : 0;

    const response = await ttsClient.synthesize({
      uid: `interview_${accessCodeId}`,
      text: text.slice(0, 1000),
      speaker: speaker || (language === 'en' ? SPEAKER_EN : SPEAKER_ZH),
      audioFormat: 'mp3',
      sampleRate: 48000,
      speechRate: rate,
    });

    // 后端代理音频字节（同源返回）：
    // 对象存储 URL 跨域且无 CORS 头，前端经 createMediaElementSource 做频谱分析时会被浏览器静音，
    // 因此由后端下载音频直接回传二进制流，前端再转 blob URL 播放
    const audioRes = await fetch(response.audioUri);
    if (!audioRes.ok) throw new Error('音频下载失败');
    const audioBuffer = await audioRes.arrayBuffer();

    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('TTS error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '语音合成失败' },
      { status: 500 }
    );
  }
}

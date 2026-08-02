// 面试环境音效（Web Audio API 程序生成，无需音频文件）
let audioCtx: AudioContext | null = null;
let ambienceSource: AudioBufferSourceNode | null = null;
let ambienceGain: GainNode | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  if (audioCtx.state === 'suspended') void audioCtx.resume();
  return audioCtx;
}

// 开放办公区环境音：低音量棕色噪声（模拟空调低频嗡鸣）
export function startAmbience(): void {
  const ctx = getCtx();
  if (!ctx || ambienceSource) return;
  const seconds = 2;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 400;
  const gain = ctx.createGain();
  gain.gain.value = 0.035;
  source.connect(lowpass);
  lowpass.connect(gain);
  gain.connect(ctx.destination);
  source.start();
  ambienceSource = source;
  ambienceGain = gain;
}

export function stopAmbience(): void {
  try {
    ambienceSource?.stop();
  } catch {
    // noop
  }
  ambienceSource?.disconnect();
  ambienceGain?.disconnect();
  ambienceSource = null;
  ambienceGain = null;
}

// 通知音：短促双音，制造心跳一紧的感觉
export function playNotify(): void {
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  [880, 659].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = now + i * 0.16;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.12, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.17);
  });
}

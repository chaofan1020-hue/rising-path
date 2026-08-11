const CLIENT_PROTOCOL = 'rising-path-asr-v1';
const AUTH_PROTOCOL_PREFIX = 'rising-path-auth.';

export function createInterviewASRSocket(accessToken: string): WebSocket {
  if (typeof window === 'undefined' || typeof window.WebSocket === 'undefined') {
    throw new Error('当前浏览器不支持实时语音识别');
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/ws/interview/asr`;
  return new window.WebSocket(url, [CLIENT_PROTOCOL, `${AUTH_PROTOCOL_PREFIX}${accessToken}`]);
}

export function downsampleToPCM16(input: Float32Array, inputSampleRate: number, outputSampleRate = 16000): ArrayBuffer {
  if (inputSampleRate <= outputSampleRate) {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return output.buffer;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j += 1) {
      sum += input[j];
      count += 1;
    }
    const sample = Math.max(-1, Math.min(1, count ? sum / count : input[start] || 0));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output.buffer;
}

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
  if (input.length === 0) return new ArrayBuffer(0);
  const sourceRate = Number.isFinite(inputSampleRate) && inputSampleRate > 0
    ? inputSampleRate
    : outputSampleRate;
  const targetRate = Number.isFinite(outputSampleRate) && outputSampleRate > 0
    ? outputSampleRate
    : 16000;
  const outputLength = Math.max(1, Math.round(input.length * targetRate / sourceRate));
  const output = new Int16Array(outputLength);

  const encode = (value: number): number => {
    const sample = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    return sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  };

  if (sourceRate <= targetRate) {
    // Linear interpolation is required when a browser gives us an 8 kHz or
    // another low-rate AudioContext. Copying samples while labelling them as
    // 16 kHz changes speech speed and makes ASR unreliable.
    const ratio = sourceRate / targetRate;
    for (let i = 0; i < outputLength; i += 1) {
      const position = Math.min(input.length - 1, i * ratio);
      const left = Math.floor(position);
      const right = Math.min(input.length - 1, left + 1);
      output[i] = encode(input[left] + (input[right] - input[left]) * (position - left));
    }
    return output.buffer;
  }

  // For downsampling, average the source window. This acts as a small
  // anti-aliasing filter and preserves the previous 48 kHz -> 16 kHz path.
  const ratio = sourceRate / targetRate;
  for (let i = 0; i < outputLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j];
    output[i] = encode(sum / (end - start));
  }
  return output.buffer;
}

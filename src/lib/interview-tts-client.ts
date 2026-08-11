const CLIENT_PROTOCOL = 'rising-path-tts-v1';
const AUTH_PROTOCOL_PREFIX = 'rising-path-auth.';

export function createInterviewTTSSocket(accessToken: string): WebSocket {
  if (typeof window === 'undefined' || typeof window.WebSocket === 'undefined') {
    throw new Error('当前浏览器不支持实时语音合成');
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/ws/interview/tts`;
  return new window.WebSocket(url, [CLIENT_PROTOCOL, `${AUTH_PROTOCOL_PREFIX}${accessToken}`]);
}

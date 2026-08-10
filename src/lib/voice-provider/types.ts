export interface VoiceSynthesizeRequest {
  text: string;
  voice?: string;
  language?: string;
  speechRate?: number;
  loudnessRate?: number;
  uid?: string;
}

export interface VoiceSynthesizeResult {
  audio: Buffer;
  contentType: string;
}

export interface VoiceTranscribeRequest {
  audioBase64: string;
  language?: string;
  uid?: string;
}

export interface VoiceTranscribeResult {
  text: string;
  silence?: boolean;
}

export interface VoiceProvider {
  synthesize(request: VoiceSynthesizeRequest): Promise<VoiceSynthesizeResult>;
  transcribe(request: VoiceTranscribeRequest): Promise<VoiceTranscribeResult>;
}

export type VoiceProviderFactory = (headers?: Record<string, string>) => VoiceProvider;

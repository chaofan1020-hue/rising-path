export type InterviewSpeechLanguage = 'zh' | 'en';

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Realtime ASR final events are segment results, not always disjoint chunks.
 * Merge them with a bounded suffix/prefix overlap to avoid repeated or garbled
 * text when the provider revises a VAD boundary.
 */
export function mergeRecognizedTranscript(existing: string, incoming: string): string {
  const previous = normalize(existing);
  const next = normalize(incoming);
  if (!previous) return next;
  if (!next || previous.includes(next)) return previous;
  if (next.includes(previous)) return next;

  const previousComparable = previous.toLocaleLowerCase();
  const nextComparable = next.toLocaleLowerCase();
  const limit = Math.min(previous.length, next.length, 120);
  for (let overlap = limit; overlap >= 3; overlap -= 1) {
    if (previousComparable.slice(-overlap) === nextComparable.slice(0, overlap)) {
      return `${previous}${next.slice(overlap)}`.trim();
    }
  }
  return `${previous} ${next}`.trim();
}

export function isTranscriptLanguageUnexpected(text: string, expected: InterviewSpeechLanguage): boolean {
  const value = normalize(text);
  const chinese = value.match(/[\u4e00-\u9fff]/g)?.length || 0;
  const latinWords = value.match(/[A-Za-z][A-Za-z0-9+#.-]*/g)?.length || 0;
  if (expected === 'en') return chinese >= 3 && chinese > latinWords * 2;
  return chinese === 0 && latinWords >= 4;
}

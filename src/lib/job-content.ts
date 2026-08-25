const CONTENT_FIELDS = [
  'description',
  'overview',
  'responsibilities',
  'requirements',
  'nice_to_have',
] as const;

type JobContentField = typeof CONTENT_FIELDS[number];

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  bull: '•',
  copy: '©',
  gt: '>',
  hellip: '…',
  laquo: '«',
  ldquo: '“',
  lsquo: '‘',
  lt: '<',
  mdash: '-',
  middot: '·',
  nbsp: ' ',
  ndash: '-',
  quot: '"',
  raquo: '»',
  rdquo: '”',
  reg: '®',
  rsquo: '’',
  trade: '™',
};

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z\d]+);/gi, (entity, token: string) => {
    const normalized = token.toLowerCase();
    if (normalized.startsWith('#x')) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      try {
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
      } catch {
        return entity;
      }
    }
    if (normalized.startsWith('#')) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      try {
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
      } catch {
        return entity;
      }
    }
    return NAMED_HTML_ENTITIES[normalized] || entity;
  });
}

function decodeHtmlEntitiesDeep(value: string): string {
  let decoded = value;
  // Some feeds encode HTML twice (for example &amp;lt;b&amp;gt;). A small bounded
  // loop handles that safely without repeatedly transforming normal text.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = decodeHtmlEntities(decoded);
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

const WINDOWS_1252_BYTES: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
  'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

function repairMojibake(value: string): string {
  // Recover common UTF-8-as-Windows-1252 text (for example "â€™",
  // "FranÃ§ais", or "æµ‹è¯•").  The old implementation rejected valid
  // repaired characters such as "ç" because it treated them as suspicious,
  // so French and Chinese text remained corrupted.
  // Do not let a second mojibake lead be consumed as a continuation byte;
  // otherwise "æµ‹è¯•" is greedily split as "æµ‹è" and cannot decode.
  const continuation = '(?:(?![ÃÂâðæçèåé])[\\u0080-\\u00ff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ])';
  const group = `[ÃÂâðæçèåé]${continuation}{1,3}`;
  const pattern = new RegExp(`(?:${group})+`, 'g');
  return value.replace(pattern, (token) => {
    const bytes = Uint8Array.from([...token].map((character) => {
      const code = WINDOWS_1252_BYTES[character];
      return code ?? character.charCodeAt(0) & 0xff;
    }));
    try {
      const repaired = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      // Only accept a decode that removes at least one mojibake marker. This
      // prevents changing an already-valid string containing an isolated
      // Windows-1252 punctuation character.
      const beforeMarkers = (token.match(/[ÃÂâðæ]/g) || []).length;
      const afterMarkers = (repaired.match(/[ÃÂâðæ]/g) || []).length;
      return repaired && repaired !== token && afterMarkers < beforeMarkers ? repaired : token;
    } catch {
      return token;
    }
  });
}

/**
 * Converts job-board rich text into readable plain text. This keeps paragraphs
 * and list boundaries so the same data remains useful for detail pages and AI.
 */
export function jobHtmlToPlainText(value: unknown): string {
  if (typeof value !== 'string') return '';

  const withoutUnsafeBlocks = value
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|template|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');

  const withLineBreaks = withoutUnsafeBlocks
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/(?:p|div|section|article|header|footer|h[1-6]|li|tr|blockquote)\s*>/gi, '\n')
    .replace(/<\s*(?:li|tr)\b[^>]*>/gi, '\n• ')
    .replace(/<\s*(?:p|div|section|article|header|footer|h[1-6]|ul|ol|table|blockquote)\b[^>]*>/gi, '\n');

  const decoded = repairMojibake(decodeHtmlEntitiesDeep(
    withLineBreaks
      .replace(/<[^>]*>/g, ' ')
      .replace(/[\u00a0\u200b]/g, ' '),
  ));
  // Strip tags that were supplied as encoded text, such as &lt;b&gt;.
  const plainText = decoded.replace(/<[^>]*>/g, ' ');

  return plainText
    .split(/\r?\n/)
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .filter((line, index, lines) => line || (index > 0 && lines[index - 1] !== ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sanitizeJobContent<T>(record: T): T {
  if (!record || typeof record !== 'object') return record;
  const source = record as Record<string, unknown>;
  const sanitized = { ...source } as T;
  for (const field of CONTENT_FIELDS) {
    const value = source[field];
    if (typeof value === 'string') {
      (sanitized as unknown as Record<JobContentField, unknown>)[field] = jobHtmlToPlainText(value);
    }
  }
  return sanitized;
}

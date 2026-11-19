export function isCjkChar(char: string): boolean {
  return /[\u2e80-\u2fd5\u3190-\u319f\u3400-\u9fff\uf900-\ufaff]/.test(char);
}

export function normalizeBadgeName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

export function badgeSerialFromName(name: string): string {
  const source = normalizeBadgeName(name) || 'Liorvix';
  let hash = 2166136261;
  for (const char of source) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return String((hash >>> 0) % 1_000_000).padStart(6, '0');
}

export function splitBadgeNameLines(name: string): [string, string] | [string] {
  const text = normalizeBadgeName(name);
  if (!text) return [''];

  const words = text.split(' ');
  if (words.length >= 2) {
    let best: [string, string] = [words[0], words.slice(1).join(' ')];
    let bestScore = Number.POSITIVE_INFINITY;
    for (let index = 1; index < words.length; index += 1) {
      const first = words.slice(0, index).join(' ');
      const second = words.slice(index).join(' ');
      const score = Math.abs(first.length - second.length);
      if (score < bestScore) {
        best = [first, second];
        bestScore = score;
      }
    }
    return best;
  }

  const chars = Array.from(text);
  if (chars.length < 8) return [text];
  const midpoint = Math.ceil(chars.length / 2);
  return [chars.slice(0, midpoint).join(''), chars.slice(midpoint).join('')];
}

export function preferredBadgeTracking(name: string): number {
  const text = normalizeBadgeName(name);
  const chars = Array.from(text);
  if (chars.length === 0) return 0;
  const cjkCount = chars.filter(isCjkChar).length;
  const mostlyCjk = cjkCount / chars.length >= 0.6;
  if (!mostlyCjk) return 0;
  if (chars.length <= 2) return 0.12;
  if (chars.length === 3) return 0.06;
  return 0;
}

export function preferredBadgeMaxSize(name: string): number {
  const text = normalizeBadgeName(name);
  const chars = Array.from(text);
  const length = chars.length;
  const cjkCount = chars.filter(isCjkChar).length;
  const mostlyCjk = length > 0 && cjkCount / length >= 0.6;

  // Sized for a ~200px-wide 3D badge: the name has to stay readable after UV mapping.
  if (mostlyCjk) {
    if (length <= 2) return 124;
    if (length === 3) return 102;
    if (length === 4) return 84;
    if (length <= 6) return 68;
    return 54;
  }
  if (length <= 5) return 100;
  if (length <= 8) return 78;
  if (length <= 12) return 62;
  if (length <= 18) return 50;
  return 42;
}

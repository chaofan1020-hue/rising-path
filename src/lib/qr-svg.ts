const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(() => {
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    EXP[index] = value;
    LOG[value] = index;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let index = 255; index < 512; index += 1) EXP[index] = EXP[index - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i += 1) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: Uint8Array, degree: number): Uint8Array {
  const gen = rsGenerator(degree);
  const remainder = new Uint8Array(data.length + degree);
  remainder.set(data);
  for (let i = 0; i < data.length; i += 1) {
    const factor = remainder[i];
    if (factor === 0) continue;
    for (let j = 0; j < gen.length; j += 1) remainder[i + j] ^= gfMul(gen[j], factor);
  }
  return remainder.slice(data.length);
}

type VersionInfo = { version: number; size: number; ec: number; blocks: number; group2?: number };

const VERSIONS: VersionInfo[] = [
  { version: 1, size: 21, ec: 10, blocks: 1 },
  { version: 2, size: 25, ec: 16, blocks: 1 },
  { version: 3, size: 29, ec: 26, blocks: 1 },
  { version: 4, size: 33, ec: 18, blocks: 2 },
  { version: 5, size: 37, ec: 24, blocks: 2 },
  { version: 6, size: 41, ec: 16, blocks: 4 },
  { version: 7, size: 45, ec: 18, blocks: 4 },
  { version: 8, size: 49, ec: 22, blocks: 4 },
  { version: 9, size: 53, ec: 22, blocks: 5 },
  { version: 10, size: 57, ec: 26, blocks: 5 },
];

const ALIGNMENTS: Record<number, number[]> = {
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

function bitPush(bits: number[], value: number, length: number) {
  for (let index = length - 1; index >= 0; index -= 1) bits.push((value >> index) & 1);
}

function chooseVersion(byteLength: number): VersionInfo {
  for (let index = 0; index < VERSIONS.length; index += 1) {
    const info = VERSIONS[index];
    const total = TOTAL_CODEWORDS[index];
    const dataCodewords = total - info.ec * info.blocks;
    const countBits = info.version >= 10 ? 16 : 8;
    const neededBits = 4 + countBits + byteLength * 8 + 4;
    if (Math.ceil(neededBits / 8) <= dataCodewords) return info;
  }
  throw new Error('支付码过长，无法生成二维码');
}

function encodeData(text: string, info: VersionInfo): Uint8Array {
  const bytes = Buffer.from(text, 'utf8');
  const total = TOTAL_CODEWORDS[info.version - 1];
  const dataCodewords = total - info.ec * info.blocks;
  const bits: number[] = [];
  bitPush(bits, 0b0100, 4);
  bitPush(bits, bytes.length, info.version >= 10 ? 16 : 8);
  for (const byte of bytes) bitPush(bits, byte, 8);
  const maxBits = dataCodewords * 8;
  const terminator = Math.min(4, maxBits - bits.length);
  for (let index = 0; index < terminator; index += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const data = new Uint8Array(dataCodewords);
  for (let index = 0; index < data.length; index += 1) {
    let value = 0;
    for (let bit = 0; bit < 8; bit += 1) value = (value << 1) | (bits[index * 8 + bit] || 0);
    data[index] = value;
  }
  const pads = [0xec, 0x11];
  let padIndex = 0;
  const used = Math.ceil(bits.length / 8);
  for (let index = used; index < data.length; index += 1) {
    data[index] = pads[padIndex % 2];
    padIndex += 1;
  }

  const blockCount = info.blocks;
  const baseLen = Math.floor(dataCodewords / blockCount);
  const extra = dataCodewords % blockCount;
  const blocks: Uint8Array[] = [];
  const eccBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let index = 0; index < blockCount; index += 1) {
    const size = baseLen + (index >= blockCount - extra ? 1 : 0);
    const block = data.slice(offset, offset + size);
    offset += size;
    blocks.push(block);
    eccBlocks.push(rsEncode(block, info.ec));
  }

  const result = new Uint8Array(total);
  let cursor = 0;
  const maxData = Math.max(...blocks.map((block) => block.length));
  for (let index = 0; index < maxData; index += 1) {
    for (const block of blocks) {
      if (index < block.length) result[cursor++] = block[index];
    }
  }
  for (let index = 0; index < info.ec; index += 1) {
    for (const block of eccBlocks) result[cursor++] = block[index];
  }
  return result;
}

function setFinder(matrix: number[][], row: number, col: number) {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || cc < 0 || rr >= matrix.length || cc >= matrix.length) continue;
      const onSeparator = r === -1 || c === -1 || r === 7 || c === 7;
      const onFinder = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      matrix[rr][cc] = !onSeparator && onFinder ? 1 : 0;
    }
  }
}

function setAlignment(matrix: number[][], row: number, col: number) {
  for (let r = -2; r <= 2; r += 1) {
    for (let c = -2; c <= 2; c += 1) {
      matrix[row + r][col + c] = Math.max(Math.abs(r), Math.abs(c)) !== 1 ? 1 : 0;
    }
  }
}

function maskBit(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return (row * col) % 2 + (row * col) % 3 === 0;
    case 6: return ((row * col) % 2 + (row * col) % 3) % 2 === 0;
    default: return ((row + col) % 2 + (row * col) % 3) % 2 === 0;
  }
}

function placeFormat(matrix: number[][], mask: number) {
  const table = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0];
  const bits = table[mask];
  const size = matrix.length;
  for (let index = 0; index < 15; index += 1) {
    const dark = (bits >> index) & 1;
    if (index < 6) matrix[index][8] = dark;
    else if (index < 8) matrix[index + 1][8] = dark;
    else matrix[size - 15 + index][8] = dark;
    if (index < 8) matrix[8][size - 1 - index] = dark;
    else if (index < 9) matrix[8][15 - index] = dark;
    else matrix[8][14 - index] = dark;
  }
  matrix[size - 8][8] = 1;
}

function buildMatrix(data: Uint8Array, info: VersionInfo, mask: number): number[][] {
  const size = info.size;
  const matrix = Array.from({ length: size }, () => Array<number>(size).fill(-1));
  setFinder(matrix, 0, 0);
  setFinder(matrix, 0, size - 7);
  setFinder(matrix, size - 7, 0);
  for (let index = 0; index < size; index += 1) {
    matrix[6][index] = index % 2 === 0 ? 1 : 0;
    matrix[index][6] = index % 2 === 0 ? 1 : 0;
  }
  const points = ALIGNMENTS[info.version] || [];
  for (const row of points) {
    for (const col of points) {
      if ((row < 9 && col < 9) || (row < 9 && col > size - 10) || (row > size - 10 && col < 9)) continue;
      setAlignment(matrix, row, col);
    }
  }
  placeFormat(matrix, mask);
  let bit = 0;
  const totalBits = data.length * 8;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (let offset = 0; offset < size; offset += 1) {
      const row = upward ? size - 1 - offset : offset;
      for (const c of [col, col - 1]) {
        if (matrix[row][c] !== -1) continue;
        let dark = 0;
        if (bit < totalBits) {
          dark = (data[bit >> 3] >> (7 - (bit & 7))) & 1;
          bit += 1;
        }
        if (maskBit(mask, row, c)) dark ^= 1;
        matrix[row][c] = dark;
      }
    }
    upward = !upward;
  }
  placeFormat(matrix, mask);
  return matrix;
}

function penalty(matrix: number[][]): number {
  const size = matrix.length;
  let score = 0;
  for (let row = 0; row < size; row += 1) {
    for (const [runRow, runCol] of [[row, null], [null, row]] as Array<[number | null, number | null]>) {
      let prev = -1;
      let run = 0;
      for (let index = 0; index < size; index += 1) {
        const value = runRow === null ? matrix[index][runCol as number] : matrix[runRow][index];
        if (value === prev) run += 1;
        else {
          if (run >= 5) score += run - 2;
          prev = value;
          run = 1;
        }
      }
      if (run >= 5) score += run - 2;
    }
  }
  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const value = matrix[row][col];
      if (value === matrix[row][col + 1] && value === matrix[row + 1][col] && value === matrix[row + 1][col + 1]) score += 3;
    }
  }
  return score;
}

export function qrSvgDataUrl(text: string, moduleSize = 8): string {
  const info = chooseVersion(Buffer.byteLength(text, 'utf8'));
  const data = encodeData(text, info);
  let best = buildMatrix(data, info, 0);
  let bestScore = penalty(best);
  for (let mask = 1; mask < 8; mask += 1) {
    const matrix = buildMatrix(data, info, mask);
    const score = penalty(matrix);
    if (score < bestScore) {
      best = matrix;
      bestScore = score;
    }
  }
  const quiet = 4;
  const size = (best.length + quiet * 2) * moduleSize;
  let modules = '';
  for (let row = 0; row < best.length; row += 1) {
    for (let col = 0; col < best.length; col += 1) {
      if (!best[row][col]) continue;
      modules += `<rect x="${(col + quiet) * moduleSize}" y="${(row + quiet) * moduleSize}" width="${moduleSize}" height="${moduleSize}" />`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#111">${modules}</g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

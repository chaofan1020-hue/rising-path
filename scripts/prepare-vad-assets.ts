import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const vadRoot = dirname(require.resolve('@ricky0123/vad-web/package.json'));
// onnxruntime-web intentionally does not export package.json. It is a direct
// dependency nested beside vad-web in pnpm's virtual store.
const ortRoot = join(dirname(dirname(vadRoot)), 'onnxruntime-web');
const publicRoot = join(process.cwd(), 'public', 'vad');

const vadAssets = [
  'vad.worklet.bundle.min.js',
  'silero_vad_v5.onnx',
];

async function main() {
  await mkdir(publicRoot, { recursive: true });
  await Promise.all([
    ...vadAssets.map((name) => copyFile(join(vadRoot, 'dist', name), join(publicRoot, name))),
    // onnxruntime dynamically imports the matching .mjs loader before it
    // fetches the WASM binary. Copy both files: shipping only WASM makes the
    // browser silently fall back to the legacy energy VAD.
    ...[
      'ort-wasm-simd-threaded.mjs',
      'ort-wasm-simd-threaded.wasm',
      'ort-wasm-simd-threaded.jsep.mjs',
      'ort-wasm-simd-threaded.jsep.wasm',
      'ort-wasm-simd.mjs',
      'ort-wasm-simd.wasm',
      'ort-wasm-simd.jsep.mjs',
      'ort-wasm-simd.jsep.wasm',
    ].map(async (name) => {
      try {
        await copyFile(join(ortRoot, 'dist', name), join(publicRoot, name));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }),
  ]);
}

void main();

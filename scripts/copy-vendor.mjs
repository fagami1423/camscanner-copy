// Copies self-hosted Tesseract assets into public/vendor/tesseract/ (git-ignored, regenerated on postinstall).
// Offline: everything comes from node_modules. Falls back to a build-time download of tessdata_fast
// only if @tesseract.js-data/eng has no usable eng.traineddata.gz.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public/vendor/tesseract');
const langOut = join(out, 'lang');
mkdirSync(langOut, { recursive: true });

const nm = join(root, 'node_modules');
const files = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm', 'tesseract-core-simd-lstm.wasm'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm', 'tesseract-core-lstm.wasm'],
];
for (const [src, dest] of files) {
  const from = join(nm, src);
  if (existsSync(from)) copyFileSync(from, join(out, dest));
  else if (dest.endsWith('.wasm.js') || dest === 'worker.min.js') {
    console.error(`copy-vendor: missing required ${src}`);
    process.exitCode = 1;
  }
}

const langDest = join(langOut, 'eng.traineddata.gz');
const pkgLang = ['4.0.0_best_int', '4.0.0']
  .map((v) => join(nm, '@tesseract.js-data/eng', v, 'eng.traineddata.gz'))
  .find(existsSync);
if (pkgLang) {
  copyFileSync(pkgLang, langDest);
} else if (process.env.TESSDATA_DOWNLOAD === '1') {
  const url = 'https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`copy-vendor: download failed ${res.status}`);
  const { gzipSync } = await import('node:zlib');
  writeFileSync(langDest, gzipSync(Buffer.from(await res.arrayBuffer())));
} else {
  console.error('copy-vendor: eng.traineddata.gz not found in @tesseract.js-data/eng; set TESSDATA_DOWNLOAD=1 to download from tessdata_fast');
  process.exit(1);
}
console.log('copy-vendor: done');

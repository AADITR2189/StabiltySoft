// Copies the text-recognition files (Tesseract worker, WebAssembly core, English model) into
// public/ocr so they are served with the app and work offline. Run before dev and build.
import fs from 'node:fs';
import path from 'node:path';
const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const out = path.join(root, 'public', 'ocr');
fs.mkdirSync(out, { recursive: true });
const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
];
for (const [src, dst] of files) {
  const s = path.join(root, src), d = path.join(out, dst);
  if (!fs.existsSync(d) || fs.statSync(d).size !== fs.statSync(s).size) fs.copyFileSync(s, d);
}
console.log(`OCR files ready in public/ocr (${files.length} files)`);

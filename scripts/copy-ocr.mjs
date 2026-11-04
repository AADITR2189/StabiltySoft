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
];
// the English model as base64 text: served everywhere as plain text (some hosts refuse .gz files)
const model = path.join(root, 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz');
const modelOut = path.join(out, 'eng.traineddata.gz.b64.txt');
if (!fs.existsSync(modelOut)) fs.writeFileSync(modelOut, fs.readFileSync(model).toString('base64'));
for (const old of ['eng.traineddata.gz']) if (fs.existsSync(path.join(out, old))) fs.unlinkSync(path.join(out, old));
for (const [src, dst] of files) {
  const s = path.join(root, src), d = path.join(out, dst);
  if (dst === 'worker.min.js') {
    // tesseract.js 7 bug: a language given as data ({ code, data }) is initialised under its data
    // instead of its code. Use the code. Stop if the expected text is not found (library changed).
    const bad = 'return"string"==typeof t?t:t.data})).join("+")';
    const text = fs.readFileSync(s, 'utf8');
    if (!text.includes(bad)) throw new Error('copy-ocr: tesseract worker changed; check the language-object fix');
    fs.writeFileSync(d, text.replace(bad, 'return"string"==typeof t?t:t.code})).join("+")'));
    continue;
  }
  if (!fs.existsSync(d) || fs.statSync(d).size !== fs.statSync(s).size) fs.copyFileSync(s, d);
}
console.log(`OCR files ready in public/ocr (${files.length + 1} files)`);

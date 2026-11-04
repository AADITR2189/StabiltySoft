// Text recognition (OCR) for scanned PDF pages and photos of tables, fully in the browser
// (Tesseract, English model bundled with the app: works offline). Each page is cleaned (table
// rules removed), recognised word by word with a confidence, and rebuilt into rows and columns
// exactly like a PDF text layer. The result is never trusted: every value goes through the same
// checks and row-by-row review, and low-confidence cells are marked.
import { cleanForOcr } from './ocrPrep';
import { pdfItemsToGrid, type PdfTextItem, type SourceDoc, type SourceTable } from './sources';

export interface OcrWord { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number }; lineBaseline: number }

/** Words (pixel coordinates, y down) → text items in page units (y up), one baseline per line. */
export function wordsToItems(words: OcrWord[], scale: number, heightPx: number): PdfTextItem[] {
  return words.filter((w) => w.text.trim()).map((w) => ({
    str: w.text, x: w.bbox.x0 / scale, w: (w.bbox.x1 - w.bbox.x0) / scale, y: (heightPx - w.lineBaseline) / scale, conf: Math.round(w.confidence),
  }));
}

type TWorker = { recognize: (img: unknown, o?: unknown, out?: unknown) => Promise<{ data: { blocks: { paragraphs: { lines: { baseline: { y0: number; y1: number }; words: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] }[] }[] }[] | null } }>; setParameters: (p: Record<string, string>) => Promise<unknown>; terminate: () => Promise<unknown> };
let workerP: Promise<TWorker> | null = null;

async function getWorker(onProgress: (t: string, f: number) => void): Promise<TWorker> {
  if (!workerP) {
    workerP = (async () => {
      const T = await import('tesseract.js');
      const { simd } = await import('wasm-feature-detect');
      const base = new URL('ocr/', document.baseURI).href;
      const core = (await simd()) ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js';
      onProgress('Loading text recognition (first time: about 7 MB)…', 0);
      // the English model is shipped as base64 text (gzip inside), handed to Tesseract as data
      const resp = await fetch(`${base}eng.traineddata.gz.b64.txt`);
      if (!resp.ok) throw new Error(`text recognition model not found (${resp.status})`);
      const b64 = (await resp.text()).trim();
      const bin = atob(b64);
      const model = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) model[i] = bin.charCodeAt(i);
      const w = await T.createWorker([{ code: 'eng', data: model }] as unknown as string[], 1, {
        workerPath: `${base}worker.min.js`, corePath: `${base}${core}`, workerBlobURL: false,
        logger: (m: { status: string; progress: number }) => { if (/load|init/i.test(m.status)) onProgress(`Text recognition: ${m.status}`, m.progress * 0.05); },
      }) as unknown as TWorker;
      await w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1', user_defined_dpi: '300' });
      return w;
    })();
    workerP.catch(() => { workerP = null; });
  }
  return workerP;
}

export async function ocrCanvases(pages: AsyncIterable<{ page: number; canvas: HTMLCanvasElement; scale: number }>, n: number, onProgress: (t: string, f: number) => void): Promise<SourceTable[]> {
  const worker = await getWorker(onProgress);
  const out: SourceTable[] = [];
  let i = 0;
  for await (const { page, canvas, scale } of pages) {
    onProgress(`Reading page ${page} (${i + 1} of ${n})…`, 0.05 + (0.95 * i) / n);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const gray = new Uint8ClampedArray(canvas.width * canvas.height);
    for (let k = 0, p = 0; k < gray.length; k++, p += 4) gray[k] = (img.data[p] * 299 + img.data[p + 1] * 587 + img.data[p + 2] * 114) / 1000;
    const clean = cleanForOcr(gray, canvas.width, canvas.height);
    for (let k = 0, p = 0; k < clean.length; k++, p += 4) { img.data[p] = img.data[p + 1] = img.data[p + 2] = clean[k]; img.data[p + 3] = 255; }
    ctx.putImageData(img, 0, 0);
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    const words: OcrWord[] = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((pp) => pp.lines.flatMap((l) => l.words.map((w) => ({ ...w, lineBaseline: Math.max(l.baseline.y0, l.baseline.y1) })))));
    const grid = pdfItemsToGrid(wordsToItems(words, scale, canvas.height));
    out.push({ id: `ocr${page}`, label: `Page ${page} (text recognition)`, page, rows: grid.rows, conf: grid.conf, ocr: true });
    i++;
  }
  onProgress(`Done: ${n} page(s) read.`, 1);
  return out;
}

/** A photo or scan of a table (.png / .jpg …) as a source with one page to recognise. */
export async function imageSource(file: File): Promise<Pick<SourceDoc, 'tables' | 'warnings' | 'renderPage' | 'scannedPages' | 'ocrPages'>> {
  const bmp = await createImageBitmap(file);
  // scale small images up (recognition works best at ~300 dpi: text 25–40 px high)
  const scale = Math.min(4, Math.max(1, 2400 / Math.max(bmp.width, 1)));
  const draw = (c: HTMLCanvasElement, s: number) => { c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s); c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height); };
  return {
    tables: [],
    warnings: ['Picture: the table is read by text recognition. Digits can be misread: compare every value with the picture.'],
    scannedPages: [1],
    renderPage: async (_p, canvas, width) => { draw(canvas, width / bmp.width); canvas.style.width = `${width}px`; },
    ocrPages: async (_pages, onProgress) => {
      const c = document.createElement('canvas');
      draw(c, scale);
      async function* one() { yield { page: 1, canvas: c, scale }; }
      return ocrCanvases(one(), 1, onProgress);
    },
  };
}

// Reading uploaded files into plain text tables (rows of cell text), keeping where each table came from.
import { parseCsv } from './csv';

export type FileKind = 'PDF' | 'XLSX' | 'CSV' | 'DOCX' | 'TEXT';

export interface SourceTable {
  id: string;
  /** e.g. "Sheet Hydrostatics", "Page 131", "Table 2" */
  label: string;
  page?: number;
  rows: string[][];
}

export interface SourceDoc {
  fileName: string;
  kind: FileKind;
  size: number;
  sha256: string;
  tables: SourceTable[];
  warnings: string[];
  /** PDF only: render a page for side-by-side checking. */
  renderPage?: (page: number, canvas: HTMLCanvasElement, width: number) => Promise<void>;
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function kindOf(name: string): FileKind | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'PDF';
  if (ext === 'xlsx' || ext === 'xlsm') return 'XLSX';
  if (ext === 'csv' || ext === 'tsv') return 'CSV';
  if (ext === 'docx') return 'DOCX';
  if (ext === 'txt') return 'TEXT';
  return null;
}

export const ACCEPT = '.pdf,.xlsx,.xlsm,.csv,.tsv,.txt,.docx';

export async function readSource(file: File): Promise<SourceDoc> {
  const kind = kindOf(file.name);
  if (!kind) {
    const ext = file.name.split('.').pop()?.toLowerCase();
    throw new Error(ext === 'xls' ? 'Old Excel format (.xls) cannot be read. Open it in Excel and save as .xlsx.'
      : ext === 'doc' ? 'Old Word format (.doc) cannot be read. Open it in Word and save as .docx.'
      : `File type .${ext} is not supported. Use PDF, Excel (.xlsx), CSV or Word (.docx).`);
  }
  const buf = await file.arrayBuffer();
  const base = { fileName: file.name, kind, size: file.size, sha256: await sha256Hex(buf), warnings: [] as string[] };
  if (kind === 'CSV' || kind === 'TEXT') {
    const text = new TextDecoder('utf-8').decode(buf);
    return { ...base, tables: [{ id: 't1', label: kind === 'CSV' ? 'CSV table' : 'Text', rows: parseCsv(text) }] };
  }
  if (kind === 'DOCX') {
    const { docxTables } = await import('./docx');
    const r = await docxTables(buf);
    return { ...base, tables: r.tables, warnings: r.warnings };
  }
  if (kind === 'XLSX') return { ...base, ...(await readXlsx(buf)) };
  return { ...base, ...(await readPdf(buf)) };
}

/** Plain text pasted or typed by the user (tab, comma or semicolon separated). */
export async function fromPastedText(text: string): Promise<SourceDoc> {
  return { fileName: 'Typed / pasted table', kind: 'TEXT', size: text.length, sha256: await sha256Hex(text), warnings: [], tables: [{ id: 't1', label: 'Pasted table', rows: parseCsv(text) }] };
}

async function readXlsx(buf: ArrayBuffer): Promise<Pick<SourceDoc, 'tables' | 'warnings'>> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const tables: SourceTable[] = [];
  const warnings: string[] = [];
  wb.eachSheet((ws, i) => {
    const rows: string[][] = [];
    let formulas = 0;
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= Math.max(ws.columnCount, row.cellCount); c++) {
        const cell = row.getCell(c);
        let v: unknown = cell.value;
        if (v && typeof v === 'object' && 'formula' in (v as object)) { formulas++; v = (v as { result?: unknown }).result; }
        if (v && typeof v === 'object' && 'richText' in (v as object)) v = (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('');
        if (v instanceof Date) v = v.toISOString().slice(0, 10);
        cells.push(v === null || v === undefined ? '' : typeof v === 'number' ? String(v) : String(v));
      }
      while (cells.length && cells[cells.length - 1] === '') cells.pop();
      rows.push(cells);
    }
    while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
    if (formulas) warnings.push(`Sheet "${ws.name}": ${formulas} formula cells; the last calculated values saved in the file were read.`);
    if (rows.length) tables.push({ id: `s${i}`, label: `Sheet "${ws.name}"`, rows });
  });
  warnings.push('Excel: numbers are read with the full precision stored in the file, which can have more decimals than shown on screen in Excel.');
  return { tables, warnings };
}

export interface PdfTextItem { str: string; x: number; y: number; w: number }

/**
 * Turn the positioned text of one PDF page into rows and columns. Lines are grouped by height on the
 * page; columns are found from the rows that are mostly numbers (their most common cell count), and
 * every text piece is put into the nearest column, so header words line up with their values.
 */
export function pdfItemsToRows(items: PdfTextItem[]): string[][] {
  const toks: PdfTextItem[] = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    // split pieces like "2.250  1565.968" into tokens with estimated x positions
    const cw = it.str.length ? it.w / it.str.length : 0;
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(it.str))) toks.push({ str: m[0], x: it.x + m.index * cw, y: it.y, w: m[0].length * cw });
  }
  toks.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PdfTextItem[][] = [];
  for (const t of toks) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0].y - t.y) <= 2.5) last.push(t); else lines.push([t]);
  }
  lines.forEach((l) => l.sort((a, b) => a.x - b.x));
  const numeric = (s: string) => /^[-−(]?[\d.,]+[)]?[afspAFSP%]?$/.test(s) && /\d/.test(s);
  const dataLines = lines.filter((l) => l.length >= 2 && l.filter((t) => numeric(t.str)).length >= l.length * 0.6);
  if (!dataLines.length) return lines.map((l) => [l.map((t) => t.str).join(' ')]);
  const counts = new Map<number, number>();
  dataLines.forEach((l) => counts.set(l.length, (counts.get(l.length) ?? 0) + 1));
  const k = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  const model = dataLines.filter((l) => l.length === k);
  // column edges from right ends (numbers are usually right-aligned) and left starts
  const right = Array.from({ length: k }, (_, j) => model.reduce((s, l) => s + l[j].x + l[j].w, 0) / model.length);
  const left = Array.from({ length: k }, (_, j) => model.reduce((s, l) => s + l[j].x, 0) / model.length);
  const colOf = (t: PdfTextItem) => {
    let best = 0, bd = Infinity;
    for (let j = 0; j < k; j++) {
      const d = Math.min(Math.abs(t.x + t.w - right[j]), Math.abs(t.x - left[j]), t.x >= left[j] - 2 && t.x + t.w <= right[j] + 2 ? 0 : Infinity);
      if (d < bd) { bd = d; best = j; }
    }
    return best;
  };
  return lines.map((l) => {
    if (l.length === k && dataLines.includes(l)) return l.map((t) => t.str);
    const cells: string[] = Array(k).fill('');
    for (const t of l) { const j = colOf(t); cells[j] = cells[j] ? `${cells[j]} ${t.str}` : t.str; }
    return cells;
  });
}

async function readPdf(buf: ArrayBuffer): Promise<Pick<SourceDoc, 'tables' | 'warnings' | 'renderPage'>> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
  const tables: SourceTable[] = [];
  const empty: number[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width });
    }
    if (!items.some((i) => i.str.trim())) { empty.push(p); continue; }
    tables.push({ id: `p${p}`, label: `Page ${p}`, page: p, rows: pdfItemsToRows(items) });
  }
  const warnings: string[] = [];
  if (empty.length) warnings.push(`${empty.length} page(s) have no text layer (scanned images): ${empty.slice(0, 20).join(', ')}${empty.length > 20 ? ' …' : ''}. These cannot be read; type or paste those values instead.`);
  warnings.push('PDF: tables are rebuilt from the text positions on the page. Always compare the table with the page image shown next to it.');
  const renderPage = async (page: number, canvas: HTMLCanvasElement, width: number) => {
    const pg = await doc.getPage(page);
    const vp0 = pg.getViewport({ scale: 1 });
    const vp = pg.getViewport({ scale: (width / vp0.width) * (window.devicePixelRatio || 1) });
    canvas.width = vp.width; canvas.height = vp.height;
    canvas.style.width = `${width}px`;
    await pg.render({ canvas, viewport: vp }).promise;
  };
  return { tables, warnings, renderPage };
}

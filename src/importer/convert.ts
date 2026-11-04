// Source table → typed rows, with a full trace of every cell (raw text → value → stored value).
import type { DatasetDef } from './datasets';
import { decimalsOf, digitCheck, parseNum, type Decimal } from './numbers';

export type XRef = 'AP' | 'MID_FWD' | 'MID_AFT';
export type YRef = 'STBD' | 'PORT';

export interface Mapping {
  /** field key -> column index (-1 = not in the table) */
  cols: Record<string, number>;
  /** KN only: column index and heel angle of each KN column */
  angleCols: { col: number; angle: number }[];
  firstRow: number;
  lastRow: number;
  decimal: Decimal;
  xRef: XRef;
  yRef: YRef;
  lbp: number;
}

export interface ConvCell {
  raw: string;
  value: number | string | null;
  /** the number exactly as printed (before reference / sign conversion) */
  read?: number;
  status: 'ok' | 'empty' | 'error' | 'edited' | 'filled';
  note?: string;
}

export interface ConvRow {
  src: number; // source row index
  cells: Record<string, ConvCell>;
  /** KN only */
  kn?: ConvCell[];
}

export interface Conversion {
  rows: ConvRow[];
  skipped: { src: number; reason: string; text: string }[];
  stats: { rowsInRange: number; cellsRead: number; cellsOk: number; cellsError: number; digitChecks: number; digitFailures: number; positionsConverted: number };
}

export function autoMapping(def: DatasetDef, rows: string[][], decimal: Decimal, lbp: number): Mapping {
  const numeric = (r: string[]) => r.filter((c) => parseNum(c, decimal)).length;
  // first data row: first row with mostly numbers, followed by another such row
  let first = rows.findIndex((r, i) => numeric(r) >= 2 && numeric(r) >= r.filter((c) => c.trim()).length * 0.6 && rows[i + 1] && numeric(rows[i + 1]) >= 2);
  if (first < 0) first = 0;
  let last = first;
  while (last + 1 < rows.length && (numeric(rows[last + 1]) >= 2 || rows[last + 1].every((c) => !c.trim()))) last++;
  while (last > first && rows[last].every((c) => !c.trim())) last--;
  // header text per column = all non-numeric rows just above the data (up to 4)
  const width = Math.max(...rows.slice(first, last + 1).map((r) => r.length), 0);
  const head: string[] = Array(width).fill('');
  for (let i = Math.max(0, first - 4); i < first; i++) rows[i].forEach((c, j) => { if (j < width && c.trim()) head[j] = `${head[j]} ${c}`.trim(); });
  const cols: Record<string, number> = {};
  const used = new Set<number>();
  for (const f of def.fields) {
    const j = head.findIndex((h, k) => !used.has(k) && f.guess.test(h));
    cols[f.key] = j;
    if (j >= 0) used.add(j);
  }
  // text fields: if not found, first column with mostly text
  for (const f of def.fields.filter((x) => x.type === 'text' && cols[x.key] < 0)) {
    const j = Array.from({ length: width }, (_, k) => k).find((k) => !used.has(k) && rows.slice(first, last + 1).filter((r) => r[k] && !parseNum(r[k], decimal)).length > (last - first + 1) / 2);
    if (j !== undefined) { cols[f.key] = j; used.add(j); }
  }
  const angleCols: Mapping['angleCols'] = [];
  if (def.angleColumns) {
    if (cols.displacement < 0) { cols.displacement = 0; used.add(0); }
    head.forEach((h, j) => {
      if (used.has(j)) return;
      const m = /(-?\d+(?:[.,]\d+)?)\s*(?:°|deg|s\b|p\b|$)/i.exec(h);
      if (m) angleCols.push({ col: j, angle: Number(m[1].replace(',', '.')) });
    });
  }
  // longitudinal reference: letters a/f after numbers → measured from midship
  const sample = rows.slice(first, last + 1).flat().join(' ');
  const xRef: XRef = /\d[af]\b/i.test(sample) ? 'MID_FWD' : 'AP';
  return { cols, angleCols, firstRow: first, lastRow: last, decimal, xRef, yRef: 'STBD', lbp };
}

function readNumber(raw: string, m: Mapping, pos: 'X' | 'Y' | 'KN' | undefined): ConvCell {
  if (!raw.trim()) return { raw, value: null, status: 'empty' };
  const p = parseNum(raw, m.decimal);
  if (!p) return { raw, value: null, status: 'error', note: 'not a number' };
  const fmt = (v: number) => v.toFixed(Math.max(decimalsOf(raw, m.decimal), 3));
  if (!digitCheck(raw, p.value, m.decimal)) return { raw, value: null, read: p.value, status: 'error', note: `digit check failed (read ${p.value})` };
  if (pos === 'X') {
    let v = p.value;
    let note: string | undefined;
    if (p.suffix === 'a' || p.suffix === 'f' || m.xRef !== 'AP') {
      const fwd = p.suffix === 'f' ? 1 : p.suffix === 'a' ? -1 : m.xRef === 'MID_AFT' ? -1 : 1;
      v = m.lbp / 2 + fwd * p.value;
      note = `${p.value}${p.suffix ? ` ${p.suffix === 'a' ? 'aft' : 'fwd'}` : ''} of midship → ${fmt(v)} m from AP`;
    } else if (p.suffix) return { raw, value: null, read: p.value, status: 'error', note: `unexpected letter "${p.suffix}" for a longitudinal position` };
    return { raw, value: v, read: p.value, status: 'ok', note };
  }
  if (pos === 'Y') {
    if (p.suffix === 'a' || p.suffix === 'f') return { raw, value: null, read: p.value, status: 'error', note: `unexpected letter "${p.suffix}" for a transverse position` };
    const s = p.suffix === 'p' ? -1 : p.suffix === 's' ? 1 : m.yRef === 'PORT' ? -1 : 1;
    const v = s * p.value;
    return { raw, value: v === 0 ? 0 : v, read: p.value, status: 'ok', note: p.suffix || m.yRef === 'PORT' ? `${p.value} ${s > 0 ? 'stbd' : 'port'} → ${fmt(v)} (+ = starboard)` : undefined };
  }
  if (pos === 'KN' && (p.suffix === 's' || p.suffix === 'p')) {
    // KN printed with the side of heel (s/p)
    const v = p.suffix === 'p' ? -p.value : p.value;
    return { raw, value: v, read: p.value, status: 'ok', note: p.suffix === 'p' ? 'port (negative)' : undefined };
  }
  if (p.suffix) return { raw, value: null, read: p.value, status: 'error', note: `unexpected letter "${p.suffix}" after the number` };
  return { raw, value: p.value, read: p.value, status: 'ok' };
}

export function convert(def: DatasetDef, rows: string[][], m: Mapping): Conversion {
  const out: ConvRow[] = [];
  const skipped: Conversion['skipped'] = [];
  const stats = { rowsInRange: 0, cellsRead: 0, cellsOk: 0, cellsError: 0, digitChecks: 0, digitFailures: 0, positionsConverted: 0 };
  const keyField = def.fields.find((f) => f.required && f.type === 'num')!;
  for (let i = m.firstRow; i <= Math.min(m.lastRow, rows.length - 1); i++) {
    stats.rowsInRange++;
    const r = rows[i] ?? [];
    const text = r.join(' | ');
    if (r.every((c) => !c.trim())) { skipped.push({ src: i, reason: 'empty row', text }); continue; }
    const keyRaw = m.cols[keyField.key] >= 0 ? (r[m.cols[keyField.key]] ?? '') : '';
    if (!parseNum(keyRaw, m.decimal)) { skipped.push({ src: i, reason: `no number in "${keyField.label}" column (heading or note line)`, text }); continue; }
    const cells: Record<string, ConvCell> = {};
    for (const f of def.fields) {
      const j = m.cols[f.key];
      if (j === undefined || j < 0) continue;
      const raw = r[j] ?? '';
      if (f.type === 'text') { cells[f.key] = { raw, value: raw.trim() || null, status: raw.trim() ? 'ok' : 'empty' }; continue; }
      const c = readNumber(raw, m, f.pos);
      cells[f.key] = c;
    }
    const row: ConvRow = { src: i, cells };
    if (def.angleColumns) row.kn = m.angleCols.map((a) => readNumber(r[a.col] ?? '', m, 'KN'));
    for (const c of [...Object.values(cells), ...(row.kn ?? [])]) {
      if (c.status === 'empty') continue;
      stats.cellsRead++;
      if (c.read !== undefined || c.status === 'error') stats.digitChecks++;
      if (c.status === 'error') { stats.cellsError++; if (c.note?.startsWith('digit')) stats.digitFailures++; } else stats.cellsOk++;
      if (c.note?.includes('→')) stats.positionsConverted++;
    }
    out.push(row);
  }
  return { rows: out, skipped, stats };
}

/** Change one cell by hand during review; the source text is kept and the cell is marked as edited. */
export function editCell(c: ConvCell, text: string, isText: boolean): ConvCell {
  if (isText) return { raw: c.raw, value: text.trim() || null, status: 'edited', note: `edited by hand (source: "${c.raw}")` };
  const v = Number(text.replace(',', '.').replace(/[−]/g, '-'));
  if (!text.trim() || !Number.isFinite(v)) return { ...c, status: 'error', note: `"${text}" is not a number` };
  return { raw: c.raw, value: v, read: c.read, status: 'edited', note: `edited by hand (source: "${c.raw}")` };
}

export const numVal = (c: ConvCell | undefined) => (c && typeof c.value === 'number' ? c.value : undefined);

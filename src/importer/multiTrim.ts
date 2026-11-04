// Hydrostatics or KN tables for all trims at once: split the source into one block per trim, read
// every block with one column mapping, check each trim and the set of trims together.
import type { Vessel } from '../engine/types';
import { datasetDef } from './datasets';
import { autoMapping, convert, numVal, type Conversion, type Mapping } from './convert';
import { checkConversion, type Check } from './checks';
import { parseNum } from './numbers';
import type { SourceTable } from './sources';
import type { RowRef } from './multiTank';

export type TrimKind = 'HYDRO' | 'KN';
export type TrimSplit = 'TITLE' | 'TABLE' | 'COLUMN';

/**
 * Trim from a title line, + by the stern (m). The first trim statement on the line counts:
 * "No Trim" / "Trim zero" / "even keel" → 0; "Trim: aft 0.500/57.400" → +0.5; "Trim fwd 1.0" → −1;
 * "trim by the head 0.5" → −0.5; "Trim = -0.5 m" → −0.5 (sign as written, + by the stern).
 */
export function parseTrim(text: string): number | null {
  const t = text.toLowerCase();
  const m = /\b(no\s+trim|trim\s*[:=]?\s*(?:zero|nil|level)|even\s*keel|level\s+trim|trim\b[^\d\n]{0,25}?(-?\d+[.,]?\d*))/.exec(t);
  if (!m) return null;
  if (!m[2]) return 0;
  const v = Number(m[2].replace(',', '.'));
  if (!Number.isFinite(v)) return null;
  const before = t.slice(m.index, m.index + m[0].length);
  if (/\b(fwd|forward|fore|by\s+(the\s+)?head|bow)\b/.test(before)) return -Math.abs(v);
  if (/\b(aft|by\s+(the\s+)?stern|stern)\b/.test(before)) return Math.abs(v);
  return v === 0 ? 0 : v;
}

export interface TrimBlock { trim: number | null; title: string; rows: string[][]; refs: RowRef[] }

const rowText = (r: string[]) => r.filter((c) => c.trim()).join(' ').replace(/\s+/g, ' ').trim();

export const TITLE_WORDS: Record<TrimKind, string> = {
  HYDRO: 'hydrostatic',
  KN: 'cross\\s*curve|righting\\s*arm|\\bkn\\b',
};

const TRIM_LINE = /^\s*(no\s+trim|trim\b|even\s*keel|level\s+trim)/i;

/** A page holding one trim table: a short heading naming the table, a line starting with the trim, and ≥ 8 rows of numbers. */
export function isTrimTablePage(t: SourceTable, kind: TrimKind): boolean {
  const w = new RegExp(TITLE_WORDS[kind], 'i');
  const lines = t.rows.map(rowText);
  const head = lines.slice(0, 14);
  const heading = head.some((x) => w.test(x) && x.split(' ').length <= 6);
  const trim = head.some((x) => TRIM_LINE.test(x) && parseTrim(x) !== null);
  const data = t.rows.filter((r) => r.filter((c) => parseNum(c)).length >= 5).length;
  return heading && trim && data >= 8;
}

/** "129-133, 140" → [129, 130, 131, 132, 133, 140] */
export function parsePages(text: string): number[] {
  const out: number[] = [];
  for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)\s*[-–]\s*(\d+)$/.exec(part);
    if (m) { for (let p = Number(m[1]); p <= Number(m[2]) && out.length < 5000; p++) out.push(p); }
    else if (/^\d+$/.test(part)) out.push(Number(part));
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** [129, 130, 131, 140] → "129-131, 140" */
export function pagesText(pages: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    out.push(i === j ? `${pages[i]}` : `${pages[i]}-${pages[j]}`);
    i = j;
  }
  return out.join(', ');
}

export function splitTrims(tables: SourceTable[], method: TrimSplit, opts: { trimCol?: number } = {}): TrimBlock[] {
  const blocks: TrimBlock[] = [];
  if (method === 'TABLE') {
    for (const t of tables) {
      const i = t.rows.findIndex((r) => parseTrim(rowText(r)) !== null);
      const fromName = parseTrim(`trim ${t.label.replace(/^Sheet "(.*)"$/, '$1')}`);
      blocks.push({ trim: i >= 0 ? parseTrim(rowText(t.rows[i])) : fromName, title: i >= 0 ? rowText(t.rows[i]) : t.label, rows: t.rows.slice(i + 1), refs: t.rows.slice(i + 1).map((_, k) => ({ table: t.label, page: t.page, row: i + 1 + k })) });
    }
    return blocks;
  }
  if (method === 'COLUMN') {
    const col = opts.trimCol ?? 0;
    for (const t of tables) {
      const head: { rows: string[][]; refs: RowRef[] } = { rows: [], refs: [] };
      let cur: TrimBlock | null = null;
      t.rows.forEach((r, i) => {
        const isData = r.filter((c, j) => j !== col && parseNum(c)).length >= 2;
        if (!isData) { if (!cur) { head.rows.push(r.filter((_, j) => j !== col)); head.refs.push({ table: t.label, page: t.page, row: i }); } return; }
        const tv = parseNum(r[col] ?? '')?.value;
        if (tv !== undefined && (!cur || tv !== cur.trim)) {
          cur = blocks.find((b) => b.trim === tv) ?? null;
          if (!cur) { cur = { trim: tv, title: `trim ${tv}`, rows: [...head.rows], refs: [...head.refs] }; blocks.push(cur); }
        }
        if (cur) { cur.rows.push(r.filter((_, j) => j !== col)); cur.refs.push({ table: t.label, page: t.page, row: i }); }
      });
    }
    return blocks;
  }
  // TITLE: a line stating the trim starts a block (a table continued on the next page stays in the block)
  let cur: TrimBlock | null = null;
  for (const t of tables) {
    t.rows.forEach((r, i) => {
      const txt = rowText(r);
      const tr = TRIM_LINE.test(txt) ? parseTrim(txt) : null;
      if (tr !== null && !/^\s*[-\d.,\s]+$/.test(txt)) { cur = { trim: tr, title: txt, rows: [], refs: [] }; blocks.push(cur); return; }
      if (cur) { cur.rows.push(r); cur.refs.push({ table: t.label, page: t.page, row: i }); }
    });
  }
  return blocks;
}

export interface TrimImport {
  key: string;
  include: boolean;
  reviewed: boolean;
  trim: number | '';
  block: TrimBlock;
  rows: string[][];
  refs: RowRef[];
  trailing: number;
  conv: Conversion;
  /** KN: heel angles found in this block's own heading (to compare with the shared mapping) */
  ownAngles?: number[];
}

/** Heading rows before the first data row, then every data row (key column numeric and ≥ 2 numbers). */
function dataRange(b: TrimBlock, keyCol: number, m: Mapping) {
  const isData = (r: string[]) => keyCol >= 0 && !!parseNum(r[keyCol] ?? '', m.decimal) && r.filter((c) => parseNum(c, m.decimal)).length >= 2;
  const first = b.rows.findIndex(isData);
  let last = -1;
  b.rows.forEach((r, i) => { if (isData(r)) last = i; });
  const rows: string[][] = [], refs: RowRef[] = [];
  let trailing = 0;
  b.rows.forEach((r, i) => {
    if (first < 0) return;
    if (i < first || isData(r)) { rows.push(r); refs.push(b.refs[i]); } else if (i > last && r.some((c) => c.trim())) trailing++;
  });
  return { rows, refs, trailing };
}

export function buildTrimImports(kind: TrimKind, blocks: TrimBlock[], m: Mapping): TrimImport[] {
  const def = datasetDef(kind);
  const keyCol = kind === 'HYDRO' ? m.cols.draft : m.cols.displacement;
  return blocks.map((b, i) => {
    const r = dataRange(b, keyCol, m);
    const first = r.rows.findIndex((row) => !!parseNum(row[keyCol] ?? '', m.decimal));
    const conv = convert(def, r.rows, { ...m, firstRow: Math.max(0, first), lastRow: r.rows.length - 1 });
    const ownAngles = kind === 'KN' ? autoMapping(def, r.rows, m.decimal, m.lbp).angleCols.map((a) => a.angle) : undefined;
    return { key: `${i}`, include: true, reviewed: false, trim: b.trim ?? '', block: b, rows: r.rows, refs: r.refs, trailing: r.trailing, conv, ownAngles };
  });
}

export function trimChecks(kind: TrimKind, t: TrimImport, all: TrimImport[], v: Vessel, m: Mapping): Check[] {
  const out = checkConversion(kind, t.conv, v);
  if (t.trim === '') out.unshift({ level: 'error', title: 'Trim of this table not found', detail: 'Type the trim (m, + by the stern).' });
  else {
    if (all.filter((x) => x.include && x.trim === t.trim).length > 1) out.unshift({ level: 'error', title: `Trim ${t.trim} m appears in more than one table`, detail: 'Untick the duplicate or correct the trim.' });
    if (v.lbp && Math.abs(t.trim) > 0.1 * v.lbp) out.unshift({ level: 'warn', title: `Trim ${t.trim} m is more than 10 % of LBP`, detail: 'Check the sign and the unit.' });
  }
  if (kind === 'KN' && t.ownAngles && t.ownAngles.length) {
    const shared = m.angleCols.map((a) => a.angle);
    if (t.ownAngles.join() !== shared.join()) out.unshift({ level: 'error', title: `Heel angles in this table (${t.ownAngles.join(', ')}) differ from the column mapping (${shared.join(', ')})`, detail: 'All trims must use the same angles.' });
  }
  if (t.trailing) out.push({ level: 'ok', title: `${t.trailing} line(s) after the table not used (page footer / notes)` });
  return out;
}

/** Checks across the trims: trim 0 present, ranges overlap. */
export function setChecks(kind: TrimKind, inc: TrimImport[]): Check[] {
  const out: Check[] = [];
  const trims = inc.map((t) => t.trim).filter((x): x is number => x !== '').sort((a, b) => a - b);
  if (!trims.length) return out;
  out.push(trims.includes(0) ? { level: 'ok', title: `Trims ${trims.join(', ')} m (even keel included)` } : { level: 'warn', title: `Trims ${trims.join(', ')} m: no even-keel (trim 0) table`, detail: 'Calculation interpolates between the given trims only.' });
  const key = kind === 'HYDRO' ? 'displacement' : 'displacement';
  const ranges = inc.map((t) => { const v = t.conv.rows.map((r) => numVal(r.cells[key])).filter((x): x is number => x !== undefined); return v.length ? [Math.min(...v), Math.max(...v)] : null; }).filter((x): x is number[] => !!x);
  if (ranges.length > 1) {
    const lo = Math.max(...ranges.map((r) => r[0])), hi = Math.min(...ranges.map((r) => r[1]));
    out.push(hi > lo ? { level: 'ok', title: `Displacement range common to all trims: ${lo.toFixed(1)} – ${hi.toFixed(1)} t` } : { level: 'error', title: 'The trims have no displacement range in common' });
  }
  const counts = [...new Set(inc.map((t) => t.conv.rows.length))];
  if (counts.length > 1) out.push({ level: 'warn', title: `Row counts differ between trims (${counts.join(', ')})`, detail: 'Normal if the tables cover different ranges; otherwise a row may be missing.' });
  return out;
}

/** Empty tables of this kind, to start from when all trims are replaced. */
export function clearKind(v: Vessel, kind: TrimKind): Vessel {
  const n = structuredClone(v);
  if (kind === 'HYDRO') n.hydro = { rhoRef: v.hydro.rhoRef, rows: [] };
  else n.kn = { rhoRef: v.kn.rhoRef, displacements: [], angles: [], kn: [] };
  return n;
}

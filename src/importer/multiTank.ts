// All tank calibration tables at once: split the source into one block per tank, read every block
// with the same column mapping, fill the blanks booklets leave by convention (marked as such), and
// check each tank on its own.
import type { TankGroup, Vessel } from '../engine/types';
import { datasetDef } from './datasets';
import { convert, numVal, type Conversion, type Mapping } from './convert';
import { checkConversion, type Check } from './checks';
import { parseNum } from './numbers';
import type { SourceTable } from './sources';

export type SplitMethod = 'TITLE' | 'TABLE' | 'COLUMN';

export interface RowRef { table: string; page?: number; row: number }

export interface TankBlock {
  name: string;
  /** text of the title line (PDF / Word) or sheet name */
  title: string;
  groupText: string;
  density?: number;
  /** source rows of this tank: headings first, then data */
  rows: string[][];
  refs: RowRef[];
  firstPage?: number;
}

export const DEFAULT_TITLE = 'Tank Capacities for|Tank Calibration( Table)?( for|:)|Sounding Table( for|:)|Ullage Table( for|:)|Tank( name)?:';

const rowText = (r: string[]) => r.filter((c) => c.trim()).join(' ').replace(/\s+/g, ' ').trim();

/** Name, contents and density from a title line such as "Tank Capacities for NO1_FO.P containing FUEL OIL (0.850)". */
export function parseTitle(text: string, re: RegExp): { name: string; groupText: string; density?: number } | null {
  const m = re.exec(text);
  if (!m) return null;
  const after = text.slice(m.index + m[0].length).trim();
  const name = (/^[^\s,;(]+/.exec(after) ?? [''])[0];
  if (!name) return null;
  const rest = after.slice(name.length);
  const groupText = (/contain(?:ing|s)?\s+([^(]+)/i.exec(rest)?.[1] ?? '').trim();
  const d = /\(\s*(\d+[.,]\d+)\s*\)/.exec(rest) ?? /(?:s\.?g\.?|spgr|sp\.?\s*gr\.?|density|ρ)\s*[:=]?\s*(\d+[.,]\d+)/i.exec(rest);
  return { name, groupText, density: d ? Number(d[1].replace(',', '.')) : undefined };
}

export function splitTanks(tables: SourceTable[], method: SplitMethod, opts: { title?: string; nameCol?: number } = {}): TankBlock[] {
  const blocks: TankBlock[] = [];
  if (method === 'TABLE') {
    let re: RegExp | null = null;
    try { re = new RegExp(opts.title || DEFAULT_TITLE, 'i'); } catch { re = null; }
    for (const t of tables) {
      const titleRow = re ? t.rows.findIndex((r) => parseTitle(rowText(r), re!)) : -1;
      const pt = titleRow >= 0 ? parseTitle(rowText(t.rows[titleRow]), re!) : null;
      const label = t.label.replace(/^Sheet "(.*)"$/, '$1');
      blocks.push({
        name: pt?.name ?? label, title: pt ? rowText(t.rows[titleRow]) : label, groupText: pt?.groupText ?? '', density: pt?.density,
        rows: t.rows.slice(titleRow + 1), refs: t.rows.slice(titleRow + 1).map((_, i) => ({ table: t.label, page: t.page, row: titleRow + 1 + i })), firstPage: t.page,
      });
    }
    return blocks;
  }
  if (method === 'COLUMN') {
    const col = opts.nameCol ?? 0;
    for (const t of tables) {
      let cur: TankBlock | null = null;
      const head: { rows: string[][]; refs: RowRef[] } = { rows: [], refs: [] };
      t.rows.forEach((r, i) => {
        const nm = (r[col] ?? '').trim();
        const isData = r.filter((c, j) => j !== col && parseNum(c)).length >= 2;
        if (!isData) { if (!cur) { head.rows.push(r); head.refs.push({ table: t.label, page: t.page, row: i }); } return; }
        if (nm && (!cur || nm !== cur.name)) {
          cur = blocks.find((b) => b.name === nm) ?? null;
          if (!cur) { cur = { name: nm, title: nm, groupText: '', rows: [...head.rows], refs: [...head.refs], firstPage: t.page }; blocks.push(cur); }
        }
        if (cur) { cur.rows.push(r); cur.refs.push({ table: t.label, page: t.page, row: i }); }
      });
    }
    return blocks;
  }
  // TITLE: a title line starts each tank; tables (pages) are read one after the other
  let re: RegExp;
  try { re = new RegExp(opts.title || DEFAULT_TITLE, 'i'); } catch { return []; }
  let cur: TankBlock | null = null;
  for (const t of tables) {
    t.rows.forEach((r, i) => {
      const pt = parseTitle(rowText(r), re);
      if (pt) { cur = { name: pt.name, title: rowText(r), groupText: pt.groupText, density: pt.density, rows: [], refs: [], firstPage: t.page }; blocks.push(cur); return; }
      if (cur) { cur.rows.push(r); cur.refs.push({ table: t.label, page: t.page, row: i }); }
    });
  }
  return blocks;
}

/** Keep the heading lines before the first data row and every data row (volume column numeric and ≥ 2 numbers). */
export function blockDataRange(b: TankBlock, m: Mapping): { rows: string[][]; refs: RowRef[]; dropped: { ref: RowRef; text: string }[]; trailing: { ref: RowRef; text: string }[] } {
  const vc = m.cols.volume;
  const isData = (r: string[]) => vc >= 0 && !!parseNum(r[vc] ?? '', m.decimal) && r.filter((c) => parseNum(c, m.decimal)).length >= 2;
  const first = b.rows.findIndex(isData);
  const rows: string[][] = [], refs: RowRef[] = [], dropped: { ref: RowRef; text: string }[] = [];
  let last = -1;
  b.rows.forEach((r, i) => { if (isData(r)) last = i; });
  const trailing: { ref: RowRef; text: string }[] = [];
  b.rows.forEach((r, i) => {
    if (first < 0) return;
    if (i < first || isData(r)) { rows.push(r); refs.push(b.refs[i]); }
    else if (r.some((c) => c.trim())) (i > last ? trailing : dropped).push({ ref: b.refs[i], text: rowText(r) });
  });
  return { rows, refs, dropped, trailing };
}

export function guessGroup(name: string, groupText: string): TankGroup {
  const s = `${groupText} ${name}`.toUpperCase();
  if (/BALLAST|\bW\.?B(T|\d|\b)|SWB|DWSWB/.test(s)) return 'BALLAST';
  if (/LUB|\bL\.?O(\d|\b)|LUBOIL/.test(s)) return 'LUB_OIL';
  if (/DIESEL|\bMGO|\bMDO|\bD\.?O(\d|\b)/.test(s)) return 'DIESEL_OIL';
  if (/FUEL|\bF\.?O(\d|\b)|\bHFO|\bIFO|_FO\b|FODAY/.test(s)) return 'FUEL_OIL';
  if (/FRESH|POTABLE|DRINK|\bF\.?W(T|\d|\b)|_FW\b/.test(s)) return 'FRESH_WATER';
  return 'MISC';
}

const CONSUMABLE: TankGroup[] = ['FUEL_OIL', 'DIESEL_OIL', 'LUB_OIL', 'FRESH_WATER'];

/**
 * Blanks that booklets leave by convention, filled and marked:
 * empty-tank row without centres → centres of the first filled row (no effect: zero weight);
 * no free surface at 0 % → 0; no free surface printed at 100 % → value of the row before (conservative).
 */
export function fillTankGaps(c: Conversion): { conv: Conversion; filled: number } {
  let filled = 0;
  const rows = c.rows.map((r) => ({ ...r, cells: { ...r.cells } }));
  const firstWith = (k: string) => rows.find((r) => typeof r.cells[k]?.value === 'number');
  rows.forEach((r, i) => {
    const vol = numVal(r.cells.volume);
    for (const k of ['lcg', 'tcg', 'vcg']) {
      const cell = r.cells[k];
      if (cell && cell.status === 'empty' && vol === 0) {
        const src = firstWith(k);
        if (src) { r.cells[k] = { ...cell, value: src.cells[k].value, status: 'filled', note: `empty tank: centre of the first filled row (${src.cells[k].value})` }; filled++; }
      }
    }
    for (const k of ['fsm', 'inertia']) {
      const cell = r.cells[k];
      if (!cell || cell.status !== 'empty') continue;
      if (vol === 0) { r.cells[k] = { ...cell, value: 0, status: 'filled', note: 'empty tank: no free surface (0)' }; filled++; }
      else if (i === rows.length - 1 && i > 0 && typeof rows[i - 1].cells[k]?.value === 'number') {
        r.cells[k] = { ...cell, value: rows[i - 1].cells[k].value, status: 'filled', note: `not printed for the full tank: value of the row before (${rows[i - 1].cells[k].value}), conservative` }; filled++;
      }
    }
  });
  return { conv: { ...c, rows }, filled };
}

export interface TankImport {
  key: string;
  include: boolean;
  reviewed: boolean;
  name: string;
  group: TankGroup;
  density: number | '';
  consumable: boolean;
  block: TankBlock;
  refs: RowRef[];
  rows: string[][];
  /** lines between data rows that were not used (warned) */
  dropped: { ref: RowRef; text: string }[];
  /** lines after the table (page footers / next headings), not used */
  trailing: { ref: RowRef; text: string }[];
  conv: Conversion;
  filled: number;
}

export function buildTankImports(blocks: TankBlock[], m: Mapping, v: Vessel, fillGaps: boolean): TankImport[] {
  const def = datasetDef('TANK');
  return blocks.map((b, i) => {
    const r = blockDataRange(b, m);
    const first = r.rows.findIndex((row) => !!parseNum(row[m.cols.volume] ?? '', m.decimal));
    let conv = convert(def, r.rows, { ...m, firstRow: Math.max(0, first), lastRow: r.rows.length - 1 });
    let filled = 0;
    if (fillGaps) ({ conv, filled } = fillTankGaps(conv));
    const existing = v.tanks.find((t) => t.name === b.name);
    const group = existing?.group ?? guessGroup(b.name, b.groupText);
    return {
      key: `${i}:${b.name}`, include: true, reviewed: false, name: b.name, group,
      density: b.density ?? existing?.density ?? '', consumable: existing?.isConsumable ?? CONSUMABLE.includes(group),
      block: b, refs: r.refs, rows: r.rows, dropped: r.dropped, trailing: r.trailing, conv, filled,
    };
  });
}

export function tankChecks(t: TankImport, v: Vessel, all: TankImport[]): Check[] {
  const out = checkConversion('TANK', t.conv, v, { density: typeof t.density === 'number' ? t.density : undefined });
  if (!t.name.trim()) out.unshift({ level: 'error', title: 'Tank name missing' });
  if (all.filter((x) => x.include && x.name.trim() === t.name.trim()).length > 1) out.unshift({ level: 'error', title: `Tank name "${t.name}" is used by more than one table` });
  if (!(typeof t.density === 'number' && t.density > 0)) out.unshift({ level: 'error', title: 'Density missing', detail: 'Enter the liquid density of this tank.' });
  else if (t.density < 0.6 || t.density > 2.5) out.unshift({ level: 'warn', title: `Density ${t.density} t/m³ is unusual` });
  if (t.dropped.length) out.push({ level: 'warn', title: `${t.dropped.length} line(s) between the data were not used`, detail: t.dropped.slice(0, 3).map((d) => `"${d.text.slice(0, 50)}"`).join(', ') + (t.dropped.length > 3 ? ' …' : '') + ' (page headers / notes?)' });
  if (t.trailing.length) out.push({ level: 'ok', title: `${t.trailing.length} line(s) after the table not used`, detail: t.trailing.slice(0, 2).map((d) => `"${d.text.slice(0, 40)}"`).join(', ') + ' (page footer / heading)' });
  if (t.filled) out.push({ level: 'ok', title: `${t.filled} blank cell(s) filled by booklet convention (marked in blue)` });
  return out;
}


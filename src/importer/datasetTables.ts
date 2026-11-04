// Every data set of a vessel as a plain table (for viewing and editing), and back into the vessel.
// Writing back uses the same applyToVessel / checks / read-back as an import.
import type { Vessel } from '../engine/types';
import type { DatasetKind } from './datasets';
import { applyToVessel, compareRows, expectedRows, storedRows, type ApplyOptions } from './apply';
import { checkConversion, type Check } from './checks';
import type { ConvCell, Conversion } from './convert';

export type DsKind = DatasetKind | 'PARTICULARS' | 'LIGHTSHIP_SUMMARY';
export interface DsRef { key: string; title: string; group: string; kind: DsKind; trim?: number; tank?: string; rows: number }
export interface DsColumn { key: string; label: string; unit: string; type: 'num' | 'text' }

export function listDatasets(v: Vessel): DsRef[] {
  const out: DsRef[] = [
    { key: 'PARTICULARS', title: 'General particulars', group: 'General', kind: 'PARTICULARS', rows: 1 },
    { key: 'LIGHTSHIP', title: 'Lightship', group: 'General', kind: 'LIGHTSHIP_SUMMARY', rows: v.lightshipItems?.length ?? (v.lightship.weight ? 1 : 0) },
  ];
  const hTrims = v.hydro.trims && v.hydro.trims.length > 1 ? v.hydro.trims.map((t) => ({ trim: t.trim, n: t.rows.length })) : [{ trim: 0, n: v.hydro.rows.length }];
  for (const t of hTrims) out.push({ key: `HYDRO trim ${t.trim}`, title: `Hydrostatics, trim ${t.trim} m`, group: 'Hydrostatics', kind: 'HYDRO', trim: t.trim, rows: t.n });
  const kTrims = v.kn.trims && v.kn.trims.length > 1 ? v.kn.trims.map((t) => ({ trim: t.trim, n: t.displacements.length })) : [{ trim: 0, n: v.kn.displacements.length }];
  for (const t of kTrims) out.push({ key: `KN trim ${t.trim}`, title: `Cross curves (KN), trim ${t.trim} m`, group: 'Cross curves', kind: 'KN', trim: t.trim, rows: t.n });
  out.push({ key: 'WINDAGE', title: 'Windage', group: 'Wind and flooding', kind: 'WINDAGE', rows: v.windage.length });
  out.push({ key: 'OPENINGS', title: 'Down-flooding openings', group: 'Wind and flooding', kind: 'OPENINGS', rows: v.openings.length });
  for (const t of v.tanks) out.push({ key: `TANK ${t.name}`, title: t.name, group: 'Tanks', kind: 'TANK', tank: t.name, rows: t.calibration.length });
  return out;
}

const C = (key: string, label: string, unit: string, type: 'num' | 'text' = 'num'): DsColumn => ({ key, label, unit, type });

export function columnsOf(v: Vessel, ref: DsRef): DsColumn[] {
  switch (ref.kind) {
    case 'HYDRO': return [C('draft', 'Draft', 'm'), C('displacement', 'Δ', 't'), C('lcb', 'LCB from AP', 'm'), C('lcf', 'LCF from AP', 'm'), C('kmt', 'KMT', 'm'), C('tpc', 'TPC', 't/cm'), C('mtc', 'MTC', 't·m/cm'), C('kb', 'KB', 'm'), C('cb', 'C_B', '')];
    case 'KN': return [C('displacement', 'Δ', 't'), ...v.kn.angles.map((a) => C(`kn${a}`, `KN ${a}°`, 'm'))];
    case 'TANK': return [C('sounding', 'Sounding', 'm'), C('volume', 'Volume', 'm³'), C('lcg', 'LCG from AP', 'm'), C('tcg', 'TCG + stbd', 'm'), C('vcg', 'VCG', 'm'), C('inertia', 'i_T', 'm⁴')];
    case 'WINDAGE': return [C('draft', 'Draft', 'm'), C('area', 'Area', 'm²'), C('centroidZ', 'Centroid above base', 'm'), C('underwaterCentroidZ', 'Underwater centre', 'm')];
    case 'OPENINGS': return [C('name', 'Opening', '', 'text'), C('x', 'X from AP', 'm'), C('y', 'Y + stbd', 'm'), C('z', 'Z above base', 'm')];
    default: return [];
  }
}

export function optionsOf(v: Vessel, ref: DsRef): ApplyOptions {
  const t = ref.tank ? v.tanks.find((x) => x.name === ref.tank) : undefined;
  return { trim: ref.trim ?? 0, angles: ref.kind === 'KN' ? v.kn.angles : undefined, tank: t ? { name: t.name, group: t.group, density: t.density, isConsumable: t.isConsumable } : undefined };
}

export function tableOf(v: Vessel, ref: DsRef): (number | string)[][] {
  if (ref.kind === 'PARTICULARS' || ref.kind === 'LIGHTSHIP_SUMMARY') return [];
  return storedRows(ref.kind, v, optionsOf(v, ref)) ?? [];
}

/** Turn plain rows into a Conversion so the import checks and applyToVessel can be used. */
export function toConversion(ref: DsRef, cols: DsColumn[], rows: (number | string)[][]): Conversion {
  const cell = (x: number | string, type: 'num' | 'text'): ConvCell => {
    if (type === 'text') return { raw: String(x), value: String(x).trim() || null, status: String(x).trim() ? 'ok' : 'empty' };
    return typeof x === 'number' && Number.isFinite(x) ? { raw: String(x), value: x, read: x, status: 'ok' } : { raw: '', value: null, status: 'empty' };
  };
  let cellsRead = 0;
  const out = rows.map((r, i) => {
    if (ref.kind === 'KN') {
      cellsRead += r.length;
      return { src: i, cells: { displacement: cell(r[0], 'num') }, kn: r.slice(1).map((x) => cell(x, 'num')) };
    }
    const cells: Record<string, ConvCell> = {};
    cols.forEach((c, j) => { cells[c.key] = cell(r[j], c.type); if (cells[c.key].status !== 'empty') cellsRead++; });
    return { src: i, cells };
  });
  return { rows: out, skipped: [], stats: { rowsInRange: rows.length, cellsRead, cellsOk: cellsRead, cellsError: 0, digitChecks: 0, digitFailures: 0, positionsConverted: 0 } };
}

export function checkTable(v: Vessel, ref: DsRef, cols: DsColumn[], rows: (number | string)[][]): Check[] {
  if (ref.kind === 'PARTICULARS' || ref.kind === 'LIGHTSHIP_SUMMARY') return [];
  const conv = toConversion(ref, cols, rows);
  const t = ref.tank ? v.tanks.find((x) => x.name === ref.tank) : undefined;
  return checkConversion(ref.kind, conv, v, { density: t?.density }).filter((c) => !/re-read digit by digit|rows in the selected range/.test(c.title));
}

/** Write edited rows into the vessel and read them back. */
export function applyTable(v: Vessel, ref: DsRef, cols: DsColumn[], rows: (number | string)[][]): { vessel: Vessel; ok: boolean; text: string } {
  if (ref.kind === 'PARTICULARS' || ref.kind === 'LIGHTSHIP_SUMMARY' || ref.kind === 'WEIGHTS' || ref.kind === 'LIGHTSHIP') throw new Error('not a table data set');
  const o = optionsOf(v, ref);
  const conv = toConversion(ref, cols, rows);
  const v2 = applyToVessel(ref.kind, v, conv, o);
  const cmp = compareRows(expectedRows(ref.kind, conv, o), storedRows(ref.kind, v2, o), ['HYDRO', 'KN', 'WINDAGE'].includes(ref.kind));
  return { vessel: v2, ...cmp };
}

/** Human-readable list of what changed between two versions of a table. */
export function diffRows(cols: DsColumn[], before: (number | string)[][], after: { orig: number | null; vals: (number | string)[] }[]): string[] {
  const out: string[] = [];
  const kept = new Set(after.filter((r) => r.orig !== null).map((r) => r.orig));
  before.forEach((r, i) => { if (!kept.has(i)) out.push(`row ${i + 1} deleted (${cols[0].label} ${r[0]})`); });
  after.forEach((r, i) => {
    if (r.orig === null) { out.push(`row added at ${i + 1} (${cols[0].label} ${r.vals[0]})`); return; }
    const b = before[r.orig];
    cols.forEach((c, j) => {
      const x = b[j], y = r.vals[j];
      const same = typeof x === 'number' && typeof y === 'number' ? (Number.isNaN(x) && Number.isNaN(y)) || x === y : x === y;
      if (!same) out.push(`row ${r.orig! + 1} ${c.label}: ${Number.isNaN(x as number) ? '—' : x} → ${Number.isNaN(y as number) ? '—' : y}`);
    });
  });
  return out;
}

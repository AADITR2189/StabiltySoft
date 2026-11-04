// Write a verified conversion into a vessel (or load case), then read it back from the stored data
// and compare value by value, so nothing is lost or changed between the review and the database.
import type { HydroRow, LoadCase, Tank, TankGroup, Vessel } from '../engine/types';
import type { DatasetKind } from './datasets';
import { numVal, type Conversion } from './convert';

export interface ApplyOptions {
  trim: number;
  /** KN: heel angle of each KN column, in column order */
  angles?: number[];
  tank?: { name: string; group: TankGroup; density: number; isConsumable: boolean; type?: string };
}

export interface Provenance {
  dataset: string;            // e.g. "HYDRO trim 0", "TANK NO1_FO.P", "LIGHTSHIP"
  method: 'IMPORT' | 'TYPED';
  fileName: string;
  fileSha256: string;
  location: string;           // e.g. "Page 131, rows 9–34"
  rows: number;
  values: number;
  editedCells: number;
  /** blanks filled by booklet convention (empty-tank centres, FSM at 0 % / 100 %) */
  filledCells?: number;
  checks: { errors: number; warnings: number };
  storedCheck: string;
  verifiedBy: string;
  verifiedAt: string;
  /** changes made after the import, newest last */
  edits?: { by: string; at: string; reason: string; changes: string[] }[];
}

export const datasetKey = (kind: DatasetKind, o: ApplyOptions) =>
  kind === 'HYDRO' || kind === 'KN' ? `${kind} trim ${o.trim}` : kind === 'TANK' ? `TANK ${o.tank?.name ?? ''}` : kind;

const n = (r: Conversion['rows'][number], k: string) => numVal(r.cells[k]);

/** A "total" line in a lightship table: used to check the sum, not stored as an item. */
export const isTotalRow = (r: Conversion['rows'][number]) => /\b(total|sum|lightship|light\s*ship|grand)\b/i.test(String(r.cells.description?.value ?? ''));

export function lightshipTotals(items: { weight: number; lcg: number; tcg: number; vcg: number }[]) {
  const W = items.reduce((s, x) => s + x.weight, 0);
  const m = (k: 'lcg' | 'tcg' | 'vcg') => (W ? items.reduce((s, x) => s + x.weight * x[k], 0) / W : 0);
  return { weight: W, lcg: m('lcg'), tcg: m('tcg'), vcg: m('vcg') };
}

/** The values as they will be stored, in source order: one array of numbers per row. */
export function expectedRows(kind: DatasetKind, c: Conversion, o: ApplyOptions): (number | string)[][] {
  switch (kind) {
    case 'HYDRO': return c.rows.map((r) => ['draft', 'displacement', 'lcb', 'lcf', 'kmt', 'tpc', 'mtc', 'kb', 'cb'].map((k) => n(r, k) ?? NaN)).filter((x) => !Number.isNaN(x[0]));
    case 'KN': return c.rows.map((r) => [n(r, 'displacement')!, ...r.kn!.map((x) => (typeof x.value === 'number' ? x.value : NaN))]);
    case 'TANK': return c.rows.map((r) => [n(r, 'sounding') ?? NaN, n(r, 'volume')!, n(r, 'lcg')!, n(r, 'tcg')!, n(r, 'vcg')!, inertiaOf(r, o)]);
    case 'WINDAGE': return c.rows.map((r) => [n(r, 'draft')!, n(r, 'area')!, n(r, 'centroidZ')!, n(r, 'underwaterCentroidZ') ?? NaN]);
    case 'OPENINGS': return c.rows.map((r) => [String(r.cells.name?.value ?? ''), n(r, 'x')!, n(r, 'y')!, n(r, 'z')!]);
    case 'WEIGHTS': return c.rows.map((r) => [String(r.cells.description?.value ?? ''), n(r, 'weight')!, n(r, 'lcg')!, n(r, 'tcg')!, n(r, 'vcg')!]);
    case 'LIGHTSHIP': return c.rows.filter((r) => !isTotalRow(r)).map((r) => [String(r.cells.description?.value ?? ''), n(r, 'weight')!, n(r, 'lcg')!, n(r, 'tcg') ?? 0, n(r, 'vcg')!]);
  }
}

function inertiaOf(r: Conversion['rows'][number], o: ApplyOptions) {
  const i = n(r, 'inertia');
  if (i !== undefined) return i;
  const f = n(r, 'fsm');
  return f !== undefined && o.tank?.density ? f / o.tank.density : 0;
}

/** Read the dataset back from a stored vessel / load case in the same layout as expectedRows. */
export function storedRows(kind: DatasetKind, v: Vessel, o: ApplyOptions, lc?: LoadCase, count?: number): (number | string)[][] | null {
  const hydroRows = (): HydroRow[] | undefined => (v.hydro.trims && v.hydro.trims.length > 1 ? v.hydro.trims.find((t) => t.trim === o.trim)?.rows : o.trim === 0 ? v.hydro.rows : undefined);
  switch (kind) {
    case 'HYDRO': return hydroRows()?.map((h) => [h.draft, h.displacement, h.lcb, h.lcf, h.kmt, h.tpc, h.mtc, h.kb ?? NaN, h.cb ?? NaN]) ?? null;
    case 'KN': {
      const t = v.kn.trims && v.kn.trims.length > 1 ? v.kn.trims.find((x) => x.trim === o.trim) : o.trim === 0 ? v.kn : undefined;
      if (!t) return null;
      const idx = (o.angles ?? []).map((a) => v.kn.angles.indexOf(a));
      if (idx.some((j) => j < 0)) return null;
      return t.displacements.map((d, i) => [d, ...idx.map((j) => t.kn[i][j])]);
    }
    case 'TANK': return v.tanks.find((t) => t.name === o.tank?.name)?.calibration.map((r) => [r.sounding ?? NaN, r.volume, r.lcg, r.tcg, r.vcg, r.inertia]) ?? null;
    case 'WINDAGE': return v.windage.map((w) => [w.draft, w.area, w.centroidZ, w.underwaterCentroidZ ?? NaN]);
    case 'OPENINGS': return v.openings.map((p) => [p.name, p.x, p.y, p.z]);
    case 'WEIGHTS': return lc ? lc.weights.slice(-(count ?? 0)).map((w) => [w.description, w.weight, w.lcg, w.tcg, w.vcg]) : null;
    case 'LIGHTSHIP': return v.lightshipItems?.map((w) => [w.description, w.weight, w.lcg, w.tcg, w.vcg]) ?? null;
  }
}

/** Datasets that are stored sorted by their first column. */
export const SORTED: DatasetKind[] = ['HYDRO', 'KN', 'WINDAGE'];

export function compareRows(exp: (number | string)[][], got: (number | string)[][] | null, sorted: boolean): { ok: boolean; text: string } {
  if (!got) return { ok: false, text: 'Stored data not found' };
  const a = sorted ? [...exp].sort((x, y) => (x[0] as number) - (y[0] as number)) : exp;
  if (a.length !== got.length) return { ok: false, text: `Row count differs: ${a.length} reviewed, ${got.length} stored` };
  let values = 0, diff = 0;
  a.forEach((r, i) => r.forEach((x, j) => {
    const y = got[i][j];
    const same = typeof x === 'number' && typeof y === 'number' ? (Number.isNaN(x) && Number.isNaN(y)) || x === y : x === y;
    if (!(typeof x === 'number' && Number.isNaN(x))) values++;
    if (!same) diff++;
  }));
  return diff ? { ok: false, text: `${diff} stored values differ from the reviewed table` } : { ok: true, text: `Stored data read back: ${a.length}/${a.length} rows, ${values}/${values} values identical to the reviewed table` };
}

export function applyToVessel(kind: DatasetKind, v0: Vessel, c: Conversion, o: ApplyOptions): Vessel {
  const v: Vessel = structuredClone(v0);
  if (kind === 'HYDRO') {
    const rows: HydroRow[] = c.rows.map((r) => {
      const h: HydroRow = { draft: n(r, 'draft')!, displacement: n(r, 'displacement')!, lcb: n(r, 'lcb')!, lcf: n(r, 'lcf')!, kmt: n(r, 'kmt')!, tpc: n(r, 'tpc')!, mtc: n(r, 'mtc')! };
      if (n(r, 'kb') !== undefined) h.kb = n(r, 'kb');
      if (n(r, 'cb') !== undefined) h.cb = n(r, 'cb');
      return h;
    }).sort((a, b) => a.draft - b.draft);
    if (o.trim === 0 && (!v.hydro.trims || v.hydro.trims.length < 2)) { v.hydro.rows = rows; v.hydro.trims = undefined; }
    else {
      const trims = v.hydro.trims && v.hydro.trims.length ? v.hydro.trims : v.hydro.rows.length ? [{ trim: 0, rows: v.hydro.rows }] : [];
      v.hydro.trims = [...trims.filter((t) => t.trim !== o.trim), { trim: o.trim, rows }].sort((a, b) => a.trim - b.trim);
      v.hydro.rows = v.hydro.trims.find((t) => t.trim === 0)?.rows ?? v.hydro.rows;
      if (!v.hydro.rows.length) v.hydro.rows = rows;
    }
  }
  if (kind === 'KN') {
    const sorted = [...c.rows].sort((a, b) => n(a, 'displacement')! - n(b, 'displacement')!);
    const angles = o.angles ?? [];
    if (angles.some((a, i) => i > 0 && a <= angles[i - 1])) throw new Error('Heel angles must increase from column to column.');
    const add0 = angles[0] !== 0;
    const table = {
      displacements: sorted.map((r) => n(r, 'displacement')!),
      kn: sorted.map((r) => [...(add0 ? [0] : []), ...r.kn!.map((x) => x.value as number)]),
    };
    const allAngles = add0 ? [0, ...angles] : angles;
    const sameAngles = (a: number[]) => a.length === allAngles.length && a.every((x, i) => x === allAngles[i]);
    if (o.trim === 0 && (!v.kn.trims || v.kn.trims.length < 2)) { v.kn = { ...v.kn, angles: allAngles, ...table, trims: undefined }; }
    else {
      if (v.kn.angles.length && !sameAngles(v.kn.angles)) throw new Error(`The heel angles (${allAngles.join(', ')}) differ from the KN tables already stored (${v.kn.angles.join(', ')}). All trims must use the same angles.`);
      const trims = v.kn.trims && v.kn.trims.length ? v.kn.trims : v.kn.displacements.length ? [{ trim: 0, displacements: v.kn.displacements, kn: v.kn.kn }] : [];
      const nt = [...trims.filter((t) => t.trim !== o.trim), { trim: o.trim, ...table }].sort((a, b) => a.trim - b.trim);
      const t0 = nt.find((t) => t.trim === 0) ?? nt[0];
      v.kn = { ...v.kn, angles: allAngles, displacements: t0.displacements, kn: t0.kn, trims: nt };
    }
  }
  if (kind === 'TANK') {
    const t = o.tank!;
    const cal = c.rows.map((r) => ({ ...(n(r, 'sounding') !== undefined ? { sounding: n(r, 'sounding') } : {}), volume: n(r, 'volume')!, lcg: n(r, 'lcg')!, tcg: n(r, 'tcg')!, vcg: n(r, 'vcg')!, inertia: inertiaOf(r, o) }));
    const prevType = t.type ?? v.tanks.find((x) => x.name === t.name)?.type;
    const tank: Tank = { id: t.name, name: t.name, ...(prevType ? { type: prevType } : {}), group: t.group, density: t.density, isConsumable: t.isConsumable, capacity: Math.max(...cal.map((x) => x.volume)), calibration: cal };
    v.tanks = [...v.tanks.filter((x) => x.name !== t.name), tank];
  }
  if (kind === 'WINDAGE') {
    v.windage = c.rows.map((r) => ({ draft: n(r, 'draft')!, area: n(r, 'area')!, centroidZ: n(r, 'centroidZ')!, ...(n(r, 'underwaterCentroidZ') !== undefined ? { underwaterCentroidZ: n(r, 'underwaterCentroidZ') } : {}) })).sort((a, b) => a.draft - b.draft);
  }
  if (kind === 'LIGHTSHIP') {
    v.lightshipItems = c.rows.filter((r) => !isTotalRow(r)).map((r) => ({ description: String(r.cells.description?.value ?? ''), weight: n(r, 'weight')!, lcg: n(r, 'lcg')!, tcg: n(r, 'tcg') ?? 0, vcg: n(r, 'vcg')! }));
    v.lightship = lightshipTotals(v.lightshipItems);
  }
  if (kind === 'OPENINGS') v.openings = c.rows.map((r) => ({ name: String(r.cells.name?.value ?? ''), x: n(r, 'x')!, y: n(r, 'y')!, z: n(r, 'z')! }));
  return v;
}

export function applyWeights(lc: LoadCase, c: Conversion, newId: () => string): LoadCase {
  return { ...lc, weights: [...lc.weights, ...c.rows.map((r) => ({ id: newId(), description: String(r.cells.description?.value ?? ''), weight: n(r, 'weight')!, lcg: n(r, 'lcg')!, tcg: n(r, 'tcg')!, vcg: n(r, 'vcg')! }))] };
}

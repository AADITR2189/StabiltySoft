// Shared report content: the PDF and the Excel report are built from the same rows, so both
// always carry the same numbers. Report identity = SHA-256 of the inputs and results.
import { ENGINE_VERSION } from '../engine/stability';
import type { LoadCase, Results, Vessel } from '../engine/types';
import { groupByType, typeTotals } from '../engine/tankTypes';

export interface ReportMeta {
  preparedBy: string;
  checkedBy: string;
  remarks: string;
  dataStatus: string;   // DEMO / UNVERIFIED / VERIFIED
  dataSource: string;
  createdAt: Date;
}

export interface ReportInput {
  vessel: Vessel;
  lc: LoadCase;
  r: Results;
  meta: ReportMeta;
  /** Optional: every load case of the vessel with its result, for the "All load cases" summary. */
  allCases?: { lc: LoadCase; r: Results | null; error: string | null }[];
}

export const DISCLAIMER = 'Not an approved stability instrument. For planning and testing only.';

export const n = (v: number | null | undefined, dp: number) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(dp);

/** Longitudinal position shown like the booklet: distance from midship, f(orward) / a(ft). */
export const fromMid = (x: number, lbp: number, dp = 3) => {
  const d = x - lbp / 2;
  return `${Math.abs(d).toFixed(dp)} ${d >= 0 ? 'f' : 'a'}`;
};
export const trans = (y: number, dp = 3) => (Math.abs(y) < 0.0005 ? (0).toFixed(dp) : `${Math.abs(y).toFixed(dp)} ${y > 0 ? 's' : 'p'}`);

export function particularsRows(v: Vessel): [string, string][] {
  return [
    ['Ship name', v.name], ['IMO number', v.imo], ['Call sign', v.callSign],
    ['Length between perpendiculars', `${n(v.lbp, 3)} m`], ['Breadth (moulded)', `${n(v.breadth, 3)} m`], ['Depth (moulded)', `${n(v.depth, 3)} m`],
    ['Load line draft', v.maxDraft ? `${n(v.maxDraft, 3)} m` : '—'], ['Density of hydrostatic tables', `${n(v.rhoRef, 3)} t/m³`],
    ['Lightship', `${n(v.lightship.weight, 2)} t, LCG ${fromMid(v.lightship.lcg, v.lbp)}, TCG ${trans(v.lightship.tcg)}, VCG ${n(v.lightship.vcg, 3)} m`],
  ];
}

export function conditionRows(v: Vessel, lc: LoadCase, r: Results): [string, string][] {
  const fsmLabel = lc.fsmMethod === 'ACTUAL' ? 'actual filling' : lc.fsmMethod === 'MAXIMUM' ? 'maximum per tank' : 'total entered manually';
  return [
    ['Displacement Δ', `${n(r.displacement, 2)} t`], ['Deadweight', `${n(r.deadweight, 2)} t`], ['Sea water density', `${n(lc.seaDensity, 3)} t/m³`],
    ['Draft at AP', `${n(r.draftAP, 3)} m`], ['Draft at midship', `${n(r.draftMS, 3)} m`], ['Draft at FP', `${n(r.draftFP, 3)} m`],
    ['Mean draft (AP+FP)/2', `${n((r.draftAP + r.draftFP) / 2, 3)} m`],
    ['Trim', `${n(Math.abs(r.trim), 3)} m ${r.trim >= 0 ? 'by stern' : 'by head'}`],
    ['Heel (static)', `${n(Math.abs(r.heel), 2)}° ${r.heel > 0.005 ? 'starboard' : r.heel < -0.005 ? 'port' : ''}`],
    ['LCG (from midship)', `${fromMid(r.lcg, v.lbp)} m`], ['TCG', `${trans(r.tcg)} m`], ['KG (solid)', `${n(r.kg, 3)} m`],
    ['Free surface moment ΣFSM', `${n(r.sumFsm, 1)} t·m (${fsmLabel})`], ['Free surface correction', `${n(r.fsc, 3)} m`], ['KG corrected (fluid)', `${n(r.kgFluid, 3)} m`],
    ['KM (transverse)', `${n(r.kmt, 3)} m`], ['GM solid', `${n(r.gmSolid, 3)} m`], ['GM fluid', `${n(r.gmFluid, 3)} m`],
    ['LCB / LCF (from midship)', `${fromMid(r.lcb, v.lbp)} / ${fromMid(r.lcf, v.lbp)} m`], ['TPC / MTC', `${n(r.tpc, 2)} t/cm / ${n(r.mtc, 2)} t·m/cm`],
    ['Down-flooding angle θf', `${n(r.floodAngle, 1)}°${r.floodOpening ? ` (${r.floodOpening}, approximate method)` : ''}`],
    ['Deck-edge immersion angle', `${n(r.deckEdgeAngle, 1)}°`],
    ['GZmax / angle', `${n(r.gzMax, 3)} m at ${n(r.gzMaxAngle, 1)}°`],
    ['Angle of vanishing stability', r.avs !== null ? `${n(r.avs, 1)}°` : `beyond ${r.gzCurve[r.gzCurve.length - 1]?.heel}°`],
  ];
}

export function weightRows(r: Results): string[][] {
  return [
    ...r.summary.map((s) => [s.group, n(s.weight, 2), n(s.lcg, 3), n(s.tcg, 3), n(s.vcg, 3)]),
    ['Displacement', n(r.displacement, 2), n(r.lcg, 3), n(r.tcg, 3), n(r.kg, 3)],
  ];
}

export function tankRows(r: Results): string[][] {
  return r.tanks.filter((t) => t.volume > 1e-9).map((t) => [t.name, t.mode.toLowerCase(), n(t.percent, 1), n(t.volume, 2), n(t.density, 3), n(t.weight, 2), n(t.lcg, 3), n(t.tcg, 3), n(t.vcg, 3), n(t.fsm, 1)]);
}

/** Tank status split by tank type: a heading row per type, its non-empty tanks, and a subtotal row. */
export function tankRowsByType(v: Vessel, r: Results): { kind: 'head' | 'tank' | 'total'; cells: string[] }[] {
  const out: { kind: 'head' | 'tank' | 'total'; cells: string[] }[] = [];
  for (const g of groupByType(v, v.tanks, (t) => t)) {
    const rs = g.items.map((t) => r.tanks.find((x) => x.tankId === t.id)).filter((x): x is NonNullable<typeof x> => !!x);
    const full = rs.filter((t) => t.volume > 1e-9);
    const tot = typeTotals(rs);
    const cap = g.items.reduce((s, t) => s + t.capacity, 0);
    out.push({ kind: 'head', cells: [`${g.type.name} (${g.items.length} tank${g.items.length > 1 ? 's' : ''}${full.length < rs.length ? `, ${rs.length - full.length} empty` : ''})`, '', '', '', '', '', '', '', '', ''] });
    for (const t of full) out.push({ kind: 'tank', cells: [t.name, t.mode.toLowerCase(), n(t.percent, 1), n(t.volume, 2), n(t.density, 3), n(t.weight, 2), n(t.lcg, 3), n(t.tcg, 3), n(t.vcg, 3), n(t.fsm, 1)] });
    out.push({ kind: 'total', cells: [`Subtotal ${g.type.name}`, '', n(cap > 0 ? (tot.volume / cap) * 100 : 0, 1), n(tot.volume, 2), '', n(tot.weight, 2), tot.weight > 0 ? n(tot.lcg, 3) : '—', tot.weight > 0 ? n(tot.tcg, 3) : '—', tot.weight > 0 ? n(tot.vcg, 3) : '—', n(tot.fsm, 1)] });
  }
  return out;
}

export function criterionCells(c: Results['criteria'][number]): string[] {
  const unit = c.unit === '' ? '' : ` ${c.unit}`;
  const dp = c.unit === 'm·rad' ? 4 : c.unit === '°' ? 2 : 3;
  return [
    c.regulation, c.description,
    `${c.comparator === '>=' ? '≥' : '≤'} ${n(c.required, dp)}${unit}`, `${n(c.actual, dp)}${unit}`,
    `${c.marginAbs >= 0 ? '+' : ''}${n(c.marginAbs, dp)}`, `${c.marginPct >= 0 ? '+' : ''}${n(c.marginPct, 1)} %`, c.passed ? 'PASS' : 'FAIL',
  ];
}

/** Results without non-serialisable members, for hashing and the trace. */
export function stableResults(r: Results) {
  return JSON.parse(JSON.stringify(r)) as Results;
}

export async function reportHash(input: ReportInput): Promise<string> {
  const payload = JSON.stringify({ engine: ENGINE_VERSION, vessel: { name: input.vessel.name, imo: input.vessel.imo }, lc: input.lc, results: stableResults(input.r) });
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function traceRows(input: ReportInput, hash: string): [string, string][] {
  const { vessel, lc, meta } = input;
  return [
    ['Calculation engine', `StabilitySoft engine ${ENGINE_VERSION}`],
    ['Vessel data', `${meta.dataStatus === 'UNVERIFIED' ? 'EXTRACTED, NOT VERIFIED' : meta.dataStatus} · ${meta.dataSource}`],
    ['Hydrostatics', vessel.hydro.trims && vessel.hydro.trims.length > 1 ? `free trim between ${vessel.hydro.trims.length} trimmed tables (linear in trim)` : 'even-keel table, small-trim method'],
    ['Interpolation', 'hydrostatics linear in displacement; KN: PCHIP in displacement and in heel angle; no extrapolation'],
    ['Areas', 'composite Simpson rule on 0.1° steps of the interpolated GZ curve'],
    ['Free surface', lc.fsmMethod === 'MANUAL_TOTAL' ? `total entered: ${n(lc.fsmTotal ?? 0, 1)} t·m` : lc.fsmMethod === 'MAXIMUM' ? 'maximum FSM of each slack tank' : 'FSM of each tank at its actual filling'],
    ['Criteria side', input.r.side < 0 ? 'port (side of static heel)' : 'starboard (side of static heel)'],
    ['Report created', meta.createdAt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'],
    ['Report SHA-256', hash],
  ];
}

export function safeFileName(s: string) {
  return s.replace(/[^\w\-. ]+/g, '').replace(/\s+/g, '_').slice(0, 80);
}

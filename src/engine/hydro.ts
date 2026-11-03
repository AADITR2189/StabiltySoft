// Hydrostatic equilibrium (docs/A-Calculation-Methods.md §A.5).
// Two methods:
//   • single even-keel table: small-trim method t = Δ·(LCB − LCG) / (100·MTC)
//   • several trimmed tables (free trim): find the trim t at which LCB(Δ, t) = LCG by
//     interpolating between tables, then interpolate every particular at that trim.
import { EngineError, assertIncreasing, lerp, pchip } from './math';
import type { HydroRow, HydroTable, KNTable, Vessel, Warning } from './types';

export interface HydroState {
  method: 'EVEN_KEEL' | 'FREE_TRIM';
  draft: number;     // draft at the table origin (even keel: at LCF)
  draftAP: number;
  draftFP: number;
  draftMS: number;
  trim: number;      // + by stern
  lcb: number;
  lcf: number;
  kmt: number;
  kb: number | null; // VCB
  mtc: number;       // at actual density
  tpc: number;       // at actual density
  cb: number | null;
  lwl: number | null;
}

type Key = keyof HydroRow;

function rowAt(rows: HydroRow[], dispRef: number, key: Key, label: string): number {
  const d = rows.map((r) => r.displacement);
  return lerp(d, rows.map((r) => r[key] as number), dispRef, label);
}

export function solveHydrostatics(
  vessel: Vessel, disp: number, lcg: number, rho: number, warnings: Warning[],
): HydroState {
  const table: HydroTable = vessel.hydro;
  const rhoRef = table.rhoRef;
  const dispRef = (disp * rhoRef) / rho;
  const L = vessel.lbp;
  const origin = vessel.draftOriginX ?? L / 2;

  const tables = table.trims && table.trims.length > 1 ? [...table.trims].sort((a, b) => a.trim - b.trim) : null;

  if (!tables) {
    const rows = table.rows;
    assertIncreasing(rows.map((r) => r.displacement), 'Hydrostatic table (displacement)');
    const g = (k: Key) => rowAt(rows, dispRef, k, 'Hydrostatic table');
    const draft = g('draft'), lcb = g('lcb'), lcf = g('lcf'), kmt = g('kmt');
    const mtc = (g('mtc') * rho) / rhoRef, tpc = (g('tpc') * rho) / rhoRef;
    const trim = (disp * (lcb - lcg)) / (100 * mtc);
    if (Math.abs(trim) > 0.01 * L) {
      warnings.push({ code: 'LARGE_TRIM_ACCURACY', message: `Trim ${trim.toFixed(2)} m exceeds 1 % of LBP; even-keel hydrostatics lose accuracy.` });
    }
    const draftAP = draft + (trim * lcf) / L;
    const draftFP = draft - (trim * (L - lcf)) / L;
    return {
      method: 'EVEN_KEEL', draft, draftAP, draftFP, draftMS: draft + (trim * (lcf - L / 2)) / L, trim,
      lcb, lcf, kmt, mtc, tpc,
      kb: rows.every((r) => typeof r.kb === 'number') ? g('kb') : null,
      cb: rows[0].cb !== undefined ? g('cb') : null,
      lwl: rows[0].lwl !== undefined ? g('lwl') : null,
    };
  }

  // ---- free trim between trimmed tables ----
  const trims = tables.map((t) => t.trim);
  const at = (k: Key) => tables.map((t) => {
    assertIncreasing(t.rows.map((r) => r.displacement), `Hydrostatic table, trim ${t.trim} m (displacement)`);
    return rowAt(t.rows, dispRef, k, `Hydrostatic table, trim ${t.trim} m`);
  });
  const lcbs = at('lcb');
  // LCB moves aft as trim by stern increases; equilibrium where LCB(t) = LCG
  let trim: number | null = null;
  for (let i = 0; i < trims.length - 1; i++) {
    const a = lcbs[i] - lcg, b = lcbs[i + 1] - lcg;
    if (a === 0) { trim = trims[i]; break; }
    if (a * b <= 0) { trim = trims[i] + (a / (a - b)) * (trims[i + 1] - trims[i]); break; }
  }
  if (trim === null) {
    throw new EngineError(
      'OUT_OF_TABLE_RANGE',
      `Trim is outside the trimmed hydrostatic tables (${trims[0]} to ${trims[trims.length - 1]} m): LCG ${(lcg - L / 2).toFixed(3)} m from midship cannot be balanced.`,
    );
  }
  const T = trim;
  const it = (vals: number[]) => lerp(trims, vals, T, 'Trim interpolation');
  const draft = it(at('draft'));
  const mtc = (it(at('mtc')) * rho) / rhoRef;
  const tpc = (it(at('tpc')) * rho) / rhoRef;
  const has = (k: Key) => tables.every((t) => t.rows.every((r) => typeof r[k] === 'number'));
  return {
    method: 'FREE_TRIM',
    draft,
    draftAP: draft + (T * origin) / L,
    draftFP: draft - (T * (L - origin)) / L,
    draftMS: draft + (T * (origin - L / 2)) / L,
    trim: T,
    lcb: lcg,
    lcf: it(at('lcf')),
    kmt: it(at('kmt')),
    kb: has('kb') ? it(at('kb')) : null,
    mtc, tpc,
    cb: has('cb') ? it(at('cb')) : null,
    lwl: has('lwl') ? it(at('lwl')) : null,
  };
}

/** KN values at each tabulated heel angle, interpolated in displacement (PCHIP) and, if several trims exist, linearly in trim. */
export function knAtCondition(kn: KNTable, disp: number, rho: number, trim: number): { angles: number[]; values: number[] } {
  const dispRef = (disp * kn.rhoRef) / rho;
  const one = (t: { displacements: number[]; kn: number[][] }, label: string) => {
    assertIncreasing(t.displacements, `${label} (displacement)`);
    lerp(t.displacements, t.displacements, dispRef, label); // range check, no extrapolation
    return kn.angles.map((_, j) => pchip(t.displacements, t.kn.map((row) => row[j]))(dispRef));
  };
  if (!kn.trims || kn.trims.length < 2) return { angles: kn.angles, values: one(kn, 'KN table') };
  const tables = [...kn.trims].sort((a, b) => a.trim - b.trim);
  const trims = tables.map((t) => t.trim);
  const perTrim = tables.map((t) => one(t, `KN table, trim ${t.trim} m`));
  const values = kn.angles.map((_, j) => lerp(trims, perTrim.map((v) => v[j]), trim, 'KN trim interpolation'));
  return { angles: kn.angles, values };
}

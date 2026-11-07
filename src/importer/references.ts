// Conversions applied while importing, so that every table is stored in one convention:
//  • hydrostatic drafts → draft at midship (the table origin used for trimmed tables);
//  • cross curves given against draft or volume → against displacement (via the hydrostatic table).
// Each converted cell keeps its source text and gets a note showing the conversion.
import type { HydroRow, Vessel } from '../engine/types';
import { lerp } from '../engine/math';
import { numVal, type ConvCell, type Conversion } from './convert';
import type { Check } from './checks';

/** Where the drafts of a hydrostatic table are measured. */
export type DraftRef = 'MID' | 'LCF' | 'AP' | 'FP' | 'X';
export const DRAFT_REF_LABEL: Record<DraftRef, string> = {
  MID: 'at midship (L/2)', LCF: 'at the LCF (mean draft at the centre of flotation)', AP: 'at the aft perpendicular', FP: 'at the forward perpendicular', X: 'at another point (X from AP)',
};

/**
 * Draft at midship from a draft measured at x (from AP) on a waterline trimmed by t (m, + by the stern)
 * over the length L: the waterline is straight, d(x) = d_AP − t·x/L, so
 *   d_MS = d_ref + t · (x_ref − L/2) / L.
 * For an even-keel table (t = 0) every reference gives the same draft.
 */
export function draftAtMidship(dRef: number, xRef: number, trim: number, L: number): number {
  return dRef + (trim * (xRef - L / 2)) / L;
}

/** Convert the draft column of a hydrostatic conversion to midship drafts. */
export function convertDraftRef(c: Conversion, ref: DraftRef, trim: number, L: number, x?: number): { conv: Conversion; converted: number } {
  if (ref === 'MID' || !trim) return { conv: c, converted: 0 };
  let converted = 0;
  const rows = c.rows.map((r) => {
    const d = numVal(r.cells.draft);
    const lcf = numVal(r.cells.lcf);
    const xRef = ref === 'LCF' ? lcf : ref === 'AP' ? 0 : ref === 'FP' ? L : x;
    if (d === undefined || xRef === undefined) return r;
    const ms = draftAtMidship(d, xRef, trim, L);
    converted++;
    const cell: ConvCell = { ...r.cells.draft, value: ms, note: [r.cells.draft.note, `draft ${d} ${ref === 'LCF' ? `at LCF (${xRef.toFixed(3)} m from AP)` : ref === 'X' ? `at X = ${xRef} m` : `at ${ref}`} → ${ms.toFixed(4)} m at midship (trim ${trim} m)`].filter(Boolean).join('; ') };
    return { ...r, cells: { ...r.cells, draft: cell } };
  });
  return { conv: { ...c, rows }, converted };
}

/** What the first column of a cross-curve table gives. */
export type KnBasis = 'DISP' | 'DRAFT' | 'VOLUME';
export const KN_BASIS_LABEL: Record<KnBasis, string> = { DISP: 'displacement (t)', DRAFT: 'draft (m)', VOLUME: 'volume of displacement (m³)' };

/** The hydrostatic rows of the vessel for a trim (exact trim table, or the even-keel table for trim 0). */
export function hydroRowsForTrim(v: Vessel, trim: number): HydroRow[] | null {
  if (v.hydro.trims && v.hydro.trims.length > 1) return v.hydro.trims.find((t) => Math.abs(t.trim - trim) < 1e-9)?.rows ?? null;
  return Math.abs(trim) < 1e-9 && v.hydro.rows.length ? v.hydro.rows : null;
}

/**
 * Convert the first column of a KN table to displacement at the density of the tables:
 *  draft → Δ by linear interpolation in the hydrostatic table of the same trim (drafts at midship);
 *  volume → Δ = ∇ · ρ_ref.
 */
export function convertKnBasis(c: Conversion, basis: KnBasis, v: Vessel, trim: number): { conv: Conversion; error: string | null } {
  if (basis === 'DISP') return { conv: c, error: null };
  let rows: HydroRow[] | null = null;
  if (basis === 'DRAFT') {
    rows = hydroRowsForTrim(v, trim);
    if (!rows || rows.length < 2) return { conv: c, error: `No hydrostatic table for trim ${trim} m in ${v.name}: import the hydrostatics first, so drafts can be turned into displacements.` };
  }
  const errs: string[] = [];
  const out = c.rows.map((r) => {
    const x = numVal(r.cells.displacement);
    if (x === undefined) return r;
    let disp: number, note: string;
    if (basis === 'VOLUME') { disp = x * v.rhoRef; note = `volume ${x} m³ × ρ ${v.rhoRef} = Δ ${disp.toFixed(3)} t`; }
    else {
      try { disp = lerp(rows!.map((h) => h.draft), rows!.map((h) => h.displacement), x, `Hydrostatic table, trim ${trim} m`); }
      catch (e) { errs.push(`row ${r.src + 1}: draft ${x} m is outside the hydrostatic table (${rows![0].draft}–${rows![rows!.length - 1].draft} m)`); return { ...r, cells: { ...r.cells, displacement: { ...r.cells.displacement, value: null, status: 'error' as const, note: e instanceof Error ? e.message : String(e) } } }; }
      note = `draft ${x} m → Δ ${disp.toFixed(3)} t (hydrostatic table, trim ${trim} m)`;
    }
    return { ...r, cells: { ...r.cells, displacement: { ...r.cells.displacement, value: disp, note } } };
  });
  return { conv: { ...c, rows: out }, error: errs.length ? errs.join('; ') : null };
}

export interface RefOptions { draftRef?: DraftRef; draftX?: number; knBasis?: KnBasis }

/** Apply the draft-reference (hydrostatics) or row-basis (KN) conversion; the result also gives a check line to show. */
export function applyRefs(kind: string, c: Conversion, v: Vessel, trim: number, o: RefOptions): { conv: Conversion; checks: Check[] } {
  if (kind === 'HYDRO' && o.draftRef && o.draftRef !== 'MID') {
    if (o.draftRef === 'X' && (o.draftX === undefined || !Number.isFinite(o.draftX))) return { conv: c, checks: [{ level: 'error', title: 'Draft reference point: enter X (m from AP)' }] };
    if (!trim) return { conv: c, checks: [{ level: 'ok', title: `Drafts ${DRAFT_REF_LABEL[o.draftRef]}`, detail: 'even-keel table: the draft is the same at every point, no conversion needed' }] };
    const r = convertDraftRef(c, o.draftRef, trim, v.lbp, o.draftX);
    const miss = c.rows.length - r.converted;
    return { conv: r.conv, checks: [{ level: miss && o.draftRef === 'LCF' ? 'error' : 'ok', title: `${r.converted} drafts ${DRAFT_REF_LABEL[o.draftRef]} converted to drafts at midship`, detail: `d_MS = d + t·(x − L/2)/L with t = ${trim} m, L = ${v.lbp} m${miss ? `; ${miss} row(s) not converted${o.draftRef === 'LCF' ? ' (no LCF value in the row: map the LCF column)' : ''}` : ''}` }] };
  }
  if (kind === 'KN' && o.knBasis && o.knBasis !== 'DISP') {
    const r = convertKnBasis(c, o.knBasis, v, trim);
    if (r.error) return { conv: r.conv, checks: [{ level: 'error', title: `Rows given by ${KN_BASIS_LABEL[o.knBasis]}: conversion to displacement failed`, detail: r.error }] };
    return { conv: r.conv, checks: [{ level: 'ok', title: `Rows given by ${KN_BASIS_LABEL[o.knBasis]} converted to displacement`, detail: o.knBasis === 'VOLUME' ? `Δ = ∇ × ${v.rhoRef} t/m³` : `from the hydrostatic table of trim ${trim} m (linear between rows)` }] };
  }
  return { conv: c, checks: [] };
}

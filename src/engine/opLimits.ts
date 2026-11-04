// Operational limits of a load case (draft, trim, heel, air draft, GM). Each limit has its own tick:
// unticked limits are not checked. They are reported separately from the stability criteria and do
// not change the criteria result.
import type { LoadCase, Vessel } from './types';

export interface OpLimit { enabled: boolean; value: number }
export interface OpLimits {
  maxDraftMS?: OpLimit;
  maxDraftAP?: OpLimit;
  minDraftFP?: OpLimit;
  maxTrimStern?: OpLimit;
  maxTrimHead?: OpLimit;
  maxHeel?: OpLimit;
  minGM?: OpLimit;
  /** maximum air draft; topZ = height of the highest point above base, topX = its position from AP */
  maxAirDraft?: OpLimit & { topZ: number; topX: number };
}

export interface OpLimitResult { key: keyof OpLimits; label: string; unit: string; comparator: '<=' | '>='; limit: number; actual: number; passed: boolean; enabled: boolean; note?: string }

export const LIMIT_LABELS: Record<keyof OpLimits, { label: string; unit: string; comparator: '<=' | '>=' }> = {
  maxDraftMS: { label: 'Max. draft at midship', unit: 'm', comparator: '<=' },
  maxDraftAP: { label: 'Max. draft aft (AP)', unit: 'm', comparator: '<=' },
  minDraftFP: { label: 'Min. draft forward (FP)', unit: 'm', comparator: '>=' },
  maxTrimStern: { label: 'Max. trim by the stern', unit: 'm', comparator: '<=' },
  maxTrimHead: { label: 'Max. trim by the head', unit: 'm', comparator: '<=' },
  maxHeel: { label: 'Max. static heel', unit: '°', comparator: '<=' },
  minGM: { label: 'Min. GM (fluid)', unit: 'm', comparator: '>=' },
  maxAirDraft: { label: 'Max. air draft', unit: 'm', comparator: '<=' },
};

/** Defaults for a new load case: the load line draft is ticked, the rest unticked. */
export function defaultLimits(v: Vessel): OpLimits {
  return {
    maxDraftMS: { enabled: v.maxDraft !== undefined, value: v.maxDraft ?? 0 },
    maxDraftAP: { enabled: false, value: v.maxDraft ?? 0 },
    minDraftFP: { enabled: false, value: 0 },
    maxTrimStern: { enabled: false, value: Math.round(0.02 * v.lbp * 100) / 100 },
    maxTrimHead: { enabled: false, value: 0 },
    maxHeel: { enabled: false, value: 2 },
    minGM: { enabled: false, value: 0.15 },
    maxAirDraft: { enabled: false, value: 0, topZ: 0, topX: v.lbp / 2 },
  };
}

export function checkLimits(lc: LoadCase, v: Vessel, r: { draftAP: number; draftFP: number; draftMS: number; trim: number; heel: number; gmFluid: number }): OpLimitResult[] {
  const lim = { ...defaultLimits(v), ...(lc.opLimits ?? {}) };
  const L = v.lbp;
  const out: OpLimitResult[] = [];
  const add = (key: keyof OpLimits, actual: number, note?: string) => {
    const l = lim[key];
    if (!l) return;
    const d = LIMIT_LABELS[key];
    // tolerance for the rounding of the tables: 5 mm for drafts and trim, 0.05° for heel
    const tol = key === 'maxHeel' ? 0.05 : key === 'minGM' ? 1e-9 : 0.005;
    out.push({ key, ...d, limit: l.value, actual, enabled: l.enabled, passed: d.comparator === '<=' ? actual <= l.value + tol : actual >= l.value - tol, note });
  };
  add('maxDraftMS', r.draftMS);
  add('maxDraftAP', r.draftAP);
  add('minDraftFP', r.draftFP);
  add('maxTrimStern', Math.max(0, r.trim), r.trim < 0 ? 'trimmed by the head' : undefined);
  add('maxTrimHead', Math.max(0, -r.trim), r.trim > 0 ? 'trimmed by the stern' : undefined);
  add('maxHeel', Math.abs(r.heel));
  add('minGM', r.gmFluid);
  const a = lim.maxAirDraft;
  if (a) {
    // draft at the position of the highest point (linear between AP and FP)
    const dx = r.draftAP + ((r.draftFP - r.draftAP) * a.topX) / L;
    add('maxAirDraft', a.topZ - dx, `highest point ${a.topZ} m above base at ${a.topX} m from AP; draft there ${dx.toFixed(3)} m`);
  }
  return out;
}

export interface GzRange { from: number; to: number; step: number }

/** Angles shown in GZ tables: from … to in steps (validated, clipped to the KN table). */
export function rangeAngles(r: GzRange | undefined, maxTable: number, fallback: () => number[]): number[] {
  if (!r) return fallback();
  const step = Math.max(0.1, r.step || 5);
  const from = Math.max(0, Math.min(r.from ?? 0, maxTable));
  const to = Math.min(Math.max(r.to ?? 90, from), maxTable);
  const out: number[] = [];
  for (let a = from; a <= to + 1e-9 && out.length < 2000; a += step) out.push(Math.round(a * 1e6) / 1e6);
  if (out[out.length - 1] < to - 1e-9) out.push(to);
  return out;
}

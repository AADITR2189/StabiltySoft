// IS 2008 B 2.7.3 (MSC.415(97)): permissible wire tension as a function of α by direct stability
// calculation. For each α the largest Fp ≤ Fd is found for which all criteria of 2.7.4 are met.
import { calculate } from './stability';
import { EngineError } from './math';
import type { CriteriaLibrary, LoadCase, Vessel } from './types';

export interface TensionRow { alpha: number; fp: number; limitedBy: string; atFd: boolean }

export function permissibleTensions(vessel: Vessel, lc: LoadCase, lib?: CriteriaLibrary, alphas = Array.from({ length: 18 }, (_, i) => 5 * (i + 1))): TensionRow[] {
  const a0 = lc.ops?.anchor;
  if (!a0) throw new EngineError('NO_OPS_DATA', 'enter the anchor handling data first.');
  const check = (alpha: number, fp: number) => {
    try {
      const r = calculate(vessel, { ...lc, criteriaGroups: ['ANCHOR_HANDLING'], ops: { ...lc.ops, anchor: { ...a0, alpha, fp } } }, lib);
      const g = r.groups[0];
      const failed = g.criteria.find((c) => !c.passed);
      return { ok: g.passed, why: g.error ?? failed?.description ?? '' };
    } catch (e) {
      return { ok: false, why: (e as Error).message };
    }
  };
  return alphas.map((alpha) => {
    const atFd = check(alpha, a0.fd);
    if (atFd.ok) return { alpha, fp: a0.fd, limitedBy: 'Design maximum tension Fd', atFd: true };
    if (!check(alpha, 0.01).ok) return { alpha, fp: 0, limitedBy: check(alpha, 0.01).why || 'Criteria not met without tension', atFd: false };
    let lo = 0.01, hi = a0.fd, why = atFd.why;
    for (let i = 0; i < 22; i++) {
      const mid = 0.5 * (lo + hi);
      const c = check(alpha, mid);
      if (c.ok) lo = mid; else { hi = mid; why = c.why; }
    }
    return { alpha, fp: lo, limitedBy: why, atFd: false };
  });
}

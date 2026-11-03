// IMO MSC.415(97) (IS Code 2008 Part B 2.7–2.9): formulas checked against hand calculation from the resolution text.
import { describe, expect, it } from 'vitest';
import { anchorGeometry, selfTrippingLever, towCT, towTripping, liftThreshold, type AnchorInput, type TowingInput } from '../src/engine/msc415';
import { calculate } from '../src/engine/stability';
import { VESSELS } from '../src/data/vessels';
import type { CriteriaLibrary } from '../src/engine/types';

const DEG = Math.PI / 180;
const marsol = VESSELS.find((v) => v.id === 'marsol-splendor')!;
const C2 = marsol.defaultLoadCases.find((c) => c.id === 'marsol-C2')!;
const C2T = marsol.defaultLoadCases.find((c) => c.id === 'marsol-C2T')!;

const AH: AnchorInput = { fp: 50, fd: 60, bp: 20, alpha: 30, h: 5, y0: 1, x: 4, xStern: 0, zStern: 5.3, lLL: 57.4 };

describe('2.7.2 anchor handling heeling lever', () => {
  it('y, β, Fv and M_AH by hand', () => {
    const g = anchorGeometry(AH, 16.8);
    const y = 1 + 4 * Math.tan(30 * DEG);                       // 3.3094
    const bMax = Math.atan(y / (5 * Math.sin(30 * DEG))) / DEG;  // 52.93°
    const bMin = Math.acos((1.5 * 20) / (50 * Math.cos(30 * DEG))) / DEG; // 46.15°
    const b = Math.max(bMax, bMin);
    expect(g.y).toBeCloseTo(y, 12);
    expect(g.beta).toBeCloseTo(b, 10);
    expect(g.fv).toBeCloseTo(50 * Math.sin(b * DEG), 10);
    expect(g.mah).toBeCloseTo(50 * (5 * Math.sin(30 * DEG) * Math.cos(b * DEG) + y * Math.sin(b * DEG)), 10);
  });
  it('y is limited to B/2 and the cos⁻¹ limit is ignored when 1.5·BP ≥ Fp·cos α', () => {
    const g = anchorGeometry({ ...AH, x: 100, bp: 100 }, 16.8);
    expect(g.y).toBe(8.4);
    expect(g.betaMin).toBe(0);
  });
  it('group: Fv is added at the stern (Δ2) and the four criteria are evaluated', () => {
    const base = calculate(marsol.vessel, { ...C2, criteriaGroups: [] });
    const r = calculate(marsol.vessel, { ...C2, criteriaGroups: ['ANCHOR_HANDLING'], ops: { anchor: AH } });
    const g = anchorGeometry(AH, 16.8);
    expect(r.displacement - base.displacement).toBeCloseTo(g.fv, 9);
    const grp = r.groups[0];
    expect(grp.criteria.map((c) => c.code)).toEqual(['AH-1', 'AH-2', 'AH-3', 'AH-4']);
    expect(grp.moments[0].rows[0].arm).toBeCloseTo(g.mah / r.displacement, 12);
    expect(grp.criteria[3].required).toBeCloseTo(0.005 * 57.4, 12);
    expect(grp.criteria[0].required).toBe(0.07);
    expect(grp.criteria[1].required).toBe(0.2);
  });
});

describe('2.8 towing and escort', () => {
  const T: TowingInput = { bp: 40, propulsion: 'AZIMUTH', azimuthMin: 0.7, l: 20, zTow: 7, zProp: 1.5, r: 0, ls: 20, ap: 220, lLL: 57.4 };
  it('C_T: 0.5 conventional; 0.90/(1 + l/L_LL) with minimum for azimuth', () => {
    expect(towCT({ ...T, propulsion: 'CONVENTIONAL' })).toBe(0.5);
    expect(towCT(T)).toBeCloseTo(Math.max(0.9 / (1 + 20 / 57.4), 0.7), 12);
    expect(towCT({ ...T, l: 2 })).toBeCloseTo(0.9 / (1 + 2 / 57.4), 12);
  });
  it('self-tripping HL = BP[kN]·C_T·(h cos φ − r sin φ)/(g·Δ)', () => {
    const disp = 3000, phi = 20;
    const hand = (40 * 9.81 * towCT(T) * (5.5 * Math.cos(phi * DEG))) / (9.81 * disp);
    expect(selfTrippingLever(T, disp, phi)).toBeCloseTo(hand, 12);
  });
  it('tow-tripping C1, C2, C3 and their limits', () => {
    const tt = towTripping(T, 57.4, 16.8, 1.1, 4.2, 1.025, 3300, 4.2);
    expect(tt.C1).toBeCloseTo(Math.min(1, Math.max(0.1, 2.8 * (20 / 57.4 - 0.1))), 12);
    const phiD = Math.atan(2.2 / 16.8) / DEG;
    expect(tt.phiD).toBeCloseTo(phiD, 12);
    const phi = 10;
    const C2 = Math.max(1, phi / (3 * phiD) + 0.5), C3 = Math.min(0.83, Math.max(0.5, 0.26 * phi / phiD + 0.3));
    const hand = tt.C1 * C2 * 1.025 * 2.57 ** 2 * 220 * ((7 - 4.2) * Math.cos(phi * DEG) + C3 * 4.2) / (2 * 9.81 * 3300);
    expect(tt.lever(phi)).toBeCloseTo(hand, 12);
    expect(towTripping({ ...T, ls: 50 }, 57.4, 16.8, 1.1, 4.2, 1.025, 3300, 4.2).C1).toBe(1);
    expect(towTripping({ ...T, ls: 6 }, 57.4, 16.8, 1.1, 4.2, 1.025, 3300, 4.2).C1).toBe(0.1);
  });
  it('towing group: area A vs B, tow-tripping vs θf, stern freeboard', () => {
    const r = calculate(marsol.vessel, { ...C2, criteriaGroups: ['TOWING'], ops: { towing: T } });
    const g = r.groups[0];
    expect(g.error).toBeUndefined();
    expect(g.criteria.map((c) => c.code)).toEqual(['TOW-1', 'TOW-2', 'TOW-3']);
    expect(g.criteria[1].required).toBeCloseTo(r.floodAngle, 9);
  });
  it('escort: A/B, C/D with a constant lever', () => {
    const r = calculate(marsol.vessel, { ...C2, criteriaGroups: ['ESCORT'], ops: { escort: { hl: 0.3 } } });
    const [e1, e2, e3] = r.groups[0].criteria;
    expect(e1.required).toBe(1.25); expect(e2.required).toBe(1.4); expect(e3.required).toBe(15);
    expect(e3.actual).toBeGreaterThan(0);
  });
});

describe('2.9 lifting: threshold, alternative method and loss of hook load', () => {
  it('M_L = 0.67·Δ·GM·(f/B)', () => {
    expect(liftThreshold(3300, 3.6, 1.0, 16.8)).toBeCloseTo(0.67 * 3300 * 3.6 / 16.8, 12);
  });
  it('alternative method equilibrium = user moment P_L·y·cos θ (no counter-ballast)', () => {
    const lib: CriteriaLibrary = {
      moments: [{ id: 'L', name: 'lift', result: 'MOMENT', formula: 'P*y*cos(theta)', vars: [{ name: 'P', source: 'VALUE', value: 20 }, { name: 'y', source: 'VALUE', value: 10 }, { name: 'theta', source: 'HEEL' }] }],
      criteria: [{ id: 'U', name: 'u', kind: 'HEEL_MOMENT', comparator: '<=', required: 10, params: { momentId: 'GROUP' } }],
      groups: [{ id: 'G', name: 'g', regulation: '', description: '', chart: 'GENERAL', criterionIds: ['U'], momentIds: ['L'] }],
    };
    const lc = { ...C2, weights: [...C2.weights, { id: 'hook', description: 'Hook load (centreline)', weight: 20, lcg: 30, tcg: 0, vcg: 12 }] };
    const r = calculate(marsol.vessel, { ...lc, criteriaGroups: ['LIFT_297', 'G'], ops: { lifting: { exposed: false, hs: 0, pl: 20, y: 10, cbm: 0, hookWeightId: 'hook' } } }, lib);
    const alt = r.groups.find((g) => g.id === 'LIFT_297')!;
    const user = r.groups.find((g) => g.id === 'G')!;
    expect(alt.criteria[1].actual).toBeCloseTo(user.criteria[0].actual, 4);
    expect(alt.criteria[0].required).toBe(0.053);
    expect(r.warnings.some((w) => w.code === 'LIFT_THRESHOLD')).toBe(true);
  });
  it('2.9.7.2 and 2.9.5 loss of hook load are evaluated with the condition without the hook load', () => {
    const lc = { ...C2, weights: [...C2.weights, { id: 'hook', description: 'Hook load (centreline)', weight: 20, lcg: 30, tcg: 0, vcg: 12 }] };
    const r = calculate(marsol.vessel, { ...lc, criteriaGroups: ['LIFT_297_LOSS'], ops: { lifting: { exposed: true, hs: 1, pl: 20, y: 10, cbm: 150, hookWeightId: 'hook' } } });
    const a3 = r.groups[0].criteria[0];
    expect(a3.required).toBe(0.037);
    expect(Number.isFinite(a3.actual)).toBe(true);
    const hookId = C2T.weights.find((w) => /LIFTED WEIGHT/.test(w.description))!.id;
    const c = calculate(marsol.vessel, { ...C2T, criteriaGroups: ['LIFT_295'], ops: { lifting: { exposed: false, hs: 0, hookWeightId: hookId } } });
    const l1 = c.groups[0].criteria[0];
    expect(l1.required).toBe(1.0);
    expect(l1.actual).toBeGreaterThan(1);
  });
  it('missing inputs are listed', () => {
    const r = calculate(marsol.vessel, { ...C2, criteriaGroups: ['ANCHOR_HANDLING', 'TOWING', 'ESCORT', 'LIFT_297'] });
    for (const g of r.groups) { expect(g.passed).toBe(false); expect(g.error).toMatch(/Operation data/); }
  });
});

describe('2.7.3 permissible tension curve', () => {
  it('finds the largest Fp ≤ Fd meeting all 2.7.4 criteria; just above it a criterion fails', async () => {
    const { permissibleTensions } = await import('../src/engine/permissibleTension');
    const lc = { ...C2, ops: { anchor: { ...AH, fd: 200 } } };
    const rows = permissibleTensions(marsol.vessel, lc, undefined, [10, 30, 60]);
    for (const row of rows) {
      expect(row.fp).toBeGreaterThan(0);
      expect(row.fp).toBeLessThanOrEqual(200);
      if (!row.atFd) {
        // just above the permissible tension either a criterion fails or the condition leaves the hydrostatic tables
        let abovePassed = false;
        try {
          abovePassed = calculate(marsol.vessel, { ...lc, criteriaGroups: ['ANCHOR_HANDLING'], ops: { anchor: { ...AH, fd: 200, alpha: row.alpha, fp: row.fp * 1.01 } } }).groups[0].passed;
        } catch { abovePassed = false; }
        expect(abovePassed).toBe(false);
        const at = calculate(marsol.vessel, { ...lc, criteriaGroups: ['ANCHOR_HANDLING'], ops: { anchor: { ...AH, fd: 200, alpha: row.alpha, fp: row.fp } } });
        expect(at.groups[0].passed).toBe(true);
      }
    }
  });
});

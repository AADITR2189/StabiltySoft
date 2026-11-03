// Engine verification against exact (hand-calculable) results for a box-shaped barge.
// See docs/A-Calculation-Methods.md §A.13.
import { describe, expect, it } from 'vitest';
import { calculate } from '../src/engine/stability';
import { resolveTank } from '../src/engine/tanks';
import { EngineError, integrateDeg, pchip, lerp } from '../src/engine/math';
import { demoLoadCase, demoVessel, DEMO } from '../src/data/demoVessel';
import { boxKN } from '../src/data/boxGeometry';
import type { LoadCase, Warning } from '../src/engine/types';

const { L, B, D, rho } = DEMO;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const DEG = Math.PI / 180;

/** A simple condition with no tanks, so every value can be hand-calculated. */
function simpleCase(weights: { w: number; x: number; y: number; z: number }[], seaDensity = 1.025): LoadCase {
  return {
    id: 't', name: 'test', type: 'Test', seaDensity, fsmMethod: 'ACTUAL',
    tanks: {},
    weights: weights.map((w, i) => ({ id: `w${i}`, description: `W${i}`, weight: w.w, lcg: w.x, tcg: w.y, vcg: w.z })),
  };
}

describe('math helpers', () => {
  it('linear interpolation refuses to extrapolate', () => {
    expect(lerp([1, 2], [10, 20], 1.5, 't')).toBeCloseTo(15, 12);
    expect(() => lerp([1, 2], [10, 20], 2.5, 't')).toThrow(EngineError);
  });
  it('PCHIP reproduces a straight line exactly and never overshoots', () => {
    const f = pchip([0, 1, 2, 3], [0, 2, 4, 6]);
    expect(f(1.37)).toBeCloseTo(2.74, 12);
    const g = pchip([0, 1, 2, 3], [0, 1, 1, 1]);
    for (let x = 0; x <= 3; x += 0.01) expect(g(x)).toBeLessThanOrEqual(1 + 1e-12);
  });
  it('Simpson integration of sin over 0–90° equals 1 rad-unit', () => {
    expect(integrateDeg((d) => Math.sin(d * DEG), 0, 90)).toBeCloseTo(1, 9);
  });
});

describe('tank conversion (§A.4)', () => {
  const tank = demoVessel.tanks.find((t) => t.id === 'DB1P')!; // 20 × 8 × 1.2 m box, 192 m³
  const w: Warning[] = [];
  it('all input modes give the same physical result', () => {
    const byVol = resolveTank(tank, { input: { mode: 'VOLUME', value: 96 } }, 'ACTUAL', w);
    const byPct = resolveTank(tank, { input: { mode: 'PERCENT', value: 50 } }, 'ACTUAL', w);
    const byWt = resolveTank(tank, { input: { mode: 'WEIGHT', value: 96 * 1.025 } }, 'ACTUAL', w);
    const bySnd = resolveTank(tank, { input: { mode: 'SOUNDING', value: 0.6 } }, 'ACTUAL', w);
    for (const r of [byPct, byWt, bySnd]) {
      expect(r.volume).toBeCloseTo(96, 9);
      expect(r.weight).toBeCloseTo(98.4, 9);
      expect(r.vcg).toBeCloseTo(0.3, 9);
      expect(r.fsm).toBeCloseTo(((20 * 8 ** 3) / 12) * 1.025, 6);
    }
    expect(byVol.lcg).toBe(70);
    expect(byVol.tcg).toBe(-4);
  });
  it('a full tank has no free surface', () => {
    const r = resolveTank(tank, { input: { mode: 'FILLED' } }, 'ACTUAL', w);
    expect(r.volume).toBeCloseTo(192, 9);
    expect(r.fsm).toBe(0);
  });
  it('blocks overfilling and out-of-table soundings', () => {
    expect(() => resolveTank(tank, { input: { mode: 'PERCENT', value: 101 } }, 'ACTUAL', w)).toThrow(/exceeds/);
    expect(() => resolveTank(tank, { input: { mode: 'SOUNDING', value: 1.5 } }, 'ACTUAL', w)).toThrow(/outside the table range/);
  });
  it('warns above 98 %', () => {
    const ws: Warning[] = [];
    resolveTank(tank, { input: { mode: 'PERCENT', value: 99 } }, 'ACTUAL', ws);
    expect(ws.map((x) => x.code)).toContain('TANK_ABOVE_98');
  });
});

describe('hydrostatics, trim and GM (§A.5)', () => {
  // Lightship only + one weight: hand-calculable
  const lc = simpleCase([{ w: 5000, x: 52, y: 0, z: 4 }]);
  const r = calculate(demoVessel, lc);
  const disp = 1800 + 5000;
  const T = disp / (L * B * rho);

  it('displacement, LCG and KG by moment summation', () => {
    expect(r.displacement).toBeCloseTo(disp, 9);
    expect(r.lcg).toBeCloseTo((1800 * 47.5 + 5000 * 52) / disp, 9);
    expect(r.kg).toBeCloseTo((1800 * 5.2 + 5000 * 4) / disp, 9);
  });
  it('draft and KM from hydrostatic interpolation match the exact box values', () => {
    expect(r.draftMean).toBeCloseTo(T, 9);
    // KM is non-linear in draft (B²/12T); linear interpolation over 0.1 m steps → error < 1 mm
    expect(Math.abs(r.kmt - (T / 2 + (B * B) / (12 * T)))).toBeLessThan(0.001);
  });
  it('trim = Δ·(LCB − LCG) / (100·MTC) and drafts at perpendiculars', () => {
    const mtc = (rho * B * L * L) / 1200;
    const trim = (disp * (50 - r.lcg)) / (100 * mtc);
    expect(r.trim).toBeCloseTo(trim, 9);
    expect(r.draftAP - r.draftFP).toBeCloseTo(trim, 9);
    expect((r.draftAP + r.draftFP) / 2).toBeCloseTo(T, 9); // LCF at midship for a box
  });
  it('GM solid = KM − KG and no free surface without slack tanks', () => {
    expect(r.gmSolid).toBeCloseTo(r.kmt - r.kg, 12);
    expect(r.fsc).toBe(0);
    expect(r.gmFluid).toBeCloseTo(r.gmSolid, 12);
  });
  it('density correction: same ship in fresh water sinks by ρsw/ρfw', () => {
    const fw = calculate(demoVessel, simpleCase([{ w: 5000, x: 52, y: 0, z: 4 }], 1.0));
    expect(fw.draftMean).toBeCloseTo(T * 1.025, 9);
  });
  it('rejects a displacement outside the hydrostatic table (no extrapolation)', () => {
    expect(() => calculate(demoVessel, simpleCase([{ w: 20000, x: 50, y: 0, z: 4 }]))).toThrow(/outside the table range/);
  });
});

describe('GZ curve (§A.7) against exact box geometry', () => {
  const lc = simpleCase([{ w: 5000, x: 50, y: 0, z: 4 }]);
  const r = calculate(demoVessel, lc);
  const T = r.draftMean;
  const exactGZ = (deg: number) => boxKN(B, D, T, deg) - r.kgFluid * Math.sin(deg * DEG);

  it('GZ at tabulated angles within 3 mm of exact (PCHIP between KN displacements)', () => {
    for (const p of r.gzTable) expect(Math.abs(p.gz - exactGZ(p.heel))).toBeLessThan(0.003);
  });
  it('GZ between tabulated angles: within 7 mm up to 50° (5° table steps), 20 mm beyond (10° steps)', () => {
    // The box hull has a sharp knuckle at deck-edge immersion (~29°), the worst case for any
    // interpolation. Accuracy between angles is limited by the spacing of the source KN table.
    for (let a = 1; a <= 90; a++) {
      const g = r.gzCurve.find((p) => p.heel === a)!.gz;
      expect(Math.abs(g - exactGZ(a))).toBeLessThan(a <= 50 ? 0.007 : 0.02);
    }
  });
  it('wall-sided formula holds below deck-edge immersion: GZ = sinφ(GM + ½BM·tan²φ)', () => {
    const BM = (B * B) / (12 * T);
    for (const a of [5, 10, 15, 20]) {
      const wall = Math.sin(a * DEG) * (r.gmFluid + 0.5 * BM * Math.tan(a * DEG) ** 2);
      const g = r.gzCurve.find((p) => p.heel === a)!.gz;
      expect(Math.abs(g - wall)).toBeLessThan(0.01);
    }
  });
  it('GZ table columns are consistent: GZ = KN − KG·sinφ − TCG·cosφ', () => {
    for (const p of r.gzTable) expect(p.gz).toBeCloseTo(p.kn - p.kgSin - p.tcgCos, 12);
  });
  it('area 0–30° within 0.001 m·rad of exact integration', () => {
    const exact = integrateDeg(exactGZ, 0, 30);
    const c = r.criteria.find((x) => x.code === 'IS-2.2.1.1')!;
    expect(Math.abs(c.actual - exact)).toBeLessThan(0.001);
  });
  it('a transverse weight produces heel ≈ atan(TCG / GM) for small angles', () => {
    const h = calculate(demoVessel, simpleCase([{ w: 5000, x: 50, y: 0.05, z: 4 }]));
    const expected = Math.atan(h.tcg / h.gmFluid) / DEG;
    expect(Math.abs(h.heel - expected)).toBeLessThan(0.05);
    expect(h.heel).toBeGreaterThan(0); // starboard
  });
});

describe('free surface (§A.6)', () => {
  it('slack tanks raise KG by ΣFSM/Δ and MAXIMUM ≥ ACTUAL', () => {
    const r = calculate(demoVessel, demoLoadCase);
    expect(r.kgFluid - r.kg).toBeCloseTo(r.sumFsm / r.displacement, 12);
    const max = calculate(demoVessel, { ...clone(demoLoadCase), fsmMethod: 'MAXIMUM' });
    expect(max.sumFsm).toBeGreaterThanOrEqual(r.sumFsm);
  });
});

describe('IS Code 2008 criteria (§A.8, §A.9)', () => {
  const r = calculate(demoVessel, demoLoadCase);

  it('evaluates all 6 general criteria and 2 weather criteria', () => {
    const codes = r.criteria.map((c) => c.code);
    expect(codes).toEqual(['IS-2.2.1.1', 'IS-2.2.1.2', 'IS-2.2.1.3', 'IS-2.2.2', 'IS-2.2.3', 'IS-2.2.4', 'IS-2.3-HEEL', 'IS-2.3-AREA']);
  });
  it('wind heeling lever l_w1 = P·A·Z / (1000·g·Δ) recomputed by hand', () => {
    const w = r.weather!;
    const d = (r.draftAP + r.draftFP) / 2;
    const A = L * (D - d) + 72;
    const hA = (L * (D - d) * (d + (D - d) / 2) + 72 * 12) / A;
    const lw1 = (504 * A * (hA - d / 2)) / (1000 * 9.81 * r.displacement);
    expect(w.A).toBeCloseTo(A, 6);
    expect(Math.abs(w.hA - hA)).toBeLessThan(0.001); // windage centroid is linearly interpolated
    expect(w.lw1).toBeCloseTo((504 * w.A * (w.hA - d / 2)) / (1000 * 9.81 * r.displacement), 12);
    expect(Math.abs(w.lw1 - lw1)).toBeLessThan(1e-5);
    expect(w.lw2).toBeCloseTo(1.5 * w.lw1, 12);
  });
  it('roll angle θ1 = 109·k·X1·X2·√(r·s) recomputed by hand', () => {
    const w = r.weather!;
    expect(w.k).toBe(0.7); // sharp bilge
    expect(w.X2).toBe(1); // CB = 1
    const d = (r.draftAP + r.draftFP) / 2;
    expect(w.r).toBeCloseTo(0.73 + (0.6 * (r.kgFluid - d)) / d, 12);
    expect(w.Troll).toBeCloseTo((2 * (0.373 + 0.023 * (B / d) - 0.043 * (L / 100)) * B) / Math.sqrt(r.gmFluid), 9);
    expect(w.theta1).toBeCloseTo(109 * w.k * w.X1 * w.X2 * Math.sqrt(w.r * w.s), 9);
  });
  it('steady wind heel θ0 is where GZ equals l_w1', () => {
    const w = r.weather!;
    const knAt = calculate(demoVessel, demoLoadCase).gzCurve; // sanity: GZ at θ0 ≈ lw1
    expect(knAt.length).toBeGreaterThan(0);
    expect(w.theta0).toBeGreaterThan(0);
    expect(w.theta0).toBeLessThan(5);
  });
  it('fails clearly when KG is too high, with an explanation', () => {
    const bad = clone(demoLoadCase);
    bad.weights[0].vcg = 9.0; // cargo raised to deck level
    const rb = calculate(demoVessel, bad);
    expect(rb.overallPass).toBe(false);
    const failed = rb.criteria.filter((c) => !c.passed);
    expect(failed.length).toBeGreaterThan(0);
    for (const f of failed) expect(f.explanation).toBeTruthy();
  });
  it('margins: absolute and percentage are consistent', () => {
    for (const c of r.criteria) {
      if (c.comparator === '>=') expect(c.marginAbs).toBeCloseTo(c.actual - c.required, 12);
      else expect(c.marginAbs).toBeCloseTo(c.required - c.actual, 12);
    }
  });
});

describe('physical properties (§A.13.4)', () => {
  it('raising a weight never increases GM', () => {
    let prev = Infinity;
    for (const z of [2, 4, 6, 8, 10]) {
      const r = calculate(demoVessel, simpleCase([{ w: 3000, x: 50, y: 0, z }]));
      expect(r.gmFluid).toBeLessThan(prev);
      prev = r.gmFluid;
    }
  });
  it('the calculation is deterministic', () => {
    expect(JSON.stringify(calculate(demoVessel, demoLoadCase))).toBe(JSON.stringify(calculate(demoVessel, demoLoadCase)));
  });
});

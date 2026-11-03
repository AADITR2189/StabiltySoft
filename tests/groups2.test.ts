// Approved criteria groups (catalogue round 1): checked against hand calculations / independent routes.
import { describe, expect, it } from 'vitest';
import { calculate } from '../src/engine/stability';
import { integrateDeg } from '../src/engine/math';
import { demoLoadCase, demoVessel } from '../src/data/demoVessel';
import { VESSELS } from '../src/data/vessels';
import type { CriteriaLibrary, LoadCase } from '../src/engine/types';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const DEG = Math.PI / 180;
const base = (groups: string[], ops: LoadCase['ops'] = {}): LoadCase => ({ ...clone(demoLoadCase), criteriaGroups: groups, ops });

describe('passenger ships (IS Code 2008 A 3.1)', () => {
  const ops = { passengers: { count: 200, massEach: 0.075, lever: 5 }, serviceSpeedKnots: 12 };
  const lib: CriteriaLibrary = {
    criteria: [{ id: 'U', name: 'u', kind: 'HEEL_MOMENT', comparator: '<=', required: 10, params: { momentId: 'GROUP' } }],
    groups: [{ id: 'G', name: 'g', regulation: '', description: '', chart: 'GENERAL', criterionIds: ['U'], momentIds: ['M'] }],
    moments: [{ id: 'M', name: 'crowd', result: 'MOMENT', formula: 'N*w*y*cos(theta)', vars: [
      { name: 'N', source: 'VALUE', value: 200 }, { name: 'w', source: 'VALUE', value: 0.075 }, { name: 'y', source: 'VALUE', value: 5 }, { name: 'theta', source: 'HEEL' }] }],
  };
  const r = calculate(demoVessel, base(['IS2008_PAX', 'G'], ops), lib);
  const pax = r.groups.find((g) => g.id === 'IS2008_PAX')!;
  it('crowding heel equals the same moment entered as a user formula', () => {
    expect(pax.criteria[0].actual).toBeCloseTo(r.groups.find((g) => g.id === 'G')!.criteria[0].actual, 6);
    expect(pax.moments.find((m) => m.id === 'pax-crowd')!.rows[0].moment).toBeCloseTo(200 * 0.075 * 5, 9);
  });
  it('turning arm = 0.2·v²/(g·L)·(KG − d/2) at 0°, times cos θ', () => {
    const v = 12 * 0.514444, L = 100, d = (r.draftAP + r.draftFP) / 2;
    const arm0 = (0.2 * v * v / L) * (r.kg - d / 2) / 9.81;
    const m = pax.moments.find((x) => x.id === 'pax-turn')!;
    expect(m.rows[0].arm).toBeCloseTo(arm0, 10);
    expect(m.rows.find((x) => x.heel === 30)!.arm).toBeCloseTo(arm0 * Math.cos(30 * DEG), 10);
    expect(pax.passed).toBe(true);
  });
  it('fails with a reason when the passenger data is missing', () => {
    const x = calculate(demoVessel, base(['IS2008_PAX'], {}));
    expect(x.groups[0].passed).toBe(false);
    expect(x.groups[0].error).toMatch(/passengers/);
  });
});

describe('grain (International Grain Code)', () => {
  const ops = { grain: { holds: [{ name: '1', vhm: 3000, sf: 1.3 }, { name: '2', vhm: 4500, sf: 1.4 }], deckEdgeLimit: true } };
  const r = calculate(demoVessel, base(['GRAIN'], ops));
  const g = r.groups[0];
  const l0 = (3000 / 1.3 + 4500 / 1.4) / r.displacement;
  it('λ0 = Σ(VHM/SF)/Δ and λ40 = 0.8·λ0', () => {
    const m = g.moments[0];
    expect(m.rows[0].arm).toBeCloseTo(l0, 10);
    expect(m.rows.find((x) => x.heel === 40)!.arm).toBeCloseTo(0.8 * l0, 10);
  });
  it('heel, residual area and GM criteria are evaluated, GM against 0.30 m', () => {
    expect(g.criteria.map((c) => c.code)).toEqual(['GRAIN-1', 'GRAIN-2', 'GRAIN-3']);
    expect(g.criteria[2].required).toBe(0.3);
    expect(g.criteria[2].actual).toBeCloseTo(r.gmFluid, 12);
    expect(g.criteria[0].actual).toBeGreaterThan(0);
  });
});

describe('pontoons (IS Code 2008 B 2.2)', () => {
  const r = calculate(demoVessel, base(['PONTOON']));
  const g = r.groups[0];
  it('wind lever = 540·A·Z/(1000·g·Δ) and half-freeboard limit angle', () => {
    const m = g.moments[0];
    const w = r.groups[0].moments[0].inputs;
    const A = w.find((i) => i.name === 'A')!.value!, Z = w.find((i) => i.name === 'Z')!.value!;
    expect(m.rows[0].arm).toBeCloseTo((540 * A * Z) / (1000 * 9.81 * r.displacement), 12);
    const fb = 9 - Math.max(r.draftAP, r.draftFP);
    expect(g.criteria[1].required).toBeCloseTo(Math.atan((fb / 2) / 8) / DEG, 9);
    expect(g.criteria[2].code).toBe('PONT-3');
  });
});

describe('MODU (MODU Code 2009)', () => {
  it('area ratio = ∫GZ / ∫lw to the 2nd intercept or θf, limit 1.4 or 1.3', () => {
    const r = calculate(demoVessel, base(['MODU'], { modu: { unitType: 'SURFACE', windSpeed: 36, coefficient: 1.0 } }));
    const g = r.groups[0];
    const lw = g.moments[0].rows[0].arm;
    expect(g.criteria[0].required).toBe(1.4);
    const lim = Math.min(r.floodAngle, 90);
    const gz = (x: number) => { const i = Math.floor(x); const a = r.gzCurve[i], b = r.gzCurve[Math.min(i + 1, r.gzCurve.length - 1)]; return a.gz + (x - i) * (b.gz - a.gz); };
    const ratio = integrateDeg(gz, 0, lim) / integrateDeg(() => lw, 0, lim);
    expect(Math.abs(g.criteria[0].actual - ratio) / ratio).toBeLessThan(0.01);
    const c = calculate(demoVessel, base(['MODU'], { modu: { unitType: 'COLUMN', windSpeed: 51.5, coefficient: 1.0 } }));
    expect(c.groups[0].criteria[0].required).toBe(1.3);
  });
});

describe('lifting 2.9.3 freeboard and other options', () => {
  const marsol = VESSELS.find((v) => v.id === 'marsol-splendor')!;
  const crane = marsol.defaultLoadCases.find((c) => c.id === 'marsol-C2T')!;
  it('freeboard = D − max(T_AP, T_FP) − (B/2)·tan φ1; limit 0.5 m sheltered, max(1.0, 0.75·Hs) exposed', () => {
    const r = calculate(marsol.vessel, { ...crane, criteriaGroups: ['LIFT_293'], ops: { lifting: { exposed: true, hs: 2 } } });
    const c5 = r.groups[0].criteria.find((c) => c.code === 'CRANE-5')!;
    expect(c5.required).toBe(1.5);
    expect(c5.actual).toBeCloseTo(5.3 - Math.max(r.draftAP, r.draftFP) - 8.4 * Math.tan(r.crane!.phi1 * DEG), 9);
    const s = calculate(marsol.vessel, { ...crane, criteriaGroups: ['LIFT_293'] });
    expect(s.groups[0].criteria.find((c) => c.code === 'CRANE-5')!.required).toBe(0.5);
  });
  it('reduced wind pressure scales the wind levers and gives a warning', () => {
    const a = calculate(demoVessel, base(['IS2008_WEATHER']));
    const b = calculate(demoVessel, base(['IS2008_WEATHER'], { windPressure: 252 }));
    expect(b.weather!.lw1).toBeCloseTo(a.weather!.lw1 / 2, 12);
    expect(b.warnings.map((w) => w.code)).toContain('REDUCED_WIND_PRESSURE');
  });
  it('A.167 and A.749 groups evaluate with the same values as IS Code 2008', () => {
    const r = calculate(demoVessel, base(['IS2008_GENERAL', 'IMO_A167', 'IMO_A749']));
    const is = r.groups[0].criteria.map((c) => c.actual);
    expect(r.groups[1].criteria.map((c) => c.actual)).toEqual(is);
    expect(r.groups[2].criteria.slice(0, 6).map((c) => c.actual)).toEqual(is);
  });
});

describe('DDS 079-1 style ratio criteria (user moment)', () => {
  const lib: CriteriaLibrary = {
    moments: [{ id: 'W', name: 'beam wind', result: 'ARM', formula: 'a*cos(theta)^2', vars: [{ name: 'a', source: 'VALUE', value: 0.2 }, { name: 'theta', source: 'HEEL' }] }],
    criteria: [
      { id: 'R1', name: 'arm/GZmax', kind: 'ARM_GZMAX_RATIO', comparator: '<=', required: 0.6, params: { momentId: 'GROUP' } },
      { id: 'R2', name: 'A1/A2', kind: 'RESERVE_RATIO', comparator: '>=', required: 1.4, params: { momentId: 'GROUP', angle: 25, to: 70, capAtFlood: true } },
    ],
    groups: [{ id: 'N', name: 'navy', regulation: '', description: '', chart: 'GENERAL', criterionIds: ['R1', 'R2'], momentIds: ['W'] }],
  };
  it('arm at equilibrium ÷ GZmax and A1/A2 are computed', () => {
    const r = calculate(demoVessel, base(['N']), lib);
    const g = r.groups[0];
    const eqAngle = Number(/\(([\d.]+)°\)/.exec(g.criteria[0].description)![1]);
    expect(g.criteria[0].actual).toBeCloseTo((0.2 * Math.cos(eqAngle * DEG) ** 2) / r.gzMax, 3);
    expect(g.criteria[1].actual).toBeGreaterThan(1);
  });
});

describe('IMO A.562(14) weather criterion (1985)', () => {
  it('P = 0.0514 t/m²: wind lever = IS 2008 lever × (0.0514·9.81·1000 / 504); same θ1; θ0 limit is a guide value', () => {
    const r = calculate(demoVessel, base(['IS2008_WEATHER', 'IMO_A562']));
    const is = r.groups[0], a = r.groups[1];
    expect(a.criteria.map((c) => c.code)).toEqual(['A562-HEEL', 'A562-AREA']);
    expect(a.criteria[0].description).toMatch(/guide value/);
    const lwIS = is.moments[1].rows[0].arm;             // steady lever, IS 2008
    const solo = calculate(demoVessel, base(['IMO_A562']));
    expect(solo.weather!.lw1).toBeCloseTo(lwIS * (0.0514 * 9.81 * 1000) / 504, 12);
    expect(solo.weather!.theta1).toBeCloseTo(r.weather!.theta1, 12);
    expect(Math.abs(a.criteria[1].actual - is.criteria[1].actual)).toBeLessThan(0.001);
  });
});

describe('adjustable wind values', () => {
  it('pontoon wind pressure scales the lever and warns when not 540 N/m²', () => {
    const a = calculate(demoVessel, base(['PONTOON']));
    const b = calculate(demoVessel, base(['PONTOON'], { pontoonWindPressure: 270 }));
    expect(b.groups[0].moments[0].rows[0].arm).toBeCloseTo(a.groups[0].moments[0].rows[0].arm / 2, 12);
    expect(b.warnings.map((w) => w.code)).toContain('PONTOON_WIND_CHANGED');
  });
  it('crane wind speed: lever scales with V²', () => {
    const marsol = VESSELS.find((v) => v.id === 'marsol-splendor')!;
    const lc = marsol.defaultLoadCases.find((c) => c.id === 'marsol-C2T')!;
    const a = calculate(marsol.vessel, { ...lc, criteriaGroups: ['CRANE_OPS'] });
    const b = calculate(marsol.vessel, { ...lc, criteriaGroups: ['CRANE_OPS'], ops: { craneWindKnots: 40 } });
    expect(b.crane!.lw).toBeCloseTo(a.crane!.lw * 4, 12);
    expect(b.warnings.map((w) => w.code)).toContain('CRANE_WIND_CHANGED');
  });
});

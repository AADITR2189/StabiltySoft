// User-defined heeling moments: formula parser and moment-based criteria.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { evaluate, parseFormula } from '../src/engine/formula';
import { calculate } from '../src/engine/stability';
import { vesselFromBooklet, type BookletExtract } from '../src/data/fromBooklet';
import { VESSELS } from '../src/data/vessels';
import type { CriteriaLibrary } from '../src/engine/types';

describe('formula parser', () => {
  it('follows normal precedence, brackets and powers', () => {
    expect(evaluate(parseFormula('2 + 3 * 4'), {})).toBe(14);
    expect(evaluate(parseFormula('(2 + 3) * 4'), {})).toBe(20);
    expect(evaluate(parseFormula('-2^2'), {})).toBe(-4);
    expect(evaluate(parseFormula('2^3^2'), {})).toBe(512);
  });
  it('uses degrees in trigonometric functions', () => {
    expect(evaluate(parseFormula('cos(60)'), {})).toBeCloseTo(0.5, 12);
    expect(evaluate(parseFormula('sin(theta)'), { theta: 30 })).toBeCloseTo(0.5, 12);
  });
  it('lists the symbols to be linked, in order of appearance', () => {
    expect(parseFormula('(n*R*(h - T/2) + S*(T/2 - e))*cos(theta)').variables).toEqual(['n', 'R', 'h', 'T', 'S', 'e', 'theta']);
  });
  it('rejects anything that is not arithmetic', () => {
    expect(() => parseFormula('alert(1)')).toThrow(/Unknown function/);
    expect(() => parseFormula('a; b')).toThrow(/not allowed/);
    expect(() => parseFormula('2 +')).toThrow();
    expect(() => evaluate(parseFormula('1/x'), { x: 0 })).toThrow(/Division by zero/);
    expect(() => evaluate(parseFormula('a*b'), { a: 1 })).toThrow(/No value for "b"/);
  });
});

describe('user-defined moment reproduces the built-in fire-fighting criterion', () => {
  const ex = JSON.parse(readFileSync('vessels/marsol-splendor/marsol-splendor.extracted.json', 'utf8'));
  const vessel = vesselFromBooklet(ex as BookletExtract);
  const lc = VESSELS.find((v) => v.id === 'marsol-splendor')!.defaultLoadCases.find((c) => c.id === 'marsol-C2')!;
  const lib: CriteriaLibrary = {
    moments: [{
      id: 'M-FIFI', name: 'FIFI (user formula)', result: 'MOMENT',
      formula: '(n*R*(h - T/2) + S*(T/2 - e))*cos(theta)',
      vars: [
        { name: 'n', source: 'VALUE', value: 2 }, { name: 'R', source: 'VALUE', value: 1.53, unit: 't' },
        { name: 'h', source: 'VALUE', value: 19.6, unit: 'm' }, { name: 'S', source: 'VALUE', value: 18, unit: 't' },
        { name: 'e', source: 'VALUE', value: 1.2, unit: 'm' }, { name: 'T', source: 'DRAFT_MS' }, { name: 'theta', source: 'HEEL' },
      ],
    }],
    criteria: [
      { id: 'U-FIFI', name: 'Heel under FIFI < 5', kind: 'HEEL_MOMENT', comparator: '<=', required: 5, params: { momentId: 'M-FIFI' } },
      { id: 'U-RES', name: 'Residual area to 40', kind: 'RESID_AREA', comparator: '>=', required: 0.09, params: { momentId: 'M-FIFI', to: 40, capAtFlood: true } },
    ],
    groups: [{ id: 'G-U', name: 'User FIFI', regulation: '', description: '', chart: 'GENERAL', criterionIds: ['U-FIFI', 'U-RES'] }],
  };
  const r = calculate(vessel, { ...lc, criteriaGroups: ['BV_FIFI', 'G-U'] }, lib);
  const builtin = r.groups.find((g) => g.id === 'BV_FIFI')!;
  const user = r.groups.find((g) => g.id === 'G-U')!;

  it('same equilibrium heel as the built-in group', () => {
    expect(user.criteria[0].actual).toBeCloseTo(builtin.criteria[0].actual, 6);
  });
  it('moment table: moment at 0° equals the booklet value 69.75 t·m (cond. 2) and arm = M/Δ', () => {
    const m = user.moments[0];
    expect(m.rows[0].moment!).toBeCloseTo(69.75, 1);
    for (const row of m.rows) expect(row.arm).toBeCloseTo(row.moment! / r.displacement, 12);
    expect(m.inputs.find((i) => i.name === 'T')!.source).toMatch(/draft at midship/);
  });
  it('group GZ table carries the heeling arm and residual arm', () => {
    const row = user.table.find((t) => t.heel === 20)!;
    expect(row.arms[0]).toBeCloseTo(user.moments[0].rows.find((x) => x.heel === 20)!.arm, 12);
    expect(row.residual!).toBeCloseTo(row.gz - row.arms[0], 12);
  });
  it('built-in groups also get their own GZ and moment tables', () => {
    expect(builtin.moments[0].rows.length).toBeGreaterThan(5);
    expect(builtin.table.length).toBe(user.table.length);
  });
  it('an unlinked symbol makes the group fail with a clear reason', () => {
    const bad: CriteriaLibrary = { ...lib, moments: [{ ...lib.moments![0], vars: lib.moments![0].vars.filter((v) => v.name !== 'e') }] };
    const x = calculate(vessel, { ...lc, criteriaGroups: ['G-U'] }, bad);
    expect(x.groups[0].passed).toBe(false);
    expect(x.groups[0].error).toMatch(/"e" .* not linked/);
  });
});

describe('several moments connected to a group (combined heeling moment)', () => {
  const ex = JSON.parse(readFileSync('vessels/marsol-splendor/marsol-splendor.extracted.json', 'utf8'));
  const vessel = vesselFromBooklet(ex as BookletExtract);
  const lc = VESSELS.find((v) => v.id === 'marsol-splendor')!.defaultLoadCases.find((c) => c.id === 'marsol-C2')!;
  const lib: CriteriaLibrary = {
    moments: [
      { id: 'MON', name: 'Fire monitors', result: 'MOMENT', formula: 'n*R*(h - T/2)*cos(theta)', vars: [
        { name: 'n', source: 'VALUE', value: 2 }, { name: 'R', source: 'VALUE', value: 1.53 }, { name: 'h', source: 'VALUE', value: 19.6 },
        { name: 'T', source: 'DRAFT_MS' }, { name: 'theta', source: 'HEEL' }] },
      { id: 'THR', name: 'Bow thruster', result: 'MOMENT', formula: 'S*(T/2 - e)*cos(theta)', vars: [
        { name: 'S', source: 'VALUE', value: 18 }, { name: 'e', source: 'VALUE', value: 1.2 }, { name: 'T', source: 'DRAFT_MS' }, { name: 'theta', source: 'HEEL' }] },
    ],
    criteria: [{ id: 'C-G', name: 'Heel under group moment', kind: 'HEEL_MOMENT', comparator: '<=', required: 5, params: { momentId: 'GROUP' } }],
    groups: [
      { id: 'G-SUM', name: 'FIFI from two moments', regulation: '', description: '', chart: 'GENERAL', criterionIds: ['C-G'], momentIds: ['MON', 'THR'] },
      { id: 'G-NONE', name: 'No moment connected', regulation: '', description: '', chart: 'GENERAL', criterionIds: ['C-G'] },
    ],
  };
  const r = calculate(vessel, { ...lc, criteriaGroups: ['BV_FIFI', 'G-SUM', 'G-NONE'] }, lib);
  const sum = r.groups.find((g) => g.id === 'G-SUM')!;

  it('combined moment of two connected moments equals the built-in fire-fighting result', () => {
    expect(sum.passed).toBe(true);
    expect(sum.criteria[0].actual).toBeCloseTo(r.groups.find((g) => g.id === 'BV_FIFI')!.criteria[0].actual, 6);
  });
  it('the group shows the combined table first, then each connected moment', () => {
    expect(sum.moments.map((m) => m.name)).toEqual(['Combined heeling moment (Fire monitors + Bow thruster)', 'Fire monitors', 'Bow thruster']);
    expect(sum.moments[0].rows[0].moment!).toBeCloseTo(69.75, 1);
    for (const row of sum.table) {
      expect(row.arms[0]).toBeCloseTo(row.arms[1] + row.arms[2], 12); // total = sum of parts
      expect(row.residual!).toBeCloseTo(row.gz - row.arms[0], 12);
    }
  });
  it('a group-moment criterion in a group without connected moments fails with a reason', () => {
    const g = r.groups.find((x) => x.id === 'G-NONE')!;
    expect(g.passed).toBe(false);
    expect(g.error).toMatch(/no heeling moment is connected/);
  });
});

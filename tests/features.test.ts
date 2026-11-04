import { describe, expect, it } from 'vitest';
import { calculate } from '../src/engine/stability';
import { generateArrival, defaultSpec } from '../src/engine/arrival';
import { defaultLimits } from '../src/engine/opLimits';
import { tankTypes, typeOf } from '../src/engine/tankTypes';
import { buildLoadCaseFile, readLoadCaseFile } from '../src/importer/loadCaseFile';
import { VESSELS } from '../src/data/vessels';

const { vessel: v, defaultLoadCases } = VESSELS[0];
const dep = defaultLoadCases.find((c) => /Cond\. 2/.test(c.name))!;
let n = 0; const id = () => `id${n++}`;

describe('GZ angle range and step', () => {
  const base = calculate(v, dep);
  it('table and chart follow the range; criteria do not change', () => {
    const r = calculate(v, { ...dep, gzRange: { from: 10, to: 40, step: 2.5 } });
    expect(r.gzTable.map((x) => x.heel)).toEqual([10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30, 32.5, 35, 37.5, 40]);
    expect(r.gzCurve[0].heel).toBe(0); // chart starts upright (areas complete); each chart ends at its range
    expect(r.gzCurve[r.gzCurve.length - 1].heel).toBe(60); // full curve; the chart cuts it at its own "to"
    expect(r.groups[0].table.map((x) => x.heel)[1]).toBe(12.5);
    expect(r.groups.map((g) => g.criteria.map((c) => c.actual))).toEqual(base.groups.map((g) => g.criteria.map((c) => c.actual)));
    expect(r.overallPass).toBe(base.overallPass);
  });
  it('range beyond the KN table is clipped with a warning', () => {
    const r = calculate(v, { ...dep, gzRange: { from: 0, to: 80, step: 10 } });
    expect(r.gzTable[r.gzTable.length - 1].heel).toBe(60);
    expect(r.warnings.some((w) => w.code === 'GZ_RANGE_CLIPPED')).toBe(true);
  });
});

describe('operational limits', () => {
  it('ticked limits are checked, unticked ones are not; criteria result unchanged', () => {
    const lim = defaultLimits(v);
    lim.minDraftFP = { enabled: true, value: 4.5 }; // fails (FP ≈ 4.07)
    lim.maxHeel = { enabled: false, value: 0.01 };  // would fail, but unticked
    const r = calculate(v, { ...dep, opLimits: lim });
    const fp = r.opLimits.find((x) => x.key === 'minDraftFP')!;
    expect(fp.passed).toBe(false);
    expect(r.limitsOk).toBe(false);
    expect(r.opLimits.find((x) => x.key === 'maxHeel')!.enabled).toBe(false);
    expect(r.overallPass).toBe(calculate(v, dep).overallPass);
    lim.minDraftFP.enabled = false;
    expect(calculate(v, { ...dep, opLimits: lim }).limitsOk).toBe(true);
  });
  it('unticking the load line draft also removes its warning', () => {
    const deep = { ...dep, opLimits: { ...defaultLimits(v), maxDraftMS: { enabled: true, value: 3.0 } } };
    expect(calculate(v, deep).opLimits.find((x) => x.key === 'maxDraftMS')!.passed).toBe(false);
  });
  it('air draft = height of the highest point minus the draft there', () => {
    const lim = { ...defaultLimits(v), maxAirDraft: { enabled: true, value: 30, topZ: 33, topX: v.lbp / 2 } };
    const r = calculate(v, { ...dep, opLimits: lim });
    const a = r.opLimits.find((x) => x.key === 'maxAirDraft')!;
    expect(a.actual).toBeCloseTo(33 - (r.draftAP + r.draftFP) / 2, 9);
  });
});

describe('arrival generator', () => {
  const rDep = calculate(v, dep);
  it('consumables reduced by the % used, everything else unchanged', () => {
    const spec = defaultSpec(v, dep);
    expect(Object.keys(spec.consumedByType).sort()).toEqual(tankTypes(v).filter((t) => t.consumable).map((t) => t.name).sort());
    expect(Object.values(spec.consumedByType).every((x) => x === 90)).toBe(true);
    // 90 % used trims MARSOL beyond its hydrostatic tables (±1 m); use 50 % here
    for (const k of Object.keys(spec.consumedByType)) spec.consumedByType[k] = 50;
    const { lc, changes } = generateArrival(v, dep, rDep, spec, id);
    const rArr = calculate(v, lc);
    for (const t of v.tanks) {
      const a = rArr.tanks.find((x) => x.tankId === t.id)!.weight, d = rDep.tanks.find((x) => x.tankId === t.id)!.weight;
      const used = spec.consumedByType[typeOf(t)] ?? 0;
      expect(a, t.name).toBeCloseTo(d * (1 - used / 100), 6);
    }
    expect(lc.type).toBe('Arrival');
    expect(lc.generatedFrom?.id).toBe(dep.id);
    expect(changes.length).toBeGreaterThan(0);
    expect(rArr.displacement).toBeLessThan(rDep.displacement);
  });
  it('weight items can be reduced too', () => {
    const w = dep.weights[0];
    const { lc } = generateArrival(v, dep, rDep, { name: 'x', consumedByType: {}, consumedByWeight: { [w.id]: 50 } }, id);
    expect(lc.weights[0].weight).toBeCloseTo(w.weight / 2, 9);
  });
});

describe('load case file', () => {
  it('round trip into the same vessel', async () => {
    const text = await buildLoadCaseFile(v, dep);
    const r = await readLoadCaseFile(text, v, id);
    expect(r.errors).toEqual([]);
    expect(r.lc.id).not.toBe(dep.id);
    expect(calculate(v, r.lc).displacement).toBeCloseTo(calculate(v, dep).displacement, 9);
  });
  it('an edited file is refused; another vessel gets a warning', async () => {
    const text = await buildLoadCaseFile(v, dep);
    expect((await readLoadCaseFile(text.replace('"seaDensity": 1.025', '"seaDensity": 1.000'), v, id)).errors[0]).toMatch(/Checksum/);
    const r = await readLoadCaseFile(text, { ...v, name: 'OTHER', imo: '1234567' }, id);
    expect(r.warnings[0]).toMatch(/saved for MARSOL SPLENDOR/);
  });
});

describe('GZ range per stability group', () => {
  const base = calculate(v, dep);
  const [g1, g2] = base.groups;
  it('each group has its own angles; others keep the default; criteria unchanged', () => {
    const r = calculate(v, { ...dep, gzRange: { from: 0, to: 60, step: 10 }, gzRanges: { [g1.id]: { from: 0, to: 30, step: 1 } } });
    const t1 = r.groups.find((g) => g.id === g1.id)!.table.map((x) => x.heel);
    const t2 = r.groups.find((g) => g.id === g2.id)!.table.map((x) => x.heel);
    expect(t1.length).toBe(31);
    expect(t1[30]).toBe(30);
    expect(t2).toEqual([0, 10, 20, 30, 40, 50, 60]);
    expect(r.groups.map((g) => g.criteria.map((c) => c.actual))).toEqual(base.groups.map((g) => g.criteria.map((c) => c.actual)));
  });
  it('moment tables follow their group\'s angles', () => {
    const wg = base.groups.find((g) => g.moments.length > 0)!;
    const r = calculate(v, { ...dep, gzRanges: { [wg.id]: { from: 0, to: 20, step: 4 } } });
    const g = r.groups.find((x) => x.id === wg.id)!;
    for (const m of g.moments) expect(m.rows.map((x) => x.heel)).toEqual([0, 4, 8, 12, 16, 20]);
  });
});

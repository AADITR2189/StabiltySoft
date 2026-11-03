// Benchmark: recalculate every loading condition of the MARSOL SPLENDOR booklet and
// compare with the booklet's printed results. Writes vessels/marsol-splendor/BENCHMARK.md.
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { calculate } from '../src/engine/stability';
import { vesselFromBooklet, type BookletExtract } from '../src/data/fromBooklet';
import type { LoadCase } from '../src/engine/types';

const DIR = 'vessels/marsol-splendor';
const ex = JSON.parse(readFileSync(`${DIR}/marsol-splendor.extracted.json`, 'utf8'));
const vessel = vesselFromBooklet(ex as BookletExtract);

interface Cond {
  id: string; name: string; pages: number[];
  floating: Record<string, number>;
  fixedWeights: { description: string; weight: number; lcg: number; tcg: number; vcg: number }[];
  tanks: { name: string; sg: number; percent: number; weight: number }[];
  gz: { heel: number; gz: number; area: number }[];
  criteria: { no: number; text: string; limit: number; actual: number; pass: boolean }[];
  fsmUsed: number[];
  weather: { steadyMoment: number | null; gustMoment: number | null; rollAngle: number | null };
}

function loadCase(c: Cond): LoadCase {
  return {
    id: c.id, name: c.name, type: 'Booklet', seaDensity: 1.025,
    fsmMethod: 'MANUAL_TOTAL', fsmTotal: c.fsmUsed[0] ?? 0,
    tanks: Object.fromEntries(c.tanks.map((t) => [t.name, { input: { mode: 'PERCENT' as const, value: t.percent }, density: t.sg }])),
    weights: c.fixedWeights.filter((w) => w.description !== 'LIGHT SHIP').map((w, i) => ({ id: `f${i}`, ...w })),
    criteriaGroups: ['OSV_INTACT', 'IS2008_WEATHER'],
  };
}

/** GZ at any heel (deg, + stbd) from the 1° curve; port side via GZ(−φ) = −GZ(φ) − 2·TCG·cos φ. */
function gzAt(r: ReturnType<typeof calculate>, heel: number): number {
  const a = Math.abs(heel);
  const i = Math.floor(a);
  const p0 = r.gzCurve[i], p1 = r.gzCurve[Math.min(i + 1, r.gzCurve.length - 1)];
  const g = p0.gz + (a - i) * (p1.gz - p0.gz);
  return heel >= 0 ? g : -g - 2 * r.tcg * Math.cos((heel * Math.PI) / 180);
}

const conditions: Cond[] = ex.conditions;
const rows: string[] = [];
const gzRows: string[] = [];
const critRows: string[] = [];
const wxRows: string[] = [];
const stats = { disp: 0, kg: 0, trim: 0, draft: 0, gm: 0, gz: 0, area: 0 };
const up = (k: keyof typeof stats, v: number) => { stats[k] = Math.max(stats[k], Math.abs(v)); };

describe('MARSOL SPLENDOR booklet benchmark', () => {
  for (const c of conditions) {
    it(`${c.id} ${c.name}`, () => {
      const r = calculate(vessel, loadCase(c));
      const f = c.floating;
      const dDisp = r.displacement - f.displacement;
      const dKg = r.kg - f.vcgSolid;
      const dTrim = r.trim - f.trim;
      const dMS = r.draftMS - f.draftMS;
      const dGM = r.gmFluid - f.gmFluid;
      up('disp', dDisp); up('kg', dKg); up('trim', dTrim); up('draft', dMS); up('gm', dGM);
      rows.push(`| ${c.id} | ${f.displacement.toFixed(1)} / ${r.displacement.toFixed(1)} | ${f.vcgSolid.toFixed(3)} / ${r.kg.toFixed(3)} | ${f.trim.toFixed(2)} / ${r.trim.toFixed(2)} | ${f.draftMS.toFixed(3)} / ${r.draftMS.toFixed(3)} | ${f.kmt.toFixed(3)} / ${r.kmt.toFixed(3)} | ${f.gmFluid.toFixed(3)} / ${r.gmFluid.toFixed(3)} | ${f.heel.toFixed(2)} / ${r.heel.toFixed(2)} |`);

      // GZ comparison (intact-criteria table of the booklet)
      const side = c.gz.length && c.gz[0].heel < 0 ? -1 : 1;
      let maxDz = 0;
      for (const p of c.gz) {
        if (Math.abs(p.heel) > 60) continue; // KN tables end at 60°
        const ours = side < 0 ? -gzAt(r, p.heel) : gzAt(r, p.heel);
        maxDz = Math.max(maxDz, Math.abs(ours - p.gz));
      }
      if (c.gz.length) {
        up('gz', maxDz);
        gzRows.push(`| ${c.id} | ${c.gz.length} | ${(maxDz * 1000).toFixed(0)} mm |`);
      }

      // OSV criteria comparison (booklet criteria no. 1–6 of the intact block)
      const osv = r.groups.find((g) => g.id === 'OSV_INTACT');
      const bk = c.criteria.filter((x) => x.no >= 1 && x.no <= 6).slice(0, 6);
      if (osv && bk.length === 6 && c.gz.length && side > 0) {
        const parts = osv.criteria.map((oc, i) => {
          const b = bk[i];
          if (oc.unit === 'm·rad') up('area', oc.actual - b.actual);
          const okSame = oc.passed === b.pass ? '' : ' **≠**';
          return `${b.actual} / ${oc.unit === '°' ? oc.actual.toFixed(2) : oc.actual.toFixed(3)}${okSame}`;
        });
        critRows.push(`| ${c.id} | ${parts.join(' | ')} |`);
        expect(osv.criteria.map((x) => x.passed)).toEqual(bk.map((x) => x.pass));
      }

      // Weather criterion comparison (sailing conditions)
      const bw = c.criteria.filter((x) => /Res\. Ratio|SSWEQ/.test(x.text));
      if (r.weather && c.weather.rollAngle && bw.length === 2) {
        const w = r.weather;
        const ratio = w.areaA > 0 ? w.areaB / w.areaA : NaN;
        const heelMargin = Math.min(16, 0.8 * r.deckEdgeAngle) - w.theta0;
        wxRows.push(`| ${c.id} | ${(c.weather.gustMoment! / f.displacement).toFixed(4)} / ${w.lw2.toFixed(4)} | ${c.weather.rollAngle.toFixed(2)} / ${w.theta1.toFixed(2)} | ${bw[0].actual.toFixed(3)} / ${ratio.toFixed(3)} | ${bw[1].actual.toFixed(2)} / ${heelMargin.toFixed(2)} | ${bw.every((x) => x.pass) ? 'PASS' : 'FAIL'} / ${r.groups.find((g) => g.id === 'IS2008_WEATHER')?.passed ? 'PASS' : 'FAIL'} |`);
      }

      expect(Math.abs(dDisp)).toBeLessThan(0.5);
      expect(Math.abs(dKg)).toBeLessThan(0.005);
    });
  }

  it('writes the benchmark report', () => {
    const md = `# Benchmark: MARSOL SPLENDOR (preliminary booklet DU5864/1022 Rev.0)

Generated by \`tests/marsol-benchmark.test.ts\`. Each condition is recalculated with the StabilitySoft
engine from the **extracted, not yet human-verified** booklet data and compared with the booklet's printed results.

**Inputs used:** tank fillings (%) and densities as listed in each condition, fixed weights, lightship, and
the booklet's total free surface moment (the booklet applies its own maximum-FSM rule; see notes).
**Method differences:** the booklet was produced with hull-geometry software (free trim while heeling,
GZ computed directly). StabilitySoft interpolates the booklet's own hydrostatic and cross-curve tables
(5 trims), so small differences are expected, mostly between the tabulated angles 5/10/20/30/40/50/60°.

## Floating position and initial stability (booklet / StabilitySoft)

| Cond | Displacement t | KG solid m | Trim m (+aft) | Draft MS m | KMT m | GM fluid m | Heel ° (+stbd) |
|---|---|---|---|---|---|---|---|
${rows.join('\n')}

## GZ curve: largest difference at the booklet's angles (≤ 60°)

| Cond | Points | Max |GZ difference| |
|---|---|---|
${gzRows.join('\n')}

## OSV intact criteria, actual values (booklet / StabilitySoft)

| Cond | (1) Area 0–θmax | (2) Area 0–40/θf | (3) Area 30–40/θf | (4) GZ ≥30° | (5) θ of GZmax | (6) GM |
|---|---|---|---|---|---|---|
${critRows.join('\n')}

**≠** marks a PASS/FAIL disagreement (none expected).

## Weather criterion (booklet / StabilitySoft)

| Cond | Gust lever l_w2 m | Roll angle θ1 ° | Area ratio b/a | Heel margin to min(16°, 0.8·deck imm.) ° | Result |
|---|---|---|---|---|---|
${wxRows.join('\n')}

## Largest differences over all conditions

| Quantity | Max difference |
|---|---|
| Displacement | ${stats.disp.toFixed(2)} t |
| KG (solid) | ${(stats.kg * 1000).toFixed(1)} mm |
| Trim | ${(stats.trim * 1000).toFixed(0)} mm |
| Draft at midship | ${(stats.draft * 1000).toFixed(0)} mm |
| GM fluid | ${(stats.gm * 1000).toFixed(0)} mm |
| GZ (≤ 60°) | ${(stats.gz * 1000).toFixed(0)} mm |
| Areas | ${stats.area.toFixed(4)} m·rad |
`;
    writeFileSync(`${DIR}/BENCHMARK.md`, md);
    console.log(md);
  });
});

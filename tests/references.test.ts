// Drafts measured at the LCF / AP / FP → midship; cross curves given against draft or volume → displacement.
import { describe, expect, it } from 'vitest';
import type { Conversion, ConvCell } from '../src/importer/convert';
import { applyRefs, convertKnBasis, draftAtMidship } from '../src/importer/references';
import { checkConversion } from '../src/importer/checks';
import { applyToVessel } from '../src/importer/apply';
import { lerp } from '../src/engine/math';
import { VESSELS } from '../src/data/vessels';

const marsol = VESSELS[0].vessel;
const L = marsol.lbp;
const cell = (v: number): ConvCell => ({ raw: String(v), value: v, read: v, status: 'ok' });
const conv = (rows: Record<string, number>[], kn?: number[][]): Conversion => ({
  rows: rows.map((r, i) => ({ src: i, cells: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cell(v)])), kn: kn?.[i].map(cell) })),
  skipped: [], stats: { rowsInRange: rows.length, cellsRead: 0, cellsOk: 0, cellsError: 0, digitChecks: 0, digitFailures: 0, positionsConverted: 0 },
});
const hydroT = (t: number) => marsol.hydro.trims!.find((x) => Math.abs(x.trim - t) < 1e-9)!.rows;

describe('draft reference', () => {
  it('formula: even keel gives the same draft everywhere; trim by stern raises the AP draft', () => {
    expect(draftAtMidship(3, 10, 0, L)).toBe(3);
    expect(draftAtMidship(3.5, 0, 1, L)).toBeCloseTo(3.0, 12);   // AP draft 3.5, trim 1 → 3.0 at L/2
    expect(draftAtMidship(2.5, L, 1, L)).toBeCloseTo(3.0, 12);   // FP draft 2.5
  });

  for (const t of [1, -1, 0.5]) {
    it(`MARSOL trim ${t} m: a table with drafts at the LCF is converted back to the stored midship drafts`, () => {
      const rows = hydroT(t);
      const lcfTable = conv(rows.map((r) => ({ draft: r.draft - (t * (r.lcf - L / 2)) / L, displacement: r.displacement, lcb: r.lcb, lcf: r.lcf, kmt: r.kmt, tpc: r.tpc, mtc: r.mtc })));
      const out = applyRefs('HYDRO', lcfTable, marsol, t, { draftRef: 'LCF' });
      expect(out.checks[0].level).toBe('ok');
      out.conv.rows.forEach((r, i) => expect(r.cells.draft.value as number).toBeCloseTo(rows[i].draft, 10));
      expect(out.conv.rows[3].cells.draft.note).toMatch(/at LCF .* at midship/);
      expect(checkConversion('HYDRO', out.conv, marsol).filter((c) => c.level === 'error')).toEqual([]);
    });
  }

  it('AP and FP drafts convert too; midship and even-keel tables are left as they are', () => {
    const rows = hydroT(1);
    const ap = conv(rows.map((r) => ({ draft: r.draft + (1 * (L / 2)) / L, lcf: r.lcf })));
    applyRefs('HYDRO', ap, marsol, 1, { draftRef: 'AP' }).conv.rows.forEach((r, i) => expect(r.cells.draft.value as number).toBeCloseTo(rows[i].draft, 10));
    const fp = conv(rows.map((r) => ({ draft: r.draft - (1 * (L / 2)) / L, lcf: r.lcf })));
    applyRefs('HYDRO', fp, marsol, 1, { draftRef: 'FP' }).conv.rows.forEach((r, i) => expect(r.cells.draft.value as number).toBeCloseTo(rows[i].draft, 10));
    const c = conv([{ draft: 3, lcf: 27 }]);
    expect(applyRefs('HYDRO', c, marsol, 1, { draftRef: 'MID' }).conv).toBe(c);
    expect(applyRefs('HYDRO', c, marsol, 0, { draftRef: 'LCF' }).conv).toBe(c);
    expect(applyRefs('HYDRO', c, marsol, 1, { draftRef: 'X' }).checks[0].level).toBe('error'); // X not given
  });
});

describe('cross curves given against draft or volume', () => {
  for (const t of [0, 0.5, -1]) {
    it(`MARSOL KN trim ${t} m against draft → the stored displacements`, () => {
      const kn = t === 0 ? marsol.kn : marsol.kn.trims!.find((x) => Math.abs(x.trim - t) < 1e-9)!;
      const hy = t === 0 ? marsol.hydro.rows : hydroT(t);
      const inRange = kn.displacements.map((d, i) => [d, i] as const).filter(([d]) => d >= hy[0].displacement && d <= hy[hy.length - 1].displacement);
      const drafts = inRange.map(([d]) => lerp(hy.map((h) => h.displacement), hy.map((h) => h.draft), d, 'test'));
      const byDraft = conv(drafts.map((d) => ({ displacement: d })), inRange.map(([, i]) => kn.kn[i]));
      const out = applyRefs('KN', byDraft, marsol, t, { knBasis: 'DRAFT' });
      expect(out.checks[0].level).toBe('ok');
      out.conv.rows.forEach((r, j) => expect(r.cells.displacement.value as number).toBeCloseTo(inRange[j][0], 6));
      expect(out.conv.rows[0].cells.displacement.note).toMatch(/draft .* → Δ/);
    });
  }

  it('volume × density of the tables', () => {
    const out = convertKnBasis(conv([{ displacement: 1000 }], [[0, 1, 2]]), 'VOLUME', marsol, 0);
    expect(out.conv.rows[0].cells.displacement.value).toBeCloseTo(1000 * marsol.rhoRef, 9);
  });

  it('no hydrostatic table for that trim, or a draft outside it → error, nothing silently guessed', () => {
    expect(applyRefs('KN', conv([{ displacement: 3 }], [[0, 1, 2]]), marsol, 0.25, { knBasis: 'DRAFT' }).checks[0].level).toBe('error');
    const out = applyRefs('KN', conv([{ displacement: 99 }], [[0, 1, 2]]), marsol, 0, { knBasis: 'DRAFT' });
    expect(out.checks[0].level).toBe('error');
    expect(out.conv.rows[0].cells.displacement.status).toBe('error');
  });

  it('a converted KN table stores and the vessel uses it', () => {
    const hy = marsol.hydro.rows;
    const ds = marsol.kn.displacements.filter((d) => d >= hy[0].displacement && d <= hy[hy.length - 1].displacement);
    const idx = ds.map((d) => marsol.kn.displacements.indexOf(d));
    const drafts = ds.map((d) => lerp(hy.map((h) => h.displacement), hy.map((h) => h.draft), d, 'test'));
    const out = applyRefs('KN', conv(drafts.map((d) => ({ displacement: d })), idx.map((i) => marsol.kn.kn[i])), marsol, 0, { knBasis: 'DRAFT' });
    const v = applyToVessel('KN', marsol, out.conv, { trim: 0, angles: marsol.kn.angles });
    v.kn.displacements.forEach((d, i) => expect(d).toBeCloseTo(ds[i], 6));
  });
});

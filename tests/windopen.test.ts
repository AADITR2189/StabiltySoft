import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdfItemsToRows, type PdfTextItem, type SourceTable } from '../src/importer/sources';
import { datasetDef } from '../src/importer/datasets';
import { autoMapping, convert, editCell } from '../src/importer/convert';
import { checkConversion } from '../src/importer/checks';
import { splitOpeningLines } from '../src/importer/openingsList';
import { findWindCases, windRows } from '../src/importer/windageParts';
import { VESSELS } from '../src/data/vessels';
import extract from '../vessels/marsol-splendor/marsol-splendor.extracted.json';

const marsol = VESSELS[0].vessel;
let docP: Promise<pdfjs.PDFDocumentProxy> | null = null;
async function pages(from: number, to: number): Promise<SourceTable[]> {
  docP ??= pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync('vessels/marsol-splendor/DU5864_1022_PRELIMINARY INTACT STABILITY BOOKLET_REV.0.pdf')), verbosity: 0 }).promise;
  const doc = await docP;
  const out: SourceTable[] = [];
  for (let p = from; p <= to; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    out.push({ id: `p${p}`, label: `Page ${p}`, page: p, rows: pdfItemsToRows((tc.items as { str?: string; transform: number[]; width: number }[]).filter((i) => typeof i.str === 'string').map((i) => ({ str: i.str!, x: i.transform[4], y: i.transform[5], w: i.width } as PdfTextItem))) });
  }
  return out;
}

describe('flooding points list (booklet page 139)', async () => {
  const [t] = await pages(139, 139);
  const split = splitOpeningLines(t.rows);
  const def = datasetDef('OPENINGS');
  const m = autoMapping(def, split.rows, '.', marsol.lbp);
  const conv = convert(def, split.rows, m);
  it('reads 4 points with midship and side letters converted', () => {
    expect(split.matched).toBe(4);
    expect(conv.rows.map((r) => r.cells.name.value)).toEqual(['POSITION 1(S)', 'POSITION 1(P)', 'POSITION 2(S)', 'POSITION 2(P)']);
    conv.rows.forEach((r, i) => {
      expect(r.cells.x.value as number).toBeCloseTo(extract.floodPoints[i].x, 9);
      expect(r.cells.z.value).toBe(extract.floodPoints[i].z);
    });
    expect(conv.rows.map((r) => r.cells.y.value)).toEqual([5.4, -5.4, 6.3, 6.3]); // as printed
  });
  it('flags the booklet typo: POSITION 2(P) printed as starboard', () => {
    const c = checkConversion('OPENINGS', conv, marsol).find((x) => /Name says port/.test(x.title));
    expect(c?.level).toBe('warn');
    expect(c?.detail).toContain('POSITION 2(P)');
    const fixed = structuredClone(conv);
    fixed.rows[3].cells.y = editCell(fixed.rows[3].cells.y, '-6.3', false);
    expect(checkConversion('OPENINGS', fixed, marsol).find((x) => /port \/ starboard/i.test(x.title))?.level).toBe('ok');
  });
});

describe('flooding points with an extra column (condition page 41)', async () => {
  const [t] = await pages(41, 41);
  const split = splitOpeningLines(t.rows);
  const def = datasetDef('OPENINGS');
  const conv = convert(def, split.rows, autoMapping(def, split.rows, '.', marsol.lbp));
  it('takes L, T, V and leaves the height column out; port side correct here', () => {
    expect(split.matched).toBe(4);
    expect(split.extraCols).toBe(1);
    conv.rows.forEach((r, i) => {
      expect(r.cells.x.value as number).toBeCloseTo(extract.floodPoints[i].x, 9);
      expect(r.cells.y.value).toBe(extract.floodPoints[i].y);
      expect(r.cells.z.value).toBe(12.15);
    });
    expect(checkConversion('OPENINGS', conv, marsol).filter((c) => c.level !== 'ok')).toEqual([]);
  });
});

describe('windage from the heeling moment tables of the loading conditions', async () => {
  const all = await pages(1, 157);
  const found = findWindCases(all);
  const cases = found.filter((c) => c.condition);
  it('the sample calculation page is recognised as outside the loading conditions', () => {
    const sample = found.filter((c) => !c.condition);
    expect(sample.map((c) => c.page)).toEqual([25]);
  });
  it('one case per condition with a wind table, condition and draft found, no errors', () => {
    expect(cases.map((c) => c.condition.slice(0, 14))).toEqual(['CONDITION 1: L', 'CONDITION NO.2', 'CONDITION NO.3', 'CONDITION NO.4', 'CONDITION NO.5']);
    for (const c of cases) expect(c.issues.filter((i) => i.level === 'error').map((i) => i.text), `page ${c.page}`).toEqual([]);
  });
  it('rows equal the earlier extraction and the total moment is reproduced', () => {
    const { rows } = windRows(cases);
    const ref = extract.windage.filter((w) => !('extrapolated' in w));
    expect(rows.map((r) => r.draft)).toEqual(ref.map((r) => r.draft));
    rows.forEach((r, i) => {
      expect(r.area).toBeCloseTo(ref[i].area, 3);
      expect(r.centroidZ).toBeCloseTo(ref[i].centroidZ, 3);
      expect(r.underwaterCentroidZ).toBeCloseTo(ref[i].underwaterCentroidZ, 3);
    });
    for (const c of cases) expect(Math.abs(c.partsSum - c.printedTotal!)).toBeLessThan(0.05);
  });
  it('optional extension to the hydrostatic range is marked as derived', () => {
    const { rows, notes } = windRows(cases, { lo: 2.25, hi: 4.75 });
    expect(rows[0].derived && rows[rows.length - 1].derived).toBe(true);
    expect(rows[0].area).toBeCloseTo(extract.windage[0].area, 3);
    expect(notes.length).toBe(2);
  });
});

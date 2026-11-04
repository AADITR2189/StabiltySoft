import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdfItemsToRows, type PdfTextItem, type SourceTable } from '../src/importer/sources';
import { datasetDef } from '../src/importer/datasets';
import { autoMapping } from '../src/importer/convert';
import { applyToVessel, compareRows, expectedRows, storedRows } from '../src/importer/apply';
import { buildTrimImports, clearKind, isTrimTablePage, pagesText, parsePages, parseTrim, setChecks, splitTrims, trimChecks } from '../src/importer/multiTrim';
import { parseCsv } from '../src/importer/csv';
import { VESSELS } from '../src/data/vessels';

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

describe('trim from title lines', () => {
  it.each([
    ['No Trim, No heel, VCG = 0.000', 0], ['Trim: aft 0.500/57.400, No heel', 0.5], ['Trim: fwd 1.000/57.400, No heel', -1],
    ['Trim zero at heel = 0 (RA Trim = 0)', 0], ['Trim aft 1.000/57.400 at heel = 0 (RA Trim = 0)', 1], ['Trim by the head 0.25 m', -0.25],
    ['Trim = -0.5 m', -0.5], ['Even keel', 0], ['Hydrostatic properties', null],
  ])('%s → %s', (t, v) => expect(parseTrim(t as string)).toBe(v));
});

for (const [kind, from, to] of [['HYDRO', 129, 133], ['KN', 134, 138]] as const) {
  describe(`MARSOL ${kind}: all 5 trims at once (pages ${from}–${to})`, async () => {
    const blocks = splitTrims(await pages(from, to), 'TITLE');
    const def = datasetDef(kind);
    const m = autoMapping(def, blocks[0].rows, '.', marsol.lbp);
    const imports = buildTrimImports(kind, blocks, m);
    it('finds 5 trims, 26 rows each, no errors or warnings', () => {
      expect(imports.map((t) => t.trim)).toEqual([0, 0.5, 1, -0.5, -1]);
      for (const t of imports) {
        expect(t.conv.rows.length).toBe(26);
        expect(trimChecks(kind, t, imports, marsol, m).filter((c) => c.level !== 'ok').map((c) => c.title), `trim ${t.trim}`).toEqual([]);
      }
      expect(setChecks(kind, imports).filter((c) => c.level !== 'ok')).toEqual([]);
    });
    it('stored tables equal the existing booklet tables for every trim', () => {
      let v = clearKind(marsol, kind);
      const angles = m.angleCols.map((a) => a.angle);
      for (const t of [...imports].sort((a, b) => (a.trim as number) - (b.trim as number))) v = applyToVessel(kind, v, t.conv, { trim: t.trim as number, angles });
      for (const t of imports) {
        const o = { trim: t.trim as number, angles };
        expect(compareRows(expectedRows(kind, t.conv, o), storedRows(kind, v, o), true).ok, `trim ${t.trim}`).toBe(true);
      }
      if (kind === 'HYDRO') {
        expect(v.hydro.trims!.map((x) => x.trim)).toEqual(marsol.hydro.trims!.map((x) => x.trim).sort((a, b) => a - b));
        v.hydro.trims!.forEach((x) => x.rows.forEach((r, j) => {
          const e = marsol.hydro.trims!.find((y) => y.trim === x.trim)!.rows[j];
          for (const k of ['draft', 'displacement', 'lcb', 'lcf', 'kmt', 'tpc', 'mtc'] as const) expect(r[k], `${x.trim} ${j} ${k}`).toBeCloseTo(e[k], 9);
        }));
      } else {
        expect(v.kn.angles).toEqual(marsol.kn.angles);
        expect(v.kn.trims!.map((x) => x.trim)).toEqual(marsol.kn.trims!.map((x) => x.trim).sort((a, b) => a - b));
        v.kn.trims!.forEach((x) => x.kn.forEach((r, j) => r.forEach((k, a) => expect(k).toBeCloseTo(marsol.kn.trims!.find((y) => y.trim === x.trim)!.kn[j][a], 9))));
      }
    });
  });
}

describe('one long table with a trim column', () => {
  it('groups rows by trim', () => {
    const rows = parseCsv('Trim;Draft;Displ;LCB;LCF;KMT;TPC;MTC\n0;2;1000;28;27;9;8;30\n0;3;1850;28.1;27.2;8.5;8.6;34\n0.5;2;1001;27.5;26.8;9.1;8.0;30.5\n0.5;3;1852;27.6;27.0;8.6;8.6;34.4\n');
    const blocks = splitTrims([{ id: 't', label: 'CSV', rows }], 'COLUMN', { trimCol: 0 });
    expect(blocks.map((b) => [b.trim, b.rows.length])).toEqual([[0, 3], [0.5, 3]]);
    const m = autoMapping(datasetDef('HYDRO'), blocks[0].rows, '.', 57.4);
    expect(buildTrimImports('HYDRO', blocks, m).map((t) => t.conv.rows.length)).toEqual([2, 2]);
  });
});

describe('finding the trim table pages in the whole booklet', async () => {
  const all = await pages(1, 184);
  it('hydrostatics 129-133 and KN 134-138, nothing else', () => {
    expect(pagesText(all.filter((t) => isTrimTablePage(t, 'HYDRO')).map((t) => t.page!))).toBe('129-133');
    expect(pagesText(all.filter((t) => isTrimTablePage(t, 'KN')).map((t) => t.page!))).toBe('134-138');
  });
  it('page list text', () => {
    expect(parsePages('129-131, 140 ;141')).toEqual([129, 130, 131, 140, 141]);
    expect(pagesText([1, 2, 3, 7, 9, 10])).toBe('1-3, 7, 9-10');
  });
});

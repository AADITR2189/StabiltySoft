import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import JSZip from 'jszip';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { digitCheck, parseNum } from '../src/importer/numbers';
import { parseCsv } from '../src/importer/csv';
import { docxTables } from '../src/importer/docx';
import { pdfItemsToRows, type PdfTextItem } from '../src/importer/sources';
import { datasetDef } from '../src/importer/datasets';
import { autoMapping, convert, editCell } from '../src/importer/convert';
import { checkConversion } from '../src/importer/checks';
import { applyToVessel, compareRows, expectedRows, storedRows } from '../src/importer/apply';
import { buildDbFile, mergeDb, readDbFile } from '../src/importer/dbFile';
import { VESSELS } from '../src/data/vessels';
import extract from '../vessels/marsol-splendor/marsol-splendor.extracted.json';

const BOOKLET = 'vessels/marsol-splendor/DU5864_1022_PRELIMINARY INTACT STABILITY BOOKLET_REV.0.pdf';
const marsol = VESSELS[0].vessel;

async function pdfPage(p: number): Promise<string[][]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(BOOKLET)), verbosity: 0 }).promise;
  const tc = await (await doc.getPage(p)).getTextContent();
  const items: PdfTextItem[] = (tc.items as { str?: string; transform: number[]; width: number }[]).filter((i) => typeof i.str === 'string').map((i) => ({ str: i.str!, x: i.transform[4], y: i.transform[5], w: i.width }));
  return pdfItemsToRows(items);
}

describe('number reading', () => {
  it('reads booklet notations and rejects garbage', () => {
    expect(parseNum('0.721a')).toEqual({ value: 0.721, suffix: 'a' });
    expect(parseNum('1,565.968')!.value).toBe(1565.968);
    expect(parseNum('1.565,968', ',')!.value).toBe(1565.968);
    expect(parseNum('−2.5')!.value).toBe(-2.5);
    expect(parseNum('(3.2)')!.value).toBe(-3.2);
    expect(parseNum('5.533s')).toEqual({ value: 5.533, suffix: 's' });
    expect(parseNum('12kg')).toBeNull();
    expect(parseNum('1,56')).toBeNull(); // ambiguous thousands separator
    expect(parseNum('abc')).toBeNull();
  });
  it('digit check catches a misread value', () => {
    expect(digitCheck('1,565.968', 1565.968)).toBe(true);
    expect(digitCheck('1,565.968', 156.5968)).toBe(false);
    expect(digitCheck('-0.25', 0.25)).toBe(false);
  });
});

describe('file readers', () => {
  it('CSV with semicolons, quotes and BOM', () => {
    expect(parseCsv('﻿a;b;"c;d"\n1;2;3\n')).toEqual([['a', 'b', 'c;d'], ['1', '2', '3']]);
    expect(parseCsv('x\ty\n1\t2')).toEqual([['x', 'y'], ['1', '2']]);
  });
  it('Word tables', async () => {
    const zip = new JSZip();
    const cell = (t: string) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
    zip.file('word/document.xml', `<w:document><w:body><w:p><w:r><w:t>Windage</w:t></w:r></w:p><w:tbl><w:tr>${cell('Draft')}${cell('Area')}</w:tr><w:tr>${cell('2.5')}${cell('540.2')}</w:tr></w:tbl></w:body></w:document>`);
    const r = await docxTables(await zip.generateAsync({ type: 'arraybuffer' }));
    expect(r.tables[0].rows).toEqual([['Draft', 'Area'], ['2.5', '540.2']]);
    expect(r.tables[1].rows[0]).toEqual(['Windage']);
  });
});

describe('PDF booklet import (MARSOL page 131: hydrostatics, trim 1.0 m by stern)', async () => {
  const rows = await pdfPage(131);
  const def = datasetDef('HYDRO');
  const m = autoMapping(def, rows, '.', marsol.lbp);
  const conv = convert(def, rows, m);
  const ref = extract.hydrostatics.find((h) => h.page === 131)!;

  it('finds the columns and the data rows by itself', () => {
    expect(m.xRef).toBe('MID_FWD');
    for (const k of ['draft', 'displacement', 'lcb', 'lcf', 'kmt', 'tpc', 'mtc', 'kb']) expect(m.cols[k], k).toBeGreaterThanOrEqual(0);
    expect(conv.rows.length).toBe(ref.rows.length);
    expect(conv.stats.cellsError).toBe(0);
  });
  it('every value equals the independently extracted booklet data (LCB/LCF converted to from-AP)', () => {
    conv.rows.forEach((r, i) => {
      for (const k of ['draft', 'displacement', 'lcb', 'lcf', 'kmt', 'tpc', 'mtc', 'kb'] as const) {
        expect(r.cells[k].value as number, `${k} row ${i}`).toBeCloseTo((ref.rows[i] as Record<string, number>)[k], 9);
      }
    });
  });
  it('consistency checks pass on clean data and flag a typo', () => {
    const ok = checkConversion('HYDRO', conv, marsol);
    expect(ok.filter((c) => c.level === 'error')).toEqual([]);
    const bad = structuredClone(conv);
    bad.rows[10].cells.displacement = editCell(bad.rows[10].cells.displacement, String((bad.rows[10].cells.displacement.value as number) + 90), false);
    const res = checkConversion('HYDRO', bad, marsol);
    expect(res.some((c) => c.level !== 'ok' && c.rows?.includes(bad.rows[10].src))).toBe(true);
  });
  it('apply to a vessel and read back identical', () => {
    const v = applyToVessel('HYDRO', marsol, conv, { trim: 1 });
    const cmp = compareRows(expectedRows('HYDRO', conv, { trim: 1 }), storedRows('HYDRO', v, { trim: 1 }), true);
    expect(cmp.ok, cmp.text).toBe(true);
  });
});

describe('PDF booklet import (page 135: KN cross curves, trim 0.5 m)', async () => {
  const rows = await pdfPage(135);
  const def = datasetDef('KN');
  const m = autoMapping(def, rows, '.', marsol.lbp);
  const conv = convert(def, rows, m);
  const ref = extract.crossCurves.find((h) => h.page === 135)!;
  it('reads the angle headings and all KN values', () => {
    expect(m.angleCols.map((a) => a.angle)).toEqual([5, 10, 20, 30, 40, 50, 60]);
    expect(conv.rows.length).toBe(ref.rows.length);
    conv.rows.forEach((r, i) => r.kn!.forEach((c, j) => expect(c.value).toBeCloseTo(ref.rows[i].kn[j + 1], 9)));
  });
  it('stores with a 0° column and reads back identical', () => {
    const o = { trim: 0.5, angles: m.angleCols.map((a) => a.angle) };
    const v = applyToVessel('KN', marsol, conv, o);
    expect(v.kn.angles[0]).toBe(0);
    const cmp = compareRows(expectedRows('KN', conv, o), storedRows('KN', v, o), true);
    expect(cmp.ok, cmp.text).toBe(true);
  });
});

describe('database file', () => {
  const data = { vessels: [{ id: 'u-1', vessel: marsol, source: 'test', createdAt: '2026-01-01', provenance: {} }], loadCases: { 'u-1': VESSELS[0].defaultLoadCases.slice(0, 2) }, library: { criteria: [], groups: [], moments: [] } };
  it('round trip with checksum', async () => {
    const text = await buildDbFile(data);
    const p = await readDbFile(text, VESSELS.map((v) => v.id));
    expect(p.checksumOk).toBe(true);
    expect(p.errors).toEqual([]);
    expect(p.file.data).toEqual(JSON.parse(JSON.stringify(data)));
  });
  it('detects an edited file', async () => {
    const text = (await buildDbFile(data)).replace('"lbp": 57.4', '"lbp": 57.5').replace('"lbp":57.4', '"lbp":57.5');
    const p = await readDbFile(text, []);
    expect(p.checksumOk).toBe(false);
    expect(p.errors.length).toBeGreaterThan(0);
  });
  it('merge keeps existing items and replaces same ids', () => {
    const cur = { vessels: [{ ...data.vessels[0], id: 'u-0' }], loadCases: {}, library: data.library };
    const merged = mergeDb(cur, data, 'MERGE', []);
    expect(merged.vessels.map((v) => v.id)).toEqual(['u-0', 'u-1']);
    expect(mergeDb(cur, data, 'REPLACE', []).vessels.map((v) => v.id)).toEqual(['u-1']);
  });
});

describe('typo detection', async () => {
  const { spikes } = await import('../src/importer/checks');
  const rows = await pdfPage(131);
  const def = datasetDef('HYDRO');
  const conv = convert(def, rows, autoMapping(def, rows, '.', marsol.lbp));
  it('no false alarms on the real booklet table', () => {
    expect(checkConversion('HYDRO', conv, marsol).filter((c) => c.level !== 'ok')).toEqual([]);
  });
  it('finds a swapped digit in KMT (11.278 → 11.728) and the row', () => {
    const bad = structuredClone(conv);
    const i = bad.rows.findIndex((r) => r.cells.kmt.raw === '11.278');
    bad.rows[i].cells.kmt = editCell(bad.rows[i].cells.kmt, '11.728', false);
    const w = checkConversion('HYDRO', bad, marsol).filter((c) => c.level !== 'ok');
    expect(w.some((c) => c.rows?.includes(bad.rows[i].src))).toBe(true);
  });
  it('a change of slope alone is not a spike', () => {
    expect(spikes([0, 1, 2, 3, 3.5, 4, 4.5], 0.01)).toEqual([]);
    expect(spikes([0, 1, 2, 3.9, 4, 5, 6], 0.01)).toEqual([3]);
  });
});

describe('all MARSOL hydrostatic and KN pages import cleanly', async () => {
  for (const [page, kind] of [[129, 'HYDRO'], [130, 'HYDRO'], [131, 'HYDRO'], [132, 'HYDRO'], [133, 'HYDRO'], [134, 'KN'], [135, 'KN'], [136, 'KN'], [137, 'KN'], [138, 'KN']] as const) {
    it(`page ${page} (${kind})`, async () => {
      const rows = await pdfPage(page);
      const def = datasetDef(kind);
      const conv = convert(def, rows, autoMapping(def, rows, '.', marsol.lbp));
      const issues = checkConversion(kind, conv, marsol).filter((c) => c.level !== 'ok');
      expect(issues.map((c) => c.title)).toEqual([]);
      expect(conv.rows.length).toBe(26);
    });
  }
});

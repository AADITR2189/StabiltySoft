import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdfItemsToRows, type PdfTextItem } from '../src/importer/sources';
import { applyKv, checkKv, imoValid, kvExpected, kvExtract, kvStored } from '../src/importer/keyValue';
import { VESSELS } from '../src/data/vessels';
import { rollFactorK } from '../src/engine/stability';

const BOOKLET = 'vessels/marsol-splendor/DU5864_1022_PRELIMINARY INTACT STABILITY BOOKLET_REV.0.pdf';
const marsol = VESSELS[0].vessel;
async function pdfPage(p: number): Promise<string[][]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(BOOKLET)), verbosity: 0 }).promise;
  const tc = await (await doc.getPage(p)).getTextContent();
  return pdfItemsToRows((tc.items as { str?: string; transform: number[]; width: number }[]).filter((i) => typeof i.str === 'string').map((i) => ({ str: i.str!, x: i.transform[4], y: i.transform[5], w: i.width } as PdfTextItem)));
}
const val = (h: ReturnType<typeof kvExtract>, k: string) => h.find((x) => x.key === k)!.value;

describe('label / value import from the MARSOL booklet', () => {
  it('general particulars (PDF page 5)', async () => {
    const h = kvExtract('PARTICULARS', await pdfPage(5), '.', 0);
    expect(val(h, 'name')).toBe('MARSOL SPLENDOR');
    expect(val(h, 'imo')).toBe('9944376');
    expect(val(h, 'callSign')).toBe('3E3692');
    expect(val(h, 'loa')).toBe(62.8);
    expect(val(h, 'lbp')).toBe(57.4);
    expect(val(h, 'breadth')).toBe(16.8);
    expect(val(h, 'depth')).toBe(5.3);
    expect(val(h, 'maxDraft')).toBe(4.2);
    const checks = checkKv('PARTICULARS', h, marsol);
    expect(checks.filter((c) => c.level === 'error')).toEqual([]);
    const v = applyKv('PARTICULARS', { ...marsol, name: 'x', lbp: 1 }, h);
    expect(kvStored('PARTICULARS', v)).toEqual(kvExpected('PARTICULARS', { ...marsol, name: 'x', lbp: 1 }, h));
  });
  it('lightship (PDF page 6): aft of midship and port converted', async () => {
    const h = kvExtract('LIGHTSHIP_SUMMARY', await pdfPage(6), '.', marsol.lbp);
    expect(val(h, 'weight')).toBe(1911.97);
    expect(val(h, 'vcg')).toBe(5.792);
    expect(val(h, 'lcg') as number).toBeCloseTo(marsol.lightship.lcg, 9);
    expect(val(h, 'tcg')).toBe(-0.243);
    expect(checkKv('LIGHTSHIP_SUMMARY', h, marsol).filter((c) => c.level === 'error')).toEqual([]);
  });
  it('IMO check digit', () => {
    expect(imoValid('9944376')).toBe(true);
    expect(imoValid('9944367')).toBe(false);
  });
});

describe('roll factor k (IS Code 2008 A 2.3.4)', () => {
  const v = { ...marsol, breadth: 16.8 };
  it('no keel area: round 1.0, sharp 0.7', () => {
    expect(rollFactorK({ ...v, bilgeType: 'ROUND', bilgeKeelArea: 0 }, 57.4).k).toBe(1);
    expect(rollFactorK({ ...v, bilgeType: 'SHARP', bilgeKeelArea: 0 }, 57.4).k).toBe(0.7);
  });
  it('known keel area is used for both bilge shapes', () => {
    // A_k·100/(L·B) = 1.5 → k = 0.95
    const Ak = (1.5 * 57.4 * 16.8) / 100;
    expect(rollFactorK({ ...v, bilgeType: 'ROUND', bilgeKeelArea: Ak, hasBilgeKeels: true }, 57.4).k).toBeCloseTo(0.95, 9);
    expect(rollFactorK({ ...v, bilgeType: 'SHARP', bilgeKeelArea: Ak, hasBilgeKeels: true }, 57.4).k).toBeCloseTo(0.95, 9);
  });
  it('area unticked is ignored', () => {
    expect(rollFactorK({ ...v, bilgeType: 'SHARP', bilgeKeelArea: 20, hasBilgeKeels: false }, 57.4).k).toBe(0.7);
  });
});

describe('lightship as a table of items', async () => {
  const { datasetDef } = await import('../src/importer/datasets');
  const { autoMapping, convert } = await import('../src/importer/convert');
  const { checkConversion } = await import('../src/importer/checks');
  const { applyToVessel, compareRows, expectedRows, storedRows } = await import('../src/importer/apply');
  const { parseCsv } = await import('../src/importer/csv');
  const csv = 'Item;Weight (t);LCG (m);TCG (m);VCG (m)\nHull;1200;27.0;0;4.5\nMachinery;400;20.0;0;3.0\nOutfit;311.97;35.0;-1.5;9.0\nTotal lightship;1911.97;26.841;-0.245;4.920\n';
  const rows = parseCsv(csv);
  const def = datasetDef('LIGHTSHIP');
  const conv = convert(def, rows, autoMapping(def, rows, '.', 57.4));
  it('adds up the items and checks them against the total line', () => {
    const c = checkConversion('LIGHTSHIP', conv, marsol);
    expect(c.find((x) => x.title.startsWith('Items add up'))).toBeTruthy();
    const v = applyToVessel('LIGHTSHIP', marsol, conv, { trim: 0 });
    expect(v.lightship.weight).toBeCloseTo(1911.97, 6);
    expect(v.lightshipItems!.length).toBe(3);
    expect(compareRows(expectedRows('LIGHTSHIP', conv, { trim: 0 }), storedRows('LIGHTSHIP', v, { trim: 0 }), false).ok).toBe(true);
  });
  it('a missing item is caught by the total line', () => {
    const bad = parseCsv(csv.replace('Machinery;400;20.0;0;3.0\n', ''));
    const c2 = convert(def, bad, autoMapping(def, bad, '.', 57.4));
    expect(checkConversion('LIGHTSHIP', c2, marsol).some((x) => x.level === 'error' && /do not add up/.test(x.title))).toBe(true);
  });
});

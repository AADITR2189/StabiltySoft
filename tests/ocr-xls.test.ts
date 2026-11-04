import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as XLSX from '@e965/xlsx';
import { readXls, pdfItemsToGrid } from '../src/importer/sources';
import { cleanForOcr } from '../src/importer/ocrPrep';
import { wordsToItems, type OcrWord } from '../src/importer/ocr';
import { datasetDef } from '../src/importer/datasets';
import { autoMapping, convert } from '../src/importer/convert';
import { checkConversion } from '../src/importer/checks';
import { VESSELS } from '../src/data/vessels';
import extract from '../vessels/marsol-splendor/marsol-splendor.extracted.json';

const marsol = VESSELS[0].vessel;

describe('old Excel (.xls)', () => {
  it('reads every sheet of a BIFF8 workbook with full precision', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Draft', 'Displ'], [2.25, 1565.968], [2.35, 1647.166]]), 'Hydro');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Tank', 'Vol'], ['FO1', 12.5]]), 'Tanks');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'biff8' }) as ArrayBuffer;
    const r = await readXls(buf);
    expect(r.tables.map((t) => t.label)).toEqual(['Sheet "Hydro"', 'Sheet "Tanks"']);
    expect(r.tables[0].rows).toEqual([['Draft', 'Displ'], ['2.25', '1565.968'], ['2.35', '1647.166']]);
  });
});

const hasPdftoppm = (() => { try { execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();

describe.skipIf(!hasPdftoppm)('text recognition of a scanned booklet page (page 131 rendered at 300 dpi)', () => {
  it('reads the table; misread values are caught by the checks', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-'));
    execFileSync('pdftoppm', ['-r', '300', '-gray', '-f', '131', '-l', '131', 'vessels/marsol-splendor/DU5864_1022_PRELIMINARY INTACT STABILITY BOOKLET_REV.0.pdf', path.join(dir, 'g')]);
    const file = fs.readdirSync(dir).find((f) => f.endsWith('.pgm'))!;
    const buf = fs.readFileSync(path.join(dir, file));
    const head = buf.subarray(0, 64).toString('latin1').split(/\s+/);
    const w = Number(head[1]), h = Number(head[2]);
    const clean = cleanForOcr(buf.subarray(buf.length - w * h), w, h);
    const pgm = Buffer.concat([Buffer.from(`P5\n${w} ${h}\n255\n`), Buffer.from(clean)]);
    const { createWorker } = await import('tesseract.js');
    const wk = await createWorker('eng', 1, { langPath: path.resolve('node_modules/@tesseract.js-data/eng/4.0.0_best_int'), cachePath: dir, gzip: true });
    await wk.setParameters({ tessedit_pageseg_mode: '6' as never, preserve_interword_spaces: '1', user_defined_dpi: '300' });
    const { data } = await wk.recognize(pgm, {}, { blocks: true });
    await wk.terminate();
    const words: OcrWord[] = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words.map((x) => ({ text: x.text, confidence: x.confidence, bbox: x.bbox, lineBaseline: Math.max(l.baseline.y0, l.baseline.y1) })))));
    const grid = pdfItemsToGrid(wordsToItems(words, 300 / 72, h));
    const def = datasetDef('HYDRO');
    const m = autoMapping(def, grid.rows, '.', marsol.lbp);
    const conv = convert(def, grid.rows, m, grid.conf);
    const ref = extract.hydrostatics.find((x) => x.page === 131)!.rows;
    // compare every value that was read with the booklet data
    let same = 0, total = 0;
    const wrongRows = new Set<number>();
    for (const r of conv.rows) {
      const d = r.cells.draft?.value as number;
      const e = ref.find((x) => Math.abs(x.draft - d) < 1e-9);
      for (const k of ['displacement', 'lcb', 'lcf', 'kmt', 'tpc', 'mtc', 'kb'] as const) {
        total++;
        if (e && typeof r.cells[k]?.value === 'number' && Math.abs((r.cells[k].value as number) - (e as Record<string, number>)[k]) < 1e-6) same++; else wrongRows.add(r.src);
      }
    }
    console.log(`OCR: ${conv.rows.length} rows, ${same}/${total} values equal to the booklet; rows with a difference: ${wrongRows.size}`);
    expect(conv.rows.length).toBeGreaterThanOrEqual(24);
    expect(m.cols.mtc).toBeGreaterThanOrEqual(0);
    expect(same / total).toBeGreaterThan(0.9);
    // safety net: every row with a wrong value is flagged by a check or a low-confidence mark, or blocks storing
    const checks = checkConversion('HYDRO', conv, marsol);
    const flagged = new Set(checks.filter((c) => c.level !== 'ok').flatMap((c) => c.rows ?? []));
    const errorsBlock = checks.some((c) => c.level === 'error');
    const missed = [...wrongRows].filter((r) => !flagged.has(r));
    console.log('checks:', checks.filter((c) => c.level !== 'ok').map((c) => c.title).join(' | '));
    expect(errorsBlock || missed.length === 0, `unflagged rows ${missed.map((x) => x + 1)}`).toBe(true);
  }, 60000);
});

describe('lost decimal point', async () => {
  const { decimalShifts } = await import('../src/importer/checks');
  it('finds 797 among 7.97, 8.21 … including the first row', () => {
    expect(decimalShifts([797, 8.21, 8.35, 8.53, 8.65])).toEqual([0]);
    expect(decimalShifts([26.4, 29.2, 3069, 32.16, 33.54])).toEqual([2]);
    expect(decimalShifts([1565.968, 1647.166, 1730.061, 1814.335])).toEqual([]);
  });
});

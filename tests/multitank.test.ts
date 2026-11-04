import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdfItemsToRows, type PdfTextItem, type SourceTable } from '../src/importer/sources';
import { datasetDef } from '../src/importer/datasets';
import { autoMapping } from '../src/importer/convert';
import { applyToVessel, compareRows, expectedRows, storedRows } from '../src/importer/apply';
import { buildTankImports, parseTitle, splitTanks, tankChecks, DEFAULT_TITLE } from '../src/importer/multiTank';
import { parseCsv } from '../src/importer/csv';
import { VESSELS } from '../src/data/vessels';

const BOOKLET = 'vessels/marsol-splendor/DU5864_1022_PRELIMINARY INTACT STABILITY BOOKLET_REV.0.pdf';
const marsol = VESSELS[0].vessel;

async function pages(from: number, to: number): Promise<SourceTable[]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(BOOKLET)), verbosity: 0 }).promise;
  const out: SourceTable[] = [];
  for (let p = from; p <= to; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const items = (tc.items as { str?: string; transform: number[]; width: number }[]).filter((i) => typeof i.str === 'string').map((i) => ({ str: i.str!, x: i.transform[4], y: i.transform[5], w: i.width } as PdfTextItem));
    out.push({ id: `p${p}`, label: `Page ${p}`, page: p, rows: pdfItemsToRows(items) });
  }
  return out;
}

describe('title line', () => {
  it('reads name, contents and density', () => {
    expect(parseTitle('Tank Capacities for NO1_FO.P containing FUEL OIL (0.850)', new RegExp(DEFAULT_TITLE, 'i'))).toEqual({ name: 'NO1_FO.P', groupText: 'FUEL OIL', density: 0.85 });
    expect(parseTitle('Sounding table: FWT 3 S, SG 1.000', new RegExp(DEFAULT_TITLE, 'i'))).toEqual({ name: 'FWT', groupText: '', density: 1 });
  });
});

describe('MARSOL booklet: all 54 tank tables (PDF pages 158–184) at once', async () => {
  const tables = await pages(158, 184);
  const blocks = splitTanks(tables, 'TITLE');
  const def = datasetDef('TANK');
  const m = autoMapping(def, blocks[0].rows, '.', marsol.lbp);
  const imports = buildTankImports(blocks, m, marsol, true);

  it('finds every tank with its density', () => {
    expect(blocks.length).toBe(54);
    expect(imports.map((t) => t.name)).toEqual(marsol.tanks.map((t) => t.name));
    imports.forEach((t, i) => expect(t.density, t.name).toBe(marsol.tanks[i].density));
  });
  it('maps the columns from the first table', () => {
    for (const k of ['volume', 'lcg', 'tcg', 'vcg', 'fsm', 'percent', 'weight']) expect(m.cols[k], k).toBeGreaterThanOrEqual(0);
    expect(m.xRef).toBe('MID_FWD');
  });
  it('no errors in any tank; booklet blanks filled by convention', () => {
    for (const t of imports) {
      const errs = tankChecks(t, marsol, imports).filter((c) => c.level === 'error');
      expect(errs.map((c) => `${c.title} ${c.detail ?? ''}`), t.name).toEqual([]);
      expect(t.conv.rows.length, t.name).toBe(14);
      expect(tankChecks(t, marsol, imports).filter((c) => c.level === 'warn').map((c) => c.title), t.name).toEqual([]);
    }
  });
  it('stored calibration equals the tank data already built from the booklet, for all 54 tanks', () => {
    let v = marsol;
    for (const t of imports) {
      const o = { trim: 0, tank: { name: t.name, group: t.group, density: t.density as number, isConsumable: t.consumable } };
      v = applyToVessel('TANK', v, t.conv, o);
      expect(compareRows(expectedRows('TANK', t.conv, o), storedRows('TANK', v, o), false).ok, t.name).toBe(true);
    }
    for (const ref of marsol.tanks) {
      const got = v.tanks.find((t) => t.name === ref.name)!;
      expect(got.capacity, ref.name).toBeCloseTo(ref.capacity, 9);
      got.calibration.forEach((r, i) => {
        const e = ref.calibration[i];
        for (const k of ['volume', 'lcg', 'tcg', 'vcg', 'inertia'] as const) expect(r[k], `${ref.name} row ${i} ${k}`).toBeCloseTo(e[k], 9);
      });
    }
  });
});

describe('other layouts', () => {
  const def = datasetDef('TANK');
  it('one long table with a tank-name column', () => {
    const rows = parseCsv('Tank;Volume;LCG;TCG;VCG;FSM\nFO1;0;10;0;0.1;0\nFO1;10;10.1;0;0.5;12\nFO1;20;10.2;0;0.9;14\nFW2;0;30;1;0.1;0\nFW2;5;30;1;0.4;3\nFW2;10;30;1;0.7;4\n');
    const t: SourceTable = { id: 't', label: 'CSV', rows };
    const blocks = splitTanks([t], 'COLUMN', { nameCol: 0 });
    expect(blocks.map((b) => b.name)).toEqual(['FO1', 'FW2']);
    const m = autoMapping(def, blocks[0].rows, '.', 57.4);
    const imp = buildTankImports(blocks, m, marsol, true);
    expect(imp.map((x) => x.conv.rows.length)).toEqual([3, 3]);
    expect(imp.map((x) => x.group)).toEqual(['FUEL_OIL', 'FRESH_WATER']);
  });
  it('one sheet per tank', () => {
    const mk = (name: string): SourceTable => ({ id: name, label: `Sheet "${name}"`, rows: parseCsv('Sounding;Volume;LCG;TCG;VCG;Inertia\n0;0;5;0;0;0\n0.5;4;5;0;0.25;8\n1.0;8;5;0;0.5;8\n') });
    const blocks = splitTanks([mk('WB1 P'), mk('WB1 S')], 'TABLE');
    expect(blocks.map((b) => b.name)).toEqual(['WB1 P', 'WB1 S']);
    const imp = buildTankImports(blocks, autoMapping(def, blocks[0].rows, '.', 57.4), marsol, true);
    expect(imp.every((x) => x.conv.rows.length === 3 && x.conv.stats.cellsError === 0)).toBe(true);
  });
});

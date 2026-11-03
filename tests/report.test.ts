// Report generation: PDF and Excel are produced and carry the calculated values.
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { calculate } from '../src/engine/stability';
import { VESSELS } from '../src/data/vessels';
import { buildPdf } from '../src/report/pdf';
import { buildXlsx } from '../src/report/excel';
import { reportHash, type ReportInput } from '../src/report/reportData';

const marsol = VESSELS.find((v) => v.id === 'marsol-splendor')!;
const lc = marsol.defaultLoadCases.find((c) => c.id === 'marsol-C2')!;
const r = calculate(marsol.vessel, { ...lc, criteriaGroups: ['OSV_INTACT', 'IS2008_WEATHER', 'BV_FIFI'] });
const input: ReportInput = {
  vessel: marsol.vessel, lc, r,
  meta: { preparedBy: 'Chief Officer', checkedBy: 'Master', remarks: 'Test', dataStatus: 'UNVERIFIED', dataSource: marsol.source, createdAt: new Date('2026-11-03T10:00:00Z') },
  allCases: marsol.defaultLoadCases.slice(0, 3).map((c) => ({ lc: c, r: calculate(marsol.vessel, c), error: null })),
};

describe('reports', () => {
  it('the report id is a stable SHA-256 of inputs and results', async () => {
    const a = await reportHash(input), b = await reportHash({ ...input });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    const other = await reportHash({ ...input, lc: { ...lc, seaDensity: 1.02 }, r: calculate(marsol.vessel, { ...lc, seaDensity: 1.02 }) });
    expect(other).not.toBe(a);
  });
  it('PDF is produced with one section per stability group', async () => {
    const blob = await buildPdf(input);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(30000);
    const text = new TextDecoder('latin1').decode(bytes);
    const pages = (text.match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(3 + r.groups.length);
  });
  it('Excel workbook carries the same numbers as the calculation', async () => {
    const blob = await buildXlsx(input);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual(expect.arrayContaining(['Summary', 'Weights', 'Tanks', 'Criteria', 'All load cases', 'Trace']));
    expect(names.filter((x) => x.startsWith('GZ ')).length).toBe(r.groups.length);
    const weights = wb.getWorksheet('Weights')!;
    let disp: number | null = null;
    weights.eachRow((row) => { if (row.getCell(1).value === 'Displacement') disp = row.getCell(2).value as number; });
    expect(disp).toBeCloseTo(r.displacement, 9);
    const crit = wb.getWorksheet('Criteria')!;
    let count = 0;
    crit.eachRow((row) => { if (row.getCell(8).value === 'PASS' || row.getCell(8).value === 'FAIL') count++; });
    expect(count).toBe(r.groups.reduce((s, g) => s + g.criteria.length, 0));
    const gz = wb.worksheets.find((w) => w.name.startsWith('GZ OSV'))!;
    const row20 = gz.getRows(1, gz.rowCount)!.find((x) => x.getCell(1).value === 20)!;
    expect(row20.getCell(5).value as number).toBeCloseTo(r.groups[0].table.find((t) => t.heel === 20)!.gz, 12);
  });
});

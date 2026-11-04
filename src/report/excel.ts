// Excel stability report (.xlsx, values only). Same content as the PDF, one sheet per topic and
// one GZ sheet per stability group, plus a summary of all load cases of the vessel.
import ExcelJS from 'exceljs';
import type { Results } from '../engine/types';
import { groupByType, typeTotals } from '../engine/tankTypes';
import {
  DISCLAIMER, conditionRows, criterionCells, particularsRows, reportHash, traceRows, type ReportInput,
} from './reportData';

const HEAD = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF1F3A5F' } };
const TITLE_FONT = { bold: true, size: 14, color: { argb: 'FF1F3A5F' } };

export async function buildXlsx(input: ReportInput): Promise<Blob> {
  const hash = await reportHash(input);
  const { vessel, lc, r, meta } = input;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'StabilitySoft';
  wb.created = meta.createdAt;
  wb.title = `Stability report ${vessel.name} ${lc.name}`;
  const used = new Set<string>();
  const sheetName = (s: string) => {
    let base = s.replace(/[\\/*?:[\]]/g, ' ').slice(0, 31).trim();
    let name = base, i = 2;
    while (used.has(name.toLowerCase())) { const suf = ` (${i++})`; name = base.slice(0, 31 - suf.length) + suf; }
    used.add(name.toLowerCase());
    return name;
  };
  const header = (ws: ExcelJS.Worksheet, cells: string[]) => {
    const row = ws.addRow(cells);
    row.eachCell((c) => { c.fill = HEAD; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.alignment = { wrapText: true, vertical: 'middle' }; });
    return row;
  };
  const kv = (ws: ExcelJS.Worksheet, rows: [string, string | number][]) => rows.forEach(([k, v]) => { const row = ws.addRow([k, v]); row.getCell(1).font = { bold: true }; });
  const title = (ws: ExcelJS.Worksheet, t: string) => {
    ws.addRow([t]).getCell(1).font = TITLE_FONT;
    ws.addRow([`${vessel.name} · IMO ${vessel.imo} · ${lc.name}`]);
    ws.addRow([DISCLAIMER + (meta.dataStatus === 'UNVERIFIED' ? ' Vessel data not verified.' : '')]).getCell(1).font = { color: { argb: 'FFC81E46' }, italic: true };
    ws.addRow([]);
  };

  // ---------- Summary ----------
  const s = wb.addWorksheet(sheetName('Summary'));
  s.columns = [{ width: 36 }, { width: 70 }];
  title(s, 'Intact Stability Report');
  kv(s, [['Load case', `${lc.name} (${lc.type})`], ['Date', meta.createdAt.toISOString().slice(0, 10)], ['Prepared by', meta.preparedBy || '—'], ['Checked by', meta.checkedBy || '—'],
    ['Overall result', r.overallPass ? 'PASS' : 'FAIL'], ['Remarks', meta.remarks || '—']]);
  const res = s.getRow(s.rowCount - 1).getCell(2);
  res.font = { bold: true, color: { argb: r.overallPass ? 'FF15803D' : 'FFC81E46' } };
  s.addRow([]); s.addRow(['Vessel particulars']).getCell(1).font = TITLE_FONT;
  kv(s, particularsRows(vessel));
  s.addRow([]); s.addRow(['Loading condition and initial stability']).getCell(1).font = TITLE_FONT;
  kv(s, conditionRows(vessel, lc, r));
  s.addRow([]); s.addRow(['Stability groups']).getCell(1).font = TITLE_FONT;
  for (const g of r.groups) {
    const row = s.addRow([g.name, `${g.error ? 'NOT EVALUATED' : g.passed ? 'PASS' : 'FAIL'} · ${g.criteria.filter((c) => c.passed).length}/${g.criteria.length} criteria · ${g.regulation}`]);
    row.getCell(2).font = { bold: true, color: { argb: g.passed ? 'FF15803D' : 'FFC81E46' } };
  }

  // ---------- Weights ----------
  const w = wb.addWorksheet(sheetName('Weights'));
  w.columns = [{ width: 34 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }];
  title(w, 'Weight summary');
  header(w, ['Item', 'Weight (t)', 'LCG (m from AP)', 'TCG (m, + stbd)', 'VCG (m)']);
  for (const x of r.summary) w.addRow([x.group, x.weight, x.lcg, x.tcg, x.vcg]);
  const tot = w.addRow(['Displacement', r.displacement, r.lcg, r.tcg, r.kg]); tot.font = { bold: true };
  w.addRow([]);
  header(w, ['Variable weight', 'Weight (t)', 'LCG (m from AP)', 'TCG (m, + stbd)', 'VCG (m)']);
  for (const x of lc.weights) w.addRow([x.description, x.weight, x.lcg, x.tcg, x.vcg]);
  numFmt(w, [2, 3, 4, 5], '0.000');

  // ---------- Tanks ----------
  const t = wb.addWorksheet(sheetName('Tanks'));
  t.columns = [{ width: 22 }, { width: 11 }, { width: 9 }, { width: 12 }, { width: 10 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 11 }];
  title(t, 'Tank status by tank type');
  header(t, ['Tank', 'Input', '%', 'Volume (m³)', 'ρ (t/m³)', 'Weight (t)', 'LCG (m)', 'TCG (m)', 'VCG (m)', 'FSM (t·m)']);
  for (const g of groupByType(vessel, vessel.tanks, (x) => x)) {
    const rs = g.items.map((x) => r.tanks.find((y) => y.tankId === x.id)).filter((x): x is NonNullable<typeof x> => !!x);
    const hr = t.addRow([`${g.type.name} (${g.items.length} tanks)`]);
    hr.font = { bold: true, color: { argb: 'FF1F3A5F' } };
    hr.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2ECEC' } };
    for (const k of rs) t.addRow([k.name, k.mode.toLowerCase(), k.percent, k.volume, k.density, k.weight, k.lcg, k.tcg, k.vcg, k.fsm]);
    const tot = typeTotals(rs);
    const cap = g.items.reduce((s2, x) => s2 + x.capacity, 0);
    const sr = t.addRow([`Subtotal ${g.type.name}`, '', cap > 0 ? (tot.volume / cap) * 100 : 0, tot.volume, '', tot.weight, tot.weight > 0 ? tot.lcg : '', tot.weight > 0 ? tot.tcg : '', tot.weight > 0 ? tot.vcg : '', tot.fsm]);
    sr.font = { bold: true };
  }
  numFmt(t, [3, 4, 5, 6, 7, 8, 9, 10], '0.000');
  t.views = [{ state: 'frozen', ySplit: 5 }];

  // ---------- Criteria ----------
  const c = wb.addWorksheet(sheetName('Criteria'));
  c.columns = [{ width: 34 }, { width: 24 }, { width: 60 }, { width: 18 }, { width: 14 }, { width: 12 }, { width: 11 }, { width: 9 }, { width: 60 }];
  title(c, 'Stability criteria');
  header(c, ['Stability group', 'Regulation', 'Criterion', 'Required', 'Actual', 'Margin', 'Margin %', 'Status', 'Explanation']);
  for (const g of r.groups) {
    if (g.error) { c.addRow([g.name, g.regulation, g.error, '', '', '', '', 'NOT EVALUATED']); continue; }
    for (const k of g.criteria) {
      const cells = criterionCells(k);
      const row = c.addRow([g.name, cells[0], cells[1], cells[2], k.actual, k.marginAbs, k.marginPct, cells[6], k.explanation ?? '']);
      row.getCell(8).font = { bold: true, color: { argb: k.passed ? 'FF15803D' : 'FFC81E46' } };
      row.getCell(5).numFmt = k.unit === 'm·rad' ? '0.0000' : '0.000';
      row.getCell(6).numFmt = k.unit === 'm·rad' ? '0.0000' : '0.000';
      row.getCell(7).numFmt = '0.0';
    }
  }
  c.views = [{ state: 'frozen', ySplit: 5 }];

  // ---------- operational limits ----------
  const ol = wb.addWorksheet(sheetName('Operational limits'));
  ol.columns = [{ width: 34 }, { width: 8 }, { width: 12 }, { width: 12 }, { width: 8 }, { width: 12 }, { width: 60 }];
  title(ol, 'Operational limits (separate from the stability criteria)');
  header(ol, ['Limit', 'In use', 'Required', 'Actual', 'Unit', 'Status', 'Note']);
  for (const x of r.opLimits) {
    const row = ol.addRow([x.label, x.enabled ? 'yes' : 'no', x.limit, x.actual, x.unit, x.enabled ? (x.passed ? 'PASS' : 'FAIL') : 'not used', x.note ?? '']);
    if (x.enabled) row.getCell(6).font = { bold: true, color: { argb: x.passed ? 'FF15803D' : 'FFC81E46' } };
  }
  numFmt(ol, [3, 4], '0.000');

  // ---------- one GZ sheet per group ----------
  for (const g of r.groups) {
    if (g.error) continue;
    const gs = wb.addWorksheet(sheetName(`GZ ${g.name}`));
    title(gs, `GZ table: ${g.name}`);
    const heads = ['Heel (°)', 'KN (m)', 'KG·sin φ (m)', 'TCG·cos φ (m)', 'GZ (m)', ...g.moments.map((m) => `Heeling arm (m): ${m.name}`), ...(g.moments.length ? ['Residual arm (m)'] : [])];
    header(gs, heads);
    for (const row of g.table) gs.addRow([row.heel, row.kn, row.kgSin, row.tcgCos, row.gz, ...row.arms, ...(row.residual !== null ? [row.residual] : [])]);
    gs.columns.forEach((col, i) => { col.width = i < 5 ? 13 : 24; });
    numFmt(gs, heads.map((_, i) => i + 2), '0.0000');
    gs.views = [{ state: 'frozen', ySplit: 5 }];
    if (g.moments.length) {
      gs.addRow([]);
      for (const m of g.moments) {
        gs.addRow([`Moment calculation: ${m.name}`]).getCell(1).font = { bold: true };
        gs.addRow(['Formula', m.formula]);
        for (const i of m.inputs) gs.addRow([i.name, i.source, i.value ?? 'each angle θ', i.unit]);
        if (m.note) gs.addRow(['Note', m.note]);
        header(gs, ['Heel (°)', 'Moment (t·m)', 'Heeling arm (m)']);
        for (const x of m.rows) gs.addRow([x.heel, x.moment ?? '', x.arm]);
        gs.addRow([]);
      }
    }
  }

  // ---------- all load cases ----------
  if (input.allCases?.length) {
    const a = wb.addWorksheet(sheetName('All load cases'));
    title(a, 'Summary of load cases');
    const groupIds = Array.from(new Set(input.allCases.flatMap((x) => x.r?.groups.map((g) => g.id) ?? [])));
    const names = groupIds.map((id) => input.allCases!.flatMap((x) => x.r?.groups ?? []).find((g) => g.id === id)!.name);
    header(a, ['Load case', 'Type', 'Displacement (t)', 'Draft AP (m)', 'Draft FP (m)', 'Trim (m, + stern)', 'Heel (°, + stbd)', 'GM fluid (m)', ...names, 'Result']);
    for (const x of input.allCases) {
      if (!x.r) { a.addRow([x.lc.name, x.lc.type, `Cannot calculate: ${x.error}`]); continue; }
      const rr: Results = x.r;
      a.addRow([x.lc.name, x.lc.type, rr.displacement, rr.draftAP, rr.draftFP, rr.trim, rr.heel, rr.gmFluid,
        ...groupIds.map((id) => { const g = rr.groups.find((y) => y.id === id); return g ? (g.passed ? 'PASS' : 'FAIL') : '—'; }), rr.overallPass ? 'PASS' : 'FAIL']);
    }
    a.columns.forEach((col, i) => { col.width = i === 0 ? 44 : i < 8 ? 14 : 18; });
    numFmt(a, [3, 4, 5, 6, 7, 8], '0.000');
  }

  // ---------- warnings and trace ----------
  const tr = wb.addWorksheet(sheetName('Trace'));
  tr.columns = [{ width: 30 }, { width: 100 }];
  title(tr, 'Warnings and calculation trace');
  header(tr, ['Warning', 'Message']);
  if (r.warnings.length) r.warnings.forEach((x) => tr.addRow([x.code, x.message])); else tr.addRow(['—', 'No warnings']);
  tr.addRow([]);
  header(tr, ['Trace', '']);
  kv(tr, traceRows(input, hash));

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function numFmt(ws: ExcelJS.Worksheet, cols: number[], fmt: string) {
  ws.eachRow((row) => cols.forEach((ci) => { const cell = row.getCell(ci); if (typeof cell.value === 'number') cell.numFmt = fmt; }));
}

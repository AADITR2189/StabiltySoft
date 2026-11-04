// PDF stability report (A4 portrait). Built with jsPDF + autoTable, DejaVu Sans embedded for
// Greek letters and maths symbols. Graphs are drawn as vector lines from the calculated data.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { CriteriaGroupResult, Results } from '../engine/types';
import { ENGINE_VERSION } from '../engine/stability';
import { DEJAVU_BOLD, DEJAVU_REGULAR } from './fonts/dejavu';
import {
  DISCLAIMER, conditionRows, criterionCells, n, particularsRows, reportHash, tankRowsByType, traceRows, weightRows, type ReportInput,
} from './reportData';

type Doc = jsPDF & { lastAutoTable?: { finalY: number } };
const M = 14; // page margin (mm)
const INK = [22, 25, 28] as const, MUTED = [80, 98, 110] as const, ACCENT = [244, 91, 11] as const, NAVY = [31, 58, 95] as const;
const PASS = [21, 128, 61] as const, FAIL = [200, 30, 70] as const;

export async function buildPdf(input: ReportInput): Promise<Blob> {
  const hash = await reportHash(input);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true }) as Doc;
  doc.addFileToVFS('DejaVuSans.ttf', DEJAVU_REGULAR);
  doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
  doc.addFileToVFS('DejaVuSans-Bold.ttf', DEJAVU_BOLD);
  doc.addFont('DejaVuSans-Bold.ttf', 'DejaVu', 'bold');
  doc.setFont('DejaVu', 'normal');
  doc.setProperties({ title: `Stability report ${input.vessel.name} ${input.lc.name}`, subject: 'Intact stability', creator: 'StabilitySoft' });

  const { vessel, lc, r, meta } = input;
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  let y = M;

  const table = (head: string[] | null, body: string[][], opts: Record<string, unknown> = {}) => {
    autoTable(doc, {
      head: head ? [head] : undefined, body, startY: y, margin: { left: M, right: M, top: 22, bottom: 18 },
      styles: { font: 'DejaVu', fontSize: 7.5, cellPadding: 1.2, textColor: [...INK], lineColor: [200, 205, 210], lineWidth: 0.1 },
      headStyles: { fillColor: [...NAVY], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 247, 249] },
      ...opts,
    });
    y = (doc.lastAutoTable?.finalY ?? y) + 5;
  };
  const heading = (text: string, size = 12) => {
    if (y > H - 40) { doc.addPage(); y = 24; }
    doc.setFont('DejaVu', 'bold'); doc.setFontSize(size); doc.setTextColor(...NAVY);
    doc.text(text, M, y); y += size === 12 ? 2 : 1.5;
    doc.setDrawColor(...ACCENT); doc.setLineWidth(0.5); doc.line(M, y, W - M, y); y += 4;
    doc.setFont('DejaVu', 'normal'); doc.setTextColor(...INK);
  };
  const para = (text: string, size = 8, color: readonly number[] = INK) => {
    doc.setFontSize(size); doc.setTextColor(color[0], color[1], color[2]);
    const lines = doc.splitTextToSize(text, W - 2 * M) as string[];
    if (y + lines.length * size * 0.42 > H - 20) { doc.addPage(); y = 24; }
    doc.text(lines, M, y); y += lines.length * size * 0.42 + 2;
    doc.setTextColor(...INK);
  };

  // ---------- title block ----------
  doc.setFont('DejaVu', 'bold'); doc.setFontSize(18); doc.setTextColor(...NAVY);
  doc.text('Intact Stability Report', M, y + 6); y += 12;
  doc.setFontSize(11); doc.setTextColor(...INK);
  doc.text(`${vessel.name}  ·  IMO ${vessel.imo}`, M, y); y += 6;
  doc.setFont('DejaVu', 'normal'); doc.setFontSize(10);
  doc.text(`Load case: ${lc.name}  (${lc.type})`, M, y); y += 5;
  doc.setFontSize(8.5); doc.setTextColor(...MUTED);
  doc.text(`Date: ${meta.createdAt.toISOString().slice(0, 10)}   Prepared by: ${meta.preparedBy || '—'}   Checked by: ${meta.checkedBy || '—'}`, M, y); y += 7;
  // overall result box
  const ok = r.overallPass;
  const box = ok ? PASS : FAIL; doc.setFillColor(box[0], box[1], box[2]); doc.roundedRect(M, y, W - 2 * M, 11, 1.5, 1.5, 'F');
  doc.setTextColor(255); doc.setFont('DejaVu', 'bold'); doc.setFontSize(12);
  doc.text(`${ok ? '✔ PASS' : '✖ FAIL'}   ${r.groups.filter((g) => g.passed).length} of ${r.groups.length} stability groups passed`, M + 4, y + 7.3);
  doc.setFont('DejaVu', 'normal'); doc.setTextColor(...INK); y += 16;
  if (meta.dataStatus !== 'VERIFIED') {
    para(meta.dataStatus === 'UNVERIFIED'
      ? 'Vessel data extracted from the stability booklet has NOT yet been verified. Results must not be used for operational decisions until the data is verified.'
      : 'Demo vessel data.', 8, FAIL);
  }
  if (meta.remarks) para(`Remarks: ${meta.remarks}`, 8.5);

  heading('1  Vessel particulars');
  table(null, particularsRows(vessel), { columnStyles: { 0: { cellWidth: 60, fontStyle: 'bold' } } });

  heading('2  Loading condition and initial stability');
  table(null, conditionRows(vessel, lc, r), { columnStyles: { 0: { cellWidth: 60, fontStyle: 'bold' } } });

  heading('3  Weight summary');
  table(['Item', 'Weight t', 'LCG m (AP)', 'TCG m', 'VCG m'], weightRows(r), { columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } } });
  if (lc.weights.length) {
    table(['Variable weight', 'Weight t', 'LCG m (AP)', 'TCG m', 'VCG m'], lc.weights.map((w) => [w.description, n(w.weight, 2), n(w.lcg, 3), n(w.tcg, 3), n(w.vcg, 3)]),
      { columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } } });
  }

  heading('4  Tank status by tank type');
  const tt = tankRowsByType(vessel, r);
  table(['Tank', 'Input', '%', 'Volume m³', 'ρ t/m³', 'Weight t', 'LCG m', 'TCG m', 'VCG m', 'FSM t·m'], tt.map((x) => x.cells), {
    styles: { font: 'DejaVu', fontSize: 6.8, cellPadding: 1 }, columnStyles: Object.fromEntries([2, 3, 4, 5, 6, 7, 8, 9].map((i) => [i, { halign: 'right' }])),
    didParseCell: (d: { section: string; row: { index: number }; column: { index: number }; cell: { styles: Record<string, unknown>; colSpan?: number } }) => {
      if (d.section !== 'body') return;
      const k = tt[d.row.index]?.kind;
      if (k === 'head') { d.cell.styles.fillColor = [226, 236, 236]; d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = [...NAVY]; }
      if (k === 'total') { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = [250, 250, 250]; }
    },
  });
  para('Empty tanks are counted in the heading line of their type but not listed. LCG measured from AP; TCG positive to starboard.', 7, MUTED);

  heading('5  Stability criteria summary');
  table(['Stability group', 'Regulation', 'Criteria', 'Result'], r.groups.map((g) => [g.name, g.regulation, `${g.criteria.filter((c) => c.passed).length} / ${g.criteria.length}`, g.error ? 'NOT EVALUATED' : g.passed ? 'PASS' : 'FAIL']),
    { didParseCell: statusColour(3) });

  // ---------- one section per group ----------
  r.groups.forEach((g, gi) => {
    doc.addPage(); y = 24;
    heading(`${6 + gi}  ${g.name}`);
    para(`${g.regulation}. ${g.description}`, 7.5, MUTED);
    if (g.error) { para(g.error, 8.5, FAIL); return; }
    drawGroupChart(doc, M, y, W - 2 * M, 72, r, g);
    y += 77;
    table(['Ref', 'Criterion', 'Required', 'Actual', 'Margin', 'Margin %', 'Status'], g.criteria.map(criterionCells),
      { columnStyles: { 0: { cellWidth: 26 }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } }, didParseCell: statusColour(6) });
    for (const c of g.criteria) if (c.explanation) para(`${c.code}: ${c.explanation}`, 7.2, FAIL);
    const armHeads = g.moments.map((m) => `Arm: ${m.name}`.slice(0, 40));
    table(['Heel °', 'KN m', 'KG·sin φ', 'TCG·cos φ', 'GZ m', ...armHeads, ...(g.moments.length ? ['Residual m'] : [])],
      g.table.map((t) => [String(t.heel), n(t.kn, 3), n(t.kgSin, 3), n(t.tcgCos, 3), n(t.gz, 3), ...t.arms.map((a) => n(a, 4)), ...(t.residual !== null ? [n(t.residual, 3)] : [])]),
      { styles: { font: 'DejaVu', fontSize: 6.8, cellPadding: 0.9, halign: 'right' } });
    for (const m of g.moments) {
      para(`Moment calculation: ${m.name}   ${m.formula}`, 7.5);
      if (m.inputs.length) table(['Symbol', 'Taken from', 'Value'], m.inputs.map((i) => [i.name, i.source, i.value === null ? 'each angle θ' : `${n(i.value, 4)} ${i.unit}`]), { styles: { font: 'DejaVu', fontSize: 6.8, cellPadding: 0.9 } });
      if (m.note) para(m.note, 7, MUTED);
    }
  });

  // ---------- warnings and trace ----------
  doc.addPage(); y = 24;
  heading(`${6 + r.groups.length}  Warnings`);
  if (r.warnings.length) table(['Code', 'Message'], r.warnings.map((w) => [w.code, w.message]), { columnStyles: { 0: { cellWidth: 42 } } });
  else para('No warnings.');
  heading(`${7 + r.groups.length}  Calculation trace`);
  table(null, traceRows(input, hash), { columnStyles: { 0: { cellWidth: 45, fontStyle: 'bold' } } });
  para('The SHA-256 identifies this exact calculation (inputs and results). Recalculating the same load case with the same data and engine version gives the same value.', 7, MUTED);

  // ---------- header and footer on every page ----------
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7); doc.setTextColor(...MUTED);
    if (i > 1) {
      doc.text(`${vessel.name} · ${lc.name}`, M, 12);
      doc.text('StabilitySoft · Intact stability report', W - M, 12, { align: 'right' });
      doc.setDrawColor(200, 205, 210); doc.setLineWidth(0.2); doc.line(M, 14, W - M, 14);
    }
    doc.setDrawColor(200, 205, 210); doc.line(M, H - 13, W - M, H - 13);
    doc.text(`Report ${hash.slice(0, 12)} · engine ${ENGINE_VERSION}`, M, H - 9);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 9, { align: 'right' });
    doc.setTextColor(...FAIL);
    doc.text(DISCLAIMER + (meta.dataStatus === 'UNVERIFIED' ? ' Vessel data not verified.' : ''), M, H - 5.5);
  }
  return doc.output('blob');
}

function statusColour(col: number) {
  return (data: { section: string; column: { index: number }; cell: { raw: unknown; styles: { textColor: unknown; fontStyle: string } } }) => {
    if (data.section !== 'body' || data.column.index !== col) return;
    const v = String(data.cell.raw);
    data.cell.styles.fontStyle = 'bold';
    data.cell.styles.textColor = v === 'PASS' ? [...PASS] : [...FAIL];
  };
}

// ---------- graph ----------
type Pt = { heel: number; gz: number };

function drawGroupChart(doc: Doc, x0: number, y0: number, w: number, h: number, r: Results, g: CriteriaGroupResult) {
  const pts: Pt[] = r.gzCurve;
  const wx = g.chart === 'WEATHER' ? r.weather : null;
  const xMin = wx ? Math.min(-10, Math.floor((wx.thetaR - 5) / 10) * 10) : 0;
  const xMax = pts[pts.length - 1]?.heel ?? 90;
  const tcgS = r.side * r.tcg;
  const neg: Pt[] = [];
  for (let a = xMin; a < 0; a++) { const p = pts[-a]; if (p) neg.push({ heel: a, gz: -p.gz - 2 * tcgS * Math.cos((a * Math.PI) / 180) }); }
  const curve = [...neg, ...pts];
  const gzAt = (xx: number) => interp(curve, xx);
  const arms = g.moments.map((m) => m.rows.map((row) => ({ heel: row.heel, gz: row.arm })));
  const all = [...curve.map((p) => p.gz), ...arms.flat().map((p) => p.gz)];
  const yMax = niceUp(Math.max(0.3, ...all) * 1.1), yMin = Math.min(0, niceDown(Math.min(...all) * 1.05));
  const L = 12, B = 9; // inner margins for labels
  const sx = (v: number) => x0 + L + ((v - xMin) / (xMax - xMin)) * (w - L - 2);
  const sy = (v: number) => y0 + ((yMax - v) / (yMax - yMin)) * (h - B);

  doc.setLineWidth(0.1); doc.setDrawColor(215, 220, 225); doc.setFontSize(6.5); doc.setTextColor(...MUTED);
  const yStep = step((yMax - yMin) / 6);
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax + 1e-9; v += yStep) {
    doc.line(sx(xMin), sy(v), sx(xMax), sy(v)); doc.text(v.toFixed(yStep < 0.1 ? 2 : 1), x0 + L - 1.5, sy(v) + 1, { align: 'right' });
  }
  for (let v = xMin; v <= xMax; v += 10) { doc.line(sx(v), sy(yMin), sx(v), sy(yMax)); doc.text(String(v), sx(v), y0 + h - B + 4, { align: 'center' }); }
  doc.setDrawColor(90, 100, 110); doc.setLineWidth(0.3);
  doc.line(sx(xMin), sy(0), sx(xMax), sy(0)); doc.line(sx(0), sy(yMin), sx(0), sy(yMax));
  doc.text(r.side < 0 ? 'Heel angle to port (°)' : 'Heel angle (°)', x0 + w / 2, y0 + h + 0.5, { align: 'center' });
  doc.text('GZ (m)', x0, y0 - 1.5);

  const fill = (from: number, to: number, level: (xx: number) => number, rgb: readonly number[], op: number) => {
    if (!(to > from)) return;
    const xs = [from, ...curve.filter((p) => p.heel > from && p.heel < to).map((p) => p.heel), to];
    const poly = [...xs.map((xx) => [sx(xx), sy(gzAt(xx))]), ...[...xs].reverse().map((xx) => [sx(xx), sy(level(xx))])];
    const d = poly.slice(1).map((p, i) => [p[0] - poly[i][0], p[1] - poly[i][1]]);
    const gs = (doc as unknown as { GState: new (o: object) => unknown }).GState;
    doc.setGState(new gs({ opacity: op }) as never);
    doc.setFillColor(rgb[0], rgb[1], rgb[2]);
    doc.lines(d, poly[0][0], poly[0][1], [1, 1], 'F', true);
    doc.setGState(new gs({ opacity: 1 }) as never);
  };
  const vline = (a: number, label: string, row: number, rgb: readonly number[] = [90, 100, 110]) => {
    if (a < xMin || a > xMax) return;
    doc.setDrawColor(rgb[0], rgb[1], rgb[2]); doc.setLineWidth(0.2); doc.setLineDashPattern([1, 1], 0);
    doc.line(sx(a), sy(yMin), sx(a), sy(yMax)); doc.setLineDashPattern([], 0);
    doc.setTextColor(rgb[0], rgb[1], rgb[2]); doc.text(label, sx(a) + 0.8, sy(yMax) + 3 + row * 3);
  };

  // areas from criteria
  if (wx && wx.thetaX !== null) {
    fill(wx.thetaR, wx.thetaX, () => wx.lw2, FAIL, 0.25);
    fill(wx.thetaX, wx.theta2, () => wx.lw2, PASS, 0.22);
  }
  for (const c of g.criteria) for (const v of c.viz ?? []) {
    if (v.type === 'area') fill(v.from, v.to, () => 0, [120, 170, 170], 0.3);
    if (v.type === 'residArea') fill(v.from, v.to, (xx) => interp(v.points.map((p) => ({ heel: p.heel, gz: p.arm })), xx), PASS, 0.22);
  }
  // heeling arms
  doc.setDrawColor(...ACCENT); doc.setLineWidth(0.35);
  arms.forEach((a) => polyline(doc, a.filter((p) => p.heel >= xMin && p.heel <= xMax).map((p) => [sx(p.heel), sy(p.gz)])));
  if (wx) { doc.line(sx(xMin), sy(wx.lw1), sx(xMax), sy(wx.lw1)); doc.line(sx(xMin), sy(wx.lw2), sx(xMax), sy(wx.lw2)); }
  // GZ curve
  doc.setDrawColor(...NAVY); doc.setLineWidth(0.6);
  polyline(doc, curve.map((p) => [sx(p.heel), sy(p.gz)]));
  // markers
  let row = 0;
  if (wx) { vline(wx.thetaR, `θ0−θ1 ${wx.thetaR.toFixed(1)}°`, row++); vline(wx.theta0, `θ0 ${wx.theta0.toFixed(1)}°`, row++); vline(wx.theta2, `θ2 ${wx.theta2.toFixed(1)}°`, row++); }
  for (const c of g.criteria) for (const v of c.viz ?? []) if (v.type === 'vline') vline(v.angle, v.label, row++ % 4);
  if (r.floodAngle < xMax) vline(r.floodAngle, `θf ${r.floodAngle.toFixed(1)}°`, 4, FAIL);
  doc.setFillColor(...ACCENT); doc.circle(sx(r.gzMaxAngle), sy(r.gzMax), 0.8, 'F');
  doc.setTextColor(...INK); doc.text(`GZmax ${r.gzMax.toFixed(3)} m @ ${r.gzMaxAngle.toFixed(1)}°`, sx(r.gzMaxAngle) + 1.5, sy(r.gzMax) - 1.5);
  // legend
  doc.setFontSize(6.3); let lx = x0 + L;
  const legend = (rgb: readonly number[], text: string) => { doc.setDrawColor(rgb[0], rgb[1], rgb[2]); doc.setLineWidth(0.6); doc.line(lx, y0 + h + 4, lx + 5, y0 + h + 4); doc.setTextColor(...INK); doc.text(text, lx + 6, y0 + h + 5); lx += doc.getTextWidth(text) + 12; };
  legend(NAVY, 'GZ');
  if (arms.length || wx) legend(ACCENT, wx ? 'Wind levers l_w1, l_w2' : 'Heeling arm(s)');
  legend(FAIL, 'Flooding angle θf');
}

function polyline(doc: jsPDF, p: number[][]) {
  if (p.length < 2) return;
  doc.lines(p.slice(1).map((q, i) => [q[0] - p[i][0], q[1] - p[i][1]]), p[0][0], p[0][1], [1, 1], 'S', false);
}
function interp(c: Pt[], x: number): number {
  if (x <= c[0].heel) return c[0].gz;
  for (let i = 0; i < c.length - 1; i++) if (c[i].heel <= x && x <= c[i + 1].heel) {
    const t = (x - c[i].heel) / (c[i + 1].heel - c[i].heel || 1); return c[i].gz + t * (c[i + 1].gz - c[i].gz);
  }
  return c[c.length - 1].gz;
}
function step(raw: number) { const p = 10 ** Math.floor(Math.log10(raw)); const q = raw / p; return (q <= 1 ? 1 : q <= 2 ? 2 : q <= 5 ? 5 : 10) * p; }
function niceUp(v: number) { const s = step(v / 5); return Math.ceil(v / s) * s; }
function niceDown(v: number) { if (v >= 0) return 0; const s = step(-v / 3); return Math.floor(v / s) * s; }

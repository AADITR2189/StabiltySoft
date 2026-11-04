// Windage from the booklet's "wind heeling moment derivation" tables of the loading conditions:
// each table lists the parts of the lateral windage (area LPA, height of its centre above the
// waterline HCP, lever Arm to the underwater centre, pressure, moment). With the draft of that
// condition this gives one windage row: A = ΣLPA, centroid above base = Σ LPA·(HCP + T) / A,
// underwater centre above base = T − (Arm − HCP). The printed total moment is re-calculated as a check.
import type { SourceTable } from './sources';

export interface WindPart { name: string; area: number; hcp: number; arm: number; pressure: number; moment: number; row: number; ok: boolean }
export interface WindCase {
  key: string;
  page: number;
  condition: string;
  draft: number | null;
  draftText: string;
  draftPage: number | null;
  parts: WindPart[];
  printedTotal: number | null;
  area: number;
  centroidZ: number;
  underwaterCentroidZ: number;
  depthSpread: number;
  recomputed: number;
  partsSum: number;
  issues: { level: 'error' | 'warn'; text: string }[];
}

const rowText = (r: string[]) => r.filter((c) => c.trim()).join(' ').replace(/\s+/g, ' ').trim();
const N = String.raw`(-?\d[\d,]*\.?\d*)`;
const PART = new RegExp(String.raw`^(.+?)\s+${N}\s+${N}\s+${N}\s+${N}\s+${N}$`);
const num = (s: string) => Number(s.replace(/,/g, ''));

/** Largest difference explained by the rounding of the printed area, arm and pressure (plus the moment's last digit). */
function roundingTol(a: string, _h: string, arm: string, p: string, product: number): number {
  const half = (x: string) => { const i = x.indexOf('.'); return 0.5 * 10 ** -(i < 0 ? 0 : x.length - i - 1); };
  const rel = half(a) / Math.max(num(a), 1e-9) + half(arm) / Math.max(num(arm), 1e-9) + half(p) / Math.max(num(p), 1e-9);
  return Math.abs(product) * rel + 0.011;
}

const CONDITION = /^(?:\d+(?:\.\d+)*\s+)?(?:loading\s+)?condition\s*(?:no\.?\s*)?\d+/i;
/** A numbered section heading in capitals, e.g. "9 SAMPLE CALCULATIONS": the scan for the condition stops there. */
const SECTION = /^\d+(?:\.\d+)*\s+[A-Z][A-Z0-9 ,.:()&/–-]{3,}$/;

export const DEFAULT_HEADING = 'heeling moment derivation|wind heeling moment calculation|windage calculation';
export const DEFAULT_DRAFT = String.raw`draft\s*(?:at\s*)?(?:ms|midship|amidships?|mean)\b\.?\s*[:=]?\s*(\d+[.,]\d+)`;

export function findWindCases(tables: SourceTable[], opts: { heading?: string; draft?: string } = {}): WindCase[] {
  let head: RegExp, dr: RegExp;
  try { head = new RegExp(opts.heading || DEFAULT_HEADING, 'i'); dr = new RegExp(opts.draft || DEFAULT_DRAFT, 'i'); } catch { return []; }
  const texts = tables.map((t) => t.rows.map(rowText));
  const out: WindCase[] = [];
  tables.forEach((t, ti) => {
    const start = texts[ti].findIndex((x) => head.test(x));
    if (start < 0) return;
    const parts: WindPart[] = [];
    let printedTotal: number | null = null;
    for (let i = start + 1; i < texts[ti].length; i++) {
      const x = texts[ti][i];
      const tm = /total\s+wind\s+heeling\s+moment\s*[:=]?\s*(-?[\d,]*\.?\d+)/i.exec(x);
      if (tm) { printedTotal = num(tm[1]); break; }
      const m = PART.exec(x);
      if (m && /[a-z]/i.test(m[1])) {
        const [area, hcp, arm, pressure, moment] = [m[2], m[3], m[4], m[5], m[6]].map(num);
        parts.push({ name: m[1], area, hcp, arm, pressure, moment, row: i, ok: Math.abs(pressure * area * arm - moment) <= roundingTol(m[2], m[3], m[4], m[5], pressure * area * arm) });
      }
    }
    if (!parts.length) return;
    // draft and condition title: scan back from the table, line by line, and stop at the
    // condition's title (or at the previous wind table), so a draft is never taken from another condition
    let draft: number | null = null, draftText = '', draftPage: number | null = null, condition = '';
    scan: for (let tj = ti; tj >= Math.max(0, ti - 20); tj--) {
      const lines = tj === ti ? texts[tj].slice(0, start) : texts[tj];
      for (let i = lines.length - 1; i >= 0; i--) {
        if (tj < ti && head.test(lines[i])) break scan;
        if (draft === null) { const m = dr.exec(lines[i]); if (m) { draft = Number(m[1].replace(',', '.')); draftText = m[0]; draftPage = tables[tj].page ?? null; } }
        if (CONDITION.test(lines[i])) { condition = lines[i].replace(/^[\d.\s]+/, '').slice(0, 80); break scan; }
        if (SECTION.test(lines[i])) break scan;
      }
    }
    const A = parts.reduce((s, p) => s + p.area, 0);
    const depths = parts.map((p) => p.arm - p.hcp);
    const depth = depths.reduce((s, d) => s + d, 0) / depths.length;
    const T = draft ?? NaN;
    const issues: WindCase['issues'] = [];
    if (draft === null) issues.push({ level: 'error', text: 'Draft of this condition not found: type it in' });
    if (!condition) issues.push({ level: 'warn', text: 'Not inside a numbered loading condition (sample or example page?): not used unless you tick it' });
    const bad = parts.filter((p) => !p.ok);
    if (bad.length) issues.push({ level: 'error', text: `Moment ≠ pressure × area × arm for ${bad.map((p) => p.name).join(', ')} (misread value?)` });
    const spread = Math.max(...depths) - Math.min(...depths);
    if (spread > 0.003) issues.push({ level: 'warn', text: `Arm − HCP differs between parts by ${spread.toFixed(3)} m (expected one underwater centre)` });
    const recomputed = parts.reduce((s, p) => s + p.pressure * p.area * p.arm, 0);
    const partsSum = parts.reduce((s, p) => s + p.moment, 0);
    if (printedTotal === null) issues.push({ level: 'warn', text: 'No printed total moment to check the parts against' });
    else if (Math.abs(partsSum - printedTotal) > Math.max(0.02, 0.002 * printedTotal)) issues.push({ level: 'error', text: `Part moments add up to ${partsSum.toFixed(2)}, the booklet total is ${printedTotal} (a part is missing or misread)` });
    out.push({
      key: `${t.id}`, page: t.page ?? ti + 1, condition, draft, draftText, draftPage, parts, printedTotal,
      area: A, centroidZ: parts.reduce((s, p) => s + p.area * (p.hcp + T), 0) / A, underwaterCentroidZ: T - depth,
      depthSpread: spread, recomputed, partsSum, issues,
    });
  });
  return out;
}

/** Recalculate a case after the draft was changed by hand. */
export function withDraft(c: WindCase, draft: number): WindCase {
  const depth = c.parts.reduce((s, p) => s + p.arm - p.hcp, 0) / c.parts.length;
  return { ...c, draft, draftText: `typed: ${draft}`, centroidZ: c.parts.reduce((s, p) => s + p.area * (p.hcp + draft), 0) / c.area, underwaterCentroidZ: draft - depth, issues: c.issues.filter((i) => !i.text.startsWith('Draft of this condition')) };
}

export interface WindRowOut { draft: number; area: number; centroidZ: number; underwaterCentroidZ: number; derived?: boolean; from: string }

/** One row per draft (equal drafts with equal values merged), sorted; optional straight-line extension to [lo, hi]. */
export function windRows(cases: WindCase[], extend?: { lo: number; hi: number }): { rows: WindRowOut[]; notes: string[]; conflicts: string[] } {
  const notes: string[] = [];
  const conflicts: string[] = [];
  const rows: WindRowOut[] = [];
  for (const c of [...cases].sort((a, b) => (a.draft ?? 0) - (b.draft ?? 0))) {
    if (c.draft === null) continue;
    const r: WindRowOut = { draft: c.draft, area: c.area, centroidZ: c.centroidZ, underwaterCentroidZ: c.underwaterCentroidZ, from: `page ${c.page}` };
    const same = rows.find((x) => Math.abs(x.draft - r.draft) < 0.0005);
    if (same) {
      if (Math.abs(same.area - r.area) < 0.05 && Math.abs(same.centroidZ - r.centroidZ) < 0.005) { same.from += `, ${r.from}`; continue; }
      conflicts.push(`Two tables at draft ${r.draft} m give different windage (${same.from}: ${same.area.toFixed(1)} m², ${r.from}: ${r.area.toFixed(1)} m²): untick the wrong one`);
      continue;
    }
    rows.push(r);
  }
  if (extend && rows.length >= 2) {
    const ext = (a: WindRowOut, b: WindRowOut, T: number): WindRowOut => {
      const f = (T - a.draft) / (b.draft - a.draft);
      const L = (k: 'area' | 'centroidZ' | 'underwaterCentroidZ') => a[k] + f * (b[k] - a[k]);
      return { draft: T, area: L('area'), centroidZ: L('centroidZ'), underwaterCentroidZ: L('underwaterCentroidZ'), derived: true, from: 'straight-line extension (derived)' };
    };
    if (extend.lo < rows[0].draft - 0.0005) { rows.unshift(ext(rows[0], rows[1], extend.lo)); notes.push(`Row at ${extend.lo} m is DERIVED by straight-line extension below the lowest condition draft; confirm with the designer.`); }
    const n = rows.length;
    if (extend.hi > rows[n - 1].draft + 0.0005) { rows.push(ext(rows[n - 2], rows[n - 1], extend.hi)); notes.push(`Row at ${extend.hi} m is DERIVED by straight-line extension above the highest condition draft; confirm with the designer.`); }
  }
  return { rows, notes, conflicts };
}

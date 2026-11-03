// Engineering consistency checks on an imported table. They catch transcription errors that a
// per-cell check cannot: a swapped digit makes a column jump, a missed row breaks the TPC balance, etc.
import type { Vessel } from '../engine/types';
import type { DatasetKind } from './datasets';
import { numVal, type Conversion } from './convert';
import { isTotalRow, lightshipTotals } from './apply';

export interface Check { level: 'error' | 'warn' | 'ok'; title: string; detail?: string; rows?: number[] }

const col = (c: Conversion, k: string) => c.rows.map((r) => numVal(r.cells[k]));

function increasing(c: Conversion, k: string, label: string, strict = true): Check {
  const v = col(c, k);
  const bad: number[] = [];
  for (let i = 1; i < v.length; i++) {
    const a = v[i - 1], b = v[i];
    if (a === undefined || b === undefined) continue;
    if (strict ? b <= a : b < a) bad.push(c.rows[i].src);
  }
  return bad.length
    ? { level: 'error', title: `${label} must ${strict ? 'increase' : 'not decrease'} from row to row`, detail: `Breaks at source row(s) ${bad.map((x) => x + 1).join(', ')}.`, rows: bad }
    : { level: 'ok', title: `${label} ${strict ? 'increases' : 'never decreases'} row by row` };
}

/**
 * A mistyped digit shows as one value out of line with BOTH neighbours: its residual against the
 * neighbour average is large, and the neighbours' residuals are about half as large with the
 * opposite sign. A real change of slope in the curve (knuckle, deck edge) does not give that pattern.
 */
export function spikes(v: (number | undefined)[], tol: number): number[] {
  if (v.length < 5 || v.some((x) => x === undefined)) return [];
  const r = v.map((x, i) => (i === 0 || i === v.length - 1 ? 0 : x! - (v[i - 1]! + v[i + 1]!) / 2));
  const abs = r.slice(1, -1).map(Math.abs).sort((a, b) => a - b);
  const q = abs[Math.floor(abs.length / 4)];
  const out: number[] = [];
  for (let i = 1; i < v.length - 1; i++) {
    const e = r[i];
    if (Math.abs(e) <= Math.max(tol, 4 * q)) continue;
    const both = i > 1 && i < v.length - 2;
    const nb = [i > 1 ? r[i - 1] : null, i < v.length - 2 ? r[i + 1] : null].filter((x): x is number => x !== null);
    const [lo, hi] = both ? [0.25, 0.8] : [0.35, 0.65];
    if (nb.length && nb.every((x) => Math.sign(x) === -Math.sign(e) && Math.abs(x) > lo * Math.abs(e) && Math.abs(x) < hi * Math.abs(e))) out.push(i);
  }
  return out;
}

function smoothness(c: Conversion, k: string, label: string, tol: number): Check | null {
  const v = col(c, k);
  if (v.length < 5 || v.some((x) => x === undefined)) return null;
  const bad = spikes(v, tol);
  if (!bad.length) return { level: 'ok', title: `${label}: no single value out of line with its neighbours` };
  return { level: 'warn', title: `${label}: value out of line with both neighbours`, detail: `Check source row(s) ${bad.map((i) => c.rows[i].src + 1).join(', ')} for a mistyped digit.`, rows: bad.map((i) => c.rows[i].src) };
}

function within(c: Conversion, k: string, label: string, lo: number, hi: number, why: string): Check {
  const bad = c.rows.filter((r) => { const x = numVal(r.cells[k]); return x !== undefined && (x < lo || x > hi); }).map((r) => r.src);
  return bad.length ? { level: 'warn', title: `${label} outside ${lo.toFixed(2)} … ${hi.toFixed(2)} m (${why})`, detail: `Source row(s) ${bad.map((x) => x + 1).join(', ')}.`, rows: bad } : { level: 'ok', title: `${label} within ${why}` };
}

export function checkConversion(kind: DatasetKind, c: Conversion, v: Vessel, opts: { density?: number } = {}): Check[] {
  const out: Check[] = [];
  const L = v.lbp || 0, B = v.breadth || 0;
  const s = c.stats;
  out.push(s.cellsError ? { level: 'error', title: `${s.cellsError} of ${s.cellsRead} cells could not be read as numbers`, detail: 'Fix the column mapping, the decimal separator, or edit the marked cells.' }
    : { level: 'ok', title: `All ${s.cellsRead} cells read; every number re-read digit by digit and matches the source text` });
  out.push({ level: c.rows.length ? 'ok' : 'error', title: `${c.rows.length} data rows + ${c.skipped.length} skipped = ${s.rowsInRange} rows in the selected range`, detail: c.skipped.length ? 'Skipped rows are listed below the table; make sure none of them holds data.' : undefined });
  const missingReq = c.rows.flatMap((r) => Object.entries(r.cells).filter(([, x]) => x.status === 'empty').map(() => r.src));
  if (missingReq.length) out.push({ level: 'warn', title: 'Some cells are empty', detail: `Source row(s) ${[...new Set(missingReq)].map((x) => x + 1).join(', ')}.`, rows: missingReq });
  if (c.rows.length < 2 && kind !== 'OPENINGS' && kind !== 'WEIGHTS') out.push({ level: 'error', title: 'At least 2 rows are needed for interpolation' });

  if (kind === 'HYDRO') {
    out.push(increasing(c, 'draft', 'Draft'), increasing(c, 'displacement', 'Displacement'));
    // TPC balance: ΔΔ ≈ mean TPC × 100 × Δdraft
    const T = col(c, 'draft'), D = col(c, 'displacement'), tpc = col(c, 'tpc');
    const bad: number[] = [];
    for (let i = 1; i < c.rows.length; i++) {
      if ([T[i], T[i - 1], D[i], D[i - 1], tpc[i], tpc[i - 1]].some((x) => x === undefined)) continue;
      const exp = ((tpc[i]! + tpc[i - 1]!) / 2) * 100 * (T[i]! - T[i - 1]!);
      const got = D[i]! - D[i - 1]!;
      if (Math.abs(got - exp) > Math.max(0.05 * Math.abs(exp), 1)) bad.push(c.rows[i].src);
    }
    out.push(bad.length ? { level: 'warn', title: 'Displacement change does not match TPC × draft change (± 5 %)', detail: `Source row(s) ${bad.map((x) => x + 1).join(', ')}. Typical cause: a mistyped displacement, draft or TPC.`, rows: bad }
      : { level: 'ok', title: 'Displacement change matches TPC × draft change on every row (± 5 %)' });
    if (L) out.push(within(c, 'lcb', 'LCB', 0, L, 'the ship length'), within(c, 'lcf', 'LCF', 0, L, 'the ship length'));
    if (B) out.push(within(c, 'kmt', 'KMT', 0, 5 * B, 'plausible range'));
    for (const [k, l, t] of [['displacement', 'Displacement', 3], ['kmt', 'KMT', 0.05], ['lcb', 'LCB', 0.03], ['tpc', 'TPC', 0.08], ['mtc', 'MTC', 0.8]] as const) {
      const x = smoothness(c, k, l, t); if (x) out.push(x);
    }
  }
  if (kind === 'KN') {
    out.push(increasing(c, 'displacement', 'Displacement'));
    const kn0 = c.rows.length && c.rows[0].kn ? c.rows[0].kn.length : 0;
    out.push(kn0 >= 3 ? { level: 'ok', title: `${kn0} heel-angle columns` } : { level: 'error', title: 'Fewer than 3 heel-angle columns mapped' });
    const neg = c.rows.filter((r) => r.kn?.some((x) => typeof x.value === 'number' && x.value < 0)).map((r) => r.src);
    out.push(neg.length ? { level: 'warn', title: 'Negative KN values', detail: `Source row(s) ${neg.map((x) => x + 1).join(', ')}.`, rows: neg } : { level: 'ok', title: 'No negative KN values' });
    if (kn0) {
      const bad: number[] = [];
      for (let j = 0; j < kn0; j++) {
        const v2 = c.rows.map((r) => (typeof r.kn![j].value === 'number' ? (r.kn![j].value as number) : undefined));
        bad.push(...spikes(v2, 0.02).map((i) => c.rows[i].src));
      }
      out.push(bad.length ? { level: 'warn', title: 'KN value out of line with both neighbours', detail: `Check source row(s) ${[...new Set(bad)].map((x) => x + 1).join(', ')}.`, rows: bad } : { level: 'ok', title: 'KN columns: no single value out of line with its neighbours' });
    }
  }
  if (kind === 'TANK') {
    out.push(increasing(c, 'volume', 'Volume', false));
    if (c.rows.some((r) => r.cells.sounding)) out.push(increasing(c, 'sounding', 'Sounding'));
    const vol = col(c, 'volume');
    const vmax = Math.max(...vol.filter((x): x is number => x !== undefined), 0);
    const pct = col(c, 'percent');
    if (pct.some((x) => x !== undefined) && vmax > 0) {
      const bad = c.rows.filter((_, i) => pct[i] !== undefined && vol[i] !== undefined && Math.abs((vol[i]! / vmax) * 100 - pct[i]!) > 0.6).map((r) => r.src);
      out.push(bad.length ? { level: 'warn', title: 'Filling % does not match volume ÷ capacity (± 0.6 %)', detail: `Source row(s) ${bad.map((x) => x + 1).join(', ')}.`, rows: bad } : { level: 'ok', title: 'Filling % matches volume ÷ capacity on every row' });
    }
    const w = col(c, 'weight');
    if (w.some((x) => x !== undefined) && opts.density) {
      const bad = c.rows.filter((_, i) => w[i] !== undefined && vol[i] !== undefined && Math.abs(vol[i]! * opts.density! - w[i]!) > Math.max(0.01 * w[i]!, 0.06)).map((r) => r.src);
      out.push(bad.length ? { level: 'warn', title: `Weight does not match volume × density ${opts.density} (± 1 %)`, detail: `Source row(s) ${bad.map((x) => x + 1).join(', ')}.`, rows: bad } : { level: 'ok', title: `Weight = volume × density ${opts.density} on every row` });
    }
    if (!c.rows.some((r) => r.cells.inertia || r.cells.fsm)) out.push({ level: 'warn', title: 'No free-surface column mapped', detail: 'The tank will have no free surface moment (i_T = 0).' });
    if (L) out.push(within(c, 'lcg', 'LCG', 0, L, 'the ship length'));
    if (B) out.push(within(c, 'tcg', 'TCG', -B / 2, B / 2, 'the ship breadth'));
    const x = smoothness(c, 'vcg', 'VCG', 0.05); if (x) out.push(x);
  }
  if (kind === 'WINDAGE') {
    out.push(increasing(c, 'draft', 'Draft'));
    const a = col(c, 'area');
    const up = a.findIndex((x, i) => i > 0 && x !== undefined && a[i - 1] !== undefined && x > a[i - 1]!);
    out.push(up > 0 ? { level: 'warn', title: 'Lateral area grows with draft', detail: `Source row ${c.rows[up].src + 1}: area above water should get smaller as draft increases.`, rows: [c.rows[up].src] } : { level: 'ok', title: 'Lateral area decreases as draft increases' });
    const bad = c.rows.filter((r) => { const z = numVal(r.cells.centroidZ), t = numVal(r.cells.draft); return z !== undefined && t !== undefined && z <= t; }).map((r) => r.src);
    out.push(bad.length ? { level: 'error', title: 'Centroid of windage is not above the waterline', rows: bad, detail: `Source row(s) ${bad.map((x) => x + 1).join(', ')}.` } : { level: 'ok', title: 'Windage centroid above the waterline on every row' });
  }
  if (kind === 'OPENINGS') {
    if (L) out.push(within(c, 'x', 'X', 0, L * 1.1, 'the ship length'));
    if (B) out.push(within(c, 'y', 'Y', -B / 2, B / 2, 'the ship breadth'));
    if (v.depth) out.push(within(c, 'z', 'Z', 0, v.depth * 6, 'plausible height'));
    const names = c.rows.map((r) => String(r.cells.name?.value ?? ''));
    const dup = names.filter((n, i) => n && names.indexOf(n) !== i);
    out.push(dup.length ? { level: 'warn', title: `Duplicate opening names: ${[...new Set(dup)].join(', ')}` } : { level: 'ok', title: 'Opening names are unique' });
  }
  if (kind === 'LIGHTSHIP') {
    const items = c.rows.filter((r) => !isTotalRow(r));
    const tot = c.rows.filter(isTotalRow);
    const t = lightshipTotals(items.map((r) => ({ weight: numVal(r.cells.weight) ?? 0, lcg: numVal(r.cells.lcg) ?? 0, tcg: numVal(r.cells.tcg) ?? 0, vcg: numVal(r.cells.vcg) ?? 0 })));
    out.push({ level: t.weight > 0 ? 'ok' : 'error', title: `${items.length} items: total ${t.weight.toFixed(2)} t, LCG ${t.lcg.toFixed(3)} m from AP, TCG ${t.tcg.toFixed(3)} m, VCG ${t.vcg.toFixed(3)} m` });
    if (tot.length === 1) {
      const T = tot[0];
      const diffs: string[] = [];
      const tw = numVal(T.cells.weight);
      if (tw !== undefined && Math.abs(tw - t.weight) > Math.max(0.001 * tw, 0.02)) diffs.push(`weight ${tw} vs sum ${t.weight.toFixed(2)} t`);
      for (const k of ['lcg', 'tcg', 'vcg'] as const) { const x = numVal(T.cells[k]); if (x !== undefined && Math.abs(x - t[k]) > 0.01) diffs.push(`${k.toUpperCase()} ${x.toFixed(3)} vs ${t[k].toFixed(3)} m`); }
      out.push(diffs.length ? { level: 'error', title: 'The items do not add up to the total line of the source', detail: `Source row ${T.src + 1}: ${diffs.join('; ')}. An item is missing, extra or misread.`, rows: [T.src] }
        : { level: 'ok', title: `Items add up to the total line of the source (row ${T.src + 1}): weight and centres agree` });
    } else if (tot.length > 1) out.push({ level: 'warn', title: `${tot.length} lines look like totals (skipped as items)`, detail: `Rows ${tot.map((r) => r.src + 1).join(', ')}.` });
    else out.push({ level: 'warn', title: 'No total line in the table to check the sum against', detail: 'Compare the total shown above with the lightship total in the booklet.' });
    if (L) out.push(within(c, 'lcg', 'LCG', -0.1 * L, 1.1 * L, 'the ship length'));
  }
  if (kind === 'WEIGHTS') {
    const neg = c.rows.filter((r) => (numVal(r.cells.weight) ?? 0) < 0).map((r) => r.src);
    if (neg.length) out.push({ level: 'warn', title: 'Negative weights (deductions)', detail: `Source row(s) ${neg.map((x) => x + 1).join(', ')}.`, rows: neg });
    const total = c.rows.reduce((s2, r) => s2 + (numVal(r.cells.weight) ?? 0), 0);
    out.push({ level: 'ok', title: `Total of imported weights: ${total.toFixed(3)} t` });
  }
  return out;
}

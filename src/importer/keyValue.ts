// Label / value lists ("LBP ........ 57.400 m", "Lightship LCG = 0.592 m AFT. of MIDSHIP"): general
// particulars and lightship totals. Each field is found by its label, the value is read from the text
// after the label, and words like "aft of midship" or "port" set the reference and sign.
import type { Vessel } from '../engine/types';
import type { Check } from './checks';
import { digitCheck, parseNum, type Decimal } from './numbers';

export type KvKind = 'PARTICULARS' | 'LIGHTSHIP_SUMMARY';

export interface KvField {
  key: string;
  label: string;
  unit: string;
  type: 'num' | 'text';
  pos?: 'X' | 'Y';
  required: boolean;
  /** used only for checks (e.g. LOA), not stored */
  checkOnly?: boolean;
  guess: RegExp;
}

export const KV_FIELDS: Record<KvKind, KvField[]> = {
  PARTICULARS: [
    { key: 'name', label: 'Ship name', unit: '', type: 'text', required: true, guess: /^\s*(ship'?s?\s*name|vessel\s*name|name\s*of\s*(ship|vessel)|name)\b/i },
    { key: 'imo', label: 'IMO number', unit: '', type: 'text', required: false, guess: /\bimo\b/i },
    { key: 'callSign', label: 'Call sign', unit: '', type: 'text', required: false, guess: /call\s*sign/i },
    { key: 'loa', label: 'Length over all (check only)', unit: 'm', type: 'num', required: false, checkOnly: true, guess: /\bloa\b|length\s*over\s*all|length\s*o\.?a/i },
    { key: 'lbp', label: 'Length between perpendiculars', unit: 'm', type: 'num', required: true, guess: /\blbp\b|\blpp\b|between\s*perp|length\s*b\.?p/i },
    { key: 'breadth', label: 'Breadth (moulded)', unit: 'm', type: 'num', required: true, guess: /breadth|beam|\bb\s*\(?mld/i },
    { key: 'depth', label: 'Depth (moulded)', unit: 'm', type: 'num', required: true, guess: /depth/i },
    { key: 'maxDraft', label: 'Load line (summer) draft', unit: 'm', type: 'num', required: false, guess: /summer\s*dr|load\s*line\s*dr|design\s*dr|scantling\s*dr|max\w*\s*dr|draught|draft/i },
    { key: 'rhoRef', label: 'Density of hydrostatic tables', unit: 't/m³', type: 'num', required: false, guess: /density|specific\s*gravity|\bsg\b/i },
    { key: 'bilgeKeelArea', label: 'Bilge keel area A_k', unit: 'm²', type: 'num', required: false, guess: /bilge\s*keel/i },
  ],
  LIGHTSHIP_SUMMARY: [
    { key: 'weight', label: 'Lightship weight', unit: 't', type: 'num', required: true, guess: /(light\s*ship|lightweight|light\s*weight)\s*(weight|displ|\(t|=|:|\s\d)|^\s*weight\b|displacement/i },
    { key: 'lcg', label: 'Lightship LCG', unit: 'm', type: 'num', pos: 'X', required: true, guess: /\blcg\b/i },
    { key: 'tcg', label: 'Lightship TCG', unit: 'm', type: 'num', pos: 'Y', required: false, guess: /\btcg\b/i },
    { key: 'vcg', label: 'Lightship VCG / KG', unit: 'm', type: 'num', required: true, guess: /\bvcg\b|\bkg\b/i },
  ],
};

export interface KvHit {
  key: string;
  /** source row index, -1 = not found */
  src: number;
  rowText: string;
  valueText: string;
  value: number | string | null;
  read?: number;
  status: 'ok' | 'missing' | 'error' | 'edited';
  note?: string;
}

const NUM_RE = /[-−+]?\(?\d[\d,' ]*(?:[.,]\d+)?\)?(?:\s*[afsp](?![a-z]))?/i;

export const rowText = (r: string[]) => r.filter((c) => c.trim()).join(' ').replace(/\s+/g, ' ').trim();

/** Read the value of one field from one source row. */
export function readKv(f: KvField, text: string, src: number, decimal: Decimal, lbp: number, defaultX: 'AP' | 'MID_FWD'): KvHit {
  const base = { key: f.key, src, rowText: text };
  const m = f.guess.exec(text);
  const after = m ? text.slice(m.index + m[0].length) : text;
  const rest = after.replace(/^[\s:=.…\-–—(]*(\((m|mld|t|mt|tonnes?)\)\s*)?[:=]?\s*/i, '');
  if (f.type === 'text') {
    let v = rest.trim();
    if (f.key === 'imo') v = (/\d{7}/.exec(v) ?? [''])[0];
    if (!v) return { ...base, valueText: rest, value: null, status: 'error', note: 'no text after the label' };
    if (f.key === 'imo' && !imoValid(v)) return { ...base, valueText: v, value: v, status: 'ok', note: 'IMO check digit does not match' };
    return { ...base, valueText: v, value: v, status: 'ok' };
  }
  const nm = NUM_RE.exec(rest);
  if (!nm) return { ...base, valueText: rest, value: null, status: 'error', note: 'no number after the label' };
  const vt = nm[0].trim().replace(/\s+(?=[afsp]$)/i, '');
  const p = parseNum(vt, decimal);
  if (!p) return { ...base, valueText: vt, value: null, status: 'error', note: `"${vt}" is not a number` };
  if (!digitCheck(vt, p.value, decimal)) return { ...base, valueText: vt, value: null, read: p.value, status: 'error', note: 'digit check failed' };
  const tail = rest.slice(nm.index + nm[0].length).toLowerCase();
  if (f.pos === 'X') {
    const aft = p.suffix === 'a' || /\baft\b|\baft\./.test(tail);
    const fwd = p.suffix === 'f' || /\bfwd\b|forward|\bfore\b|\bfd\b/.test(tail);
    const fromAP = /\ba\.?p\b|aft\s*perp/.test(tail) && !/mid/.test(tail);
    if (fromAP) return { ...base, valueText: vt, value: p.value, read: p.value, status: 'ok', note: 'from AP' };
    if (aft || fwd || /mid|amid|ms\b|⊗/.test(tail) || defaultX === 'MID_FWD') {
      const v = lbp / 2 + (aft ? -1 : 1) * p.value;
      if (!(lbp > 0)) return { ...base, valueText: vt, value: null, read: p.value, status: 'error', note: 'LBP needed to convert from midship' };
      return { ...base, valueText: vt, value: v, read: p.value, status: 'ok', note: `${p.value} ${aft ? 'aft' : 'fwd'} of midship → ${v.toFixed(3)} m from AP` };
    }
    return { ...base, valueText: vt, value: p.value, read: p.value, status: 'ok', note: 'taken as from AP' };
  }
  if (f.pos === 'Y') {
    const port = p.suffix === 'p' || /\bport\b|\bps\b|\(p\)/.test(tail);
    const v = port ? -p.value : p.value;
    return { ...base, valueText: vt, value: v === 0 ? 0 : v, read: p.value, status: 'ok', note: port ? `${p.value} to port → ${v} (+ = starboard)` : undefined };
  }
  if (p.suffix) return { ...base, valueText: vt, value: null, read: p.value, status: 'error', note: `unexpected letter "${p.suffix}"` };
  return { ...base, valueText: vt, value: p.value, read: p.value, status: 'ok' };
}

/** Find every field in the table: the first row whose text matches the field's label. */
export function kvExtract(kind: KvKind, rows: string[][], decimal: Decimal, lbp: number, defaultX: 'AP' | 'MID_FWD' = 'AP', pick: Record<string, number> = {}): KvHit[] {
  const texts = rows.map(rowText);
  const fields = KV_FIELDS[kind];
  // LBP first, so positions in the same list can be converted with it
  let L = lbp;
  const out: Record<string, KvHit> = {};
  const order = [...fields].sort((a, b) => (a.key === 'lbp' ? -1 : b.key === 'lbp' ? 1 : 0));
  for (const f of order) {
    const src = pick[f.key] ?? texts.findIndex((t) => f.guess.test(t) && (f.type === 'text' || NUM_RE.test(t.slice((f.guess.exec(t)?.index ?? 0)))));
    if (src < 0 || src >= texts.length) { out[f.key] = { key: f.key, src: -1, rowText: '', valueText: '', value: null, status: 'missing' }; continue; }
    out[f.key] = readKv(f, texts[src], src, decimal, L, defaultX);
    if (f.key === 'lbp' && typeof out.lbp.value === 'number') L = out.lbp.value;
  }
  return fields.map((f) => out[f.key]);
}

export function imoValid(imo: string): boolean {
  if (!/^\d{7}$/.test(imo)) return false;
  const d = imo.split('').map(Number);
  return d.slice(0, 6).reduce((s, x, i) => s + x * (7 - i), 0) % 10 === d[6];
}

const hv = (h: KvHit[], k: string) => { const x = h.find((y) => y.key === k); return typeof x?.value === 'number' ? x.value : undefined; };

export function checkKv(kind: KvKind, hits: KvHit[], v: Vessel): Check[] {
  const out: Check[] = [];
  const fields = KV_FIELDS[kind];
  const missing = fields.filter((f) => f.required && hits.find((h) => h.key === f.key)?.status === 'missing');
  const errs = hits.filter((h) => h.status === 'error');
  out.push(missing.length ? { level: 'error', title: `Not found: ${missing.map((f) => f.label).join(', ')}`, detail: 'Choose the source row for these fields, or type the value.' } : { level: 'ok', title: 'All required fields found' });
  out.push(errs.length ? { level: 'error', title: `${errs.length} value(s) could not be read`, detail: errs.map((h) => fields.find((f) => f.key === h.key)!.label).join(', ') } : { level: 'ok', title: 'Every value read and re-read digit by digit' });
  const rows = hits.filter((h) => h.src >= 0).map((h) => h.src);
  const dup = rows.filter((r, i) => rows.indexOf(r) !== i);
  if (dup.length) out.push({ level: 'warn', title: 'Two fields were read from the same source row', detail: `Row(s) ${[...new Set(dup)].map((r) => r + 1).join(', ')}: check the row choice.` });
  if (kind === 'PARTICULARS') {
    const L = hv(hits, 'lbp'), B = hv(hits, 'breadth'), D = hv(hits, 'depth'), T = hv(hits, 'maxDraft'), loa = hv(hits, 'loa'), rho = hv(hits, 'rhoRef');
    const imo = hits.find((h) => h.key === 'imo');
    if (imo?.value) out.push(imoValid(String(imo.value)) ? { level: 'ok', title: `IMO ${imo.value}: check digit correct` } : { level: 'warn', title: `IMO ${imo.value}: check digit does not match`, detail: 'A digit may be misread or mistyped.' });
    if (L && loa) out.push(loa >= L ? { level: 'ok', title: `LOA ${loa} m ≥ LBP ${L} m` } : { level: 'error', title: `LOA ${loa} m is shorter than LBP ${L} m` });
    if (L && B) out.push(L / B >= 2 && L / B <= 12 ? { level: 'ok', title: `L/B = ${(L / B).toFixed(2)} (plausible)` } : { level: 'warn', title: `L/B = ${(L / B).toFixed(2)} is unusual`, detail: 'Check LBP and breadth.' });
    if (B && D) out.push(B / D >= 1 && B / D <= 6 ? { level: 'ok', title: `B/D = ${(B / D).toFixed(2)} (plausible)` } : { level: 'warn', title: `B/D = ${(B / D).toFixed(2)} is unusual`, detail: 'Check breadth and depth.' });
    if (T && D) out.push(T < D ? { level: 'ok', title: `Draft ${T} m < depth ${D} m` } : { level: 'error', title: `Draft ${T} m is not less than depth ${D} m` });
    if (rho) out.push(rho >= 0.99 && rho <= 1.03 ? { level: 'ok', title: `Density ${rho} t/m³` } : { level: 'warn', title: `Density ${rho} t/m³ is unusual for sea / fresh water` });
  } else {
    const W = hv(hits, 'weight'), x = hv(hits, 'lcg'), y = hv(hits, 'tcg'), z = hv(hits, 'vcg');
    if (W !== undefined) out.push(W > 0 ? { level: 'ok', title: `Weight ${W} t > 0` } : { level: 'error', title: 'Lightship weight must be positive' });
    if (x !== undefined && v.lbp) out.push(x > 0 && x < v.lbp ? { level: 'ok', title: `LCG ${x.toFixed(3)} m from AP is within the ship length` } : { level: 'warn', title: `LCG ${x.toFixed(3)} m from AP is outside 0 … ${v.lbp} m` });
    if (y !== undefined && v.breadth) out.push(Math.abs(y) < v.breadth / 4 ? { level: 'ok', title: `TCG ${y} m (close to centreline)` } : { level: 'warn', title: `TCG ${y} m is far from the centreline` });
    if (z !== undefined && v.depth) out.push(z > 0 && z < 3 * v.depth ? { level: 'ok', title: `VCG ${z} m (plausible for depth ${v.depth} m)` } : { level: 'warn', title: `VCG ${z} m is unusual for depth ${v.depth} m` });
  }
  return out;
}

export function editKv(h: KvHit, f: KvField, text: string): KvHit {
  if (f.type === 'text') return { ...h, value: text.trim() || null, status: 'edited', note: `edited by hand (source: "${h.valueText}")` };
  const n = Number(text.replace(',', '.').replace('−', '-'));
  if (!text.trim() || !Number.isFinite(n)) return { ...h, status: 'error', note: `"${text}" is not a number` };
  return { ...h, value: n, status: 'edited', note: `edited by hand (source: "${h.valueText || 'not in source'}")` };
}

/** Apply: particulars or lightship totals into the vessel. Fields not found keep their old value. */
export function applyKv(kind: KvKind, v0: Vessel, hits: KvHit[]): Vessel {
  const v = structuredClone(v0);
  const get = (k: string) => hits.find((h) => h.key === k && h.status !== 'missing' && h.value !== null)?.value;
  if (kind === 'PARTICULARS') {
    for (const k of ['name', 'imo', 'callSign'] as const) { const x = get(k); if (typeof x === 'string') v[k] = x; }
    for (const k of ['lbp', 'breadth', 'depth', 'maxDraft', 'rhoRef', 'bilgeKeelArea'] as const) { const x = get(k); if (typeof x === 'number') v[k] = x; }
    if (typeof get('rhoRef') === 'number') { v.hydro.rhoRef = v.rhoRef; v.kn.rhoRef = v.rhoRef; }
    if (typeof get('bilgeKeelArea') === 'number' && v.bilgeKeelArea > 0) v.hasBilgeKeels = true;
  } else {
    v.lightship = { weight: get('weight') as number, lcg: get('lcg') as number, tcg: (get('tcg') as number | undefined) ?? 0, vcg: get('vcg') as number };
    v.lightshipItems = undefined;
  }
  return v;
}

/** Read back what was stored, as the list of values in field order (for the read-back comparison). */
export function kvStored(kind: KvKind, v: Vessel): (number | string | undefined)[] {
  return kind === 'PARTICULARS'
    ? KV_FIELDS.PARTICULARS.filter((f) => !f.checkOnly).map((f) => (v as unknown as Record<string, number | string | undefined>)[f.key])
    : [v.lightship.weight, v.lightship.lcg, v.lightship.tcg, v.lightship.vcg];
}
export function kvExpected(kind: KvKind, v0: Vessel, hits: KvHit[]): (number | string | undefined)[] {
  return kvStored(kind, v0).map((old, i) => {
    const f = KV_FIELDS[kind].filter((y) => !y.checkOnly)[i];
    const h = hits.find((y) => y.key === f.key);
    if (h && h.status !== 'missing' && h.value !== null) return h.value;
    return kind === 'LIGHTSHIP_SUMMARY' && f.key === 'tcg' ? 0 : old;
  });
}

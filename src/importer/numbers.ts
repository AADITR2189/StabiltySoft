// Number reading for imported tables. Two independent paths are used for every cell:
// parseNum() reads the value; digitCheck() rebuilds the number from the raw digits only and
// compares, so a misread digit, sign or decimal point is caught instead of silently stored.

export type Decimal = '.' | ',';

export interface ParsedNum {
  value: number;
  /** Direction letter written after the number in many booklets: a/f (aft/fwd), s/p (stbd/port). */
  suffix: '' | 'a' | 'f' | 's' | 'p';
}

const MINUS = /[−–—‒]/g;
const SPACES = /[\s   ']/g;

export function parseNum(raw: string, decimal: Decimal = '.'): ParsedNum | null {
  let s = raw.trim().replace(MINUS, '-');
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  let suffix: ParsedNum['suffix'] = '';
  const m = /^(.*?)\s*([afspAFSP])$/.exec(s);
  if (m && /\d/.test(m[1])) { suffix = m[2].toLowerCase() as ParsedNum['suffix']; s = m[1]; }
  s = s.replace(SPACES, '');
  const thousands = decimal === '.' ? ',' : '.';
  // thousands separators only between groups of three digits
  if (s.includes(thousands)) {
    if (!new RegExp(`^[-+]?\\d{1,3}(\\${thousands}\\d{3})+(\\${decimal}\\d*)?$`).test(s)) return null;
    s = s.split(thousands).join('');
  }
  if (decimal === ',') s = s.replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return null;
  let v = Number(s);
  if (!Number.isFinite(v)) return null;
  if (neg) v = -v;
  return { value: v === 0 ? 0 : v, suffix };
}

/** Independent re-read: keep only digits, sign and the decimal mark of the raw text and compare with the parsed value. */
export function digitCheck(raw: string, value: number, decimal: Decimal = '.'): boolean {
  const t = raw.replace(MINUS, '-');
  const negative = /^\s*\(/.test(t) || /^\s*-/.test(t);
  if (/e/i.test(t.replace(/[afsp]\s*$/i, ''))) return Math.abs(Number(t.replace(/[^\d.eE+-]/g, '')) - Math.abs(value)) <= 1e-12 * Math.max(1, Math.abs(value));
  let digits = '';
  let seenDec = false;
  for (const ch of t) {
    if (ch >= '0' && ch <= '9') digits += ch;
    else if (ch === decimal && !seenDec) { digits += '.'; seenDec = true; }
  }
  if (!digits || digits === '.') return false;
  const rebuilt = Number(digits) * (negative ? -1 : 1);
  return Math.abs(rebuilt - value) <= 1e-12 * Math.max(1, Math.abs(value));
}

/** Number of decimals written in the source text (used to show values exactly as printed). */
export function decimalsOf(raw: string, decimal: Decimal = '.'): number {
  const s = raw.replace(/[afsp]\s*$/i, '').trim();
  const i = s.lastIndexOf(decimal);
  return i < 0 ? 0 : s.length - i - 1 - (s.endsWith(')') ? 1 : 0);
}

export const isNumeric = (raw: string, decimal: Decimal = '.') => parseNum(raw, decimal) !== null;

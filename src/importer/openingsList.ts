// Flooding points printed as lines: "(1)  POSITION 1(S)   9.700f, 5.400s, 12.150   [7.982]"
// (name followed by L, T, V, sometimes more columns). The first three numbers are L, T, V; further
// numbers go to extra columns (not used). Other lines stay as text.
const NUM = /^[-−]?\d[\d,]*[.,]\d+\s?[afspAFSP]?,?$/; // coordinates have decimals (page numbers do not)

export function splitOpeningLines(rows: string[][]): { rows: string[][]; matched: number; extraCols: number } {
  const out: string[][] = [];
  let matched = 0, extraCols = 0, headerAt = -1;
  for (const r of rows) {
    const text = r.filter((c) => c.trim()).join(' ').replace(/\s+/g, ' ').trim();
    const toks = text.replace(/^\(\s*\d+\s*\)\s+|^\d+[.)]\s+/, '').replace(/(\d[afsp]?)\s+([afsp])\b/gi, '$1$2').split(' ');
    const k = toks.findIndex((t) => NUM.test(t));
    const nums = k > 0 ? toks.slice(k) : [];
    if (k > 0 && nums.length >= 3 && nums.every((t) => NUM.test(t)) && /[a-z]/i.test(toks.slice(0, k).join(' '))) {
      if (headerAt < 0) { headerAt = out.length; out.push([]); }
      const vals = nums.map((t) => t.replace(/,$/, ''));
      extraCols = Math.max(extraCols, vals.length - 3);
      out.push([toks.slice(0, k).join(' '), ...vals]);
      matched++;
    } else out.push([text]);
  }
  if (headerAt >= 0) out[headerAt] = ['Name', 'X (L)', 'Y (T)', 'Z (V)', ...Array.from({ length: extraCols }, (_, i) => `extra ${i + 1} (not used)`)];
  return { rows: out, matched, extraCols };
}

export const looksLikeOpeningLines = (rows: string[][]) => splitOpeningLines(rows).matched >= 1;

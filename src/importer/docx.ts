// Word (.docx) → the tables in the document, plus the remaining text as one "text lines" table.
import JSZip from 'jszip';
import type { SourceTable } from './sources';

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function textOf(xml: string): string {
  let out = '';
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out += m[1] !== undefined ? decode(m[1]) : ' ';
  return out.trim();
}

export async function docxTables(buf: ArrayBuffer): Promise<{ tables: SourceTable[]; warnings: string[] }> {
  const zip = await JSZip.loadAsync(buf);
  const f = zip.file('word/document.xml');
  if (!f) throw new Error('This .docx file has no document body.');
  const xml = await f.async('string');
  const tables: SourceTable[] = [];
  const warnings: string[] = [];
  // top-level tables (nested tables are read as text of their cell)
  const tblRe = /<w:tbl>([\s\S]*?)<\/w:tbl>/g;
  let m: RegExpExecArray | null;
  let n = 0;
  let rest = xml;
  while ((m = tblRe.exec(xml))) {
    n++;
    const rows: string[][] = [];
    const trRe = /<w:tr[ >][\s\S]*?<\/w:tr>/g;
    let tr: RegExpExecArray | null;
    while ((tr = trRe.exec(m[1]))) {
      const cells: string[] = [];
      const tcRe = /<w:tc>([\s\S]*?)<\/w:tc>/g;
      let tc: RegExpExecArray | null;
      while ((tc = tcRe.exec(tr[0]))) {
        cells.push(textOf(tc[1]));
        const span = /<w:gridSpan w:val="(\d+)"/.exec(tc[1]);
        for (let i = 1; i < (span ? Number(span[1]) : 1); i++) cells.push('');
      }
      rows.push(cells);
    }
    if (/<w:tbl>/.test(m[1])) warnings.push(`Table ${n} contains a nested table; its cells were read as text.`);
    tables.push({ id: `w${n}`, label: `Table ${n}`, rows });
    rest = rest.replace(m[0], '');
  }
  const paras = (rest.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map(textOf).filter((s) => s);
  if (paras.length) tables.push({ id: 'wtext', label: 'Text lines (outside tables)', rows: paras.map((p) => p.split(/\t+|\s{2,}|\s+(?=[-−]?\d)/).map((x) => x.trim()).filter(Boolean)) });
  if (!tables.length) warnings.push('No tables or text found in the Word file.');
  return { tables, warnings };
}

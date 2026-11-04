// Export a chart (SVG on screen) as SVG or PNG with its colours inlined, and a GZ table as CSV.
import type { CriteriaGroupResult } from '../engine/types';
import { saveFile, type SaveOutcome } from '../report/save';

const PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'opacity', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'dominant-baseline'];

/** Copy of the SVG with every computed style written onto the elements, plus a background. */
export function standaloneSvg(svg: SVGSVGElement, background = '#1F2327'): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const src = [svg, ...svg.querySelectorAll('*')];
  const dst = [clone, ...clone.querySelectorAll('*')];
  src.forEach((el, i) => {
    const cs = getComputedStyle(el as Element);
    const d = dst[i] as SVGElement;
    for (const p of PROPS) { const v = cs.getPropertyValue(p); if (v) d.style.setProperty(p, v); }
    if (el.tagName === 'text') d.style.setProperty('fill', cs.getPropertyValue('fill') || cs.color);
  });
  const vb = svg.viewBox.baseVal;
  const w = vb && vb.width ? vb.width : svg.clientWidth, h = vb && vb.height ? vb.height : svg.clientHeight;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(w)); clone.setAttribute('height', String(h));
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('x', String(vb?.x ?? 0)); bg.setAttribute('y', String(vb?.y ?? 0)); bg.setAttribute('width', String(w)); bg.setAttribute('height', String(h)); bg.setAttribute('fill', background);
  clone.insertBefore(bg, clone.firstChild);
  return new XMLSerializer().serializeToString(clone);
}

export async function saveSvg(svg: SVGSVGElement, name: string): Promise<SaveOutcome> {
  return saveFile(`${name}.svg`, new Blob([standaloneSvg(svg)], { type: 'image/svg+xml' }));
}

export async function savePng(svg: SVGSVGElement, name: string, scale = 2): Promise<SaveOutcome> {
  const text = standaloneSvg(svg);
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('chart image could not be drawn')); img.src = url; });
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    const ctx = c.getContext('2d')!;
    ctx.scale(scale, scale); ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG could not be made'))), 'image/png'));
    return saveFile(`${name}.png`, blob);
  } finally { URL.revokeObjectURL(url); }
}

const csvCell = (x: string | number) => { const s = typeof x === 'number' ? String(Math.round(x * 1e6) / 1e6) : x; return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function gzCsv(g: CriteriaGroupResult, head: string[]): string {
  const cols = ['Heel (deg)', 'KN (m)', 'KG·sin(phi) (m)', 'TCG·cos(phi) (m)', 'GZ (m)', ...g.moments.map((m) => `Heeling arm (m): ${m.name}`), ...(g.moments.length ? ['Residual arm (m)'] : [])];
  const rows = g.table.map((t) => [t.heel, t.kn, t.kgSin, t.tcgCos, t.gz, ...t.arms, ...(t.residual !== null ? [t.residual] : [])]);
  return [...head.map((h) => csvCell(h)), cols.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n';
}

export const fileSafe = (s: string) => s.replace(/[^\w\-. ]+/g, '').replace(/\s+/g, '_').slice(0, 80);

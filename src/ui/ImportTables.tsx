// Shared import tables: source grid with column mapping, and the review table (value + source text).
import { useState } from 'react';
import type { datasetDef } from '../importer/datasets';
import type { ConvCell, Conversion, Mapping } from '../importer/convert';

export function SourceGrid({ rows, mapping, def, onMap }: { rows: string[][]; mapping: Mapping; def: ReturnType<typeof datasetDef>; onMap: (m: Partial<Mapping>) => void }) {
  const width = Math.max(1, ...rows.map((r) => r.length));
  const fieldOf = (j: number) => Object.entries(mapping.cols).find(([, c]) => c === j)?.[0] ?? '';
  const angleOf = (j: number) => mapping.angleCols.find((a) => a.col === j);
  const setCol = (j: number, val: string) => {
    const cols = { ...mapping.cols };
    for (const k of Object.keys(cols)) if (cols[k] === j) cols[k] = -1;
    let angleCols = mapping.angleCols.filter((a) => a.col !== j);
    if (val.startsWith('angle:')) angleCols = [...angleCols, { col: j, angle: Number(val.slice(6)) }].sort((a, b) => a.col - b.col);
    else if (val) { for (const k of Object.keys(cols)) if (k === val) cols[k] = -1; cols[val] = j; }
    onMap({ cols, angleCols });
  };
  return (
    <div className="table-wrap tall source-grid">
      <table className="grid">
        <thead>
          <tr>
            <th>Row</th>
            {Array.from({ length: width }, (_, j) => {
              const a = angleOf(j);
              return (
                <th key={j}>
                  <select aria-label={`Column ${j + 1}`} value={a ? `angle:${a.angle}` : fieldOf(j)} onChange={(e) => {
                    if (e.target.value === 'angle:?') { const v = prompt('Heel angle of this column (degrees)'); if (v && Number.isFinite(Number(v))) setCol(j, `angle:${Number(v)}`); return; }
                    setCol(j, e.target.value);
                  }}>
                    <option value="">— not used —</option>
                    {def.fields.map((f) => <option key={f.key} value={f.key}>{f.label}{f.unit ? ` (${f.unit})` : ''}{f.required ? ' *' : ''}</option>)}
                    {def.angleColumns && a && <option value={`angle:${a.angle}`}>KN at {a.angle}°</option>}
                    {def.angleColumns && <option value="angle:?">KN at angle…</option>}
                  </select>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const inRange = i >= mapping.firstRow && i <= mapping.lastRow;
            return (
              <tr key={i} className={inRange ? 'in-range' : 'out-range'}>
                <td className="num muted">{i + 1}</td>
                {Array.from({ length: width }, (_, j) => <td key={j} className={fieldOf(j) || angleOf(j) ? 'mapped' : ''}>{r[j] ?? ''}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ReviewTable({ conv, def, mapping, ticked, flagged, onTick, onEdit, srcLabel }: {
  conv: Conversion; def: ReturnType<typeof datasetDef>; mapping: Mapping; ticked?: Set<number>; flagged: Set<number>;
  onTick?: (src: number) => void; onEdit: (src: number, key: string | number, text: string) => void;
  /** label of the source row (default: row number) */
  srcLabel?: (src: number) => string;
}) {
  const fields = def.fields.filter((f) => (mapping.cols[f.key] ?? -1) >= 0);
  return (
    <div className="table-wrap tall">
      <table className="grid review">
        <thead>
          <tr>
            {onTick && <th>✓</th>}<th>Source row</th>
            {fields.map((f) => <th key={f.key} className="num">{f.label}{f.unit && <div className="muted small">{f.unit}{f.pos === 'X' ? ' from AP' : f.pos === 'Y' ? ' + stbd' : ''}</div>}{f.checkOnly && <div className="muted small">check only</div>}</th>)}
            {mapping.angleCols.map((a) => <th key={a.col} className="num">KN {a.angle}°<div className="muted small">m</div></th>)}
          </tr>
        </thead>
        <tbody>
          {conv.rows.map((r) => (
            <tr key={r.src} className={flagged.has(r.src) ? 'row-flag' : ''}>
              {onTick && ticked && <td><input type="checkbox" aria-label={`Row ${r.src + 1} checked`} checked={ticked.has(r.src)} onChange={() => onTick(r.src)} /></td>}
              <td className="num muted">{srcLabel ? srcLabel(r.src) : r.src + 1}</td>
              {fields.map((f) => <Cell key={f.key} c={r.cells[f.key]} onEdit={(t) => onEdit(r.src, f.key, t)} text={f.type === 'text'} />)}
              {(r.kn ?? []).map((c, j) => <Cell key={j} c={c} onEdit={(t) => onEdit(r.src, j, t)} />)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Cell({ c, onEdit, text }: { c: ConvCell | undefined; onEdit: (t: string) => void; text?: boolean }) {
  const [editing, setEditing] = useState(false);
  if (!c) return <td />;
  const shown = c.value === null ? '' : typeof c.value === 'number' ? fmtNum(c.value) : c.value;
  const differs = c.raw.trim() !== shown;
  if (editing) {
    return (
      <td className="num">
        <input autoFocus defaultValue={shown} style={{ width: 90 }} onBlur={(e) => { setEditing(false); if (e.target.value !== shown) onEdit(e.target.value); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(false); }} />
      </td>
    );
  }
  return (
    <td className={`num cell-${c.status}${c.lowConf !== undefined && c.status !== 'edited' ? ' cell-lowconf' : ''}`} title={c.note ?? (differs ? `source: ${c.raw}` : 'same as source')} onClick={() => setEditing(true)}>
      <div className={text ? 'left' : ''}>{c.status === 'error' ? '✗' : c.status === 'empty' ? '—' : shown}</div>
      {(differs || c.status !== 'ok' || c.lowConf !== undefined) && <div className="src">{c.raw || '(empty)'}{c.status === 'filled' ? ' · filled by convention' : c.status === 'edited' ? ' · edited' : c.status === 'error' ? ` · ${c.note}` : c.lowConf !== undefined ? ` · OCR ${c.lowConf} %` : ''}</div>}
    </td>
  );
}

const fmtNum = (v: number) => String(Math.round(v * 1e9) / 1e9);

// All tank calibration tables at once: choose where the tables are, map the columns once, review
// every tank (summary list, open any tank for the cell-by-cell view), sign off and store all together.
import { useEffect, useMemo, useState } from 'react';
import type { TankGroup, Vessel } from '../engine/types';
import type { UserVesselEntry } from '../importer/dbFile';
import type { SourceDoc } from '../importer/sources';
import { datasetDef } from '../importer/datasets';
import { autoMapping, editCell, numVal, type Mapping } from '../importer/convert';
import { applyToVessel, compareRows, expectedRows, storedRows, type Provenance } from '../importer/apply';
import { buildTankImports, DEFAULT_TITLE, parseTitle, splitTanks, tankChecks, type SplitMethod, type TankImport } from '../importer/multiTank';
import type { Check } from '../importer/checks';
import { ReviewTable, SourceGrid } from './ImportTables';
import { tankTypes } from '../engine/tankTypes';
import { PdfPage } from './PdfPage';

const GROUPS: TankGroup[] = ['BALLAST', 'FUEL_OIL', 'DIESEL_OIL', 'LUB_OIL', 'FRESH_WATER', 'MISC'];
const def = datasetDef('TANK');

interface Props { doc: SourceDoc; vessel: Vessel; target: UserVesselEntry | undefined; save: (u: UserVesselEntry) => void }

export function MultiTankSection({ doc, vessel, target, save }: Props) {
  const [method, setMethod] = useState<SplitMethod>(doc.kind === 'PDF' ? 'TITLE' : doc.tables.length > 1 ? 'TABLE' : 'COLUMN');
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const titleRe = useMemo(() => { try { return new RegExp(title || DEFAULT_TITLE, 'i'); } catch { return null; } }, [title]);
  // PDF: the pages that hold title lines
  const titlePages = useMemo(() => (doc.kind === 'PDF' && titleRe ? doc.tables.filter((t) => t.rows.some((r) => parseTitle(r.join(' '), titleRe))).map((t) => t.page!) : []), [doc, titleRe]);
  const [from, setFrom] = useState<number>(titlePages[0] ?? 1);
  const [to, setTo] = useState<number>(titlePages[titlePages.length - 1] ?? doc.tables.length);
  useEffect(() => { if (titlePages.length) { setFrom(titlePages[0]); setTo(titlePages[titlePages.length - 1]); } }, [titlePages]);
  const [nameCol, setNameCol] = useState(0);
  const [fillGaps, setFillGaps] = useState(true);

  const tables = useMemo(() => (doc.kind === 'PDF' ? doc.tables.filter((t) => (t.page ?? 0) >= from && (t.page ?? 0) <= to) : doc.tables), [doc, from, to]);
  const blocks = useMemo(() => splitTanks(tables, method, { title, nameCol }), [tables, method, title, nameCol]);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  useEffect(() => { setMapping(blocks.length ? autoMapping(def, blocks[0].rows, mapping?.decimal ?? '.', vessel.lbp) : null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [blocks]);

  const [imports, setImports] = useState<TankImport[]>([]);
  useEffect(() => { setImports(mapping ? buildTankImports(blocks, { ...mapping, lbp: vessel.lbp }, vessel, fillGaps) : []); setResult(null); setConfirm(false); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, mapping, fillGaps, vessel.lbp]);
  const [open, setOpen] = useState<string | null>(null);
  const [verifier, setVerifier] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const checks = useMemo(() => new Map<string, Check[]>(imports.map((t) => [t.key, tankChecks(t, vessel, imports)])), [imports, vessel]);
  const inc = imports.filter((t) => t.include);
  const withErr = inc.filter((t) => checks.get(t.key)!.some((c) => c.level === 'error'));
  const withWarn = inc.filter((t) => checks.get(t.key)!.some((c) => c.level === 'warn'));
  const notReviewed = inc.filter((t) => !t.reviewed);
  const missingInVessel = vessel.tanks.filter((t) => !inc.some((x) => x.name.trim() === t.name)).map((t) => t.name);
  const missingReq = def.fields.filter((f) => f.required && (mapping?.cols[f.key] ?? -1) < 0);
  const blockers = [
    !inc.length && 'no tank selected',
    missingReq.length > 0 && `map the required column(s): ${missingReq.map((f) => f.label).join(', ')}`,
    withErr.length > 0 && `${withErr.length} tank(s) with errors (fix them or untick "include")`,
    notReviewed.length > 0 && `${notReviewed.length} tank(s) not yet marked as compared`,
    !verifier.trim() && 'enter your name',
    !confirm && 'confirm the comparison',
    !target && 'select one of your vessels (built-in vessels are read-only)',
  ].filter(Boolean) as string[];

  const upd = (key: string, patch: Partial<TankImport>) => setImports((xs) => xs.map((t) => (t.key === key ? { ...t, ...patch, reviewed: 'reviewed' in patch ? !!patch.reviewed : false } : t)));
  const where = (t: TankImport) => {
    const a = t.refs.find((_, i) => i >= 0), b = t.refs[t.refs.length - 1];
    if (!a || !b) return '—';
    return a.table === b.table ? `${a.table}, rows ${a.row + 1}–${b.row + 1}` : `${a.table} row ${a.row + 1} – ${b.table} row ${b.row + 1}`;
  };

  function store() {
    if (!target || blockers.length) return;
    let v = vessel;
    const prov: Record<string, Provenance> = { ...target.provenance };
    let rows = 0, values = 0;
    for (const t of inc) {
      const o = { trim: 0, tank: { name: t.name.trim(), group: t.group, density: t.density as number, isConsumable: t.consumable, type: t.type.trim().toUpperCase() || undefined } };
      try { v = applyToVessel('TANK', v, t.conv, o); } catch (e) { setResult({ ok: false, text: `${t.name}: ${e instanceof Error ? e.message : e}. Nothing was stored.` }); return; }
      const exp = expectedRows('TANK', t.conv, o);
      const cmp = compareRows(exp, storedRows('TANK', v, o), false);
      if (!cmp.ok) { setResult({ ok: false, text: `${t.name}: ${cmp.text}. Nothing was stored.` }); return; }
      const cs = checks.get(t.key)!;
      const nv = exp.reduce((s, r) => s + r.filter((x) => !(typeof x === 'number' && Number.isNaN(x))).length, 0);
      rows += exp.length; values += nv;
      prov[`TANK ${o.tank.name}`] = {
        dataset: `TANK ${o.tank.name}`, method: 'IMPORT', fileName: doc.fileName, fileSha256: doc.sha256, location: where(t),
        rows: exp.length, values: nv, editedCells: t.conv.rows.reduce((s, r) => s + Object.values(r.cells).filter((c) => c.status === 'edited').length, 0), filledCells: t.filled,
        checks: { errors: 0, warnings: cs.filter((c) => c.level === 'warn').length }, storedCheck: cmp.text, verifiedBy: verifier.trim(), verifiedAt: new Date().toISOString(),
      };
    }
    save({ ...target, vessel: v, provenance: prov });
    setResult({ ok: true, text: `${inc.length} tanks stored in ${v.name}. Every tank read back from the database: ${rows} rows, ${values} values identical to the reviewed tables.` });
  }

  const first = blocks[0];
  return (
    <>
      <section className="panel">
        <div className="panel-head"><h2>3 · Where are the tank tables, and how is each tank marked?</h2><span className="muted small">{blocks.length} tank table(s) found</span></div>
        <div className="form-row">
          <label>Each tank is
            <select value={method} onChange={(e) => setMethod(e.target.value as SplitMethod)}>
              <option value="TITLE">a table that starts with a title line (booklet PDF / Word)</option>
              <option value="TABLE">one sheet or one table per tank (Excel / Word)</option>
              <option value="COLUMN">rows of one long table, with a tank-name column</option>
            </select>
          </label>
          {doc.kind === 'PDF' && <>
            <label>From page<input type="number" min={1} style={{ width: 80 }} value={from} onChange={(e) => setFrom(Number(e.target.value))} /></label>
            <label>To page<input type="number" min={1} style={{ width: 80 }} value={to} onChange={(e) => setTo(Number(e.target.value))} /></label>
          </>}
          {method !== 'COLUMN' && (
            <label style={{ flex: '1 1 320px' }}>Title line contains (before the tank name){method === 'TABLE' ? ', optional' : ''}
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="mono" />
            </label>
          )}
          {method === 'COLUMN' && first && (
            <label>Tank name column
              <select value={nameCol} onChange={(e) => setNameCol(Number(e.target.value))}>
                {(doc.tables[0]?.rows[0] ?? []).map((h, j) => <option key={j} value={j}>{j + 1}: {h || '(no heading)'}</option>)}
              </select>
            </label>
          )}
        </div>
        <p className="muted small">
          {method === 'TITLE' && <>A line such as <span className="mono">Tank Capacities for NO1_FO.P containing FUEL OIL (0.850)</span> starts a tank: the name is the word after the title text; contents and density in brackets (or after SG / Spgr / density) are read too. Title text is a pattern: separate alternatives with <span className="mono">|</span>.</>}
          {method === 'TABLE' && <>The sheet or table name is the tank name, unless a title line inside it names the tank.</>}
          {method === 'COLUMN' && <>Rows are grouped by the tank name; an empty name cell belongs to the tank above.</>}
          {doc.kind === 'PDF' && titlePages.length > 0 && <> Title lines found on pages {titlePages[0]}–{titlePages[titlePages.length - 1]}.</>}
        </p>
        {!blocks.length && <div className="error-box">No tank tables found. Check the {method === 'TITLE' ? 'title text and the page range' : method === 'COLUMN' ? 'tank name column' : 'file'}.</div>}

        {first && mapping && <>
          <h3 className="small-h" style={{ marginTop: 10 }}>Columns (set once, used for every tank): first tank "{first.name}"</h3>
          <div className="form-row">
            <label>Decimal separator<select value={mapping.decimal} onChange={(e) => setMapping({ ...mapping, decimal: e.target.value as ',' | '.' })}><option value=".">point 1,234.5</option><option value=",">comma 1.234,5</option></select></label>
            <label>LCG measured
              <select value={mapping.xRef} onChange={(e) => setMapping({ ...mapping, xRef: e.target.value as Mapping['xRef'] })}><option value="AP">from AP, + forward</option><option value="MID_FWD">from midship, + forward</option><option value="MID_AFT">from midship, + aft</option></select>
            </label>
            <label>TCG<select value={mapping.yRef} onChange={(e) => setMapping({ ...mapping, yRef: e.target.value as Mapping['yRef'] })}><option value="STBD">+ = starboard</option><option value="PORT">+ = port</option></select></label>
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'end' }}>
              <input type="checkbox" checked={fillGaps} onChange={(e) => setFillGaps(e.target.checked)} /> Fill booklet blanks (empty-tank centres, free surface at 0 % and 100 %)
            </label>
          </div>
          <div className="import-source">
            <SourceGrid rows={first.rows} mapping={{ ...mapping, firstRow: 0, lastRow: first.rows.length - 1 }} def={def} onMap={(m) => setMapping({ ...mapping, ...m, firstRow: mapping.firstRow, lastRow: mapping.lastRow })} />
          </div>
        </>}
      </section>

      {imports.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2>4 · Review all tanks</h2>
            <span className="muted small">{inc.length} of {imports.length} included · {inc.length - withErr.length - withWarn.filter((t) => !withErr.includes(t)).length} clean · {withWarn.filter((t) => !withErr.includes(t)).length} with warnings · {withErr.length} with errors · {inc.length - notReviewed.length} compared</span></div>
          {missingInVessel.length > 0 && <p className="warn-text small">! Tanks of {vessel.name} not in this import (kept as they are): {missingInVessel.join(', ')}</p>}
          <p className="muted small">Open a tank to see every value next to its source text{doc.kind === 'PDF' ? ' and the page image' : ''}; tick "compared" when it agrees with the source. Name, group, density and consumable can be corrected here.</p>
          <datalist id="mt-types">{[...new Set([...tankTypes(vessel).map((x) => x.name), ...imports.map((x) => x.type)])].map((n) => <option key={n} value={n} />)}</datalist>
          <p className="muted small">Types in this import: {[...new Set(inc.map((t) => t.type))].map((ty) => `${ty} (${inc.filter((t) => t.type === ty).length})`).join(' · ')}</p>
          <div className="table-wrap tall">
            <table className="grid tank-list">
              <thead><tr><th>Include</th><th>Tank</th><th>Source</th><th>Type</th><th>Category</th><th className="num">Density t/m³</th><th>Cons.</th><th className="num">Rows</th><th className="num">Capacity m³</th><th>In vessel</th><th>Checks</th><th>Compared</th><th /></tr></thead>
              <tbody>
                {imports.map((t) => {
                  const cs = checks.get(t.key)!;
                  const e = cs.filter((c) => c.level === 'error').length, w = cs.filter((c) => c.level === 'warn').length;
                  const cap = Math.max(0, ...t.conv.rows.map((r) => numVal(r.cells.volume) ?? 0));
                  const ex = vessel.tanks.find((x) => x.name === t.name.trim());
                  return (
                    <tr key={t.key} className={open === t.key ? 'open' : e && t.include ? 'row-fail' : ''}>
                      <td><input type="checkbox" checked={t.include} aria-label={`Include ${t.name}`} onChange={(ev) => upd(t.key, { include: ev.target.checked, reviewed: t.reviewed })} /></td>
                      <td><input type="text" value={t.name} onChange={(ev) => upd(t.key, { name: ev.target.value })} aria-label="Tank name" /></td>
                      <td className="small muted">{where(t)}</td>
                      <td><input type="text" list="mt-types" value={t.type} onChange={(ev) => { const ty = ev.target.value.toUpperCase(); const k = tankTypes(vessel).find((x) => x.name === ty); upd(t.key, { type: ty, ...(k ? { group: k.category } : {}) }); }} aria-label={`${t.name} type`} /></td>
                      <td><select value={t.group} onChange={(ev) => upd(t.key, { group: ev.target.value as TankGroup })}>{GROUPS.map((g) => <option key={g} value={g}>{g.replace('_', ' ').toLowerCase()}</option>)}</select></td>
                      <td className="num"><input type="number" step="any" value={t.density} onChange={(ev) => upd(t.key, { density: ev.target.value === '' ? '' : Number(ev.target.value) })} aria-label={`${t.name} density`} /></td>
                      <td><input type="checkbox" checked={t.consumable} onChange={(ev) => upd(t.key, { consumable: ev.target.checked })} aria-label={`${t.name} consumable`} /></td>
                      <td className="num">{t.conv.rows.length}</td>
                      <td className="num">{cap.toFixed(2)}</td>
                      <td className="small">{ex ? (Math.abs(ex.capacity - cap) < 0.005 ? 'replaces (same capacity)' : `replaces (was ${ex.capacity.toFixed(2)})`) : 'new tank'}</td>
                      <td className="small">{e ? <span className="fail-text">✗ {e} error{e > 1 ? 's' : ''}</span> : w ? <span className="warn-text">! {w} warning{w > 1 ? 's' : ''}</span> : <span className="pass-text">✓ all passed</span>}</td>
                      <td><input type="checkbox" checked={t.reviewed} disabled={!t.include} aria-label={`${t.name} compared`} onChange={(ev) => upd(t.key, { reviewed: ev.target.checked })} /></td>
                      <td><button className="ghost tiny" onClick={() => setOpen(open === t.key ? null : t.key)}>{open === t.key ? 'Close' : 'Open'}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {open && (() => {
            const t = imports.find((x) => x.key === open);
            if (!t || !mapping) return null;
            const cs = checks.get(t.key)!;
            const page = t.refs.find((r) => r.page)?.page;
            return (
              <div className="tank-detail">
                <div className="panel-head"><h2>{t.name}</h2><span className="muted small">{t.block.title}</span></div>
                <ul className="checks">{cs.map((c, i) => <li key={i} className={c.level}><span className="mark">{c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : '✗'}</span><span><b>{c.title}</b>{c.detail && <span className="muted"> · {c.detail}</span>}</span></li>)}</ul>
                <div className="import-source">
                  <div style={{ flex: '1 1 560px', minWidth: 0 }}>
                    <ReviewTable conv={t.conv} def={def} mapping={mapping} flagged={new Set(cs.flatMap((c) => (c.level !== 'ok' ? c.rows ?? [] : [])))}
                      srcLabel={(src) => { const r = t.refs[src]; return r ? `${r.page ? `p${r.page}` : r.table.replace(/^Sheet /, '')} r${r.row + 1}` : String(src + 1); }}
                      onEdit={(src, key, text) => upd(t.key, { conv: { ...t.conv, rows: t.conv.rows.map((r) => (r.src !== src || typeof key !== 'string' ? r : { ...r, cells: { ...r.cells, [key]: editCell(r.cells[key], text, false) } })) } })} />
                    <div className="form-row" style={{ marginTop: 8 }}>
                      <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={t.reviewed} onChange={(ev) => upd(t.key, { reviewed: ev.target.checked })} /> I compared {t.name} with the source</label>
                      <button className="ghost" onClick={() => { const i = imports.findIndex((x) => x.key === t.key); const nx = imports.slice(i + 1).find((x) => x.include); upd(t.key, { reviewed: true }); setOpen(nx?.key ?? null); }}>Compared, open next tank →</button>
                    </div>
                  </div>
                  {doc.renderPage && page && <PdfPage doc={doc} page={page} />}
                </div>
              </div>
            );
          })()}
        </section>
      )}

      {imports.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2>5 · Verify and store all tanks</h2></div>
          <div className="form-row">
            <button className="ghost" onClick={() => setImports((xs) => xs.map((t) => (t.include ? { ...t, reviewed: true } : t)))}>Mark all {inc.length} included tanks as compared</button>
            <label>Verified by<input value={verifier} onChange={(e) => setVerifier(e.target.value)} placeholder="Name / rank" /></label>
          </div>
          <label className="confirm"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I have compared every included tank with the source and the values agree.</label>
          {blockers.length > 0 && <p className="muted small">To store: {blockers.join(' · ')}.</p>}
          <button disabled={blockers.length > 0} onClick={store}>Store {inc.length} tanks in {vessel.name}</button>
          {result && <div className={result.ok ? 'notice ok-notice' : 'error-box'} role="status" style={{ marginTop: 10 }}>{result.ok ? '✓ ' : '✗ '}{result.text}</div>}
        </section>
      )}
    </>
  );
}

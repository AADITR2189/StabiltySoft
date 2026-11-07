// Hydrostatics or KN tables for all trims at once.
import { useEffect, useMemo, useState } from 'react';
import type { Vessel } from '../engine/types';
import type { UserVesselEntry } from '../importer/dbFile';
import type { SourceDoc } from '../importer/sources';
import { datasetDef } from '../importer/datasets';
import { autoMapping, editCell, numVal, type Mapping } from '../importer/convert';
import { applyToVessel, compareRows, expectedRows, storedRows, type Provenance } from '../importer/apply';
import { buildTrimImports, clearKind, isTrimTablePage, pagesText, parsePages, setChecks, splitTrims, trimChecks, type TrimImport, type TrimKind, type TrimSplit } from '../importer/multiTrim';
import type { Check } from '../importer/checks';
import { ReviewTable, SourceGrid } from './ImportTables';
import { applyRefs, DRAFT_REF_LABEL, KN_BASIS_LABEL, type DraftRef, type KnBasis } from '../importer/references';
import { PdfPage } from './PdfPage';

interface Props { kind: TrimKind; doc: SourceDoc; vessel: Vessel; target: UserVesselEntry | undefined; save: (u: UserVesselEntry) => void }

const CheckList = ({ checks }: { checks: Check[] }) => (
  <ul className="checks">{checks.map((c, i) => <li key={i} className={c.level}><span className="mark">{c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : '✗'}</span><span><b>{c.title}</b>{c.detail && <span className="muted"> · {c.detail}</span>}</span></li>)}</ul>
);

export function MultiTrimSection({ kind, doc, vessel, target, save }: Props) {
  const def = datasetDef(kind);
  const label = kind === 'HYDRO' ? 'hydrostatic' : 'cross curve (KN)';
  const [method, setMethod] = useState<TrimSplit>(doc.kind === 'PDF' ? 'TITLE' : doc.tables.length > 1 ? 'TABLE' : 'COLUMN');
  // PDF: pages that hold one trim table (short heading, trim line, ≥ 8 rows of numbers)
  const titlePages = useMemo(() => (doc.kind === 'PDF' ? doc.tables.filter((t) => isTrimTablePage(t, kind)).map((t) => t.page!) : []), [doc, kind]);
  const [pagesIn, setPagesIn] = useState(pagesText(titlePages));
  useEffect(() => setPagesIn(pagesText(titlePages)), [titlePages]);
  const pageList = useMemo(() => parsePages(pagesIn), [pagesIn]);
  const [trimCol, setTrimCol] = useState(0);
  const tables = useMemo(() => (doc.kind === 'PDF' ? doc.tables.filter((t) => pageList.includes(t.page ?? 0)) : doc.tables), [doc, pageList]);
  const blocks = useMemo(() => splitTrims(tables, method, { trimCol }), [tables, method, trimCol]);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  useEffect(() => { setMapping(blocks.length ? autoMapping(def, blocks[0].rows, mapping?.decimal ?? '.', vessel.lbp) : null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [blocks]);
  const [base, setImports] = useState<TrimImport[]>([]);
  const [draftRef, setDraftRef] = useState<DraftRef>('MID');
  const [draftX, setDraftX] = useState<number | undefined>(undefined);
  const [knBasis, setKnBasis] = useState<KnBasis>('DISP');
  // drafts at LCF / AP / FP → midship; KN rows by draft / volume → displacement (each with the trim of its table)
  const refd = useMemo(() => base.map((t) => { const r = typeof t.trim === 'number' ? applyRefs(kind, t.conv, vessel, t.trim, { draftRef, draftX, knBasis }) : { conv: t.conv, checks: [] }; return { t: { ...t, conv: r.conv }, checks: r.checks }; }), [base, kind, vessel, draftRef, draftX, knBasis]);
  const imports = useMemo(() => refd.map((x) => x.t), [refd]);
  useEffect(() => { setImports(mapping ? buildTrimImports(kind, blocks, { ...mapping, lbp: vessel.lbp }) : []); setResult(null); setConfirm(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [blocks, mapping, vessel.lbp, kind]);
  const [open, setOpen] = useState<string | null>(null);
  const [replaceAll, setReplaceAll] = useState(true);
  const [verifier, setVerifier] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const checks = useMemo(() => new Map<string, Check[]>(mapping ? imports.map((t, i) => [t.key, [...refd[i].checks, ...trimChecks(kind, t, imports, vessel, mapping)]]) : []), [imports, refd, vessel, mapping, kind]);
  const inc = imports.filter((t) => t.include);
  const set = useMemo(() => setChecks(kind, inc), [kind, inc]);
  const withErr = inc.filter((t) => checks.get(t.key)?.some((c) => c.level === 'error'));
  const notReviewed = inc.filter((t) => !t.reviewed);
  const existing = (kind === 'HYDRO' ? (vessel.hydro.trims && vessel.hydro.trims.length > 1 ? vessel.hydro.trims.map((t) => t.trim) : vessel.hydro.rows.length ? [0] : [])
    : (vessel.kn.trims && vessel.kn.trims.length > 1 ? vessel.kn.trims.map((t) => t.trim) : vessel.kn.displacements.length ? [0] : []));
  const dropped = replaceAll ? existing.filter((x) => !inc.some((t) => t.trim === x)) : [];
  const missingReq = def.fields.filter((f) => f.required && (mapping?.cols[f.key] ?? -1) < 0);
  const blockers = [
    !inc.length && 'no table selected',
    missingReq.length > 0 && `map the required column(s): ${missingReq.map((f) => f.label).join(', ')}`,
    kind === 'KN' && (mapping?.angleCols.length ?? 0) < 3 && 'map at least 3 heel-angle columns',
    withErr.length > 0 && `${withErr.length} trim table(s) with errors (fix them or untick)`,
    set.some((c) => c.level === 'error') && 'resolve the error across the trims',
    notReviewed.length > 0 && `${notReviewed.length} table(s) not yet marked as compared`,
    !verifier.trim() && 'enter your name',
    !confirm && 'confirm the comparison',
    !target && 'select one of your vessels (built-in vessels are read-only)',
  ].filter(Boolean) as string[];
  const upd = (key: string, patch: Partial<TrimImport>) => setImports((xs) => xs.map((t) => (t.key === key ? { ...t, ...patch, reviewed: 'reviewed' in patch ? !!patch.reviewed : false } : t)));
  const where = (t: TrimImport) => { const a = t.refs[0], b = t.refs[t.refs.length - 1]; return !a || !b ? '—' : a.table === b.table ? `${a.table}, rows ${a.row + 1}–${b.row + 1}` : `${a.table} r${a.row + 1} – ${b.table} r${b.row + 1}`; };
  const keyName = kind === 'HYDRO' ? 'draft' : 'displacement';

  function store() {
    if (!target || !mapping || blockers.length) return;
    const angles = mapping.angleCols.map((a) => a.angle);
    let v = replaceAll ? clearKind(vessel, kind) : vessel;
    const sorted = [...inc].sort((a, b) => (a.trim as number) - (b.trim as number));
    try { for (const t of sorted) v = applyToVessel(kind, v, t.conv, { trim: t.trim as number, angles }); }
    catch (e) { setResult({ ok: false, text: `${e instanceof Error ? e.message : e} Nothing was stored.` }); return; }
    const prov: Record<string, Provenance> = { ...target.provenance };
    if (replaceAll) for (const k of Object.keys(prov)) if (k.startsWith(`${kind} trim `)) delete prov[k];
    let rows = 0, values = 0;
    for (const t of sorted) {
      const o = { trim: t.trim as number, angles };
      const exp = expectedRows(kind, t.conv, o);
      const cmp = compareRows(exp, storedRows(kind, v, o), true);
      if (!cmp.ok) { setResult({ ok: false, text: `Trim ${t.trim}: ${cmp.text}. Nothing was stored.` }); return; }
      const nv = exp.reduce((s, r) => s + r.filter((x) => !(typeof x === 'number' && Number.isNaN(x))).length, 0);
      rows += exp.length; values += nv;
      const cs = checks.get(t.key) ?? [];
      prov[`${kind} trim ${t.trim}`] = {
        dataset: `${kind} trim ${t.trim}`, method: 'IMPORT', fileName: doc.fileName, fileSha256: doc.sha256, location: where(t), rows: exp.length, values: nv,
        editedCells: t.conv.rows.reduce((s, r) => s + [...Object.values(r.cells), ...(r.kn ?? [])].filter((c) => c.status === 'edited').length, 0),
        checks: { errors: 0, warnings: cs.filter((c) => c.level === 'warn').length }, storedCheck: cmp.text, verifiedBy: verifier.trim(), verifiedAt: new Date().toISOString(),
      };
    }
    save({ ...target, vessel: v, provenance: prov });
    setResult({ ok: true, text: `${sorted.length} ${label} tables (trims ${sorted.map((t) => t.trim).join(', ')} m) stored in ${v.name}${dropped.length ? `; trims ${dropped.join(', ')} m removed` : ''}. Every trim read back from the database: ${rows} rows, ${values} values identical to the reviewed tables.` });
  }

  const first = imports[0]?.block ?? blocks[0];
  return (
    <>
      <section className="panel">
        <div className="panel-head"><h2>3 · Where are the {label} tables, and how is the trim shown?</h2><span className="muted small">{blocks.length} table(s) found</span></div>
        <div className="form-row">
          <label>Each trim is
            <select value={method} onChange={(e) => setMethod(e.target.value as TrimSplit)}>
              <option value="TITLE">a table with a title line stating the trim (booklet PDF / Word)</option>
              <option value="TABLE">one sheet or table per trim (trim in the sheet name or a title line)</option>
              <option value="COLUMN">rows of one long table, with a trim column</option>
            </select>
          </label>
          {doc.kind === 'PDF' && <>
            <label>Pages (e.g. 129-133, 140)<input className="mono" style={{ width: 200 }} value={pagesIn} onChange={(e) => setPagesIn(e.target.value)} aria-label="Pages" /></label>
          </>}
          {method === 'COLUMN' && (
            <label>Trim column
              <select value={trimCol} onChange={(e) => setTrimCol(Number(e.target.value))}>{(doc.tables[0]?.rows[0] ?? []).map((h, j) => <option key={j} value={j}>{j + 1}: {h || '(no heading)'}</option>)}</select>
            </label>
          )}
          {kind === 'HYDRO' && <label>Drafts in the tables are measured
            <select value={draftRef} onChange={(e) => setDraftRef(e.target.value as DraftRef)}>
              {(Object.keys(DRAFT_REF_LABEL) as DraftRef[]).map((k) => <option key={k} value={k}>{DRAFT_REF_LABEL[k]}</option>)}
            </select></label>}
          {kind === 'HYDRO' && draftRef === 'X' && <label>X of the draft mark (m from AP)<input type="number" step="any" value={draftX ?? ''} onChange={(e) => setDraftX(e.target.value === '' ? undefined : Number(e.target.value))} /></label>}
          {kind === 'KN' && <label>First column of the tables gives
            <select value={knBasis} onChange={(e) => setKnBasis(e.target.value as KnBasis)}>
              {(Object.keys(KN_BASIS_LABEL) as KnBasis[]).map((k) => <option key={k} value={k}>{KN_BASIS_LABEL[k]}</option>)}
            </select></label>}
        </div>
        {kind === 'HYDRO' && draftRef !== 'MID' && <p className="muted small">Trimmed tables are stored with drafts at midship: each draft is converted with d_MS = d + t·(x − L/2)/L, x = where the draft is measured (for the LCF, the LCF of that row). Every converted cell shows the conversion.</p>}
        {kind === 'KN' && knBasis === 'DRAFT' && <p className="muted small">Import the hydrostatics of every trim first: each draft is turned into a displacement using the hydrostatic table of the same trim.</p>}
        <p className="muted small">
          Trim is read as + by the stern: "No Trim" / "Trim zero" / "even keel" = 0, "Trim: aft 0.500/57.400" = +0.5, "Trim fwd 1.000" or "by the head 1.0" = −1.0.
          {doc.kind === 'PDF' && (titlePages.length > 0 ? <> {label[0].toUpperCase() + label.slice(1)} table pages found automatically: {pagesText(titlePages)}.</> : <> No {label} table pages found automatically: type the pages.</>)}
        </p>
        {!blocks.length && <div className="error-box">No {label} tables with a trim found. Check the page range or the layout choice.</div>}
        {first && mapping && <>
          <h3 className="small-h" style={{ marginTop: 10 }}>Columns (set once, used for every trim): first table "{first.title}"</h3>
          <div className="form-row">
            <label>Decimal separator<select value={mapping.decimal} onChange={(e) => setMapping({ ...mapping, decimal: e.target.value as ',' | '.' })}><option value=".">point 1,234.5</option><option value=",">comma 1.234,5</option></select></label>
            {kind === 'HYDRO' && (
              <label>LCB / LCF measured
                <select value={mapping.xRef} onChange={(e) => setMapping({ ...mapping, xRef: e.target.value as Mapping['xRef'] })}><option value="AP">from AP, + forward</option><option value="MID_FWD">from midship, + forward</option><option value="MID_AFT">from midship, + aft</option></select>
              </label>
            )}
          </div>
          <div className="import-source">
            <SourceGrid rows={first.rows} mapping={{ ...mapping, firstRow: 0, lastRow: first.rows.length - 1 }} def={def} onMap={(m) => setMapping({ ...mapping, ...m, firstRow: mapping.firstRow, lastRow: mapping.lastRow })} />
          </div>
        </>}
      </section>

      {imports.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2>4 · Review all trims</h2><span className="muted small">{inc.length} of {imports.length} included · {withErr.length} with errors · {inc.length - notReviewed.length} compared</span></div>
          <CheckList checks={set} />
          <div className="table-wrap">
            <table className="grid tank-list">
              <thead><tr><th>Include</th><th className="num">Trim m (+ stern)</th><th>Title line</th><th>Source</th><th className="num">Rows</th><th className="num">{kind === 'HYDRO' ? 'Drafts m' : 'Displacements t'}</th>{kind === 'KN' && <th>Angles °</th>}<th>Checks</th><th>Compared</th><th /></tr></thead>
              <tbody>
                {imports.map((t) => {
                  const cs = checks.get(t.key) ?? [];
                  const e = cs.filter((c) => c.level === 'error').length, w = cs.filter((c) => c.level === 'warn').length;
                  const vals = t.conv.rows.map((r) => numVal(r.cells[keyName])).filter((x): x is number => x !== undefined);
                  return (
                    <tr key={t.key} className={open === t.key ? 'open' : e && t.include ? 'row-fail' : ''}>
                      <td><input type="checkbox" checked={t.include} aria-label={`Include table ${t.key}`} onChange={(ev) => upd(t.key, { include: ev.target.checked, reviewed: t.reviewed })} /></td>
                      <td className="num"><input type="number" step="any" value={t.trim} aria-label={`Trim of table ${Number(t.key) + 1}`} onChange={(ev) => upd(t.key, { trim: ev.target.value === '' ? '' : Number(ev.target.value) })} /></td>
                      <td className="small wrap" style={{ maxWidth: 260 }}>{t.block.title}</td>
                      <td className="small muted">{where(t)}</td>
                      <td className="num">{t.conv.rows.length}</td>
                      <td className="num small">{vals.length ? `${Math.min(...vals)} – ${Math.max(...vals)}` : '—'}</td>
                      {kind === 'KN' && <td className="small">{(t.ownAngles ?? []).join(', ')}</td>}
                      <td className="small">{e ? <span className="fail-text">✗ {e} error{e > 1 ? 's' : ''}</span> : w ? <span className="warn-text">! {w} warning{w > 1 ? 's' : ''}</span> : <span className="pass-text">✓ all passed</span>}</td>
                      <td><input type="checkbox" checked={t.reviewed} disabled={!t.include} aria-label={`Trim ${t.trim} compared`} onChange={(ev) => upd(t.key, { reviewed: ev.target.checked })} /></td>
                      <td><button className="ghost tiny" onClick={() => setOpen(open === t.key ? null : t.key)}>{open === t.key ? 'Close' : 'Open'}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {open && mapping && (() => {
            const t = imports.find((x) => x.key === open);
            if (!t) return null;
            const cs = checks.get(t.key) ?? [];
            const page = t.refs.find((r) => r.page)?.page;
            return (
              <div className="tank-detail">
                <div className="panel-head"><h2>Trim {t.trim} m</h2><span className="muted small">{t.block.title}</span></div>
                <CheckList checks={cs} />
                <div className="import-source">
                  <div style={{ flex: '1 1 560px', minWidth: 0 }}>
                    <ReviewTable conv={t.conv} def={def} mapping={mapping} flagged={new Set(cs.flatMap((c) => (c.level !== 'ok' ? c.rows ?? [] : [])))}
                      srcLabel={(src) => { const r = t.refs[src]; return r ? `${r.page ? `p${r.page}` : r.table.replace(/^Sheet /, '')} r${r.row + 1}` : String(src + 1); }}
                      onEdit={(src, key, text) => { const bc = base.find((x) => x.key === t.key)!.conv; upd(t.key, { conv: { ...bc, rows: bc.rows.map((r) => (r.src !== src ? r : typeof key === 'number' ? { ...r, kn: r.kn!.map((c, j) => (j === key ? editCell(c, text, false) : c)) } : { ...r, cells: { ...r.cells, [key]: editCell(r.cells[key], text, false) } })) } }); }} />
                    <div className="form-row" style={{ marginTop: 8 }}>
                      <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={t.reviewed} onChange={(ev) => upd(t.key, { reviewed: ev.target.checked })} /> I compared trim {t.trim} m with the source</label>
                      <button className="ghost" onClick={() => { const i = imports.findIndex((x) => x.key === t.key); const nx = imports.slice(i + 1).find((x) => x.include); upd(t.key, { reviewed: true }); setOpen(nx?.key ?? null); }}>Compared, open next trim →</button>
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
          <div className="panel-head"><h2>5 · Verify and store all trims</h2></div>
          <label className="confirm small">
            <input type="checkbox" checked={replaceAll} onChange={(e) => setReplaceAll(e.target.checked)} />
            Replace all {label} tables of {vessel.name} (trims not in this import are removed{existing.length ? `; now stored: ${existing.join(', ')} m` : ''})
          </label>
          {dropped.length > 0 && <p className="warn-text small">! Trims {dropped.join(', ')} m are stored now but not in this import: they will be removed.</p>}
          {!replaceAll && <p className="muted small">Trims in this import replace the stored table of the same trim; other stored trims are kept.</p>}
          <div className="form-row">
            <button className="ghost" onClick={() => setImports((xs) => xs.map((t) => (t.include ? { ...t, reviewed: true } : t)))}>Mark all {inc.length} included tables as compared</button>
            <label>Verified by<input value={verifier} onChange={(e) => setVerifier(e.target.value)} placeholder="Name / rank" /></label>
          </div>
          <label className="confirm"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I have compared every included table with the source and the values agree.</label>
          {blockers.length > 0 && <p className="muted small">To store: {blockers.join(' · ')}.</p>}
          <button disabled={blockers.length > 0} onClick={store}>Store {inc.length} {label} tables in {vessel.name}</button>
          {result && <div className={result.ok ? 'notice ok-notice' : 'error-box'} role="status" style={{ marginTop: 10 }}>{result.ok ? '✓ ' : '✗ '}{result.text}</div>}
        </section>
      )}
    </>
  );
}

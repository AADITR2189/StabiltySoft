// Windage from the booklet's wind heeling moment tables (one per loading condition).
import { useMemo, useState } from 'react';
import type { Vessel } from '../engine/types';
import type { UserVesselEntry } from '../importer/dbFile';
import type { Provenance } from '../importer/apply';
import type { SourceDoc } from '../importer/sources';
import { DEFAULT_DRAFT, DEFAULT_HEADING, findWindCases, windRows, withDraft, type WindCase } from '../importer/windageParts';
import { PdfPage } from './PdfPage';

interface Props { doc: SourceDoc; vessel: Vessel; target: UserVesselEntry | undefined; save: (u: UserVesselEntry) => void }

export function WindageBookletSection({ doc, vessel, target, save }: Props) {
  const [heading, setHeading] = useState(DEFAULT_HEADING);
  const [draftRe, setDraftRe] = useState(DEFAULT_DRAFT);
  const found = useMemo(() => findWindCases(doc.tables, { heading, draft: draftRe }), [doc, heading, draftRe]);
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [excludedSet, setExcluded] = useState<Set<string> | null>(null);
  // tables outside a numbered loading condition (samples) start unticked
  const excluded = excludedSet ?? new Set(found.filter((c) => !c.condition).map((c) => c.key));
  const [compared, setCompared] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const hydroDrafts = vessel.hydro.rows.map((r) => r.draft);
  const [extend, setExtend] = useState(false);
  const [verifier, setVerifier] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const cases: WindCase[] = found.map((c) => (drafts[c.key] !== undefined ? withDraft(c, drafts[c.key]) : c));
  const inc = cases.filter((c) => !excluded.has(c.key));
  const lo = hydroDrafts.length ? Math.min(...hydroDrafts) : undefined, hi = hydroDrafts.length ? Math.max(...hydroDrafts) : undefined;
  const out = windRows(inc, extend && lo !== undefined && hi !== undefined ? { lo, hi } : undefined);
  const errs = inc.filter((c) => c.issues.some((i) => i.level === 'error'));
  const outside = lo !== undefined && out.rows.length ? (out.rows[0].draft > lo + 0.0005 || out.rows[out.rows.length - 1].draft < hi! - 0.0005) : false;
  const blockers = [
    !inc.length && 'no condition selected',
    errs.length > 0 && `${errs.length} condition(s) with errors (fix the draft or untick)`,
    out.rows.length < 2 && 'at least 2 different drafts are needed',
    out.conflicts.length > 0 && out.conflicts.join('; '),
    inc.some((c) => !compared.has(c.key)) && 'tick "compared" for every condition',
    !verifier.trim() && 'enter your name',
    !confirm && 'confirm the comparison',
    !target && 'select one of your vessels (built-in vessels are read-only)',
  ].filter(Boolean) as string[];

  function store() {
    if (!target || blockers.length) return;
    const windage = out.rows.map((r) => ({ draft: r.draft, area: r.area, centroidZ: r.centroidZ, underwaterCentroidZ: r.underwaterCentroidZ }));
    const v2: Vessel = { ...structuredClone(vessel), windage };
    const back = v2.windage.map((w) => [w.draft, w.area, w.centroidZ, w.underwaterCentroidZ ?? NaN]);
    const same = back.length === windage.length && back.every((r, i) => r[0] === windage[i].draft && r[1] === windage[i].area && r[2] === windage[i].centroidZ && r[3] === windage[i].underwaterCentroidZ);
    if (!same) { setResult({ ok: false, text: 'Not stored: read-back differs.' }); return; }
    const derived = out.rows.filter((r) => r.derived).length;
    const prov: Provenance = {
      dataset: 'WINDAGE', method: 'IMPORT', fileName: doc.fileName, fileSha256: doc.sha256,
      location: `Wind heeling moment tables, pages ${inc.map((c) => c.page).join(', ')}${derived ? `; ${derived} row(s) derived by extension` : ''}`,
      rows: windage.length, values: windage.length * 4, editedCells: Object.keys(drafts).length, filledCells: derived,
      checks: { errors: 0, warnings: inc.reduce((s, c) => s + c.issues.length, 0) + out.notes.length }, storedCheck: `Stored data read back: ${windage.length}/${windage.length} rows identical`,
      verifiedBy: verifier.trim(), verifiedAt: new Date().toISOString(),
    };
    save({ ...target, vessel: v2, provenance: { ...target.provenance, WINDAGE: prov } });
    setResult({ ok: true, text: `Windage stored in ${v2.name}: ${windage.length} rows (${windage.length - derived} from the booklet${derived ? `, ${derived} derived` : ''}). ${prov.storedCheck}.` });
  }

  return (
    <>
      <section className="panel">
        <div className="panel-head"><h2>3 · Wind heeling moment tables found</h2><span className="muted small">{found.length} condition(s)</span></div>
        <div className="form-row">
          <label style={{ flex: '1 1 300px' }}>Table heading contains<input className="mono" value={heading} onChange={(e) => setHeading(e.target.value)} /></label>
          <label style={{ flex: '1 1 300px' }}>Draft of the condition (pattern, number in brackets)<input className="mono" value={draftRe} onChange={(e) => setDraftRe(e.target.value)} /></label>
        </div>
        {!found.length && <div className="error-box">No wind heeling moment tables found. Check the heading text.</div>}
        {found.length > 0 && (
          <div className="table-wrap">
            <table className="grid tank-list">
              <thead><tr><th>Use</th><th>Page</th><th>Condition</th><th className="num">Draft m</th><th className="num">Parts</th><th className="num">Area A m²</th><th className="num">Centroid above base m</th><th className="num">Underwater centre m</th><th className="num">Total moment: booklet / parts</th><th>Checks</th><th>Compared</th><th /></tr></thead>
              <tbody>
                {cases.map((c) => {
                  const e = c.issues.filter((i) => i.level === 'error'), w = c.issues.filter((i) => i.level === 'warn' && (excluded.has(c.key) || !/Not inside/.test(i.text)));
                  return (
                    <tr key={c.key} className={open === c.key ? 'open' : e.length && !excluded.has(c.key) ? 'row-fail' : ''}>
                      <td><input type="checkbox" checked={!excluded.has(c.key)} aria-label={`Use page ${c.page}`} onChange={(ev) => setExcluded(() => { const n = new Set(excluded); if (ev.target.checked) n.delete(c.key); else n.add(c.key); return n; })} /></td>
                      <td>{c.page}</td>
                      <td className="wrap small">{c.condition || '—'}</td>
                      <td className="num">
                        <input type="number" step="any" style={{ width: 80 }} aria-label={`Draft page ${c.page}`} value={c.draft ?? ''} onChange={(ev) => { const v = Number(ev.target.value); if (ev.target.value !== '' && Number.isFinite(v)) setDrafts((d) => ({ ...d, [c.key]: v })); setCompared((s) => { const n = new Set(s); n.delete(c.key); return n; }); }} />
                        <div className="src">{c.draftText ? `${c.draftText}${c.draftPage ? `, p${c.draftPage}` : ''}` : 'not found'}</div>
                      </td>
                      <td className="num">{c.parts.length}</td>
                      <td className="num">{c.area.toFixed(2)}</td>
                      <td className="num">{Number.isFinite(c.centroidZ) ? c.centroidZ.toFixed(4) : '—'}</td>
                      <td className="num">{Number.isFinite(c.underwaterCentroidZ) ? c.underwaterCentroidZ.toFixed(4) : '—'}</td>
                      <td className="num">{c.printedTotal ?? '—'} / {c.partsSum.toFixed(2)}</td>
                      <td className="small wrap">{e.length ? <span className="fail-text">✗ {e.map((i) => i.text).join('; ')}</span> : w.length ? <span className="warn-text">! {w.map((i) => i.text).join('; ')}</span> : <span className="pass-text">✓ parts add up to the booklet total</span>}</td>
                      <td><input type="checkbox" checked={compared.has(c.key)} aria-label={`Compared page ${c.page}`} onChange={(ev) => setCompared((s) => { const n = new Set(s); if (ev.target.checked) n.add(c.key); else n.delete(c.key); return n; })} /></td>
                      <td><button className="ghost tiny" onClick={() => setOpen(open === c.key ? null : c.key)}>{open === c.key ? 'Close' : 'Parts'}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {open && (() => {
          const c = cases.find((x) => x.key === open);
          if (!c) return null;
          return (
            <div className="tank-detail import-source">
              <div style={{ flex: '1 1 480px' }}>
                <table className="grid">
                  <thead><tr><th>Part</th><th className="num">LPA m²</th><th className="num">HCP m</th><th className="num">Arm m</th><th className="num">Pressure t/m²</th><th className="num">Moment t·m</th><th>p × A × arm</th></tr></thead>
                  <tbody>{c.parts.map((p) => <tr key={p.row} className={p.ok ? '' : 'row-fail'}><td>{p.name}</td><td className="num">{p.area}</td><td className="num">{p.hcp}</td><td className="num">{p.arm}</td><td className="num">{p.pressure}</td><td className="num">{p.moment}</td><td className="small">{p.ok ? '✓' : `✗ ${(p.pressure * p.area * p.arm).toFixed(2)}`}</td></tr>)}
                    <tr className="total"><td>Σ</td><td className="num">{c.area.toFixed(2)}</td><td colSpan={3} /><td className="num">{c.partsSum.toFixed(2)}</td><td className="small">booklet {c.printedTotal ?? '—'}</td></tr>
                  </tbody>
                </table>
                <p className="muted small">Centroid above base = Σ LPA·(HCP + T) / ΣLPA; underwater centre = T − (Arm − HCP). T = {c.draft ?? '—'} m.</p>
              </div>
              {doc.renderPage && <PdfPage doc={doc} page={c.page} />}
            </div>
          );
        })()}
      </section>

      {found.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2>4 · Windage table to store</h2></div>
          {lo !== undefined && (
            <label className="confirm small">
              <input type="checkbox" checked={extend} onChange={(e) => setExtend(e.target.checked)} />
              Extend by straight lines to the hydrostatic draft range {lo}–{hi} m (rows marked DERIVED; confirm them with the designer)
            </label>
          )}
          {outside && !extend && <p className="warn-text small">! The windage covers drafts {out.rows[0]?.draft}–{out.rows[out.rows.length - 1]?.draft} m only; loading conditions outside this range cannot be calculated.</p>}
          {out.conflicts.map((n) => <p key={n} className="fail-text small">✗ {n}</p>)}
          {out.notes.map((n) => <p key={n} className="warn-text small">! {n}</p>)}
          <table className="grid">
            <thead><tr><th className="num">Draft m</th><th className="num">Area m²</th><th className="num">Centroid above base m</th><th className="num">Underwater centre m</th><th>From</th></tr></thead>
            <tbody>{out.rows.map((r) => <tr key={r.draft} className={r.derived ? 'row-flag' : ''}><td className="num">{r.draft}</td><td className="num">{r.area.toFixed(3)}</td><td className="num">{r.centroidZ.toFixed(4)}</td><td className="num">{r.underwaterCentroidZ.toFixed(4)}</td><td className={r.derived ? 'warn-text small' : 'small'}>{r.from}</td></tr>)}</tbody>
          </table>
          <div className="form-row" style={{ marginTop: 8 }}>
            <button className="ghost" onClick={() => setCompared(new Set(inc.map((c) => c.key)))}>Mark all {inc.length} conditions as compared</button>
            <label>Verified by<input value={verifier} onChange={(e) => setVerifier(e.target.value)} placeholder="Name / rank" /></label>
          </div>
          <label className="confirm"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I have compared the parts, drafts and totals with the booklet and they agree.</label>
          {blockers.length > 0 && <p className="muted small">To store: {blockers.join(' · ')}.</p>}
          <button disabled={blockers.length > 0} onClick={store}>Store windage in {vessel.name}</button>
          {result && <div className={result.ok ? 'notice ok-notice' : 'error-box'} role="status" style={{ marginTop: 10 }}>{result.ok ? '✓ ' : '✗ '}{result.text}</div>}
        </section>
      )}
    </>
  );
}

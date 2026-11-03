// Import of label / value lists (general particulars, lightship totals): pick the page or sheet,
// see for each field the source line, the value read and what will be stored; correct the row or the
// value; checks; tick each field; store and read back.
import { useEffect, useMemo, useState } from 'react';
import type { Vessel } from '../engine/types';
import type { UserVesselEntry } from '../importer/dbFile';
import type { Provenance } from '../importer/apply';
import type { SourceDoc } from '../importer/sources';
import { applyKv, checkKv, editKv, kvExpected, kvExtract, kvStored, KV_FIELDS, readKv, rowText, type KvHit, type KvKind } from '../importer/keyValue';
import type { Decimal } from '../importer/numbers';
import { PdfPage } from './PdfPage';

interface Props {
  kind: KvKind;
  doc: SourceDoc;
  tableId: string;
  setTableId: (id: string) => void;
  vessel: Vessel;
  target: UserVesselEntry | undefined;
  save: (u: UserVesselEntry) => void;
}

export function KvSection({ kind, doc, tableId, setTableId, vessel, target, save }: Props) {
  const table = doc.tables.find((t) => t.id === tableId) ?? doc.tables[0];
  const fields = KV_FIELDS[kind];
  const [decimal, setDecimal] = useState<Decimal>('.');
  const [defaultX, setDefaultX] = useState<'AP' | 'MID_FWD'>('AP');
  const [hits, setHits] = useState<KvHit[]>([]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [verifier, setVerifier] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  // LBP for midship → AP conversion: from this list (particulars) or the vessel
  const lbp = vessel.lbp;
  useEffect(() => {
    if (!table) return;
    setHits(kvExtract(kind, table.rows, decimal, lbp, defaultX));
    setTicked(new Set()); setConfirm(false); setResult(null);
  }, [table, kind, decimal, lbp, defaultX]);

  const checks = useMemo(() => checkKv(kind, hits, vessel), [kind, hits, vessel]);
  const found = hits.filter((h) => h.status !== 'missing');
  const errors = checks.filter((c) => c.level === 'error').length;
  const warns = checks.filter((c) => c.level === 'warn').length;
  const allTicked = found.length > 0 && found.every((h) => ticked.has(h.key));
  const blockers = [
    errors > 0 && `resolve ${errors} failed check(s)`,
    !allTicked && 'tick every field after comparing it with the source',
    !verifier.trim() && 'enter your name',
    !confirm && 'confirm the comparison',
    !target && 'select one of your vessels (built-in vessels are read-only)',
  ].filter(Boolean) as string[];

  const texts = table ? table.rows.map(rowText) : [];
  const setRow = (key: string, src: number) => {
    const f = fields.find((x) => x.key === key)!;
    const L = typeof hits.find((h) => h.key === 'lbp')?.value === 'number' ? (hits.find((h) => h.key === 'lbp')!.value as number) : lbp;
    setHits(hits.map((h) => (h.key !== key ? h : src < 0 || src >= texts.length ? { key, src: -1, rowText: '', valueText: '', value: null, status: 'missing' } : readKv(f, texts[src], src, decimal, L, defaultX))));
    setTicked((t) => { const n = new Set(t); n.delete(key); return n; });
  };
  const setVal = (key: string, text: string) => {
    const f = fields.find((x) => x.key === key)!;
    setHits(hits.map((h) => (h.key === key ? editKv(h, f, text) : h)));
    setTicked((t) => { const n = new Set(t); n.delete(key); return n; });
  };

  function store() {
    if (!target || blockers.length || !table) return;
    const v2 = applyKv(kind, vessel, hits);
    const exp = kvExpected(kind, vessel, hits);
    const got = kvStored(kind, v2);
    const diff = exp.filter((x, i) => x !== got[i]).length;
    const text = diff ? `${diff} stored value(s) differ from the reviewed list` : `Stored data read back: ${exp.length}/${exp.length} values identical to the reviewed list`;
    if (diff) { setResult({ ok: false, text: `Not stored: ${text}.` }); return; }
    const key = kind === 'PARTICULARS' ? 'PARTICULARS' : 'LIGHTSHIP';
    const prov: Provenance = {
      dataset: key, method: doc.fileName.startsWith('Typed') ? 'TYPED' : 'IMPORT', fileName: doc.fileName, fileSha256: doc.sha256,
      location: `${table.label}, rows ${[...new Set(found.map((h) => h.src + 1))].sort((a, b) => a - b).join(', ')}`,
      rows: found.length, values: found.filter((h) => !fields.find((f) => f.key === h.key)?.checkOnly).length,
      editedCells: hits.filter((h) => h.status === 'edited').length, checks: { errors, warnings: warns }, storedCheck: text,
      verifiedBy: verifier.trim(), verifiedAt: new Date().toISOString(),
    };
    save({ ...target, vessel: v2, provenance: { ...target.provenance, [key]: prov } });
    setResult({ ok: true, text: `${kind === 'PARTICULARS' ? 'General particulars' : 'Lightship'} stored in ${v2.name}. ${text}.` });
  }

  if (!table) return null;
  return (
    <>
      <section className="panel">
        <div className="panel-head"><h2>3 · Page / sheet and values found</h2><span className="muted small">{doc.tables.length} table(s) / page(s) found</span></div>
        <div className="form-row">
          <label>Table
            {doc.kind === 'PDF' ? (
              <span className="with-unit">
                <span className="muted">Page</span>
                <input type="number" min={1} style={{ width: 80 }} value={table.page ?? 1} onChange={(e) => { const t = doc.tables.find((x) => x.page === Number(e.target.value)); if (t) setTableId(t.id); }} />
              </span>
            ) : (
              <select value={table.id} onChange={(e) => setTableId(e.target.value)}>{doc.tables.map((t) => <option key={t.id} value={t.id}>{t.label} ({t.rows.length} rows)</option>)}</select>
            )}
          </label>
          <label>Decimal separator<select value={decimal} onChange={(e) => setDecimal(e.target.value as Decimal)}><option value=".">point 1,234.5</option><option value=",">comma 1.234,5</option></select></label>
          {kind === 'LIGHTSHIP_SUMMARY' && (
            <label>LCG without "aft / fwd" or "from AP" words is measured
              <select value={defaultX} onChange={(e) => setDefaultX(e.target.value as 'AP' | 'MID_FWD')}><option value="AP">from AP, + forward</option><option value="MID_FWD">from midship, + forward</option></select>
            </label>
          )}
        </div>
        {kind === 'LIGHTSHIP_SUMMARY' && <p className="muted small">LBP used to convert from midship: {lbp || '— (enter the particulars first)'} m.</p>}
        <ul className="checks">
          {checks.map((c, i) => (
            <li key={i} className={c.level}><span className="mark">{c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : '✗'}</span><span><b>{c.title}</b>{c.detail && <span className="muted"> · {c.detail}</span>}</span></li>
          ))}
        </ul>
        <div className="import-source">
          <div className="table-wrap" style={{ flex: '1 1 560px', minWidth: 0 }}>
            <table className="grid review">
              <thead><tr><th>✓</th><th>Field</th><th className="num">Source row</th><th>Source line</th><th className="num">Value stored</th><th>Note</th></tr></thead>
              <tbody>
                {fields.map((f) => {
                  const h = hits.find((x) => x.key === f.key);
                  if (!h) return null;
                  const shown = h.value === null ? '' : typeof h.value === 'number' ? String(Math.round(h.value * 1e9) / 1e9) : h.value;
                  return (
                    <tr key={f.key} className={h.status === 'error' ? 'row-flag' : ''}>
                      <td>{h.status !== 'missing' && <input type="checkbox" aria-label={`${f.label} checked`} checked={ticked.has(f.key)} onChange={() => setTicked((t) => { const n = new Set(t); if (n.has(f.key)) n.delete(f.key); else n.add(f.key); return n; })} />}</td>
                      <td className="wrap">{f.label}{f.unit && <span className="muted"> ({f.unit}{f.pos === 'X' ? ' from AP' : f.pos === 'Y' ? ', + stbd' : ''})</span>}{f.required && ' *'}{f.checkOnly && <div className="muted small">check only, not stored</div>}</td>
                      <td className="num"><input type="number" min={0} style={{ width: 64 }} aria-label={`${f.label} source row`} value={h.src >= 0 ? h.src + 1 : ''} placeholder="—" onChange={(e) => setRow(f.key, e.target.value === '' ? -1 : Number(e.target.value) - 1)} /></td>
                      <td className="wrap mono small" style={{ maxWidth: 360 }}>{h.status === 'missing' ? <span className="muted">not found in this {doc.kind === 'PDF' ? 'page' : 'table'}{f.required ? '' : ' (keeps present value)'}</span> : h.rowText}</td>
                      <td className={`num cell-${h.status === 'missing' ? 'empty' : h.status}`}>
                        <input style={{ width: f.type === 'text' ? 170 : 100, textAlign: f.type === 'text' ? 'left' : 'right' }} aria-label={`${f.label} value`} key={`${h.src}-${shown}`} defaultValue={shown}
                          onBlur={(e) => { if (e.target.value !== shown) setVal(f.key, e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                        {h.valueText && h.valueText !== shown && <div className="src">{h.valueText}</div>}
                      </td>
                      <td className="wrap small">{h.note ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {doc.renderPage && table.page && <PdfPage doc={doc} page={table.page} />}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>4 · Verify and store</h2></div>
        <div className="form-row">
          <button className="ghost" onClick={() => setTicked(new Set(found.map((h) => h.key)))}>Tick all {found.length} fields</button>
          <label>Verified by<input value={verifier} onChange={(e) => setVerifier(e.target.value)} placeholder="Name / rank" /></label>
        </div>
        <label className="confirm"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I have compared every value with the source and they agree.</label>
        {blockers.length > 0 && <p className="muted small">To store: {blockers.join(' · ')}.</p>}
        <button disabled={blockers.length > 0} onClick={store}>Store {kind === 'PARTICULARS' ? 'general particulars' : 'lightship'} in {vessel.name}</button>
        {result && <div className={result.ok ? 'notice ok-notice' : 'error-box'} role="status" style={{ marginTop: 10 }}>{result.ok ? '✓ ' : '✗ '}{result.text}</div>}
      </section>
    </>
  );
}

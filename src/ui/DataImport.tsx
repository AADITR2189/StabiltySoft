// Data Import: PDF / Excel / CSV / Word / pasted text → a table in the software, with a cell-by-cell
// trace to the source, consistency checks, human verification and a read-back check after storing.
import { useEffect, useMemo, useState } from 'react';
import type { LoadCase, TankGroup, Vessel } from '../engine/types';
import type { VesselEntry } from '../data/vessels';
import type { UserVesselEntry } from '../importer/dbFile';
import { DATASETS, datasetDef, type DatasetKind } from '../importer/datasets';
import { autoMapping, convert, editCell, type Conversion, type Mapping } from '../importer/convert';
import { checkConversion } from '../importer/checks';
import { applyToVessel, applyWeights, compareRows, datasetKey, expectedRows, SORTED, storedRows, type ApplyOptions, type Provenance } from '../importer/apply';
import { ACCEPT, fromPastedText, readSource, type SourceDoc } from '../importer/sources';
import { newId } from '../store';
import { KvSection } from './KvImport';
import { MultiTankSection } from './MultiTankImport';
import { PdfPage } from './PdfPage';
import { ReviewTable, SourceGrid } from './ImportTables';
import type { KvKind } from '../importer/keyValue';

interface Props {
  entries: VesselEntry[];
  current: VesselEntry;
  userVessels: UserVesselEntry[];
  saveUserVessel: (u: UserVesselEntry) => void;
  /** active load case of the current vessel (for weights) */
  lc: LoadCase;
  updateLoadCase: (lc: LoadCase) => void;
  makeCopy: (e: VesselEntry) => string;
  openVessel: (id: string) => void;
}

type Mode = DatasetKind | KvKind | 'TANKS_ALL';

const GROUPS: TankGroup[] = ['BALLAST', 'FUEL_OIL', 'DIESEL_OIL', 'LUB_OIL', 'FRESH_WATER', 'MISC'];

export function DataImportScreen(p: Props) {
  const [mode, setMode] = useState<Mode>('PARTICULARS');
  const isMulti = mode === 'TANKS_ALL';
  const isKv = mode === 'PARTICULARS' || mode === 'LIGHTSHIP_SUMMARY' || isMulti;
  const kind: DatasetKind = isKv ? 'HYDRO' : (mode as DatasetKind);
  const def = datasetDef(kind);
  const target = p.userVessels.find((u) => u.id === p.current.id);
  const vessel: Vessel = target?.vessel ?? p.current.vessel;

  // dataset options
  const [trim, setTrim] = useState(0);
  const [tankName, setTankName] = useState('');
  const [tankGroup, setTankGroup] = useState<TankGroup>('BALLAST');
  const [tankDensity, setTankDensity] = useState(1.025);
  const [consumable, setConsumable] = useState(false);

  // source
  const [doc, setDoc] = useState<SourceDoc | null>(null);
  const [reading, setReading] = useState(false);
  const [readErr, setReadErr] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const [tableId, setTableId] = useState('');
  const table = doc?.tables.find((t) => t.id === tableId) ?? doc?.tables[0];

  // mapping and conversion
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [conv, setConv] = useState<Conversion | null>(null);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [verifier, setVerifier] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; prov?: Provenance } | null>(null);

  const resetReview = () => { setTicked(new Set()); setConfirm(false); setResult(null); };

  // new table or dataset → guess the mapping
  useEffect(() => {
    if (!table) { setMapping(null); return; }
    setMapping(autoMapping(def, table.rows, mapping?.decimal ?? '.', vessel.lbp));
    resetReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table?.id, doc, kind]);

  useEffect(() => {
    if (!table || !mapping) { setConv(null); return; }
    setConv(convert(def, table.rows, { ...mapping, lbp: vessel.lbp }));
    resetReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapping, vessel.lbp]);

  const checks = useMemo(() => (conv ? checkConversion(kind, conv, vessel, { density: tankDensity }) : []), [conv, kind, vessel, tankDensity]);
  const cellErrors = conv ? conv.rows.reduce((s, r) => s + [...Object.values(r.cells), ...(r.kn ?? [])].filter((c) => c.status === 'error').length, 0) : 0;
  const edited = conv ? conv.rows.reduce((s, r) => s + [...Object.values(r.cells), ...(r.kn ?? [])].filter((c) => c.status === 'edited').length, 0) : 0;
  const missingReq = def.fields.filter((f) => f.required && (mapping?.cols[f.key] ?? -1) < 0);
  const checkErrors = checks.filter((c) => c.level === 'error').length;
  const checkWarns = checks.filter((c) => c.level === 'warn').length;
  const allTicked = !!conv && conv.rows.length > 0 && conv.rows.every((r) => ticked.has(r.src));
  const tankOk = kind !== 'TANK' || (tankName.trim() !== '' && tankDensity > 0);
  const blockers = [
    !doc && 'choose a file or paste a table',
    missingReq.length > 0 && `map the required column(s): ${missingReq.map((f) => f.label).join(', ')}`,
    kind === 'KN' && (mapping?.angleCols.length ?? 0) < 3 && 'map at least 3 heel-angle columns',
    cellErrors > 0 && `fix ${cellErrors} unreadable cell(s)`,
    checkErrors > 0 && `resolve ${checkErrors} failed check(s)`,
    !tankOk && 'enter the tank name and density',
    !allTicked && 'tick every row after comparing it with the source',
    !verifier.trim() && 'enter your name',
    !confirm && 'confirm the comparison',
    kind !== 'WEIGHTS' && !target && 'select one of your vessels (built-in vessels are read-only)',
  ].filter(Boolean) as string[];

  async function onFile(f: File | undefined) {
    if (!f) return;
    setReading(true); setReadErr(null); setDoc(null); setResult(null);
    try { const d = await readSource(f); setDoc(d); if (mode !== 'TANKS_ALL') setTableId(pickTable(d, mode)); }
    catch (e) { setReadErr(e instanceof Error ? e.message : String(e)); }
    finally { setReading(false); }
  }
  async function onPaste() {
    if (!paste.trim()) return;
    const d = await fromPastedText(paste);
    setDoc(d); setTableId(d.tables[0].id); setReadErr(null);
  }

  function apply() {
    if (!conv || !doc || !table || !mapping || blockers.length) return;
    const o: ApplyOptions = { trim, angles: mapping.angleCols.map((a) => a.angle), tank: kind === 'TANK' ? { name: tankName.trim(), group: tankGroup, density: tankDensity, isConsumable: consumable } : undefined };
    const exp = expectedRows(kind, conv, o);
    const values = exp.reduce((s, r) => s + r.filter((x) => !(typeof x === 'number' && Number.isNaN(x))).length, 0);
    const location = `${table.label}, rows ${conv.rows[0].src + 1}–${conv.rows[conv.rows.length - 1].src + 1}`;
    try {
      if (kind === 'WEIGHTS') {
        const lc2 = applyWeights(p.lc, conv, newId);
        p.updateLoadCase(lc2);
        const cmp = compareRows(exp, storedRows(kind, vessel, o, lc2, conv.rows.length), false);
        setResult({ ok: cmp.ok, text: `${conv.rows.length} weight items added to "${p.lc.name}". ${cmp.text}.` });
        return;
      }
      const v2 = applyToVessel(kind, vessel, conv, o);
      const cmp = compareRows(exp, storedRows(kind, v2, o), SORTED.includes(kind));
      const prov: Provenance = {
        dataset: datasetKey(kind, o), method: doc.kind === 'TEXT' && doc.fileName.startsWith('Typed') ? 'TYPED' : 'IMPORT',
        fileName: doc.fileName, fileSha256: doc.sha256, location, rows: conv.rows.length, values, editedCells: edited,
        checks: { errors: checkErrors, warnings: checkWarns }, storedCheck: cmp.text, verifiedBy: verifier.trim(), verifiedAt: new Date().toISOString(),
      };
      if (!cmp.ok) { setResult({ ok: false, text: `Not stored: ${cmp.text}.` }); return; }
      p.saveUserVessel({ ...target!, vessel: v2, provenance: { ...target!.provenance, [prov.dataset]: prov } });
      setResult({ ok: true, text: `${def.label} stored in ${v2.name}. ${cmp.text}.`, prov });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  const setMap = (patch: Partial<Mapping>) => mapping && setMapping({ ...mapping, ...patch });
  const setCell = (src: number, key: string | number, text: string) => {
    if (!conv) return;
    const isText = typeof key === 'string' && def.fields.find((f) => f.key === key)?.type === 'text';
    setConv({
      ...conv,
      rows: conv.rows.map((r) => {
        if (r.src !== src) return r;
        if (typeof key === 'number') return { ...r, kn: r.kn!.map((c, j) => (j === key ? editCell(c, text, false) : c)) };
        return { ...r, cells: { ...r.cells, [key]: editCell(r.cells[key], text, !!isText) } };
      }),
    });
    setTicked((t) => { const n = new Set(t); n.delete(src); return n; });
  };

  return (
    <div className="stack import">
      <div className="notice">
        Bring vessel data in from <b>PDF, Excel (.xlsx), CSV or Word (.docx)</b>, or paste / type a table. Every value keeps its source text so you can compare
        it, each number is re-read digit by digit, engineering checks look for typing errors, and after storing the table is read back from the database and compared value by value.
      </div>

      {/* 1. dataset and target */}
      <section className="panel">
        <div className="panel-head"><h2>1 · What to import, and into which vessel</h2></div>
        <div className="form-row">
          <label>Data set
            <select value={mode} onChange={(e) => { setMode(e.target.value as Mode); setResult(null); if (doc && e.target.value !== 'TANKS_ALL') setTableId(pickTable(doc, e.target.value as DatasetKind | KvKind)); }}>
              <option value="PARTICULARS">General particulars (label / value list)</option>
              <option value="LIGHTSHIP_SUMMARY">Lightship: total weight and centres (label / value list)</option>
              <option value="TANKS_ALL">Tank calibration: all tanks at once</option>
              {DATASETS.map((d) => <option key={d.kind} value={d.kind}>{d.label}</option>)}
            </select>
          </label>
          <label>Vessel
            <select value={p.current.id} onChange={(e) => p.openVessel(e.target.value)}>
              {p.entries.map((e) => <option key={e.id} value={e.id}>{e.vessel.name}{e.user ? ' (mine)' : ' (built-in, read-only)'}</option>)}
            </select>
          </label>
          {!isKv && (kind === 'HYDRO' || kind === 'KN') && <label>Trim of this table (m, + by stern)<input type="number" step="any" value={trim} onChange={(e) => setTrim(Number(e.target.value))} /></label>}
          {!isKv && kind === 'TANK' && <>
            <label>Tank name
              <input list="tank-names" value={tankName} onChange={(e) => {
                setTankName(e.target.value);
                const t = vessel.tanks.find((x) => x.name === e.target.value);
                if (t) { setTankGroup(t.group); setTankDensity(t.density); setConsumable(t.isConsumable); }
              }} placeholder="e.g. NO1_FO.P" />
              <datalist id="tank-names">{vessel.tanks.map((t) => <option key={t.id} value={t.name} />)}</datalist>
            </label>
            <label>Group<select value={tankGroup} onChange={(e) => setTankGroup(e.target.value as TankGroup)}>{GROUPS.map((g) => <option key={g} value={g}>{g.replace('_', ' ').toLowerCase()}</option>)}</select></label>
            <label>Density t/m³<input type="number" step="any" value={tankDensity} onChange={(e) => setTankDensity(Number(e.target.value))} /></label>
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={consumable} onChange={(e) => setConsumable(e.target.checked)} /> Consumable</label>
          </>}
          {!isKv && kind === 'WEIGHTS' && <p className="muted small" style={{ alignSelf: 'end' }}>Added to load case: <b>{p.lc.name}</b></p>}
        </div>
        <p className="muted small">{isMulti ? 'Every tank calibration table in the file in one go: the booklet tank pages, an Excel workbook with one sheet per tank, or one long table with a tank-name column. Columns are mapped once; each tank is checked on its own and stored with its own record.' : isKv ? (mode === 'PARTICULARS' ? 'Ship name, IMO, call sign, LBP, breadth, depth, draft, density and bilge keel area are found by their labels (e.g. "LBP ...... 57.400 m"). Fields not in the source keep their present value.' : 'Lightship weight, LCG, TCG and VCG found by their labels (e.g. "Lightship LCG = 0.592 m AFT of MIDSHIP"). Words like aft / fwd of midship and port / starboard are understood.') : def.help}</p>
        {(isKv || kind !== 'WEIGHTS') && !target && (
          <div className="notice warn-notice">
            <b>{p.current.vessel.name}</b> is a built-in vessel and cannot be changed. Make your own copy to import into, or create a new vessel in Vessel Database.
            <div style={{ marginTop: 8 }}><button onClick={() => p.openVessel(p.makeCopy(p.current))}>Make my copy of {p.current.vessel.name}</button></div>
          </div>
        )}
      </section>

      {/* 2. source */}
      <section className="panel">
        <div className="panel-head"><h2>2 · Source</h2>{doc && <span className="muted small">{doc.fileName} · {doc.kind} · {(doc.size / 1024).toFixed(0)} KB · SHA-256 {doc.sha256.slice(0, 12)}…</span>}</div>
        <div className="form-row">
          <label>Upload a file (PDF, Excel, CSV, Word)
            <input type="file" accept={ACCEPT} onChange={(e) => onFile(e.target.files?.[0])} aria-label="Upload a data file" />
          </label>
          <label style={{ flex: 1, minWidth: 260 }}>…or paste / type a table (copy cells from Excel, or separate values with tabs, commas or semicolons)
            <textarea rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Draft\tDispl\tLCB …\n2.25\t1565.968\t27.979 …'} />
          </label>
          <button className="ghost" style={{ alignSelf: 'end' }} disabled={!paste.trim()} onClick={onPaste}>Use pasted table</button>
        </div>
        {reading && <p className="muted">Reading file…</p>}
        {readErr && <div className="error-box">{readErr}</div>}
        {doc?.warnings.map((w) => <p key={w} className="warn-text small">⚠ {w}</p>)}
        {doc && doc.tables.length === 0 && <div className="error-box">No readable text or tables found in this file.</div>}
      </section>

      {isMulti && doc && <MultiTankSection key={doc.sha256} doc={doc} vessel={vessel} target={target} save={p.saveUserVessel} />}
      {isKv && !isMulti && doc && <KvSection kind={mode as KvKind} doc={doc} tableId={table?.id ?? ''} setTableId={setTableId} vessel={vessel} target={target} save={p.saveUserVessel} />}

      {/* 3. table and columns */}
      {!isKv && doc && table && mapping && (
        <section className="panel">
          <div className="panel-head"><h2>3 · Table and columns</h2><span className="muted small">{doc.tables.length} table(s) / page(s) found</span></div>
          <div className="form-row">
            <label>Table
              {doc.kind === 'PDF' ? (
                <span className="with-unit">
                  <span className="muted">Page</span>
                  <input type="number" min={1} style={{ width: 80 }} value={table.page ?? 1} onChange={(e) => { const t = doc.tables.find((x) => x.page === Number(e.target.value)); if (t) setTableId(t.id); }} />
                  <select value={table.id} onChange={(e) => setTableId(e.target.value)} aria-label="Page">
                    {doc.tables.map((t) => <option key={t.id} value={t.id}>{t.label}: {preview(t.rows)}</option>)}
                  </select>
                </span>
              ) : (
                <select value={table.id} onChange={(e) => setTableId(e.target.value)}>{doc.tables.map((t) => <option key={t.id} value={t.id}>{t.label} ({t.rows.length} rows)</option>)}</select>
              )}
            </label>
            <label>First data row<input type="number" min={1} style={{ width: 90 }} value={mapping.firstRow + 1} onChange={(e) => setMap({ firstRow: Math.max(0, Number(e.target.value) - 1) })} /></label>
            <label>Last data row<input type="number" min={1} style={{ width: 90 }} value={mapping.lastRow + 1} onChange={(e) => setMap({ lastRow: Math.max(0, Number(e.target.value) - 1) })} /></label>
            <label>Decimal separator<select value={mapping.decimal} onChange={(e) => setMap({ decimal: e.target.value as ',' | '.' })}><option value=".">point 1,234.5</option><option value=",">comma 1.234,5</option></select></label>
            {def.fields.some((f) => f.pos === 'X') && (
              <label>Longitudinal positions are measured
                <select value={mapping.xRef} onChange={(e) => setMap({ xRef: e.target.value as Mapping['xRef'] })}>
                  <option value="AP">from AP, + forward</option><option value="MID_FWD">from midship, + forward</option><option value="MID_AFT">from midship, + aft</option>
                </select>
              </label>
            )}
            {def.fields.some((f) => f.pos === 'Y') && (
              <label>Transverse positions
                <select value={mapping.yRef} onChange={(e) => setMap({ yRef: e.target.value as Mapping['yRef'] })}><option value="STBD">+ = starboard</option><option value="PORT">+ = port</option></select>
              </label>
            )}
          </div>
          <p className="muted small">Letters after numbers are understood: <b>a / f</b> = aft / forward of midship, <b>s / p</b> = starboard / port. LBP used for conversion: {vessel.lbp} m.</p>
          <div className="import-source">
            <SourceGrid rows={table.rows} mapping={mapping} def={def} onMap={setMap} />
            {doc.renderPage && table.page && <PdfPage doc={doc} page={table.page} />}
          </div>
        </section>
      )}

      {/* 4. review */}
      {!isKv && conv && mapping && (
        <section className="panel">
          <div className="panel-head"><h2>4 · Review: converted table next to the source text</h2>
            <span className="muted small">{conv.rows.length} rows · {conv.stats.cellsRead} values · {conv.stats.positionsConverted} positions converted{edited ? ` · ${edited} edited by hand` : ''}</span></div>
          <ul className="checks">
            {checks.map((c, i) => (
              <li key={i} className={c.level}>
                <span className="mark">{c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : '✗'}</span>
                <span><b>{c.title}</b>{c.detail && <span className="muted"> · {c.detail}</span>}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">Each cell shows the stored value; the grey line under it is the text exactly as found in the source. Click a value to correct it (the cell is then marked as edited). Tick each row once you have compared it with the source.</p>
          <ReviewTable conv={conv} def={def} mapping={mapping} ticked={ticked} flagged={new Set(checks.flatMap((c) => (c.level !== 'ok' ? c.rows ?? [] : [])))}
            onTick={(src) => setTicked((t) => { const n = new Set(t); if (n.has(src)) n.delete(src); else n.add(src); return n; })}
            onEdit={setCell} />
          {conv.skipped.length > 0 && (
            <details className="calc-details">
              <summary>{conv.skipped.length} row(s) in the range were skipped: check none of them holds data</summary>
              <table className="grid"><tbody>{conv.skipped.map((s) => <tr key={s.src}><td className="num">{s.src + 1}</td><td>{s.reason}</td><td className="muted mono small">{s.text}</td></tr>)}</tbody></table>
            </details>
          )}
        </section>
      )}

      {/* 5. verify and store */}
      {!isKv && conv && (
        <section className="panel">
          <div className="panel-head"><h2>5 · Verify and store</h2></div>
          <div className="form-row">
            <button className="ghost" onClick={() => setTicked(new Set(conv.rows.map((r) => r.src)))}>Tick all {conv.rows.length} rows</button>
            <span className="muted" style={{ alignSelf: 'center' }}>{conv.rows.filter((r) => ticked.has(r.src)).length} of {conv.rows.length} rows ticked</span>
            <label>Verified by<input value={verifier} onChange={(e) => setVerifier(e.target.value)} placeholder="Name / rank" /></label>
          </div>
          <label className="confirm">
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
            I have compared every row of the converted table with the source{doc?.kind === 'PDF' ? ' page' : ' file'} and the values agree.
          </label>
          {blockers.length > 0 && <p className="muted small">To store: {blockers.join(' · ')}.</p>}
          <button disabled={blockers.length > 0} onClick={apply}>Store {def.label.toLowerCase()} {kind === 'WEIGHTS' ? `in "${p.lc.name}"` : `in ${vessel.name}`}</button>
          {result && (
            <div className={result.ok ? 'notice ok-notice' : 'error-box'} role="status" style={{ marginTop: 10 }}>
              {result.ok ? '✓ ' : '✗ '}{result.text}
              {result.prov && <div className="muted small">Recorded: {result.prov.dataset} · {result.prov.fileName} · {result.prov.location} · verified by {result.prov.verifiedBy}, {result.prov.verifiedAt.slice(0, 16).replace('T', ' ')} UTC</div>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function pickTable(d: SourceDoc, kind: DatasetKind | KvKind): string {
  const words: Record<DatasetKind | KvKind, RegExp> = {
    HYDRO: /hydrostat/i, KN: /cross\s*curve|KN/i, TANK: /sounding|ullage|calibration/i, WINDAGE: /wind|lateral/i, OPENINGS: /flood|opening/i, WEIGHTS: /weight|deadweight/i,
    LIGHTSHIP: /light\s*ship.*(weight|estimat|breakdown)/i, PARTICULARS: /general\s*particulars|principal\s*(particulars|dimensions)|main\s*particulars/i, LIGHTSHIP_SUMMARY: /light\s*ship\s*(weight|lcg|vcg)/i,
  };
  const flat = (x: SourceDoc['tables'][number], n: number) => x.rows.slice(0, n).map((r) => r.join(' ')).join('\n');
  // label / value lists: the page that holds the values, not the contents page that names them
  const kv: Partial<Record<DatasetKind | KvKind, (t: string) => boolean>> = {
    PARTICULARS: (t) => /\b(lbp|lpp|length\s*b\.?p)\b[^\n]*\d/i.test(t) && /breadth[^\n]*\d/i.test(t),
    LIGHTSHIP_SUMMARY: (t) => /light\s*ship[^\n]*(weight|lcg|vcg)[^\n]*\d/i.test(t),
  };
  const t = kv[kind] ? d.tables.find((x) => kv[kind]!(flat(x, 80))) : d.tables.find((x) => words[kind].test(flat(x, 8)));
  return (t ?? d.tables[0])?.id ?? '';
}

const preview = (rows: string[][]) => rows.slice(1, 8).flat().filter((c) => /[a-z]{3}/i.test(c)).slice(0, 4).join(' ').slice(0, 50);

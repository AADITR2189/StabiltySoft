// Vessel list (built-in and your own), new vessel / particulars form, dataset verification record,
// and the whole-database file: save to a file and import (merge or replace) with checksum check.
import { useRef, useState } from 'react';
import type { Vessel } from '../engine/types';
import type { VesselEntry } from '../data/vessels';
import { DEFAULT_GROUP_IDS } from '../engine/criteriaGroups';
import { buildDbFile, mergeDb, readDbFile, summarize, type DbData, type DbPreview, type UserVesselEntry } from '../importer/dbFile';
import { missingVerification, newId } from '../store';
import { saveFile } from '../report/save';

interface Props {
  entries: VesselEntry[];
  current: VesselEntry;
  userVessels: UserVesselEntry[];
  saveUserVessel: (u: UserVesselEntry) => void;
  removeUserVessel: (id: string) => void;
  makeCopy: (e: VesselEntry) => string;
  openVessel: (id: string) => void;
  dbData: () => DbData;
  applyDb: (d: DbData) => void;
  builtinIds: string[];
  storageError: string | null;
}

export function VesselManager(p: Props) {
  const [form, setForm] = useState<{ id: string | null } | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const mine = p.userVessels.find((u) => u.id === p.current.id);
  return (
    <div className="stack">
      {p.storageError && <div className="error-box">{p.storageError}</div>}
      <section className="panel">
        <div className="panel-head"><h2>Vessels</h2><button onClick={() => setForm({ id: null })}>+ New vessel</button></div>
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>Vessel</th><th>IMO</th><th>Kind</th><th>Data status</th><th /></tr></thead>
            <tbody>
              {p.entries.map((e) => {
                const u = p.userVessels.find((x) => x.id === e.id);
                const miss = u ? missingVerification(u) : [];
                return (
                  <tr key={e.id} className={e.id === p.current.id ? 'selected' : ''}>
                    <td><button className="link" onClick={() => p.openVessel(e.id)}>{e.vessel.name}</button></td>
                    <td>{e.vessel.imo || '—'}</td>
                    <td>{e.user ? 'Mine (editable)' : 'Built-in (read-only)'}</td>
                    <td className="wrap">
                      <span className={`data-badge ${e.status.toLowerCase()}`}>{e.status === 'VERIFIED' ? 'Verified' : e.status === 'DEMO' ? 'Demo' : 'Not verified'}</span>
                      {u && miss.length > 0 && <div className="muted small">Still to import / verify: {miss.slice(0, 6).join(', ')}{miss.length > 6 ? ` +${miss.length - 6} more` : ''}</div>}
                    </td>
                    <td className="actions">
                      <button className="ghost tiny" onClick={() => p.openVessel(p.makeCopy(e))}>Copy as mine</button>
                      {u && <button className="ghost tiny" onClick={() => { p.openVessel(e.id); setForm({ id: e.id }); }}>Edit particulars</button>}
                      {u && (confirmDel === e.id
                        ? <><button className="danger tiny" onClick={() => { p.removeUserVessel(e.id); setConfirmDel(null); }}>Delete with its load cases</button><button className="ghost tiny" onClick={() => setConfirmDel(null)}>Keep</button></>
                        : <button className="ghost tiny" onClick={() => setConfirmDel(e.id)}>Delete</button>)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {form && <ParticularsForm key={form.id ?? 'new'} existing={form.id ? p.userVessels.find((u) => u.id === form.id) : undefined}
        onCancel={() => setForm(null)}
        onSave={(u) => { p.saveUserVessel(u); p.openVessel(u.id); setForm(null); }} />}

      {mine && <Provenances u={mine} />}

      <DatabaseFile {...p} />
    </div>
  );
}

function Provenances({ u }: { u: UserVesselEntry }) {
  const list = Object.values(u.provenance).sort((a, b) => a.dataset.localeCompare(b.dataset));
  return (
    <section className="panel">
      <div className="panel-head"><h2>Data record of {u.vessel.name}</h2><span className="muted small">{u.source}</span></div>
      {list.length === 0 ? <p className="muted">No data set has been imported and verified yet. Use <b>Data Import</b>.</p> : (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>Data set</th><th>Source</th><th>Location</th><th className="num">Rows</th><th className="num">Values</th><th>Checks</th><th>Read-back</th><th>Verified by</th></tr></thead>
            <tbody>{list.map((x) => (
              <tr key={x.dataset}>
                <td>{x.dataset}</td>
                <td className="wrap">{x.method === 'TYPED' ? 'typed in' : x.fileName}<div className="muted small mono">SHA-256 {x.fileSha256.slice(0, 12)}…</div></td>
                <td className="wrap">{x.location}</td>
                <td className="num">{x.rows}</td><td className="num">{x.values}{x.editedCells ? <div className="warn-text small">{x.editedCells} edited</div> : null}</td>
                <td>{x.checks.errors ? <span className="fail-text">{x.checks.errors} errors</span> : x.checks.warnings ? <span className="warn-text">{x.checks.warnings} warnings accepted</span> : <span className="pass-text">all passed</span>}</td>
                <td className="wrap small">{x.storedCheck}</td>
                <td>{x.verifiedBy}<div className="muted small">{x.verifiedAt.slice(0, 16).replace('T', ' ')} UTC</div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type Num = number | '';
function ParticularsForm({ existing, onSave, onCancel }: { existing?: UserVesselEntry; onSave: (u: UserVesselEntry) => void; onCancel: () => void }) {
  const v = existing?.vessel;
  const [s, setS] = useState({
    name: v?.name ?? '', imo: v?.imo ?? '', callSign: v?.callSign ?? '',
    lbp: (v?.lbp ?? '') as Num, breadth: (v?.breadth ?? '') as Num, depth: (v?.depth ?? '') as Num, maxDraft: (v?.maxDraft ?? '') as Num,
    rhoRef: (v?.rhoRef ?? 1.025) as Num, bilgeType: v?.bilgeType ?? 'ROUND', bilgeKeelArea: (v?.bilgeKeelArea ?? 0) as Num,
    lw: (v?.lightship.weight ?? '') as Num, lcg: (v?.lightship.lcg ?? '') as Num, tcg: (v?.lightship.tcg ?? 0) as Num, vcg: (v?.lightship.vcg ?? '') as Num,
    by: '',
  });
  const num = (k: keyof typeof s) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: e.target.value === '' ? '' : Number(e.target.value) });
  const required: (keyof typeof s)[] = ['lbp', 'breadth', 'depth', 'rhoRef', 'lw', 'lcg', 'vcg'];
  const missing = [!s.name.trim() && 'name', ...required.filter((k) => s[k] === '' || !Number.isFinite(s[k] as number)), !s.by.trim() && 'your name'].filter(Boolean);
  const save = () => {
    const base: Vessel = v ? structuredClone(v) : {
      name: '', imo: '', callSign: '', lbp: 0, breadth: 0, depth: 0, rhoRef: 1.025, bilgeType: 'ROUND', bilgeKeelArea: 0,
      lightship: { weight: 0, lcg: 0, tcg: 0, vcg: 0 }, hydro: { rhoRef: 1.025, rows: [] }, kn: { rhoRef: 1.025, displacements: [], angles: [], kn: [] },
      tanks: [], windage: [], openings: [], criteriaGroups: DEFAULT_GROUP_IDS,
    };
    const vessel: Vessel = {
      ...base, name: s.name.trim(), imo: s.imo.trim(), callSign: s.callSign.trim(), lbp: +s.lbp, breadth: +s.breadth, depth: +s.depth,
      maxDraft: s.maxDraft === '' ? undefined : +s.maxDraft, rhoRef: +s.rhoRef, bilgeType: s.bilgeType as Vessel['bilgeType'], bilgeKeelArea: +s.bilgeKeelArea,
      lightship: { weight: +s.lw, lcg: +s.lcg, tcg: +s.tcg, vcg: +s.vcg },
      hydro: { ...base.hydro, rhoRef: +s.rhoRef }, kn: { ...base.kn, rhoRef: +s.rhoRef },
    };
    const id = existing?.id ?? `u-${newId()}`;
    onSave({
      id, vessel, source: existing?.source ?? 'Created in StabilitySoft', createdAt: existing?.createdAt ?? new Date().toISOString(),
      provenance: {
        ...(existing?.provenance ?? {}),
        PARTICULARS: { dataset: 'PARTICULARS', method: 'TYPED', fileName: 'Typed in', fileSha256: '', location: 'General particulars and lightship form', rows: 1, values: 11, editedCells: 0, checks: { errors: 0, warnings: 0 }, storedCheck: 'entered directly', verifiedBy: s.by.trim(), verifiedAt: new Date().toISOString() },
      },
    });
  };
  const F = (label: string, k: keyof typeof s, unit = '') => <label>{label}{unit && ` (${unit})`}<input type="number" step="any" value={s[k] as Num} onChange={num(k)} /></label>;
  return (
    <section className="panel">
      <div className="panel-head"><h2>{existing ? `Particulars of ${existing.vessel.name}` : 'New vessel'}</h2></div>
      <div className="form-row">
        <label>Ship name<input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} /></label>
        <label>IMO number<input value={s.imo} onChange={(e) => setS({ ...s, imo: e.target.value })} /></label>
        <label>Call sign<input value={s.callSign} onChange={(e) => setS({ ...s, callSign: e.target.value })} /></label>
        {F('Length between perpendiculars', 'lbp', 'm')}{F('Breadth', 'breadth', 'm')}{F('Depth', 'depth', 'm')}{F('Load line draft', 'maxDraft', 'm')}
        {F('Density of hydrostatic tables', 'rhoRef', 't/m³')}
        <label>Bilge<select value={s.bilgeType} onChange={(e) => setS({ ...s, bilgeType: e.target.value as 'ROUND' | 'SHARP' })}><option value="ROUND">round</option><option value="SHARP">sharp</option></select></label>
        {F('Bilge keel area', 'bilgeKeelArea', 'm²')}
      </div>
      <h3 className="small-h" style={{ marginTop: 12 }}>Lightship</h3>
      <div className="form-row">{F('Weight', 'lw', 't')}{F('LCG from AP', 'lcg', 'm')}{F('TCG (+ stbd)', 'tcg', 'm')}{F('VCG', 'vcg', 'm')}</div>
      <div className="form-row" style={{ marginTop: 12 }}>
        <label>Entered and checked by<input value={s.by} onChange={(e) => setS({ ...s, by: e.target.value })} placeholder="Name / rank" /></label>
        <button style={{ alignSelf: 'end' }} disabled={missing.length > 0} onClick={save}>{existing ? 'Save particulars' : 'Create vessel'}</button>
        <button className="ghost" style={{ alignSelf: 'end' }} onClick={onCancel}>Cancel</button>
      </div>
      {missing.length > 0 && <p className="muted small">Still needed: {missing.join(', ')}.</p>}
      {!existing && <p className="muted small">After creating the vessel, bring in the hydrostatics, cross curves, tanks, windage and openings with <b>Data Import</b>.</p>}
    </section>
  );
}

function DatabaseFile(p: Props) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<DbPreview | null>(null);
  const [mode, setMode] = useState<'MERGE' | 'REPLACE'>('MERGE');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const cur = summarize(p.dbData());

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const text = await buildDbFile(p.dbData());
      const name = `StabilitySoft_database_${new Date().toISOString().slice(0, 10)}.json`;
      const out = await saveFile(name, new Blob([text], { type: 'application/json' }));
      setMsg(out === 'saved' ? { ok: true, text: `${name} (${Math.round(text.length / 1024)} KB) saved.` } : { ok: false, text: out === 'declined' ? 'Save cancelled.' : 'Saving files is not available here.' });
    } catch (e) { setMsg({ ok: false, text: String(e instanceof Error ? e.message : e) }); }
    finally { setBusy(false); }
  }
  async function open(f: File | undefined) {
    if (!f) return;
    setMsg(null); setPreview(null);
    try { setPreview(await readDbFile(await f.text(), p.entries.map((e) => e.id))); }
    catch (e) { setMsg({ ok: false, text: String(e instanceof Error ? e.message : e) }); }
    if (input.current) input.current.value = '';
  }
  function doImport() {
    if (!preview || preview.errors.length) return;
    const merged = mergeDb(p.dbData(), preview.file.data, mode, p.builtinIds);
    p.applyDb(merged);
    const s = summarize(merged);
    setMsg({ ok: true, text: `Database ${mode === 'MERGE' ? 'merged' : 'replaced'}: now ${s.vessels} of your vessels, ${s.loadCases} load cases, ${s.criteria} criteria, ${s.groups} groups, ${s.moments} moments.` });
    setPreview(null);
  }

  const inc = preview?.file.data;
  return (
    <section className="panel">
      <div className="panel-head"><h2>Database file</h2></div>
      <p className="muted small">The whole database in one file: your vessels with their data record, the load cases of every vessel, and your criteria, groups and moments.
        Now: {cur.vessels} of your vessels · {cur.loadCases} load cases · {cur.criteria} criteria · {cur.groups} groups · {cur.moments} moments. The file is sealed with a SHA-256 checksum.</p>
      <div className="form-row">
        <button disabled={busy} onClick={save}>⬇ Save database to file</button>
        <label className="ghost-file">
          <span className="file-btn">⬆ Import database file</span>
          <input ref={input} type="file" accept=".json,application/json" onChange={(e) => open(e.target.files?.[0])} aria-label="Import database file" />
        </label>
      </div>
      {msg && <p role="status" className={msg.ok ? 'pass-text' : 'fail-text'}>{msg.text}</p>}
      {preview && inc && (
        <div className="db-preview">
          <h3 className="small-h">File content</h3>
          <table className="grid"><tbody>
            <tr><td>Saved</td><td>{preview.file.createdAt.slice(0, 16).replace('T', ' ')} UTC · engine {preview.file.engine}</td></tr>
            <tr><td>Checksum</td><td className={preview.checksumOk ? 'pass-text' : 'fail-text'}>{preview.checksumOk ? '✓ matches: file unchanged since it was saved' : '✗ does not match'}</td></tr>
            <tr><td>Vessels</td><td className="wrap">{inc.vessels.length ? inc.vessels.map((v) => `${v.vessel.name}${p.userVessels.some((u) => u.id === v.id) ? ' (replaces yours)' : ' (new)'}`).join(', ') : 'none'}</td></tr>
            <tr><td>Load cases</td><td className="wrap">{Object.entries(inc.loadCases).map(([vid, cs]) => `${p.entries.find((e) => e.id === vid)?.vessel.name ?? inc.vessels.find((v) => v.id === vid)?.vessel.name ?? vid}: ${cs.length}`).join(' · ')}</td></tr>
            <tr><td>Library</td><td>{inc.library.criteria.length} criteria · {inc.library.groups.length} groups · {inc.library.moments?.length ?? 0} moments</td></tr>
          </tbody></table>
          {preview.errors.map((e) => <p key={e} className="fail-text small">✗ {e}</p>)}
          {preview.warnings.map((e) => <p key={e} className="warn-text small">! {e}</p>)}
          {preview.errors.length === 0 && <>
            <div className="form-row" style={{ marginTop: 8 }}>
              <label style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><input type="radio" checked={mode === 'MERGE'} onChange={() => setMode('MERGE')} /> Merge: add new items, update items with the same ID, keep the rest</label>
              <label style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><input type="radio" checked={mode === 'REPLACE'} onChange={() => setMode('REPLACE')} /> Replace: the database becomes exactly this file</label>
            </div>
            {mode === 'REPLACE' && <p className="warn-text small">Everything now in the software that is not in the file will be removed. Save the current database to a file first if you may need it.</p>}
            <div className="form-row"><button onClick={doImport}>{mode === 'MERGE' ? 'Merge into database' : 'Replace database'}</button><button className="ghost" onClick={() => setPreview(null)}>Cancel</button></div>
          </>}
          {preview.errors.length > 0 && <p className="fail-text">This file cannot be imported. Use the original file saved by StabilitySoft.</p>}
        </div>
      )}
    </section>
  );
}

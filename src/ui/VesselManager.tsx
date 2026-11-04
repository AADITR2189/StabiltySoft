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
  const [lightForm, setLightForm] = useState<string | null>(null);
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
                      {u && <button className="ghost tiny" onClick={() => { p.openVessel(e.id); setLightForm(null); setForm({ id: e.id }); }}>Edit particulars</button>}
                      {u && <button className="ghost tiny" onClick={() => { p.openVessel(e.id); setForm(null); setLightForm(e.id); }}>Edit lightship</button>}
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
        onSave={(u) => { const isNew = !p.userVessels.some((x) => x.id === u.id); p.saveUserVessel(u); p.openVessel(u.id); setForm(null); if (isNew) setLightForm(u.id); }} />}

      {lightForm && p.userVessels.find((u) => u.id === lightForm) && <LightshipForm key={lightForm} u={p.userVessels.find((u) => u.id === lightForm)!}
        onCancel={() => setLightForm(null)} onSave={(u) => { p.saveUserVessel(u); setLightForm(null); }} />}

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
const K_TABLE: [number[], number[]] = [[0, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0], [1.0, 0.98, 0.95, 0.88, 0.79, 0.74, 0.72, 0.7]];
function kPreview(keels: boolean, area: Num, bilge: string, L: Num, B: Num): string {
  if (keels) {
    if (!(+area > 0)) return 'Enter the total bilge keel area A_k (both sides, plus bar keel area if any).';
    if (!(+L > 0 && +B > 0)) return 'k will be taken from the IS Code table with A_k·100/(L·B).';
    const x = (+area * 100) / (+L * +B);
    const [xs, ys] = K_TABLE;
    const c = Math.min(Math.max(x, xs[0]), xs[xs.length - 1]);
    let i = 0; while (i < xs.length - 2 && c > xs[i + 1]) i++;
    const k = ys[i] + ((c - xs[i]) / (xs[i + 1] - xs[i])) * (ys[i + 1] - ys[i]);
    return `A_k·100/(L·B) = ${x.toFixed(3)} → k ≈ ${k.toFixed(3)} from the IS Code 2008 A 2.3.4 table (calculated with the waterline length of each condition; LBP shown here).`;
  }
  return bilge === 'SHARP' ? 'No bilge keel area: k = 0.7 for a ship with sharp bilges (IS Code 2008 A 2.3.4).' : 'No bilge keel area: k = 1.0 for a round-bilged ship without bilge or bar keels (IS Code 2008 A 2.3.4).';
}

export function ParticularsForm({ existing, onSave, onCancel }: { existing?: UserVesselEntry; onSave: (u: UserVesselEntry) => void; onCancel: () => void }) {
  const v = existing?.vessel;
  const [s, setS] = useState({
    name: v?.name ?? '', imo: v?.imo ?? '', callSign: v?.callSign ?? '',
    lbp: (v?.lbp || '') as Num, breadth: (v?.breadth || '') as Num, depth: (v?.depth || '') as Num, maxDraft: (v?.maxDraft ?? '') as Num,
    rhoRef: (v?.rhoRef ?? 1.025) as Num, bilgeType: v?.bilgeType ?? 'ROUND',
    keels: v ? (v.hasBilgeKeels ?? v.bilgeKeelArea > 0) : false, bilgeKeelArea: (v?.bilgeKeelArea || '') as Num,
    by: '',
  });
  const num = (k: keyof typeof s) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: e.target.value === '' ? '' : Number(e.target.value) });
  const required: (keyof typeof s)[] = ['lbp', 'breadth', 'depth', 'rhoRef'];
  const missing = [
    !s.name.trim() && 'name', ...required.filter((k) => s[k] === '' || !Number.isFinite(s[k] as number)),
    s.keels && !(+s.bilgeKeelArea > 0) && 'bilge keel area (or untick "area known")', !s.by.trim() && 'your name',
  ].filter(Boolean);
  const save = () => {
    const base: Vessel = v ? structuredClone(v) : {
      name: '', imo: '', callSign: '', lbp: 0, breadth: 0, depth: 0, rhoRef: 1.025, bilgeType: 'ROUND', bilgeKeelArea: 0,
      lightship: { weight: 0, lcg: 0, tcg: 0, vcg: 0 }, hydro: { rhoRef: 1.025, rows: [] }, kn: { rhoRef: 1.025, displacements: [], angles: [], kn: [] },
      tanks: [], windage: [], openings: [], criteriaGroups: DEFAULT_GROUP_IDS,
    };
    const vessel: Vessel = {
      ...base, name: s.name.trim(), imo: s.imo.trim(), callSign: s.callSign.trim(), lbp: +s.lbp, breadth: +s.breadth, depth: +s.depth,
      maxDraft: s.maxDraft === '' ? undefined : +s.maxDraft, rhoRef: +s.rhoRef, bilgeType: s.bilgeType as Vessel['bilgeType'],
      hasBilgeKeels: s.keels, bilgeKeelArea: s.keels ? +s.bilgeKeelArea : 0,
      hydro: { ...base.hydro, rhoRef: +s.rhoRef }, kn: { ...base.kn, rhoRef: +s.rhoRef },
    };
    const id = existing?.id ?? `u-${newId()}`;
    onSave({
      id, vessel, source: existing?.source ?? 'Created in StabilitySoft', createdAt: existing?.createdAt ?? new Date().toISOString(),
      provenance: {
        ...(existing?.provenance ?? {}),
        PARTICULARS: { dataset: 'PARTICULARS', method: 'TYPED', fileName: 'Typed in', fileSha256: '', location: 'General particulars form', rows: 1, values: 10, editedCells: 0, checks: { errors: 0, warnings: 0 }, storedCheck: 'entered directly', verifiedBy: s.by.trim(), verifiedAt: new Date().toISOString() },
      },
    });
  };
  const F = (label: string, k: keyof typeof s, unit = '') => <label>{label}{unit && ` (${unit})`}<input type="number" step="any" value={s[k] as Num} onChange={num(k)} /></label>;
  return (
    <section className="panel">
      <div className="panel-head"><h2>{existing ? `Particulars of ${existing.vessel.name}` : 'New vessel'}</h2></div>
      <p className="muted small">Type the values here, or import them from the booklet with <b>Data Import → General particulars</b>.</p>
      <div className="form-row">
        <label>Ship name<input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} /></label>
        <label>IMO number<input value={s.imo} onChange={(e) => setS({ ...s, imo: e.target.value })} /></label>
        <label>Call sign<input value={s.callSign} onChange={(e) => setS({ ...s, callSign: e.target.value })} /></label>
        {F('Length between perpendiculars', 'lbp', 'm')}{F('Breadth', 'breadth', 'm')}{F('Depth', 'depth', 'm')}{F('Load line draft', 'maxDraft', 'm')}
        {F('Density of hydrostatic tables', 'rhoRef', 't/m³')}
      </div>
      <h3 className="small-h" style={{ marginTop: 12 }}>Bilge and bilge keels (roll factor k of the weather criterion)</h3>
      <div className="form-row">
        <label>Bilge<select value={s.bilgeType} onChange={(e) => setS({ ...s, bilgeType: e.target.value as 'ROUND' | 'SHARP' })}><option value="ROUND">round</option><option value="SHARP">sharp</option></select></label>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'end' }}>
          <input type="checkbox" checked={s.keels} onChange={(e) => setS({ ...s, keels: e.target.checked })} /> Bilge keels / bar keel fitted and area known
        </label>
        {s.keels && F('Total bilge keel area A_k', 'bilgeKeelArea', 'm²')}
      </div>
      <p className="muted small">{kPreview(s.keels, s.bilgeKeelArea, s.bilgeType, s.lbp, s.breadth)}</p>
      <div className="form-row" style={{ marginTop: 12 }}>
        <label>Entered and checked by<input value={s.by} onChange={(e) => setS({ ...s, by: e.target.value })} placeholder="Name / rank" /></label>
        <button style={{ alignSelf: 'end' }} disabled={missing.length > 0} onClick={save}>{existing ? 'Save particulars' : 'Create vessel'}</button>
        <button className="ghost" style={{ alignSelf: 'end' }} onClick={onCancel}>Cancel</button>
      </div>
      {missing.length > 0 && <p className="muted small">Still needed: {missing.join(', ')}.</p>}
      {!existing && <p className="muted small">After creating the vessel, add the lightship (<b>Edit lightship</b>) and bring in the hydrostatics, cross curves, tanks, windage and openings with <b>Data Import</b>.</p>}
    </section>
  );
}

type Item = { description: string; weight: Num; lcg: Num; tcg: Num; vcg: Num };
export function LightshipForm({ u, onSave, onCancel }: { u: UserVesselEntry; onSave: (u: UserVesselEntry) => void; onCancel: () => void }) {
  const v = u.vessel;
  const L = v.lbp;
  const start: Item[] = v.lightshipItems?.length
    ? v.lightshipItems.map((x) => ({ ...x }))
    : [{ description: 'Lightship', weight: v.lightship.weight || '', lcg: v.lightship.weight ? v.lightship.lcg : '', tcg: v.lightship.weight ? v.lightship.tcg : 0, vcg: v.lightship.weight ? v.lightship.vcg : '' }];
  const [items, setItems] = useState<Item[]>(start);
  const [xRef, setXRef] = useState<'AP' | 'MID'>('AP');
  const [by, setBy] = useState('');
  const toAP = (x: number) => (xRef === 'MID' ? L / 2 + x : x);
  const ok = (x: Num) => x !== '' && Number.isFinite(x);
  const complete = items.filter((x) => ok(x.weight) && ok(x.lcg) && ok(x.vcg));
  const W = complete.reduce((s, x) => s + +x.weight, 0);
  const m = (f: (x: Item) => number) => (W ? complete.reduce((s, x) => s + +x.weight * f(x), 0) / W : 0);
  const tot = { weight: W, lcg: m((x) => toAP(+x.lcg)), tcg: m((x) => +(x.tcg || 0)), vcg: m((x) => +x.vcg) };
  const missing = [complete.length !== items.length && 'every row needs weight, LCG and VCG', !(W > 0) && 'total weight must be positive', !by.trim() && 'your name'].filter(Boolean);
  const set = (i: number, k: keyof Item, val: string) => setItems(items.map((x, j) => (j !== i ? x : { ...x, [k]: k === 'description' ? val : val === '' ? '' : Number(val) })));
  const save = () => {
    const list = complete.map((x) => ({ description: x.description.trim() || 'Item', weight: +x.weight, lcg: toAP(+x.lcg), tcg: +(x.tcg || 0), vcg: +x.vcg }));
    const vessel: Vessel = { ...structuredClone(v), lightship: tot, lightshipItems: list.length > 1 ? list : undefined };
    onSave({
      ...u, vessel,
      provenance: { ...u.provenance, LIGHTSHIP: { dataset: 'LIGHTSHIP', method: 'TYPED', fileName: 'Typed in', fileSha256: '', location: `Lightship form, ${list.length} item(s)`, rows: list.length, values: list.length * 4, editedCells: 0, checks: { errors: 0, warnings: 0 }, storedCheck: 'entered directly', verifiedBy: by.trim(), verifiedAt: new Date().toISOString() } },
    });
  };
  return (
    <section className="panel">
      <div className="panel-head"><h2>Lightship of {v.name}</h2></div>
      <p className="muted small">One line with the totals, or several weight items (hull, machinery, outfit, …) which are added up. To import from the booklet use <b>Data Import → Lightship</b>.</p>
      <div className="form-row">
        <label>LCG entered
          <select value={xRef} onChange={(e) => setXRef(e.target.value as 'AP' | 'MID')}><option value="AP">from AP, + forward</option><option value="MID">from midship, + forward (− aft)</option></select>
        </label>
      </div>
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th>Item</th><th className="num">Weight t</th><th className="num">LCG m</th><th className="num">TCG m (+ stbd)</th><th className="num">VCG m</th><th /></tr></thead>
          <tbody>
            {items.map((x, i) => (
              <tr key={i}>
                <td><input value={x.description} onChange={(e) => set(i, 'description', e.target.value)} aria-label={`Item ${i + 1} description`} /></td>
                {(['weight', 'lcg', 'tcg', 'vcg'] as const).map((k) => <td key={k} className="num"><input type="number" step="any" style={{ width: 100 }} value={x[k]} onChange={(e) => set(i, k, e.target.value)} aria-label={`Item ${i + 1} ${k}`} /></td>)}
                <td className="actions">{items.length > 1 && <button className="ghost tiny" onClick={() => setItems(items.filter((_, j) => j !== i))}>Remove</button>}</td>
              </tr>
            ))}
            <tr className="total"><td>Lightship total{xRef === 'MID' ? ' (LCG from AP)' : ''}</td><td className="num">{tot.weight.toFixed(2)}</td><td className="num">{tot.lcg.toFixed(3)}</td><td className="num">{tot.tcg.toFixed(3)}</td><td className="num">{tot.vcg.toFixed(3)}</td><td /></tr>
          </tbody>
        </table>
      </div>
      <div className="form-row" style={{ marginTop: 8 }}>
        <button className="ghost" onClick={() => setItems([...items, { description: '', weight: '', lcg: '', tcg: 0, vcg: '' }])}>+ Add item</button>
        <label>Entered and checked by<input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Name / rank" /></label>
        <button style={{ alignSelf: 'end' }} disabled={missing.length > 0} onClick={save}>Save lightship</button>
        <button className="ghost" style={{ alignSelf: 'end' }} onClick={onCancel}>Cancel</button>
      </div>
      {missing.length > 0 && <p className="muted small">Still needed: {missing.join(', ')}.</p>}
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

// Imported Data: every data set of the vessel in one place, with where it came from, who verified
// it, the edit history, the full table, and an editor (checks + read-back + change log on save).
import { useMemo, useState } from 'react';
import type { Vessel } from '../engine/types';
import type { VesselEntry } from '../data/vessels';
import type { UserVesselEntry } from '../importer/dbFile';
import type { Provenance } from '../importer/apply';
import { tankTypes } from '../engine/tankTypes';
import { applyTable, checkTable, columnsOf, diffRows, listDatasets, tableOf, type DsRef } from '../importer/datasetTables';
import { LightshipForm, ParticularsForm } from './VesselManager';
import { TankTypesEditor, TankTypesView } from './TankTypesEditor';

interface Props {
  current: VesselEntry;
  userVessels: UserVesselEntry[];
  saveUserVessel: (u: UserVesselEntry) => void;
  makeCopy: (e: VesselEntry) => string;
  openVessel: (id: string) => void;
}

const fmt = (x: number | string) => (typeof x === 'number' ? (Number.isNaN(x) ? '—' : String(Math.round(x * 1e6) / 1e6)) : x);

export function ImportedDataScreen(p: Props) {
  const mine = p.userVessels.find((u) => u.id === p.current.id);
  const v: Vessel = mine?.vessel ?? p.current.vessel;
  const prov = mine?.provenance ?? {};
  const list = useMemo(() => listDatasets(v), [v]);
  const [sel, setSel] = useState('HYDRO trim 0');
  const ref = list.find((d) => d.key === sel) ?? list[0];
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState('');

  const statusOf = (d: DsRef): { cls: string; text: string } => {
    const pr = prov[d.key === 'LIGHTSHIP' ? 'LIGHTSHIP' : d.key];
    if (!d.rows && d.kind !== 'PARTICULARS') return { cls: 'fail-text', text: 'missing' };
    if (pr) return { cls: 'pass-text', text: `${pr.method === 'IMPORT' ? 'imported' : 'typed'}${pr.edits?.length ? ', edited' : ''} ✓` };
    return { cls: 'warn-text', text: mine ? 'not verified' : p.current.status === 'DEMO' ? 'demo' : 'booklet, not verified' };
  };

  const groups = [...new Set(list.map((d) => d.group))];
  return (
    <div className="stack">
      {!mine && (
        <div className="notice warn-notice">
          <b>{v.name}</b> is a built-in vessel: you can look at every data set here, but not change it.
          <div style={{ marginTop: 8 }}><button onClick={() => p.openVessel(p.makeCopy(p.current))}>Make my copy of {v.name} to edit</button></div>
        </div>
      )}
      <div className="data-browser">
        <nav className="panel ds-list" aria-label="Data sets">
          <input placeholder="Find data set / tank" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Find data set" />
          {groups.map((g) => {
            const items = list.filter((d) => d.group === g && (!filter || d.title.toLowerCase().includes(filter.toLowerCase())));
            if (!items.length) return null;
            return (
              <div key={g}>
                <div className="ds-group">{g.startsWith('Tanks · ') && <span className="dot" style={{ background: tankTypes(v).find((t) => `Tanks · ${t.name}` === g)?.color }} />}{g}{g.startsWith('Tanks · ') ? ` (${items.length})` : ''}</div>
                {items.map((d) => {
                  const st = statusOf(d);
                  return (
                    <button key={d.key} className={`ds-item ${d.key === ref.key ? 'active' : ''}`} onClick={() => { setSel(d.key); setEditing(false); }}>
                      <span>{d.title}</span><span className={`small ${st.cls}`}>{st.text}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="ds-main">
          <SourceRecord pr={prov[ref.key === 'LIGHTSHIP' ? 'LIGHTSHIP' : ref.key]} builtIn={!mine} status={p.current.status} source={p.current.source} />
          {ref.kind === 'TANK_TYPES'
            ? (editing && mine ? <TankTypesEditor u={mine} save={p.saveUserVessel} onDone={() => setEditing(false)} />
              : <section className="panel"><div className="panel-head"><h2>Tank types</h2>{mine && <button onClick={() => setEditing(true)}>Edit</button>}</div><TankTypesView v={v} /></section>)
            : ref.kind === 'PARTICULARS' || ref.kind === 'LIGHTSHIP_SUMMARY'
            ? <FormDataset key={`${ref.key}-${p.current.id}`} kind={ref.kind} v={v} mine={mine} save={p.saveUserVessel} editing={editing} setEditing={setEditing} />
            : <TableDataset key={`${ref.key}-${p.current.id}`} ref_={ref} v={v} mine={mine} save={p.saveUserVessel} editing={editing} setEditing={setEditing} onDeleted={() => setSel('HYDRO trim 0')} />}
        </div>
      </div>
    </div>
  );
}

function SourceRecord({ pr, builtIn, status, source }: { pr?: Provenance; builtIn: boolean; status: string; source: string }) {
  if (!pr) {
    return (
      <section className="panel">
        <div className="panel-head"><h2>Source</h2></div>
        <p className={builtIn ? 'warn-text' : 'warn-text'}>{builtIn ? `${status === 'DEMO' ? 'Demo data' : `Extracted from the booklet, not yet verified`}: ${source}` : 'No import record: this data set came with the copied vessel and has not been imported or verified here. Import it with Data Import, or check it and save it in the editor.'}</p>
      </section>
    );
  }
  return (
    <section className="panel">
      <div className="panel-head"><h2>Source</h2><span className={pr.edits?.length ? 'warn-text small' : 'pass-text small'}>{pr.method === 'IMPORT' ? 'Imported' : 'Typed in'}{pr.edits?.length ? ` · edited ${pr.edits.length}×` : ''} · verified by {pr.verifiedBy}</span></div>
      <table className="grid"><tbody>
        <tr><td>File</td><td className="wrap">{pr.fileName}{pr.fileSha256 && <span className="muted mono small"> · SHA-256 {pr.fileSha256.slice(0, 16)}…</span>}</td></tr>
        <tr><td>Location</td><td className="wrap">{pr.location}</td></tr>
        <tr><td>Rows / values</td><td>{pr.rows} / {pr.values}{pr.editedCells ? ` · ${pr.editedCells} cells corrected during import` : ''}{pr.filledCells ? ` · ${pr.filledCells} filled by convention or derived` : ''}</td></tr>
        <tr><td>Checks</td><td>{pr.checks.errors ? `${pr.checks.errors} errors` : pr.checks.warnings ? `${pr.checks.warnings} warnings accepted` : 'all passed'}</td></tr>
        <tr><td>Read-back</td><td className="wrap">{pr.storedCheck}</td></tr>
        <tr><td>Verified</td><td>{pr.verifiedBy}, {pr.verifiedAt.slice(0, 16).replace('T', ' ')} UTC</td></tr>
      </tbody></table>
      {pr.edits && pr.edits.length > 0 && (
        <details className="calc-details" open>
          <summary>Edit history ({pr.edits.length})</summary>
          <ul className="edit-log">
            {pr.edits.map((e, i) => (
              <li key={i}><b>{e.at.slice(0, 16).replace('T', ' ')} UTC · {e.by}</b> · {e.reason}
                <ul>{e.changes.slice(0, 30).map((c, j) => <li key={j} className="mono small">{c}</li>)}{e.changes.length > 30 && <li className="muted small">… {e.changes.length - 30} more</li>}</ul>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function withEdit(u: UserVesselEntry, key: string, vessel: Vessel, by: string, reason: string, changes: string[], fallback: () => Provenance): UserVesselEntry {
  const old = u.provenance[key];
  const entry = { by, at: new Date().toISOString(), reason, changes };
  const pr: Provenance = old ? { ...old, edits: [...(old.edits ?? []), entry] } : { ...fallback(), edits: [entry] };
  return { ...u, vessel, provenance: { ...u.provenance, [key]: pr } };
}

function TableDataset({ ref_, v, mine, save, editing, setEditing, onDeleted }: {
  ref_: DsRef; v: Vessel; mine?: UserVesselEntry; save: (u: UserVesselEntry) => void; editing: boolean; setEditing: (b: boolean) => void; onDeleted: () => void;
}) {
  const ref = ref_;
  const cols = columnsOf(v, ref);
  const before = useMemo(() => tableOf(v, ref), [v, ref]);
  const [rows, setRows] = useState(() => before.map((r, i) => ({ orig: i as number | null, vals: [...r] })));
  const [by, setBy] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const plain = rows.map((r) => r.vals);
  const checks = useMemo(() => checkTable(v, ref, cols, editing ? plain : before), [v, ref, cols, plain, before, editing]);
  const changes = editing ? diffRows(cols, before, rows) : [];
  const errors = checks.filter((c) => c.level === 'error');
  const tank = ref.tank ? v.tanks.find((t) => t.name === ref.tank) : undefined;

  const setCell = (i: number, j: number, text: string) => setRows((rs) => rs.map((r, k) => {
    if (k !== i) return r;
    const vals = [...r.vals];
    vals[j] = cols[j].type === 'text' ? text : text.trim() === '' ? NaN : Number(text.replace(',', '.').replace('−', '-'));
    return { ...r, vals };
  }));

  function doSave() {
    if (!mine) return;
    try {
      const res = applyTable(v, ref, cols, plain);
      if (!res.ok) { setMsg({ ok: false, text: `Not saved: ${res.text}.` }); return; }
      const nv = plain.reduce((s, r) => s + r.filter((x) => !(typeof x === 'number' && Number.isNaN(x))).length, 0);
      save(withEdit(mine, ref.key, res.vessel, by.trim(), reason.trim(), changes, () => ({
        dataset: ref.key, method: 'TYPED', fileName: 'Checked and edited in Imported Data', fileSha256: '', location: 'Imported Data editor',
        rows: plain.length, values: nv, editedCells: changes.length, checks: { errors: 0, warnings: checks.filter((c) => c.level === 'warn').length },
        storedCheck: res.text, verifiedBy: by.trim(), verifiedAt: new Date().toISOString(),
      })));
      setMsg({ ok: true, text: `Saved: ${changes.length} change(s). ${res.text}.` });
      setEditing(false);
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
  }

  function deleteTank() {
    if (!mine || !tank) return;
    const provenance = { ...mine.provenance };
    delete provenance[ref.key];
    save({ ...mine, vessel: { ...structuredClone(v), tanks: v.tanks.filter((t) => t.name !== tank.name) }, provenance });
    onDeleted();
  }

  const blockers = [!changes.length && 'no changes yet', errors.length > 0 && `fix ${errors.length} failed check(s)`, !by.trim() && 'your name', !reason.trim() && 'the reason for the change'].filter(Boolean) as string[];
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{ref.title}{tank ? ` · ${tank.group.replace('_', ' ').toLowerCase()} · ρ ${tank.density} t/m³ · ${tank.capacity.toFixed(2)} m³` : ''}</h2>
        <span className="form-row" style={{ gap: 8 }}>
          {mine && !editing && <button onClick={() => { setRows(before.map((r, i) => ({ orig: i as number | null, vals: [...r] }))); setMsg(null); setEditing(true); }}>Edit</button>}
          {mine && tank && !editing && (confirmDel
            ? <><button className="danger tiny" onClick={deleteTank}>Delete tank {tank.name}</button><button className="ghost tiny" onClick={() => setConfirmDel(false)}>Keep</button></>
            : <button className="ghost" onClick={() => setConfirmDel(true)}>Delete tank</button>)}
        </span>
      </div>
      {msg && <div className={msg.ok ? 'notice ok-notice' : 'error-box'} role="status" style={{ marginBottom: 8 }}>{msg.text}</div>}
      <ul className="checks">{checks.map((c, i) => <li key={i} className={c.level}><span className="mark">{c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : '✗'}</span><span><b>{c.title}</b>{c.detail && <span className="muted"> · {c.detail}</span>}</span></li>)}</ul>
      {!before.length && !editing && <p className="muted">No rows. {mine ? 'Use Edit to type them, or Data Import.' : ''}</p>}
      <div className="table-wrap tall">
        <table className="grid ds-table">
          <thead><tr><th className="num">#</th>{cols.map((c) => <th key={c.key} className={c.type === 'num' ? 'num' : ''}>{c.label}{c.unit && <div className="muted small">{c.unit}</div>}</th>)}{editing && <th />}</tr></thead>
          <tbody>
            {(editing ? rows : before.map((r, i) => ({ orig: i, vals: r }))).map((r, i) => {
              const orig = r.orig !== null ? before[r.orig] : null;
              return (
                <tr key={i} className={r.orig === null ? 'row-added' : ''}>
                  <td className="num muted">{i + 1}</td>
                  {r.vals.map((x, j) => {
                    const changed = editing && (!orig || !(typeof x === 'number' && typeof orig[j] === 'number' ? (Number.isNaN(x) && Number.isNaN(orig[j] as number)) || x === orig[j] : x === orig[j]));
                    return editing ? (
                      <td key={j} className={`num ${changed ? 'cell-edited' : ''}`}>
                        <input key={`${i}-${j}-${String(x)}`} defaultValue={fmt(x) === '—' ? '' : fmt(x)} aria-label={`Row ${i + 1} ${cols[j].label}`}
                          style={{ width: cols[j].type === 'text' ? 150 : 86, textAlign: cols[j].type === 'text' ? 'left' : 'right' }}
                          onBlur={(e) => setCell(i, j, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                        {changed && orig && <div className="src">was {fmt(orig[j])}</div>}
                      </td>
                    ) : <td key={j} className={cols[j].type === 'num' ? 'num' : ''}>{fmt(x)}</td>;
                  })}
                  {editing && <td><button className="ghost tiny" onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))} aria-label={`Delete row ${i + 1}`}>✕</button></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editing && (
        <div style={{ marginTop: 10 }}>
          <div className="form-row">
            <button className="ghost" onClick={() => setRows((rs) => [...rs, { orig: null, vals: cols.map((c) => (c.type === 'text' ? '' : NaN)) }])}>+ Add row</button>
            <label>Changed by<input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Name / rank" /></label>
            <label style={{ flex: '1 1 300px' }}>Reason<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. booklet p.139 typo: POSITION 2(P) is on port side" /></label>
          </div>
          {changes.length > 0 && <details className="calc-details"><summary>{changes.length} change(s)</summary><ul className="edit-log">{changes.map((c, i) => <li key={i} className="mono small">{c}</li>)}</ul></details>}
          {blockers.length > 0 && <p className="muted small">To save: {blockers.join(' · ')}.</p>}
          <div className="form-row">
            <button disabled={blockers.length > 0} onClick={doSave}>Save changes</button>
            <button className="ghost" onClick={() => setEditing(false)}>Cancel</button>
          </div>
          <p className="muted small">Saving runs the same checks as an import, stores the table, reads it back value by value, and adds the changes to the edit history of this data set.</p>
        </div>
      )}
    </section>
  );
}

function FormDataset({ kind, v, mine, save, editing, setEditing }: { kind: 'PARTICULARS' | 'LIGHTSHIP_SUMMARY'; v: Vessel; mine?: UserVesselEntry; save: (u: UserVesselEntry) => void; editing: boolean; setEditing: (b: boolean) => void }) {
  const key = kind === 'PARTICULARS' ? 'PARTICULARS' : 'LIGHTSHIP';
  const rows: [string, string][] = kind === 'PARTICULARS'
    ? [['Ship name', v.name], ['IMO number', v.imo || '—'], ['Call sign', v.callSign || '—'], ['LBP', `${v.lbp} m`], ['Breadth', `${v.breadth} m`], ['Depth', `${v.depth} m`],
      ['Load line draft', v.maxDraft !== undefined ? `${v.maxDraft} m` : '—'], ['Density of tables', `${v.rhoRef} t/m³`], ['Bilge', v.bilgeType === 'SHARP' ? 'sharp' : 'round'],
      ['Bilge keels / bar keel', (v.hasBilgeKeels ?? v.bilgeKeelArea > 0) && v.bilgeKeelArea > 0 ? `fitted, A_k = ${v.bilgeKeelArea} m²` : 'area not given']]
    : [['Weight', `${v.lightship.weight} t`], ['LCG from AP', `${Math.round(v.lightship.lcg * 1e4) / 1e4} m`], ['TCG (+ stbd)', `${Math.round(v.lightship.tcg * 1e4) / 1e4} m`], ['VCG', `${Math.round(v.lightship.vcg * 1e4) / 1e4} m`]];
  const onSave = (u: UserVesselEntry) => {
    if (!mine) return;
    const changes = (kind === 'PARTICULARS'
      ? (['name', 'imo', 'callSign', 'lbp', 'breadth', 'depth', 'maxDraft', 'rhoRef', 'bilgeType', 'hasBilgeKeels', 'bilgeKeelArea'] as const).filter((k) => mine.vessel[k] !== u.vessel[k]).map((k) => `${k}: ${mine.vessel[k] ?? '—'} → ${u.vessel[k] ?? '—'}`)
      : (['weight', 'lcg', 'tcg', 'vcg'] as const).filter((k) => mine.vessel.lightship[k] !== u.vessel.lightship[k]).map((k) => `${k}: ${mine.vessel.lightship[k]} → ${Math.round(u.vessel.lightship[k] * 1e4) / 1e4}`));
    const typed = u.provenance[key];
    const old = mine.provenance[key];
    // keep the import record and log the edit; a dataset without record gets the form's record
    const merged = old ? { ...u, provenance: { ...u.provenance, [key]: { ...old, edits: [...(old.edits ?? []), { by: typed.verifiedBy, at: typed.verifiedAt, reason: 'edited in the form', changes: changes.length ? changes : ['no value changed (checked)'] }] } } } : u;
    save(merged);
    setEditing(false);
  };
  return (
    <section className="panel">
      <div className="panel-head"><h2>{kind === 'PARTICULARS' ? 'General particulars' : 'Lightship'}</h2>{mine && !editing && <button onClick={() => setEditing(true)}>Edit</button>}</div>
      {!editing && <table className="grid"><tbody>{rows.map(([k, x]) => <tr key={k}><td>{k}</td><td className="num">{x}</td></tr>)}</tbody></table>}
      {!editing && kind === 'LIGHTSHIP_SUMMARY' && v.lightshipItems && v.lightshipItems.length > 1 && (
        <table className="grid" style={{ marginTop: 8 }}>
          <thead><tr><th>Item</th><th className="num">t</th><th className="num">LCG</th><th className="num">TCG</th><th className="num">VCG</th></tr></thead>
          <tbody>{v.lightshipItems.map((x, i) => <tr key={i}><td>{x.description}</td><td className="num">{x.weight}</td><td className="num">{x.lcg}</td><td className="num">{x.tcg}</td><td className="num">{x.vcg}</td></tr>)}</tbody>
        </table>
      )}
      {editing && mine && (kind === 'PARTICULARS'
        ? <ParticularsForm existing={mine} onSave={onSave} onCancel={() => setEditing(false)} />
        : <LightshipForm u={mine} onSave={onSave} onCancel={() => setEditing(false)} />)}
    </section>
  );
}

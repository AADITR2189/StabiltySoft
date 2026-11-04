// Edit the vessel's tank types: rename, add, delete, reorder; category, colour, default density and
// consumable per type; move tanks between types. Saved with name, reason and a change log.
import { useMemo, useState } from 'react';
import type { Vessel } from '../engine/types';
import type { UserVesselEntry } from '../importer/dbFile';
import type { Provenance } from '../importer/apply';
import { applyTypeEdits, CATEGORIES, CATEGORY_LABEL, categoryOf, PALETTE, tankTypes, typeOf, type TypeEdit } from '../engine/tankTypes';

export function TankTypesView({ v }: { v: Vessel }) {
  const types = tankTypes(v);
  return (
    <table className="grid">
      <thead><tr><th>Type</th><th>Category</th><th className="num">Default density t/m³</th><th>Consumable</th><th className="num">Tanks</th><th className="num">Capacity m³</th></tr></thead>
      <tbody>{types.map((t) => {
        const ts = v.tanks.filter((x) => typeOf(x) === t.name);
        return <tr key={t.name}><td><span className="dot" style={{ background: t.color }} />{t.name}</td><td>{CATEGORY_LABEL[t.category]}</td><td className="num">{t.density ?? '—'}</td><td>{t.consumable ? 'yes' : 'no'}</td><td className="num">{ts.length}</td><td className="num">{ts.reduce((s, x) => s + x.capacity, 0).toFixed(1)}</td></tr>;
      })}</tbody>
    </table>
  );
}

export function TankTypesEditor({ u, save, onDone }: { u: UserVesselEntry; save: (u: UserVesselEntry) => void; onDone: () => void }) {
  const v = u.vessel;
  type Row = TypeEdit & { uid: number };
  const [types, setTypes] = useState<Row[]>(() => tankTypes(v).map((t, i) => ({ ...t, orig: t.name, applyDensity: false, uid: i })));
  // tank → type uid (stable while names are being edited)
  const [tankUid, setTankUid] = useState<Record<string, number>>(() => { const ts = tankTypes(v); return Object.fromEntries(v.tanks.map((t) => [t.name, ts.findIndex((x) => x.name === typeOf(t))])); });
  const nameOf = (uid: number) => types.find((t) => t.uid === uid)?.name ?? '';
  const tankType: Record<string, string> = Object.fromEntries(Object.entries(tankUid).map(([k, id]) => [k, nameOf(id).trim()]));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveTo, setMoveTo] = useState('');
  const [by, setBy] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  // keep tank assignments following renames
  const rename = (i: number, name: string) => setTypes(types.map((t, j) => (j === i ? { ...t, name } : t)));
  const upd = (i: number, patch: Partial<TypeEdit>) => setTypes(types.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const count = (uid: number) => Object.values(tankUid).filter((x) => x === uid).length;
  const names = types.map((t) => t.name.trim());
  const problems = [
    names.some((n) => !n) && 'every type needs a name',
    new Set(names.map((n) => n.toUpperCase())).size !== names.length && 'type names must be different',
    Object.values(tankUid).some((x) => !types.some((t) => t.uid === x)) && 'every tank needs a type from the list',
  ].filter(Boolean) as string[];

  const preview = useMemo(() => {
    if (problems.length) return null;
    try { return applyTypeEdits(v, types.map(({ uid: _u, ...t }) => ({ ...t, name: t.name.trim() })), tankType); } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types, tankUid, v]);
  const changes = preview && 'changes' in preview ? preview.changes : [];
  const perTank = preview && 'perTank' in preview ? preview.perTank : {};
  const nTankChanges = Object.keys(perTank).length;
  const blockers = [...problems, preview && 'error' in preview && preview.error, !changes.length && !nTankChanges && 'no changes yet', !by.trim() && 'your name', !reason.trim() && 'the reason'].filter(Boolean) as string[];

  function doSave() {
    if (!preview || !('vessel' in preview) || blockers.length) return;
    const at = new Date().toISOString();
    const prov: Record<string, Provenance> = { ...u.provenance };
    const all = [...changes, ...Object.entries(perTank).filter(([n]) => !changes.some((c) => c.startsWith(`${n} `))).map(([n, cs]) => `${n}: ${cs.join(', ')}`)];
    const old = prov['TANK TYPES'];
    prov['TANK TYPES'] = old
      ? { ...old, edits: [...(old.edits ?? []), { by: by.trim(), at, reason: reason.trim(), changes: all }] }
      : { dataset: 'TANK TYPES', method: 'TYPED', fileName: 'Tank type editor', fileSha256: '', location: 'Vessel Database / Imported Data', rows: types.length, values: types.length * 5, editedCells: 0, checks: { errors: 0, warnings: 0 }, storedCheck: 'entered directly', verifiedBy: by.trim(), verifiedAt: at, edits: [{ by: by.trim(), at, reason: reason.trim(), changes: all }] };
    for (const [tank, cs] of Object.entries(perTank)) {
      const k = `TANK ${tank}`;
      if (prov[k]) prov[k] = { ...prov[k], edits: [...(prov[k].edits ?? []), { by: by.trim(), at, reason: `tank types: ${reason.trim()}`, changes: cs }] };
    }
    save({ ...u, vessel: preview.vessel, provenance: prov });
    setMsg(`Saved: ${all.length} change(s).`);
    onDone();
  }

  return (
    <section className="panel">
      <div className="panel-head"><h2>Tank types of {v.name}</h2><span className="muted small">{types.length} types · {v.tanks.length} tanks</span></div>
      <p className="muted small">The type groups the tank tables (load case, vessel data, reports). Its category sets the colour family and which tanks count as consumables. A new default density is applied to the tanks of the type only if you tick "set for its tanks".</p>
      <div className="table-wrap">
        <table className="grid types-edit">
          <thead><tr><th>Colour</th><th>Type name</th><th>Category</th><th className="num">Default density t/m³</th><th>Consumable</th><th className="num">Tanks</th><th>Order</th><th /></tr></thead>
          <tbody>
            {types.map((t, i) => {
              const n = count(t.uid);
              const tanksWithOther = v.tanks.filter((x) => tankUid[x.name] === t.uid && t.density !== undefined && x.density !== t.density).length;
              return (
                <tr key={t.uid}>
                  <td><input type="color" value={t.color} onChange={(e) => upd(i, { color: e.target.value })} aria-label={`${t.name} colour`} /></td>
                  <td><input value={t.name} onChange={(e) => rename(i, e.target.value.toUpperCase())} aria-label={`Type ${i + 1} name`} />{t.orig && t.orig !== t.name && <div className="src">was {t.orig}</div>}</td>
                  <td><select value={t.category} onChange={(e) => upd(i, { category: e.target.value as TypeEdit['category'] })} aria-label={`${t.name} category`}>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></td>
                  <td className="num">
                    <input type="number" step="any" style={{ width: 80 }} value={t.density ?? ''} onChange={(e) => upd(i, { density: e.target.value === '' ? undefined : Number(e.target.value) })} aria-label={`${t.name} density`} />
                    {tanksWithOther > 0 && <label className="small" style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end' }}><input type="checkbox" checked={t.applyDensity} onChange={(e) => upd(i, { applyDensity: e.target.checked })} /> set for its {tanksWithOther} tank(s)</label>}
                  </td>
                  <td><input type="checkbox" checked={t.consumable} onChange={(e) => upd(i, { consumable: e.target.checked })} aria-label={`${t.name} consumable`} /></td>
                  <td className="num">{n}</td>
                  <td>
                    <button className="ghost tiny" disabled={i === 0} onClick={() => setTypes(types.map((x, j) => (j === i - 1 ? types[i] : j === i ? types[i - 1] : x)))} aria-label={`Move ${t.name} up`}>↑</button>
                    <button className="ghost tiny" disabled={i === types.length - 1} onClick={() => setTypes(types.map((x, j) => (j === i + 1 ? types[i] : j === i ? types[i + 1] : x)))} aria-label={`Move ${t.name} down`}>↓</button>
                  </td>
                  <td>{n === 0 ? <button className="ghost tiny" onClick={() => setTypes(types.filter((_, j) => j !== i))}>Delete</button> : <span className="muted small">move its tanks to delete</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="form-row" style={{ marginTop: 8 }}>
        <button className="ghost" onClick={() => { const name = `NEW TYPE ${types.length + 1}`; setTypes([...types, { name, category: categoryOf(name), color: PALETTE[types.length % PALETTE.length], consumable: false, orig: null, applyDensity: false, uid: Math.max(-1, ...types.map((t) => t.uid)) + 1 }]); }}>+ Add type</button>
      </div>

      <h3 className="small-h" style={{ marginTop: 14 }}>Tanks by type</h3>
      <div className="form-row">
        <label>Move the {selected.size} selected tank(s) to
          <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)}><option value="">— choose type —</option>{types.map((t) => <option key={t.uid} value={t.uid}>{t.name}</option>)}</select>
        </label>
        <button className="ghost" style={{ alignSelf: 'end' }} disabled={!moveTo || !selected.size} onClick={() => { setTankUid({ ...tankUid, ...Object.fromEntries([...selected].map((n) => [n, Number(moveTo)])) }); setSelected(new Set()); }}>Move</button>
      </div>
      <div className="types-tanks">
        {types.map((t) => {
          const ts = v.tanks.filter((x) => tankUid[x.name] === t.uid);
          return (
            <div key={t.uid} className="types-col">
              <div className="ds-group"><span className="dot" style={{ background: t.color }} />{t.name || '(no name)'} ({ts.length})</div>
              {ts.map((x) => (
                <label key={x.name} className="small types-tank">
                  <input type="checkbox" checked={selected.has(x.name)} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(x.name); else n.delete(x.name); return n; })} />
                  <span>{x.name}</span>
                  <select value={tankUid[x.name]} onChange={(e) => setTankUid({ ...tankUid, [x.name]: Number(e.target.value) })} aria-label={`${x.name} type`}>{types.map((y) => <option key={y.uid} value={y.uid}>{y.name}</option>)}</select>
                  {typeOf(x) !== tankType[x.name] && <span className="warn-text">was {typeOf(x)}</span>}
                </label>
              ))}
              {!ts.length && <span className="muted small">no tanks</span>}
            </div>
          );
        })}
      </div>

      {(changes.length > 0 || nTankChanges > 0) && (
        <details className="calc-details" open>
          <summary>{changes.length} change(s) to types{nTankChanges ? `, ${nTankChanges} tank(s) affected` : ''}</summary>
          <ul className="edit-log">{changes.map((c, i) => <li key={i} className="mono small">{c}</li>)}
            {Object.entries(perTank).slice(0, 40).map(([n, cs]) => <li key={n} className="mono small muted">{n}: {cs.join(', ')}</li>)}</ul>
        </details>
      )}
      <div className="form-row" style={{ marginTop: 8 }}>
        <label>Changed by<input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Name / rank" /></label>
        <label style={{ flex: '1 1 300px' }}>Reason<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. booklet tank groups" /></label>
      </div>
      {blockers.length > 0 && <p className="muted small">To save: {blockers.join(' · ')}.</p>}
      <div className="form-row">
        <button disabled={blockers.length > 0} onClick={doSave}>Save tank types</button>
        <button className="ghost" onClick={onDone}>Cancel</button>
      </div>
      {msg && <p className="pass-text" role="status">{msg}</p>}
    </section>
  );
}

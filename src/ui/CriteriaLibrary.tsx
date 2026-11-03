// Criteria Library: create intact stability criteria from building blocks and combine any
// criteria (built-in or own) into stability groups by clicking them.
import { useState } from 'react';
import { BUILTIN_CRITERIA, BUILTIN_GROUPS, CRITERION_KINDS } from '../engine/criteriaGroups';
import type { CriteriaLibrary, CriterionDef, GroupDef } from '../engine/types';
import { newId } from '../store';

type Kind = (typeof CRITERION_KINDS)[number]['kind'];

interface Props {
  lib: CriteriaLibrary;
  addCriterion: (c: CriterionDef) => void;
  removeCriterion: (id: string) => void;
  saveGroup: (g: GroupDef) => void;
  removeGroup: (id: string) => void;
}

export function CriteriaLibraryScreen({ lib, addCriterion, removeCriterion, saveGroup, removeGroup }: Props) {
  const all = [...BUILTIN_CRITERIA, ...lib.criteria];
  const unitOf = (c: CriterionDef) =>
    c.kind === 'SPECIAL' ? (c.id.includes('AREA') || c.id === 'OSV-1' || c.id === 'CRANE-3' ? 'm·rad' : c.id === 'CRANE-2' ? '' : '°') : CRITERION_KINDS.find((k) => k.kind === c.kind)?.unit ?? '';

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head"><h2>How this works</h2></div>
        <p className="muted small">
          1. Create your own intact stability criteria below, or use the built-in ones. 2. Build a stability group by clicking criteria.
          3. Select the group in a load case (Load Case screen). Each group is checked on its own and gets its own GZ diagram with its criteria marked.
          Your criteria are labelled “User-defined”: they are not statutory unless approved by the Administration or class.
        </p>
      </section>
      <CriterionForm onSave={addCriterion} />
      <section className="panel">
        <div className="panel-head"><h2>Intact stability criteria ({all.length})</h2></div>
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>Criterion</th><th>Reference</th><th className="num">Requirement</th><th>Source</th><th /></tr></thead>
            <tbody>
              {all.map((c) => (
                <tr key={c.id}>
                  <td className="wrap">{c.name}</td>
                  <td className="muted">{c.regulation ?? 'User-defined'}</td>
                  <td className="num">{c.kind === 'SPECIAL' && c.id === 'IS-2.3-AREA' ? 'b ≥ a' : `${c.comparator === '>=' ? '≥' : '≤'} ${c.required} ${unitOf(c)}`}</td>
                  <td>{c.builtin ? <span className="chip-static">Built-in</span> : <span className="chip-static own">User-defined</span>}</td>
                  <td>{!c.builtin && <ConfirmDelete label={`Delete ${c.name}`} onConfirm={() => removeCriterion(c.id)} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <GroupBuilder all={all} onSave={saveGroup} />
      <section className="panel">
        <div className="panel-head"><h2>Stability groups</h2></div>
        <div className="group-cards">
          {[...BUILTIN_GROUPS, ...lib.groups].map((g) => (
            <div key={g.id} className="group-card">
              <div className="panel-head">
                <div><strong>{g.name}</strong><div className="muted small">{g.regulation}</div></div>
                {g.builtin ? <span className="chip-static">Built-in</span> : <ConfirmDelete label={`Delete group ${g.name}`} onConfirm={() => removeGroup(g.id)} />}
              </div>
              <ol className="crit-list">
                {g.criterionIds.map((id) => <li key={id}>{all.find((c) => c.id === id)?.name ?? <span className="fail-text">missing criterion</span>}</li>)}
              </ol>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function CriterionForm({ onSave }: { onSave: (c: CriterionDef) => void }) {
  const [kind, setKind] = useState<Kind>('AREA');
  const [name, setName] = useState('');
  const [from, setFrom] = useState('0');
  const [to, setTo] = useState('30');
  const [angle, setAngle] = useState('30');
  const [cap, setCap] = useState(true);
  const [required, setRequired] = useState('0.055');
  const [reference, setReference] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const k = CRITERION_KINDS.find((x) => x.kind === kind)!;
  const [comparator, setComparator] = useState<'>=' | '<='>(k.comparator);

  const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const req = num(required), f = num(from), t = num(to), a = num(angle);
    if (!Number.isFinite(req)) return setMsg({ ok: false, text: 'Enter the required value as a number.' });
    if (k.fields.includes('from') && !(f >= 0 && f <= 90)) return setMsg({ ok: false, text: 'The "from" angle must be between 0° and 90°.' });
    if (k.fields.includes('to') && !(t > f && t <= 90)) return setMsg({ ok: false, text: 'The "to" angle must be larger than the "from" angle and at most 90°.' });
    if (k.fields.includes('angle') && !(a >= 0 && a <= 90)) return setMsg({ ok: false, text: 'The angle must be between 0° and 90°.' });
    const sym = comparator === '>=' ? '≥' : '≤';
    const auto =
      kind === 'AREA' ? `Area under GZ curve ${f}° to ${t}°${cap ? ' or θf' : ''} ${sym} ${req} m·rad`
      : kind === 'GZ_AT' ? `GZ at ${a}° ${sym} ${req} m`
      : kind === 'GZ_MAX_FROM' ? `GZ at an angle ≥ ${f}° ${sym} ${req} m`
      : `${k.label} ${sym} ${req} ${k.unit}`;
    onSave({
      id: `USER-${newId()}`,
      name: name.trim() || auto,
      kind, comparator, required: req,
      params: { from: k.fields.includes('from') ? f : undefined, to: k.fields.includes('to') ? t : undefined, angle: k.fields.includes('angle') ? a : undefined, capAtFlood: k.fields.includes('capAtFlood') ? cap : undefined },
      regulation: reference.trim() || 'User-defined',
    });
    setName('');
    setMsg({ ok: true, text: `Criterion “${name.trim() || auto}” added. Click it in the group builder below to use it.` });
  };

  return (
    <section className="panel">
      <div className="panel-head"><h2>Create intact stability criterion</h2></div>
      <form className="form-row" onSubmit={save}>
        <label>Type
          <select id="crit-kind" value={kind} onChange={(e) => { const nk = e.target.value as Kind; setKind(nk); setComparator(CRITERION_KINDS.find((x) => x.kind === nk)!.comparator); }}>
            {CRITERION_KINDS.map((x) => <option key={x.kind} value={x.kind}>{x.label}</option>)}
          </select>
        </label>
        {k.fields.includes('from') && <label>From angle (°)<input id="crit-from" type="number" step="any" value={from} onChange={(e) => setFrom(e.target.value)} /></label>}
        {k.fields.includes('to') && <label>To angle (°)<input id="crit-to" type="number" step="any" value={to} onChange={(e) => setTo(e.target.value)} /></label>}
        {k.fields.includes('angle') && <label>At angle (°)<input id="crit-angle" type="number" step="any" value={angle} onChange={(e) => setAngle(e.target.value)} /></label>}
        {k.fields.includes('capAtFlood') && (
          <label className="check inline"><input id="crit-cap" type="checkbox" checked={cap} onChange={(e) => setCap(e.target.checked)} /><span>Stop at flooding angle θf if smaller</span></label>
        )}
        <label>Requirement
          <span className="with-unit">
            <select id="crit-cmp" value={comparator} onChange={(e) => setComparator(e.target.value as '>=' | '<=')}>
              <option value=">=">at least (≥)</option>
              <option value="<=">at most (≤)</option>
            </select>
            <input id="crit-req" type="number" step="any" value={required} onChange={(e) => setRequired(e.target.value)} />
            <em>{k.unit}</em>
          </span>
        </label>
        <label>Name (optional)<input id="crit-name" className="wide" value={name} placeholder="Generated if empty" onChange={(e) => setName(e.target.value)} /></label>
        <label>Reference (optional)<input id="crit-ref" value={reference} placeholder="e.g. Company policy 4.2" onChange={(e) => setReference(e.target.value)} /></label>
        <div className="form-actions"><button type="submit">Add criterion</button></div>
      </form>
      {msg && <p className={msg.ok ? 'ok-text small' : 'fail-text small'} role="status">{msg.text}</p>}
    </section>
  );
}

function GroupBuilder({ all, onSave }: { all: CriterionDef[]; onSave: (g: GroupDef) => void }) {
  const [name, setName] = useState('');
  const [reference, setReference] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const save = () => {
    if (!name.trim()) return setMsg({ ok: false, text: 'Give the group a name.' });
    if (picked.length === 0) return setMsg({ ok: false, text: 'Click at least one criterion to add it to the group.' });
    onSave({
      id: `GRP-${newId()}`, name: name.trim(), regulation: reference.trim() || 'User-defined group',
      description: `${picked.length} criteria selected by the user.`, chart: 'GENERAL', criterionIds: picked,
    });
    setMsg({ ok: true, text: `Group “${name.trim()}” saved. Select it for a load case in the Load Case screen.` });
    setName(''); setPicked([]);
  };
  return (
    <section className="panel">
      <div className="panel-head"><h2>Create stability group</h2><span className="muted small">{picked.length} selected</span></div>
      <div className="form-row">
        <label>Group name<input id="grp-name" className="wide" value={name} placeholder="e.g. Company minimum stability" onChange={(e) => setName(e.target.value)} /></label>
        <label>Reference (optional)<input id="grp-ref" value={reference} onChange={(e) => setReference(e.target.value)} /></label>
      </div>
      <p className="muted small">Click criteria to add or remove them:</p>
      <div className="pick-grid">
        {all.map((c) => {
          const i = picked.indexOf(c.id);
          return (
            <button key={c.id} type="button" className={`pick ${i >= 0 ? 'on' : ''}`} aria-pressed={i >= 0} onClick={() => toggle(c.id)}>
              {i >= 0 && <span className="pick-n">{i + 1}</span>}
              <span>{c.name}</span>
              <span className="muted small">{c.regulation ?? 'User-defined'}</span>
            </button>
          );
        })}
      </div>
      <div className="form-actions"><button type="button" onClick={save}>Save group</button></div>
      {msg && <p className={msg.ok ? 'ok-text small' : 'fail-text small'} role="status">{msg.text}</p>}
    </section>
  );
}

/** Delete with an in-page confirmation step (browser confirm dialogs are not available everywhere). */
export function ConfirmDelete({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [ask, setAsk] = useState(false);
  return ask ? (
    <span className="confirm">
      <button className="danger" onClick={() => { onConfirm(); setAsk(false); }}>Delete</button>
      <button className="ghost" onClick={() => setAsk(false)}>Cancel</button>
    </span>
  ) : (
    <button className="ghost" aria-label={label} onClick={() => setAsk(true)}>Delete</button>
  );
}

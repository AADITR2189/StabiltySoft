// Criteria Library: create intact stability criteria from building blocks and combine any
// criteria (built-in or own) into stability groups by clicking them.
import { useState } from 'react';
import { BUILTIN_CRITERIA, BUILTIN_GROUPS, CRITERION_KINDS } from '../engine/criteriaGroups';
import type { CriteriaLibrary, CriterionDef, GroupDef, MomentDef, Results } from '../engine/types';
import { MomentBuilder } from './MomentBuilder';
import { newId } from '../store';

type Kind = (typeof CRITERION_KINDS)[number]['kind'];

interface Props {
  lib: CriteriaLibrary;
  addCriterion: (c: CriterionDef) => void;
  removeCriterion: (id: string) => void;
  saveGroup: (g: GroupDef) => void;
  removeGroup: (id: string) => void;
  saveMoment: (m: MomentDef) => void;
  removeMoment: (id: string) => void;
  preview: Results | null;
  lcName: string;
}

export function CriteriaLibraryScreen({ lib, addCriterion, removeCriterion, saveGroup, removeGroup, saveMoment, removeMoment, preview, lcName }: Props) {
  const moments = lib.moments ?? [];
  const [editing, setEditing] = useState<GroupDef | null>(null);
  const [editCrit, setEditCrit] = useState<CriterionDef | null>(null);
  const usedIn = (id: string) => [...BUILTIN_GROUPS, ...lib.groups].filter((g) => g.criterionIds.includes(id)).map((g) => g.name);
  const all = [...BUILTIN_CRITERIA, ...lib.criteria];
  const unitOf = (c: CriterionDef) =>
    c.kind === 'SPECIAL'
      ? (c.id.includes('AREA') || ['OSV-1', 'CRANE-3', 'GRAIN-2', 'PONT-1'].includes(c.id) ? 'm·rad' : ['CRANE-2', 'MODU-1'].includes(c.id) ? '×' : c.id === 'CRANE-5' ? 'm' : c.id === 'MODU-2' ? 'm (GZ > 0)' : '°')
      : CRITERION_KINDS.find((k) => k.kind === c.kind)?.unit ?? '';

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head"><h2>How moments, criteria and groups connect</h2></div>
        <div className="flow" aria-label="Moments connect to groups; criteria belong to groups; groups are selected per load case">
          <div className="flow-box"><strong>1 · Heeling moments</strong><span>Formula + symbols linked to the load case or entered values. Each gives a moment table (moment and heeling arm at every heel angle).</span></div>
          <div className="flow-arrow" aria-hidden="true">→</div>
          <div className="flow-box"><strong>2 · Criteria</strong><span>Area, GZ, GM, heel… Moment criteria (heel at equilibrium, residual area, residual arm) use either <em>the group’s combined moment</em> or one chosen moment.</span></div>
          <div className="flow-arrow" aria-hidden="true">→</div>
          <div className="flow-box"><strong>3 · Stability group</strong><span>Click criteria to include them. Click moments to connect them: the group’s combined moment is their <em>sum</em>, arm = Σ Mᵢ / Δ.</span></div>
          <div className="flow-arrow" aria-hidden="true">→</div>
          <div className="flow-box"><strong>4 · Load case</strong><span>Tick the group. Stability Criteria then shows the group’s GZ diagram, GZ table (GZ, each arm, total, residual) and every moment table.</span></div>
        </div>
        <p className="muted small">Your own criteria and groups are labelled “User-defined”: they are not statutory unless approved by the Administration or class.</p>
      </section>
      <MomentBuilder onSave={saveMoment} preview={preview} lcName={lcName} />
      {moments.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2>Heeling moments ({moments.length})</h2></div>
          <div className="table-wrap">
            <table className="grid">
              <thead><tr><th>Moment</th><th>Formula</th><th>Symbols</th><th /></tr></thead>
              <tbody>
                {moments.map((m) => (
                  <tr key={m.id}>
                    <td className="wrap">{m.name}<div className="muted small">{m.result === 'ARM' ? 'gives heeling arm' : 'arm = moment ÷ Δ'}</div></td>
                    <td className="mono wrap">{m.formula}</td>
                    <td className="wrap small">{m.vars.map((v) => `${v.name}: ${v.source === 'VALUE' ? `${v.value} ${v.unit ?? ''}` : v.source === 'HEEL' ? 'θ' : v.source.toLowerCase().replace('_', ' ')}`).join(' · ')}</td>
                    <td><ConfirmDelete label={`Delete ${m.name}`} onConfirm={() => removeMoment(m.id)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <CriterionForm key={`crit-${editCrit?.id ?? 'new'}`} onSave={(c) => { addCriterion(c); setEditCrit(null); }} moments={moments} editing={editCrit} onCancel={() => setEditCrit(null)} />
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
                  <td>
                    {!c.builtin && (
                      <span className="confirm">
                        <button className="ghost" onClick={() => { setEditCrit(c); document.getElementById('criterion-form')?.scrollIntoView({ behavior: 'smooth' }); }}>Edit</button>
                        <ConfirmDelete label={`Delete ${c.name}`} onConfirm={() => removeCriterion(c.id)} warning={usedIn(c.id).length ? `Used in: ${usedIn(c.id).join(', ')}. It will be removed from these groups.` : undefined} />
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <GroupBuilder key={`grp-${editing?.id ?? 'new'}`} all={all} moments={moments} onSave={(g) => { saveGroup(g); setEditing(null); }} editing={editing} onCancel={() => setEditing(null)} />
      <section className="panel">
        <div className="panel-head"><h2>Stability groups</h2></div>
        <div className="group-cards">
          {[...BUILTIN_GROUPS, ...lib.groups].map((g) => (
            <div key={g.id} className="group-card">
              <div className="panel-head">
                <div><strong>{g.name}</strong><div className="muted small">{g.regulation}</div></div>
                {g.builtin ? <span className="chip-static">Built-in</span> : (
                  <span className="confirm">
                    <button className="ghost" onClick={() => { setEditing(g); window.scrollTo({ top: 0 }); document.getElementById('group-builder')?.scrollIntoView({ behavior: 'smooth' }); }}>Edit</button>
                    <ConfirmDelete label={`Delete group ${g.name}`} onConfirm={() => removeGroup(g.id)} />
                  </span>
                )}
              </div>
              {(g.momentIds ?? []).length > 0 && (
                <p className="small"><span className="muted">Connected moments (combined = sum): </span>
                  {(g.momentIds ?? []).map((id) => moments.find((m) => m.id === id)?.name ?? 'missing moment').join(' + ')}</p>
              )}
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

function CriterionForm({ onSave, moments, editing, onCancel }: { onSave: (c: CriterionDef) => void; moments: MomentDef[]; editing: CriterionDef | null; onCancel: () => void }) {
  const ep = editing?.params ?? {};
  const [momentId, setMomentId] = useState(ep.momentId ?? 'GROUP');
  const [kind, setKind] = useState<Kind>((editing?.kind as Kind) ?? 'AREA');
  const [name, setName] = useState(editing?.name ?? '');
  const [from, setFrom] = useState(String(ep.from ?? 0));
  const [to, setTo] = useState(String(ep.to ?? 30));
  const [angle, setAngle] = useState(String(ep.angle ?? 30));
  const [cap, setCap] = useState(ep.capAtFlood ?? true);
  const [required, setRequired] = useState(String(editing?.required ?? 0.055));
  const [reference, setReference] = useState(editing?.regulation && editing.regulation !== 'User-defined' ? editing.regulation : '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const k = CRITERION_KINDS.find((x) => x.kind === kind)!;
  const [comparator, setComparator] = useState<'>=' | '<='>(editing?.comparator ?? k.comparator);

  const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const req = num(required), f = num(from), t = num(to), a = num(angle);
    if (!Number.isFinite(req)) return setMsg({ ok: false, text: 'Enter the required value as a number.' });
    if (k.fields.includes('from') && !(f >= 0 && f <= 90)) return setMsg({ ok: false, text: 'The "from" angle must be between 0° and 90°.' });
    if (k.fields.includes('to') && !k.fields.includes('moment') && !(t > f && t <= 90)) return setMsg({ ok: false, text: 'The "to" angle must be larger than the "from" angle and at most 90°.' });
    if (k.fields.includes('angle') && !(a >= 0 && a <= 90)) return setMsg({ ok: false, text: 'The angle must be between 0° and 90°.' });
    const mom = moments.find((m) => m.id === momentId);
    if (k.fields.includes('moment') && momentId !== 'GROUP' && !mom) return setMsg({ ok: false, text: 'Choose a heeling moment (create one above first).' });
    const momName = momentId === 'GROUP' ? 'group moment' : mom?.name;
    const sym = comparator === '>=' ? '≥' : '≤';
    const auto =
      kind === 'AREA' ? `Area under GZ curve ${f}° to ${t}°${cap ? ' or θf' : ''} ${sym} ${req} m·rad`
      : kind === 'GZ_AT' ? `GZ at ${a}° ${sym} ${req} m`
      : kind === 'GZ_MAX_FROM' ? `GZ at an angle ≥ ${f}° ${sym} ${req} m`
      : kind === 'HEEL_MOMENT' ? `Heel under ${momName} ${sym} ${req}°`
      : kind === 'RESID_AREA' ? `Residual area under ${momName} to ${t}°${cap ? ' or θf' : ''} ${sym} ${req} m·rad`
      : kind === 'RESID_GZMAX' ? `Residual arm under ${momName} ${sym} ${req} m`
      : kind === 'ARM_GZMAX_RATIO' ? `Heeling arm at equilibrium ÷ GZmax under ${momName} ${sym} ${req}`
      : kind === 'RESERVE_RATIO' ? `Reserve area A1/A2 under ${momName}, roll ${a}°, to ${t}°${cap ? ' or θf' : ''} ${sym} ${req}`
      : `${k.label} ${sym} ${req} ${k.unit}`;
    onSave({
      id: editing?.id ?? `USER-${newId()}`,
      name: name.trim() || auto,
      kind, comparator, required: req,
      params: { from: k.fields.includes('from') ? f : undefined, to: k.fields.includes('to') ? t : undefined, angle: k.fields.includes('angle') ? a : undefined, capAtFlood: k.fields.includes('capAtFlood') ? cap : undefined, momentId: k.fields.includes('moment') ? momentId : undefined },
      regulation: reference.trim() || 'User-defined',
    });
    setName('');
    setMsg({ ok: true, text: editing ? `Criterion “${name.trim() || auto}” updated. Groups using it are recalculated.` : `Criterion “${name.trim() || auto}” added. Click it in the group builder below to use it.` });
  };

  return (
    <section className="panel">
      <div className="panel-head" id="criterion-form"><h2>{editing ? `Edit criterion: ${editing.name}` : 'Create intact stability criterion'}</h2></div>
      <form className="form-row" onSubmit={save}>
        <label>Type
          <select id="crit-kind" value={kind} onChange={(e) => { const nk = e.target.value as Kind; setKind(nk); setComparator(CRITERION_KINDS.find((x) => x.kind === nk)!.comparator); }}>
            {CRITERION_KINDS.map((x) => <option key={x.kind} value={x.kind}>{x.label}</option>)}
          </select>
        </label>
        {k.fields.includes('moment') && (
          <label>Heeling moment
            <select id="crit-moment" value={momentId} onChange={(e) => setMomentId(e.target.value)}>
              <option value="GROUP">Combined moment of the group (connected when building the group)</option>
              {moments.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
        )}
        {k.fields.includes('from') && <label>From angle (°)<input id="crit-from" type="number" step="any" value={from} onChange={(e) => setFrom(e.target.value)} /></label>}
        {k.fields.includes('to') && <label>{k.fields.includes('moment') ? 'Up to angle (°)' : 'To angle (°)'}<input id="crit-to" type="number" step="any" value={to} onChange={(e) => setTo(e.target.value)} /></label>}
        {k.fields.includes('angle') && <label>{kind === 'RESERVE_RATIO' ? 'Roll-back angle (°)' : 'At angle (°)'}<input id="crit-angle" type="number" step="any" value={angle} onChange={(e) => setAngle(e.target.value)} /></label>}
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
        <div className="form-actions confirm">
          <button type="submit">{editing ? 'Save changes' : 'Add criterion'}</button>
          {editing && <button type="button" className="ghost" onClick={onCancel}>Cancel editing</button>}
        </div>
      </form>
      {msg && <p className={msg.ok ? 'ok-text small' : 'fail-text small'} role="status">{msg.text}</p>}
    </section>
  );
}

function GroupBuilder({ all, moments, onSave, editing, onCancel }: {
  all: CriterionDef[]; moments: MomentDef[]; onSave: (g: GroupDef) => void; editing: GroupDef | null; onCancel: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? '');
  const [reference, setReference] = useState(editing?.regulation ?? '');
  const [picked, setPicked] = useState<string[]>(editing?.criterionIds ?? []);
  const [pickedM, setPickedM] = useState<string[]>(editing?.momentIds ?? []);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const toggleM = (id: string) => setPickedM((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const usesGroupMoment = picked.some((id) => {
    const c = all.find((x) => x.id === id);
    return c && ['HEEL_MOMENT', 'RESID_AREA', 'RESID_GZMAX'].includes(c.kind) && (c.params?.momentId ?? 'GROUP') === 'GROUP';
  });
  const save = () => {
    if (!name.trim()) return setMsg({ ok: false, text: 'Give the group a name.' });
    if (picked.length === 0) return setMsg({ ok: false, text: 'Click at least one criterion to add it to the group.' });
    if (usesGroupMoment && pickedM.length === 0) return setMsg({ ok: false, text: 'A selected criterion uses the group’s combined moment: connect at least one heeling moment.' });
    onSave({
      id: editing?.id ?? `GRP-${newId()}`, name: name.trim(), regulation: reference.trim() || 'User-defined group',
      description: `${picked.length} criteria${pickedM.length ? `, ${pickedM.length} connected heeling moment(s)` : ''}.`,
      chart: 'GENERAL', criterionIds: picked, momentIds: pickedM,
    });
    setMsg({ ok: true, text: `Group “${name.trim()}” ${editing ? 'updated' : 'saved'}. Select it for a load case in the Load Case screen.` });
    if (!editing) { setName(''); setPicked([]); setPickedM([]); }
  };
  return (
    <section className="panel" id="group-builder">
      <div className="panel-head">
        <h2>{editing ? `Edit group: ${editing.name}` : 'Create stability group'}</h2>
        <span className="muted small">{picked.length} criteria · {pickedM.length} moments</span>
      </div>
      <div className="form-row">
        <label>Group name<input id="grp-name" className="wide" value={name} placeholder="e.g. Towing operation" onChange={(e) => setName(e.target.value)} /></label>
        <label>Reference (optional)<input id="grp-ref" value={reference} onChange={(e) => setReference(e.target.value)} /></label>
      </div>
      <p className="small"><strong>Criteria:</strong> click to add or remove</p>
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
      <p className="small"><strong>Heeling moments connected to this group:</strong> click to connect. The group’s combined heeling moment is the sum of the connected moments.</p>
      {moments.length === 0 ? <p className="muted small">No moments yet. Create one in “Create heeling moment” above.</p> : (
        <div className="pick-grid">
          {moments.map((m) => {
            const on = pickedM.includes(m.id);
            return (
              <button key={m.id} type="button" className={`pick moment ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggleM(m.id)}>
                {on && <span className="pick-n">+</span>}
                <span>{m.name}</span>
                <span className="muted small mono">{m.formula}</span>
              </button>
            );
          })}
        </div>
      )}
      {usesGroupMoment && pickedM.length > 0 && (
        <p className="small ok-text">Combined moment = {pickedM.map((id) => moments.find((m) => m.id === id)?.name).join(' + ')}</p>
      )}
      <div className="form-actions">
        <button type="button" onClick={save}>{editing ? 'Save changes' : 'Save group'}</button>
        {editing && <button type="button" className="ghost" onClick={onCancel}>Cancel editing</button>}
      </div>
      {msg && <p className={msg.ok ? 'ok-text small' : 'fail-text small'} role="status">{msg.text}</p>}
    </section>
  );
}

/** Delete with an in-page confirmation step (browser confirm dialogs are not available everywhere). */
export function ConfirmDelete({ label, onConfirm, warning }: { label: string; onConfirm: () => void; warning?: string }) {
  const [ask, setAsk] = useState(false);
  return ask ? (
    <span className="confirm">
      {warning && <span className="warn-text small">{warning}</span>}
      <button className="danger" onClick={() => { onConfirm(); setAsk(false); }}>Delete</button>
      <button className="ghost" onClick={() => setAsk(false)}>Cancel</button>
    </span>
  ) : (
    <button className="ghost" aria-label={label} onClick={() => setAsk(true)}>Delete</button>
  );
}

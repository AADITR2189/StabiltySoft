// Load case tools: operational limits (each with a tick), GZ table range, arrival generator,
// export / import of one load case file.
import { useMemo, useState } from 'react';
import type { LoadCase, Results, Vessel } from '../engine/types';
import { defaultLimits, LIMIT_LABELS, type OpLimits } from '../engine/opLimits';
import { defaultSpec, generateArrival, type ArrivalSpec } from '../engine/arrival';
import { tankTypes } from '../engine/tankTypes';
import { buildLoadCaseFile } from '../importer/loadCaseFile';
import { saveFile } from '../report/save';
import { newId } from '../store';
import { f } from './format';
import { fileSafe } from './chartExport';

const KEYS = Object.keys(LIMIT_LABELS) as (keyof OpLimits)[];

export function OpLimitsPanel({ vessel, lc, r, onChange }: { vessel: Vessel; lc: LoadCase; r: Results | null; onChange: (lc: LoadCase) => void }) {
  const lim: OpLimits = { ...defaultLimits(vessel), ...(lc.opLimits ?? {}) };
  const set = (k: keyof OpLimits, patch: Partial<NonNullable<OpLimits[typeof k]>>) => onChange({ ...lc, opLimits: { ...lim, [k]: { ...lim[k]!, ...patch } } });
  const res = (k: keyof OpLimits) => r?.opLimits.find((x) => x.key === k);
  const on = KEYS.filter((k) => lim[k]?.enabled).length;
  return (
    <section className="panel">
      <div className="panel-head"><h2>Operational limits</h2><span className="muted small">{on} of {KEYS.length} in use · checked separately from the stability criteria · untick a limit to stop using it</span></div>
      <div className="table-wrap">
        <table className="grid limits">
          <thead><tr><th>Use</th><th>Limit</th><th className="num">Value</th><th className="num">Actual</th><th>Status</th></tr></thead>
          <tbody>
            {KEYS.map((k) => {
              const l = lim[k]!, d = LIMIT_LABELS[k], x = res(k);
              return (
                <tr key={k} className={l.enabled ? (x && !x.passed ? 'row-fail' : '') : 'limit-off'}>
                  <td><input type="checkbox" checked={l.enabled} onChange={(e) => set(k, { enabled: e.target.checked })} aria-label={`Use ${d.label}`} /></td>
                  <td>{d.label} <span className="muted small">({d.comparator === '<=' ? '≤' : '≥'})</span>
                    {k === 'maxAirDraft' && (
                      <div className="form-row small" style={{ gap: 8, marginTop: 4 }}>
                        <label>Highest point above base (m)<input type="number" step="any" style={{ width: 90 }} value={lim.maxAirDraft!.topZ} onChange={(e) => set('maxAirDraft', { topZ: Number(e.target.value) })} /></label>
                        <label>at X from AP (m)<input type="number" step="any" style={{ width: 90 }} value={lim.maxAirDraft!.topX} onChange={(e) => set('maxAirDraft', { topX: Number(e.target.value) })} /></label>
                      </div>
                    )}
                  </td>
                  <td className="num"><span className="with-unit"><input type="number" step="any" style={{ width: 90 }} value={l.value} onChange={(e) => set(k, { value: Number(e.target.value) })} aria-label={`${d.label} value`} /><em>{d.unit}</em></span></td>
                  <td className="num">{x ? `${f(x.actual, d.unit === '°' ? 2 : 3)} ${d.unit}` : '—'}{x?.note && <div className="muted small">{x.note}</div>}</td>
                  <td>{!l.enabled ? <span className="muted">not used</span> : !x ? '—' : x.passed ? <span className="pass-text">✓ within limit</span> : <span className="fail-text">✗ exceeded</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Read-only summary of the operational limits for the results screens. */
export function OpLimitsSummary({ r }: { r: Results }) {
  const used = r.opLimits.filter((x) => x.enabled);
  return (
    <section className="panel">
      <div className="panel-head"><h2>Operational limits</h2>
        <span className={used.length ? (r.limitsOk ? 'pass-text' : 'fail-text') : 'muted'}>{!used.length ? 'none in use' : r.limitsOk ? `✓ all ${used.length} limits met` : `✗ ${used.filter((x) => !x.passed).length} of ${used.length} exceeded`}</span></div>
      <p className="muted small">Shown separately: operational limits do not change the stability criteria result. Change or untick them in the Load Case screen.</p>
      {used.length > 0 && (
        <table className="grid">
          <thead><tr><th>Limit</th><th className="num">Required</th><th className="num">Actual</th><th>Status</th></tr></thead>
          <tbody>{used.map((x) => <tr key={x.key} className={x.passed ? '' : 'row-fail'}><td>{x.label}</td><td className="num">{x.comparator === '<=' ? '≤' : '≥'} {f(x.limit, x.unit === '°' ? 2 : 3)} {x.unit}</td><td className="num">{f(x.actual, x.unit === '°' ? 2 : 3)} {x.unit}</td><td>{x.passed ? <span className="pass-text">✓ within</span> : <span className="fail-text">✗ exceeded</span>}</td></tr>)}</tbody>
        </table>
      )}
    </section>
  );
}

/** GZ table range for the whole load case (default) or for one stability group. */
export function GzRangeControl({ lc, onChange, groupId, groupName }: { lc: LoadCase; onChange: (lc: LoadCase) => void; groupId?: string; groupName?: string }) {
  const own = groupId ? lc.gzRanges?.[groupId] : lc.gzRange;
  const shown = own ?? (groupId ? lc.gzRange : undefined);
  const [from, setFrom] = useState(shown?.from ?? 0);
  const [to, setTo] = useState(shown?.to ?? 90);
  const [step, setStep] = useState(shown?.step ?? 5);
  const ok = step >= 0.1 && to > from && from >= 0;
  const apply = (rng: LoadCase['gzRange']) => {
    if (!groupId) return onChange({ ...lc, gzRange: rng });
    const next = { ...(lc.gzRanges ?? {}) };
    if (rng) next[groupId] = rng; else delete next[groupId];
    onChange({ ...lc, gzRanges: Object.keys(next).length ? next : undefined });
  };
  const desc = (x?: LoadCase['gzRange']) => (x ? `${x.from}–${x.to}° every ${x.step}°` : 'standard: KN angles + every 5°');
  return (
    <div className="form-row gz-range" style={{ alignItems: 'end' }}>
      <span className="muted small" style={{ alignSelf: 'center' }}>{groupId ? 'GZ table of this group:' : 'GZ tables, default for all groups:'}</span>
      <label>From °<input type="number" step="any" style={{ width: 70 }} value={from} onChange={(e) => setFrom(Number(e.target.value))} aria-label={`GZ range from${groupName ? ` (${groupName})` : ''}`} /></label>
      <label>To °<input type="number" step="any" style={{ width: 70 }} value={to} onChange={(e) => setTo(Number(e.target.value))} aria-label={`GZ range to${groupName ? ` (${groupName})` : ''}`} /></label>
      <label>Step °<input type="number" step="any" min={0.1} style={{ width: 70 }} value={step} onChange={(e) => setStep(Number(e.target.value))} aria-label={`GZ range step${groupName ? ` (${groupName})` : ''}`} /></label>
      <button className="ghost" disabled={!ok} onClick={() => apply({ from, to, step })}>Apply{groupId ? ' to this group' : ''}</button>
      {own && <button className="ghost" onClick={() => { const d = groupId ? lc.gzRange : undefined; setFrom(d?.from ?? 0); setTo(d?.to ?? 90); setStep(d?.step ?? 5); apply(undefined); }}>{groupId ? 'Use the load case default' : 'Reset to standard'}</button>}
      <span className="muted small" style={{ alignSelf: 'center' }}>
        {groupId ? (own ? `own range: ${desc(own)}` : `uses the default (${desc(lc.gzRange)})`) : `now ${desc(lc.gzRange)}`}.
        {' '}The chart starts at 0° and ends at “To”; criteria always use the full curve.
      </span>
    </div>
  );
}

export function ArrivalPanel({ vessel, lc, r, onCreate, onClose }: { vessel: Vessel; lc: LoadCase; r: Results | null; onCreate: (lc: LoadCase) => void; onClose: () => void }) {
  const [spec, setSpec] = useState<ArrivalSpec>(() => defaultSpec(vessel, lc));
  const [err, setErr] = useState<string | null>(null);
  const types = tankTypes(vessel);
  const preview = useMemo(() => { try { return generateArrival(vessel, lc, r, spec, () => 'preview'); } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; } }, [vessel, lc, r, spec]);
  const setType = (n: string, v: number) => setSpec({ ...spec, consumedByType: { ...spec.consumedByType, [n]: v } });
  return (
    <section className="panel">
      <div className="panel-head"><h2>Generate arrival condition from “{lc.name}”</h2><button className="ghost" onClick={onClose}>Close</button></div>
      <p className="muted small">Enter how much of each tank type is used on the voyage. Each tank of the type keeps (100 − used) % of its departure contents. Other tanks and weights are copied unchanged unless you reduce them below.</p>
      <div className="form-row">
        <label style={{ flex: '1 1 320px' }}>Name of the new load case<input value={spec.name} onChange={(e) => setSpec({ ...spec, name: e.target.value })} /></label>
        <button className="ghost" style={{ alignSelf: 'end' }} onClick={() => setSpec({ ...spec, consumedByType: Object.fromEntries(types.filter((t) => t.consumable).map((t) => [t.name, 90])) })}>10 % remaining (IMO standard arrival)</button>
        <button className="ghost" style={{ alignSelf: 'end' }} onClick={() => setSpec({ ...spec, consumedByType: {} })}>Nothing used</button>
      </div>
      <div className="cards">
        <div>
          <h3 className="small-h">Tank types: % used</h3>
          <table className="grid"><tbody>
            {types.map((t) => (
              <tr key={t.name}>
                <td><span className="dot" style={{ background: t.color }} />{t.name}{t.consumable && <span className="muted small"> · consumable</span>}</td>
                <td className="num"><span className="with-unit"><input type="number" min={0} max={100} step="any" style={{ width: 70 }} value={spec.consumedByType[t.name] ?? 0} onChange={(e) => setType(t.name, Math.min(100, Math.max(0, Number(e.target.value))))} aria-label={`${t.name} % used`} /><em>%</em></span></td>
              </tr>
            ))}
          </tbody></table>
        </div>
        {lc.weights.length > 0 && (
          <div>
            <h3 className="small-h">Weight items: % used (e.g. provisions, stores)</h3>
            <table className="grid"><tbody>
              {lc.weights.map((w) => (
                <tr key={w.id}><td>{w.description} <span className="muted small">{f(w.weight, 2)} t</span></td>
                  <td className="num"><span className="with-unit"><input type="number" min={0} max={100} step="any" style={{ width: 70 }} value={spec.consumedByWeight[w.id] ?? 0} onChange={(e) => setSpec({ ...spec, consumedByWeight: { ...spec.consumedByWeight, [w.id]: Math.min(100, Math.max(0, Number(e.target.value))) } })} aria-label={`${w.description} % used`} /><em>%</em></span></td></tr>
              ))}
            </tbody></table>
          </div>
        )}
      </div>
      {'error' in preview ? <div className="error-box">{preview.error}</div> : (
        <details className="calc-details" open={preview.changes.length <= 12}>
          <summary>{preview.changes.length} change(s) from the departure</summary>
          <ul className="edit-log">{preview.changes.map((c, i) => <li key={i} className="mono small">{c}</li>)}</ul>
        </details>
      )}
      {err && <div className="error-box">{err}</div>}
      <div className="form-row">
        <button disabled={'error' in preview || !spec.name.trim()} onClick={() => { try { onCreate(generateArrival(vessel, lc, r, spec, newId).lc); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } }}>Create arrival condition</button>
      </div>
    </section>
  );
}

export async function exportLoadCase(vessel: Vessel, lc: LoadCase): Promise<string> {
  const text = await buildLoadCaseFile(vessel, lc);
  const name = `${fileSafe(`${vessel.name}_${lc.name}`)}.loadcase.json`;
  const out = await saveFile(name, new Blob([text], { type: 'application/json' }));
  return out === 'saved' ? `${name} saved.` : out === 'declined' ? 'Save cancelled.' : 'Saving files is not available here.';
}

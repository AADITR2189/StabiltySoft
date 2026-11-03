// Create a heeling moment: write a formula, then click each symbol and link it to a load case
// value (displacement, draft, VCB, TCG …, or the heel angle θ) or enter its value.
import { useMemo, useState } from 'react';
import { MOMENT_SOURCES } from '../engine/criteriaGroups';
import { FUNCTIONS, evaluate, parseFormula } from '../engine/formula';
import type { MomentDef, MomentSource, MomentVar, Results } from '../engine/types';
import { newId } from '../store';
import { f } from './format';

export function lcValueOf(r: Results, src: MomentSource): number | null {
  switch (src) {
    case 'DISPLACEMENT': return r.displacement;
    case 'DRAFT_MS': return r.draftMS;
    case 'DRAFT_MEAN': return (r.draftAP + r.draftFP) / 2;
    case 'DRAFT_AP': return r.draftAP;
    case 'DRAFT_FP': return r.draftFP;
    case 'KG': return r.kg;
    case 'KG_FLUID': return r.kgFluid;
    case 'VCB': return r.kb;
    case 'TCG': return r.tcg;
    case 'LCG': return r.lcg;
    case 'GM': return r.gmFluid;
    case 'KM': return r.kmt;
    case 'TRIM': return r.trim;
    case 'STATIC_HEEL': return Math.abs(r.heel);
    default: return null;
  }
}

const EXAMPLES = [
  { label: 'Fire monitors + thruster', formula: '(n*R*(h - T/2) + S*(T/2 - e))*cos(theta)' },
  { label: 'Passenger crowding', formula: 'N*w*b*cos(theta)' },
  { label: 'Turning (IS Code 3.1)', formula: '0.2*V^2/L*Disp*(KG - T/2)*cos(theta)' },
  { label: 'Towline pull', formula: 'F*(z - VCB)*cos(theta)' },
];

export function MomentBuilder({ onSave, preview, lcName }: { onSave: (m: MomentDef) => void; preview: Results | null; lcName: string }) {
  const [name, setName] = useState('');
  const [formula, setFormula] = useState('');
  const [result, setResult] = useState<'MOMENT' | 'ARM'>('MOMENT');
  const [vars, setVars] = useState<Record<string, MomentVar>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const parsed = useMemo(() => {
    if (!formula.trim()) return { vars: [] as string[], error: null as string | null, f: null as ReturnType<typeof parseFormula> | null };
    try { const p = parseFormula(formula); return { vars: p.variables, error: null, f: p }; }
    catch (e) { return { vars: [], error: (e as Error).message, f: null }; }
  }, [formula]);

  // every symbol gets a link: guess from its name, else "enter a value"
  const linkOf = (n: string): MomentVar =>
    vars[n] ?? { name: n, source: MOMENT_SOURCES.find((s) => s.guess.test(n))?.source ?? 'VALUE' };
  const setVar = (n: string, patch: Partial<MomentVar>) => setVars((v) => ({ ...v, [n]: { ...linkOf(n), ...patch } }));

  const calc = useMemo(() => {
    if (!parsed.f || !preview) return null;
    try {
      const fixed: Record<string, number> = {};
      let heelVar: string | null = null;
      for (const n of parsed.vars) {
        const l = linkOf(n);
        if (l.source === 'HEEL') { heelVar = n; continue; }
        const v = l.source === 'VALUE' ? l.value : lcValueOf(preview, l.source);
        if (v === null || v === undefined || !Number.isFinite(v)) return { error: `Enter a value for “${n}”${l.source === 'VCB' ? ' (VCB is not in this vessel’s hydrostatic tables)' : ''}.` };
        fixed[n] = v;
      }
      const rows = [0, 10, 20, 30, 40, 50, 60].map((a) => {
        const m = evaluate(parsed.f!, heelVar ? { ...fixed, [heelVar]: a } : fixed);
        return { heel: a, m, arm: result === 'ARM' ? m : m / preview.displacement };
      });
      return { rows, fixed, heelVar };
    } catch (e) { return { error: (e as Error).message }; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, vars, preview, result]);

  const save = () => {
    if (!name.trim()) return setMsg({ ok: false, text: 'Give the moment a name.' });
    if (!parsed.f) return setMsg({ ok: false, text: parsed.error ?? 'Enter a formula.' });
    const list = parsed.vars.map(linkOf);
    const missing = list.find((v) => v.source === 'VALUE' && !Number.isFinite(v.value));
    if (missing) { setOpen(missing.name); return setMsg({ ok: false, text: `Enter a value for “${missing.name}” or link it to the load case.` }); }
    onSave({ id: `M-${newId()}`, name: name.trim(), formula: formula.trim(), result, vars: list });
    setMsg({ ok: true, text: `Moment “${name.trim()}” saved. Use it in a criterion: “Heel at equilibrium under a heeling moment” or “Residual area”.` });
    setName(''); setFormula(''); setVars({}); setOpen(null);
  };

  return (
    <section className="panel">
      <div className="panel-head"><h2>Create heeling moment</h2></div>
      <div className="form-row">
        <label>Moment name<input id="mom-name" className="wide" value={name} placeholder="e.g. Towline pull" onChange={(e) => setName(e.target.value)} /></label>
        <label>Formula gives
          <select id="mom-result" value={result} onChange={(e) => setResult(e.target.value as 'MOMENT' | 'ARM')}>
            <option value="MOMENT">Moment (t·m): heeling arm = moment ÷ displacement</option>
            <option value="ARM">Heeling arm (m) directly</option>
          </select>
        </label>
      </div>
      <label className="formula-field">Formula
        <input id="mom-formula" className="mono" value={formula} placeholder="e.g. (n*R*(h - T/2) + S*(T/2 - e))*cos(theta)" onChange={(e) => setFormula(e.target.value)} spellCheck={false} />
      </label>
      <p className="muted small">
        Use + − * / ^ and brackets. Functions: {Object.keys(FUNCTIONS).join(', ')}. Trigonometric functions use degrees. Examples:{' '}
        {EXAMPLES.map((x) => <button key={x.label} type="button" className="ghost tiny" onClick={() => setFormula(x.formula)}>{x.label}</button>)}
      </p>
      {parsed.error && <p className="fail-text small" role="alert">{parsed.error}</p>}

      {parsed.vars.length > 0 && (
        <>
          <p className="small"><strong>Click each symbol</strong> to link it to the load case or enter its value:</p>
          <div className="symbol-row">
            {parsed.vars.map((n) => {
              const l = linkOf(n);
              const lab = l.source === 'VALUE' ? (Number.isFinite(l.value) ? `= ${l.value} ${l.unit ?? ''}` : 'value needed') : MOMENT_SOURCES.find((s) => s.source === l.source)?.label;
              return (
                <button key={n} type="button" className={`symbol ${open === n ? 'on' : ''} ${l.source === 'VALUE' && !Number.isFinite(l.value) ? 'missing' : ''}`} onClick={() => setOpen(open === n ? null : n)}>
                  <span className="mono">{n}</span><span className="small">{lab}</span>
                </button>
              );
            })}
          </div>
          {open && (
            <div className="symbol-edit">
              <strong className="mono">{open}</strong>
              <label>Take from
                <select id="sym-source" value={linkOf(open).source} onChange={(e) => setVar(open, { source: e.target.value as MomentSource })}>
                  <option value="VALUE">Enter a value (table)</option>
                  {MOMENT_SOURCES.map((s) => <option key={s.source} value={s.source}>Load case: {s.label}</option>)}
                </select>
              </label>
              {linkOf(open).source === 'VALUE' ? (
                <>
                  <label>Value<input id="sym-value" type="number" step="any" value={Number.isFinite(linkOf(open).value) ? linkOf(open).value : ''} onChange={(e) => setVar(open, { value: e.target.value === '' ? NaN : Number(e.target.value) })} /></label>
                  <label>Unit<input id="sym-unit" value={linkOf(open).unit ?? ''} placeholder="t, m, kN…" onChange={(e) => setVar(open, { unit: e.target.value })} /></label>
                  <label>Description<input id="sym-desc" value={linkOf(open).description ?? ''} placeholder="e.g. monitor reaction force" onChange={(e) => setVar(open, { description: e.target.value })} /></label>
                </>
              ) : (
                <span className="muted small">
                  {linkOf(open).source === 'HEEL' ? 'Calculated at every heel angle of the GZ curve.' : preview ? `Current load case “${lcName}”: ${f(lcValueOf(preview, linkOf(open).source), 3)} ${MOMENT_SOURCES.find((s) => s.source === linkOf(open).source)?.unit}` : ''}
                </span>
              )}
            </div>
          )}

          <div className="calc-box">
            <div className="panel-head"><h3 className="small-h">Calculation with load case “{lcName}”</h3></div>
            <table className="grid">
              <thead><tr><th>Symbol</th><th>Source</th><th className="num">Value</th></tr></thead>
              <tbody>
                {parsed.vars.map((n) => {
                  const l = linkOf(n);
                  const v = l.source === 'HEEL' ? null : l.source === 'VALUE' ? l.value : preview ? lcValueOf(preview, l.source) : null;
                  return <tr key={n}><td className="mono">{n}</td><td>{l.source === 'VALUE' ? `Entered${l.description ? ': ' + l.description : ''}` : `Load case: ${MOMENT_SOURCES.find((s) => s.source === l.source)?.label}`}</td><td className="num">{l.source === 'HEEL' ? 'each angle' : `${f(v, 4)} ${l.unit ?? MOMENT_SOURCES.find((s) => s.source === l.source)?.unit ?? ''}`}</td></tr>;
                })}
              </tbody>
            </table>
            {calc && 'error' in calc ? <p className="fail-text small">{calc.error}</p> : calc && (
              <table className="grid">
                <thead><tr><th className="num">Heel θ °</th>{result === 'MOMENT' && <th className="num">Moment t·m</th>}<th className="num">Heeling arm m</th></tr></thead>
                <tbody>{calc.rows.map((x) => <tr key={x.heel}><td className="num">{x.heel}</td>{result === 'MOMENT' && <td className="num">{f(x.m, 3)}</td>}<td className="num">{f(x.arm, 4)}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        </>
      )}
      <div className="form-actions"><button type="button" onClick={save}>Save moment</button></div>
      {msg && <p className={msg.ok ? 'ok-text small' : 'fail-text small'} role="status">{msg.text}</p>}
    </section>
  );
}

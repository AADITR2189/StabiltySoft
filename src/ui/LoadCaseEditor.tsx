import type { GroupDef, LoadCase, Results, TankInput, Vessel, WeightItem } from '../engine/types';
import { newId } from '../store';
import { BUILTIN_GROUPS, DEFAULT_GROUP_IDS } from '../engine/criteriaGroups';
import { f } from './format';

const MODES: { value: TankInput['mode']; label: string; unit: string }[] = [
  { value: 'FILLED', label: 'Filled', unit: '' },
  { value: 'PERCENT', label: '%', unit: '%' },
  { value: 'VOLUME', label: 'Volume', unit: 'm³' },
  { value: 'WEIGHT', label: 'Weight', unit: 't' },
  { value: 'SOUNDING', label: 'Sounding', unit: 'm' },
];

interface Props {
  vessel: Vessel;
  lc: LoadCase;
  r: Results | null;
  onChange: (lc: LoadCase) => void;
  customGroups: GroupDef[];
}

export function LoadCaseEditor({ vessel, lc, r, onChange, customGroups }: Props) {
  const set = (patch: Partial<LoadCase>) => onChange({ ...lc, ...patch });

  const setTankMode = (tankId: string, mode: TankInput['mode']) => {
    // keep the physical quantity when switching mode
    const tr = r?.tanks.find((t) => t.tankId === tankId);
    const tank = vessel.tanks.find((t) => t.id === tankId)!;
    let input: TankInput;
    if (mode === 'FILLED') input = { mode };
    else if (mode === 'PERCENT') input = { mode, value: round(tr?.percent ?? 0, 2) };
    else if (mode === 'VOLUME') input = { mode, value: round(tr?.volume ?? 0, 2) };
    else if (mode === 'WEIGHT') input = { mode, value: round(tr?.weight ?? 0, 2) };
    else {
      const v = tr?.volume ?? 0;
      const cal = tank.calibration;
      let snd = 0;
      for (let i = 0; i < cal.length - 1; i++) {
        if (cal[i].volume <= v && v <= cal[i + 1].volume) {
          const s0 = cal[i].sounding ?? 0, s1 = cal[i + 1].sounding ?? 0;
          snd = s0 + ((v - cal[i].volume) / (cal[i + 1].volume - cal[i].volume || 1)) * (s1 - s0);
          break;
        }
      }
      input = { mode, value: round(snd, 3) };
    }
    set({ tanks: { ...lc.tanks, [tankId]: { ...lc.tanks[tankId], input } } });
  };

  const setTankValue = (tankId: string, value: number) => {
    const cur = lc.tanks[tankId]?.input ?? { mode: 'VOLUME', value: 0 };
    if (cur.mode === 'FILLED') return;
    set({ tanks: { ...lc.tanks, [tankId]: { ...lc.tanks[tankId], input: { mode: cur.mode, value } } } });
  };

  const setWeight = (id: string, patch: Partial<WeightItem>) =>
    set({ weights: lc.weights.map((w) => (w.id === id ? { ...w, ...patch } : w)) });

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head"><h2>Load case</h2></div>
        <div className="form-row">
          <label>Name<input value={lc.name} onChange={(e) => set({ name: e.target.value })} /></label>
          <label>Type
            <select value={lc.type} onChange={(e) => set({ type: e.target.value })}>
              {['Departure', 'Arrival', 'Ballast', 'Harbour', 'Heavy Weather', 'Special Cargo', 'Custom'].map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label>Sea water density (t/m³)
            <NumInput value={lc.seaDensity} onCommit={(v) => set({ seaDensity: v })} step={0.001} />
          </label>
          <label>Free surface method
            <select value={lc.fsmMethod} onChange={(e) => set({ fsmMethod: e.target.value as LoadCase['fsmMethod'] })}>
              <option value="ACTUAL">Actual filling</option>
              <option value="MAXIMUM">Maximum (conservative)</option>
              <option value="MANUAL_TOTAL">Total FSM entered manually</option>
            </select>
          </label>
          {lc.fsmMethod === 'MANUAL_TOTAL' && (
            <label>Total FSM (t·m)
              <NumInput value={lc.fsmTotal ?? 0} onCommit={(v) => set({ fsmTotal: v })} />
            </label>
          )}
        </div>
        <fieldset className="group-select">
          <legend>Stability groups to check</legend>
          {[...BUILTIN_GROUPS, ...customGroups].map((g) => {
            const sel = lc.criteriaGroups ?? vessel.criteriaGroups ?? DEFAULT_GROUP_IDS;
            const on = sel.includes(g.id);
            return (
              <label key={g.id} className="check">
                <input
                  type="checkbox"
                  id={`grp-${g.id}`}
                  checked={on}
                  onChange={() => set({ criteriaGroups: on ? sel.filter((x) => x !== g.id) : [...sel, g.id] })}
                />
                <span><strong>{g.name}</strong><br /><span className="muted small">{g.regulation}</span></span>
              </label>
            );
          })}
        </fieldset>
      </section>

      <OperationPanel lc={lc} vessel={vessel} set={set} />

      <section className="panel">
        <div className="panel-head"><h2>Tanks</h2><span className="muted">Choose how you enter each tank. The rest is calculated.</span></div>
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Tank</th><th>Input method</th><th className="num">Value</th><th className="num">Density</th>
                <th className="num">%</th><th className="num">Volume m³</th><th className="num">Weight t</th>
                <th className="num">LCG m</th><th className="num">VCG m</th><th className="num">FSM t·m</th>
              </tr>
            </thead>
            <tbody>
              {vessel.tanks.map((t) => {
                const st = lc.tanks[t.id]?.input ?? { mode: 'VOLUME' as const, value: 0 };
                const tr = r?.tanks.find((x) => x.tankId === t.id);
                const unit = MODES.find((m) => m.value === st.mode)!.unit;
                return (
                  <tr key={t.id}>
                    <td><span className={`dot g-${t.group}`} />{t.name}</td>
                    <td>
                      <select value={st.mode} onChange={(e) => setTankMode(t.id, e.target.value as TankInput['mode'])}>
                        {MODES.filter((m) => m.value !== 'SOUNDING' || t.calibration.every((c) => c.sounding !== undefined)).map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                    </td>
                    <td className="num">
                      {st.mode === 'FILLED' ? <span className="muted">100 %</span> : (
                        <span className="with-unit">
                          <NumInput value={st.value} onCommit={(v) => setTankValue(t.id, v)} />
                          <em>{unit}</em>
                        </span>
                      )}
                    </td>
                    <td className="num">
                      <NumInput
                        value={lc.tanks[t.id]?.density ?? t.density}
                        step={0.001}
                        onCommit={(v) => set({ tanks: { ...lc.tanks, [t.id]: { input: st, density: v } } })}
                      />
                    </td>
                    <td className={`num ${tr && tr.percent > 98 ? 'warn-text' : ''}`}>{f(tr?.percent, 1)}</td>
                    <td className="num">{f(tr?.volume, 1)}</td>
                    <td className="num">{f(tr?.weight, 1)}</td>
                    <td className="num">{f(tr?.lcg, 2)}</td>
                    <td className="num">{f(tr?.vcg, 2)}</td>
                    <td className="num">{f(tr?.fsm, 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Variable weights</h2>
          <button onClick={() => set({ weights: [...lc.weights, { id: newId(), description: 'New weight', weight: 0, lcg: 50, tcg: 0, vcg: 5 }] })}>+ Add weight</button>
        </div>
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Description</th><th className="num">Weight t</th><th className="num">LCG m</th><th className="num">TCG m</th>
                <th className="num">VCG m</th><th className="num">Wind area m²</th><th className="num">Wind height m</th><th />
              </tr>
            </thead>
            <tbody>
              {lc.weights.map((w) => (
                <tr key={w.id}>
                  <td><input className="wide" value={w.description} onChange={(e) => setWeight(w.id, { description: e.target.value })} /></td>
                  <td className="num"><NumInput value={w.weight} onCommit={(v) => setWeight(w.id, { weight: v })} /></td>
                  <td className="num"><NumInput value={w.lcg} onCommit={(v) => setWeight(w.id, { lcg: v })} /></td>
                  <td className="num"><NumInput value={w.tcg} onCommit={(v) => setWeight(w.id, { tcg: v })} /></td>
                  <td className="num"><NumInput value={w.vcg} onCommit={(v) => setWeight(w.id, { vcg: v })} /></td>
                  <td className="num"><NumInput value={w.windArea ?? 0} onCommit={(v) => setWeight(w.id, { windArea: v })} /></td>
                  <td className="num"><NumInput value={w.windCentroidZ ?? 0} onCommit={(v) => setWeight(w.id, { windCentroidZ: v })} /></td>
                  <td><button className="ghost" onClick={() => set({ weights: lc.weights.filter((x) => x.id !== w.id) })} aria-label="Remove weight">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {r && (
        <section className="panel">
          <div className="panel-head"><h2>Weight summary</h2></div>
          <table className="grid">
            <thead><tr><th>Item</th><th className="num">Weight t</th><th className="num">LCG m</th><th className="num">TCG m</th><th className="num">VCG m</th></tr></thead>
            <tbody>
              {r.summary.map((s) => (
                <tr key={s.group}><td>{s.group}</td><td className="num">{f(s.weight, 1)}</td><td className="num">{f(s.lcg, 3)}</td><td className="num">{f(s.tcg, 3)}</td><td className="num">{f(s.vcg, 3)}</td></tr>
              ))}
              <tr className="total"><td>Displacement</td><td className="num">{f(r.displacement, 1)}</td><td className="num">{f(r.lcg, 3)}</td><td className="num">{f(r.tcg, 3)}</td><td className="num">{f(r.kg, 3)}</td></tr>
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function round(x: number, dp: number) {
  const k = 10 ** dp;
  return Math.round(x * k) / k;
}

/** Numeric input that only commits valid numbers (prevents typing errors from reaching the engine). */
function NumInput({ value, onCommit, step }: { value: number; onCommit: (v: number) => void; step?: number }) {
  return (
    <input
      key={value}
      type="number"
      inputMode="decimal"
      step={step ?? 'any'}
      defaultValue={value}
      onBlur={(e) => {
        const v = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(v)) onCommit(v);
        else e.target.value = String(value);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

/** Inputs needed by the selected stability groups (passengers, speed, grain holds, MODU wind, lifting waters, wind pressure). */
function OperationPanel({ lc, vessel, set }: { lc: LoadCase; vessel: Vessel; set: (p: Partial<LoadCase>) => void }) {
  const sel = lc.criteriaGroups ?? vessel.criteriaGroups ?? DEFAULT_GROUP_IDS;
  const has = (...ids: string[]) => ids.some((id) => sel.includes(id));
  const ops = lc.ops ?? {};
  const setOps = (p: Partial<NonNullable<LoadCase['ops']>>) => set({ ops: { ...ops, ...p } });
  const pax = ops.passengers ?? { count: 0, massEach: 0.075, lever: 0 };
  const grain = ops.grain ?? { holds: [], deckEdgeLimit: true };
  const modu = ops.modu ?? { unitType: 'SURFACE' as const, windSpeed: 36, coefficient: 1.0 };
  const lift = ops.lifting ?? { exposed: false, hs: 0 };
  const show = { wx: has('IS2008_WEATHER', 'IMO_A749'), pax: has('IS2008_PAX'), grain: has('GRAIN'), modu: has('MODU'), lift: has('LIFT_293') };
  if (!Object.values(show).some(Boolean)) return null;
  return (
    <section className="panel">
      <div className="panel-head"><h2>Operation data</h2><span className="muted small">Inputs for the selected stability groups</span></div>
      <div className="ops">
        {show.wx && (
          <fieldset className="ops-box">
            <legend>Weather criterion</legend>
            <label>Wind pressure P (N/m²)<NumInput value={ops.windPressure ?? 504} onCommit={(v) => setOps({ windPressure: v })} /></label>
            <p className="muted small">504 N/m² for unrestricted service. A lower value only for restricted service with Administration approval.</p>
          </fieldset>
        )}
        {show.pax && (
          <fieldset className="ops-box">
            <legend>Passenger ship (IS Code A 3.1)</legend>
            <label>Number of passengers<NumInput value={pax.count} onCommit={(v) => setOps({ passengers: { ...pax, count: v } })} /></label>
            <label>Mass per passenger (t)<NumInput value={pax.massEach} step={0.001} onCommit={(v) => setOps({ passengers: { ...pax, massEach: v } })} /></label>
            <label>Crowd transverse lever (m)<NumInput value={pax.lever} onCommit={(v) => setOps({ passengers: { ...pax, lever: v } })} /></label>
            <label>Service speed (kn)<NumInput value={ops.serviceSpeedKnots ?? 0} onCommit={(v) => setOps({ serviceSpeedKnots: v })} /></label>
            <p className="muted small">Lever: distance from centreline to the centre of the crowd when passengers move to one side (4 persons/m² on available deck). Passenger weights must also be in the loading condition.</p>
          </fieldset>
        )}
        {show.grain && (
          <fieldset className="ops-box wide">
            <legend>Grain holds (International Grain Code)</legend>
            <table className="grid">
              <thead><tr><th>Hold</th><th className="num">VHM (m⁴)</th><th className="num">Stowage factor (m³/t)</th><th className="num">VHM ÷ SF (t·m)</th><th /></tr></thead>
              <tbody>
                {grain.holds.map((h, i) => {
                  const upd = (p: Partial<typeof h>) => setOps({ grain: { ...grain, holds: grain.holds.map((x, j) => (j === i ? { ...x, ...p } : x)) } });
                  return (
                    <tr key={i}>
                      <td><input value={h.name} onChange={(e) => upd({ name: e.target.value })} aria-label="Hold name" /></td>
                      <td className="num"><NumInput value={h.vhm} onCommit={(v) => upd({ vhm: v })} /></td>
                      <td className="num"><NumInput value={h.sf} step={0.01} onCommit={(v) => upd({ sf: v })} /></td>
                      <td className="num">{h.sf > 0 ? (h.vhm / h.sf).toFixed(1) : '—'}</td>
                      <td><button className="ghost" onClick={() => setOps({ grain: { ...grain, holds: grain.holds.filter((_, j) => j !== i) } })} aria-label="Remove hold">✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="form-row">
              <button onClick={() => setOps({ grain: { ...grain, holds: [...grain.holds, { name: `Hold ${grain.holds.length + 1}`, vhm: 0, sf: 1.3 }] } })}>+ Add hold</button>
              <label className="check inline"><input type="checkbox" checked={grain.deckEdgeLimit} onChange={(e) => setOps({ grain: { ...grain, deckEdgeLimit: e.target.checked } })} /><span>Ship built on or after 1 Jan 1994: limit heel to deck-edge immersion angle if less than 12°</span></label>
            </div>
            <p className="muted small">Enter the volumetric heeling moment of each hold from the approved grain loading booklet (filled or partly filled, as applicable).</p>
          </fieldset>
        )}
        {show.modu && (
          <fieldset className="ops-box">
            <legend>MODU (MODU Code 2009)</legend>
            <label>Unit type
              <select value={modu.unitType} onChange={(e) => setOps({ modu: { ...modu, unitType: e.target.value as 'SURFACE' | 'COLUMN' } })}>
                <option value="SURFACE">Surface / self-elevating (ratio 1.4)</option>
                <option value="COLUMN">Column-stabilised (ratio 1.3)</option>
              </select>
            </label>
            <label>Wind speed (m/s)
              <select value={String(modu.windSpeed)} onChange={(e) => setOps({ modu: { ...modu, windSpeed: Number(e.target.value) } })}>
                <option value="36">36 m/s (70 kn): normal operation</option>
                <option value="51.5">51.5 m/s (100 kn): severe storm</option>
                {![36, 51.5].includes(modu.windSpeed) && <option value={String(modu.windSpeed)}>{modu.windSpeed} m/s</option>}
              </select>
            </label>
            <label>Wind coefficient Cs·Ch (area-weighted)<NumInput value={modu.coefficient} step={0.01} onCommit={(v) => setOps({ modu: { ...modu, coefficient: v } })} /></label>
            <p className="muted small">Shape (Cs) and height (Ch) coefficients per MODU Code 2009 Ch.3, averaged over the windage areas.</p>
          </fieldset>
        )}
        {show.lift && (
          <fieldset className="ops-box">
            <legend>Lifting (IS Code B 2.9.3)</legend>
            <label className="check inline"><input type="checkbox" checked={lift.exposed} onChange={(e) => setOps({ lifting: { ...lift, exposed: e.target.checked } })} /><span>Lifting in exposed waters</span></label>
            {lift.exposed && <label>Highest significant wave height Hs (m)<NumInput value={lift.hs} onCommit={(v) => setOps({ lifting: { ...lift, hs: v } })} /></label>}
            <p className="muted small">Minimum freeboard: 0.50 m in non-exposed waters; in exposed waters 1.00 m or 0.75·Hs, whichever is greater.</p>
          </fieldset>
        )}
      </div>
    </section>
  );
}

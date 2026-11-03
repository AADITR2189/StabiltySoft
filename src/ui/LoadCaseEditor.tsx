import type { LoadCase, Results, TankInput, Vessel, WeightItem } from '../engine/types';
import { newId } from '../store';
import { CRITERIA_GROUPS, DEFAULT_GROUP_IDS } from '../engine/criteriaGroups';
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
}

export function LoadCaseEditor({ vessel, lc, r, onChange }: Props) {
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
          {CRITERIA_GROUPS.map((g) => {
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

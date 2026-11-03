import type { CriterionResult, LoadCase, Results, Vessel } from '../engine/types';
import { f, unitFmt } from './format';
import { GzChart } from './GzChart';

export function StatusBadge({ pass }: { pass: boolean }) {
  return <span className={`badge ${pass ? 'pass' : 'fail'}`}>{pass ? '✔ PASS' : '✖ FAIL'}</span>;
}

export function ResultsSidebar({ r, error }: { r: Results | null; error: string | null }) {
  if (error) return <aside className="results"><div className="error-box"><strong>Cannot calculate</strong><p>{error}</p></div></aside>;
  if (!r) return null;
  const rows: [string, string][] = [
    ['Displacement', `${f(r.displacement, 1)} t`],
    ['Deadweight', `${f(r.deadweight, 1)} t`],
    ['Draft AP', `${f(r.draftAP, 3)} m`],
    ['Draft FP', `${f(r.draftFP, 3)} m`],
    ['Draft mean', `${f((r.draftAP + r.draftFP) / 2, 3)} m`],
    ['Trim', `${f(Math.abs(r.trim), 3)} m ${r.trim >= 0 ? 'by stern' : 'by head'}`],
    ['Heel', `${f(Math.abs(r.heel), 2)}° ${r.heel > 0.005 ? 'stbd' : r.heel < -0.005 ? 'port' : ''}`],
    ['KM', `${f(r.kmt, 3)} m`],
    ['KG', `${f(r.kg, 3)} m`],
    ['FS correction', `${f(r.fsc, 3)} m`],
    ['KG fluid', `${f(r.kgFluid, 3)} m`],
  ];
  return (
    <aside className="results" aria-live="polite">
      <div className="kpi"><span>GM fluid</span><strong className={r.gmFluid >= 0.15 ? '' : 'fail-text'}>{f(r.gmFluid, 3)} m</strong></div>
      <dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <div className="overall">
        <span>IMO criteria</span>
        <StatusBadge pass={r.overallPass} />
      </div>
      {r.warnings.length > 0 && (
        <ul className="warnings">{r.warnings.map((w, i) => <li key={i}>⚠ {w.message}</li>)}</ul>
      )}
    </aside>
  );
}

export function Dashboard({ vessel, cases, active, r, onOpen, onDuplicate, onCreate, onRemove }: {
  vessel: Vessel; cases: LoadCase[]; active: LoadCase; r: Results | null;
  onOpen: (id: string) => void; onDuplicate: (id: string) => void; onCreate: () => void; onRemove: (id: string) => void;
}) {
  const passed = r?.criteria.filter((c) => c.passed).length ?? 0;
  const lowest = r ? [...r.criteria].sort((a, b) => a.marginPct - b.marginPct)[0] : null;
  return (
    <div className="stack">
      <div className="cards">
        <section className="panel">
          <div className="panel-head"><h2>Vessel</h2></div>
          <p className="big">{vessel.name}</p>
          <p className="muted">IMO {vessel.imo} · Call sign {vessel.callSign}</p>
          <p className="muted">LBP {f(vessel.lbp, 2)} m · B {f(vessel.breadth, 2)} m · D {f(vessel.depth, 2)} m</p>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Active load case</h2></div>
          <p className="big">{active.name}</p>
          {r && (
            <div className="kpis">
              <div><span>Δ</span><strong>{f(r.displacement, 0)} t</strong></div>
              <div><span>GM fluid</span><strong>{f(r.gmFluid, 3)} m</strong></div>
              <div><span>Trim</span><strong>{f(Math.abs(r.trim), 2)} m {r.trim >= 0 ? 'A' : 'F'}</strong></div>
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Compliance</h2></div>
          {r ? (
            <>
              <p><StatusBadge pass={r.overallPass} /> &nbsp;{passed} of {r.criteria.length} criteria passed</p>
              {lowest && <p className="muted">Lowest margin: {lowest.description} ({f(lowest.marginPct, 1)} %)</p>}
              {r.warnings.length > 0 && <p className="warn-text">⚠ {r.warnings.length} warning(s)</p>}
            </>
          ) : <p className="fail-text">Calculation error: see the results panel.</p>}
        </section>
      </div>
      {r && <section className="panel"><div className="panel-head"><h2>GZ curve</h2></div><GzChart r={r} showWeather={false} /></section>}
      <section className="panel">
        <div className="panel-head"><h2>Load cases</h2><button onClick={onCreate}>+ New load case</button></div>
        <table className="grid">
          <thead><tr><th>Name</th><th>Type</th><th className="num">Sea density</th><th /></tr></thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.id} className={c.id === active.id ? 'selected' : ''}>
                <td>{c.name}</td><td>{c.type}</td><td className="num">{f(c.seaDensity, 3)}</td>
                <td className="actions">
                  <button className="ghost" onClick={() => onOpen(c.id)}>Open</button>
                  <button className="ghost" onClick={() => onDuplicate(c.id)}>Duplicate</button>
                  <button className="ghost" disabled={cases.length === 1} onClick={() => { if (confirm(`Delete "${c.name}"?`)) onRemove(c.id); }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export function Stability({ r }: { r: Results }) {
  const w = r.weather;
  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head"><h2>GZ curve</h2>
          <span className="legend"><i className="l-gz" />GZ <i className="l-gm" />GM tangent <i className="l-wind" />Wind levers <i className="l-flood" />Flooding angle <i className="l-a" />Area a <i className="l-b" />Area b</span>
        </div>
        <GzChart r={r} />
        <p className="muted">
          GM fluid {f(r.gmFluid, 3)} m · GZmax {f(r.gzMax, 3)} m at {f(r.gzMaxAngle, 1)}° ·
          Angle of vanishing stability {r.avs !== null ? `${f(r.avs, 1)}°` : `> ${r.gzCurve[r.gzCurve.length - 1].heel}°`} ·
          Flooding angle {f(r.floodAngle, 1)}° {r.floodOpening ? `(${r.floodOpening}, approximate method)` : ''} ·
          Deck edge immersion {f(r.deckEdgeAngle, 1)}°
        </p>
      </section>
      <div className="cards two">
        <section className="panel">
          <div className="panel-head"><h2>GZ table</h2></div>
          <table className="grid">
            <thead><tr><th className="num">Heel °</th><th className="num">KN m</th><th className="num">KG·sin φ m</th><th className="num">TCG·cos φ m</th><th className="num">GZ m</th></tr></thead>
            <tbody>
              {r.gzTable.map((p) => (
                <tr key={p.heel}><td className="num">{p.heel}</td><td className="num">{f(p.kn, 3)}</td><td className="num">{f(p.kgSin, 3)}</td><td className="num">{f(p.tcgCos, 3)}</td><td className={`num ${p.gz < 0 ? 'fail-text' : ''}`}>{f(p.gz, 3)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
        {w && (
          <section className="panel">
            <div className="panel-head"><h2>Weather criterion details</h2></div>
            <table className="grid">
              <tbody>
                {([
                  ['Wind pressure P', `${w.P} N/m²`],
                  ['Lateral windage area A', `${f(w.A, 1)} m²`],
                  ['Centroid of A above base', `${f(w.hA, 3)} m`],
                  ['Lever Z (to half draft)', `${f(w.Z, 3)} m`],
                  ['Steady wind lever l_w1', `${f(w.lw1, 4)} m`],
                  ['Gust wind lever l_w2', `${f(w.lw2, 4)} m`],
                  ['B/d', f(w.Bd, 3)],
                  ['Block coefficient C_B', f(w.Cb, 3)],
                  ['X1 / X2 / k', `${f(w.X1, 3)} / ${f(w.X2, 3)} / ${f(w.k, 3)}`],
                  ['OG / r', `${f(w.OG, 3)} m / ${f(w.r, 4)}`],
                  ['C / Roll period T', `${f(w.C, 4)} / ${f(w.Troll, 2)} s`],
                  ['s', f(w.s, 4)],
                  ['θ0 steady wind heel', `${f(w.theta0, 2)}°`],
                  ['θ1 roll angle', `${f(w.theta1, 2)}°`],
                  ['Roll-back angle θ0 − θ1', `${f(w.thetaR, 2)}°`],
                  ['θ2 = min(θf, 50°, θc)', `${f(w.theta2, 2)}°`],
                  ['Area a', `${f(w.areaA, 4)} m·rad`],
                  ['Area b', `${f(w.areaB, 4)} m·rad`],
                  ['Ratio b / a', w.areaA > 0 ? f(w.areaB / w.areaA, 2) : '—'],
                ] as [string, string][]).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{v}</td></tr>)}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </div>
  );
}

export function Criteria({ r }: { r: Results }) {
  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head"><h2>IMO IS Code 2008: intact stability criteria</h2><StatusBadge pass={r.overallPass} /></div>
        <table className="grid">
          <thead><tr><th>Ref</th><th>Criterion</th><th className="num">Required</th><th className="num">Actual</th><th className="num">Margin</th><th className="num">Margin %</th><th>Status</th></tr></thead>
          <tbody>
            {r.criteria.map((c) => <CritRow key={c.code} c={c} />)}
          </tbody>
        </table>
      </section>
      {r.warnings.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2>Warnings</h2></div>
          <ul className="warnings">{r.warnings.map((w, i) => <li key={i}>⚠ <strong>{w.code}</strong>: {w.message}</li>)}</ul>
        </section>
      )}
    </div>
  );
}

function CritRow({ c }: { c: CriterionResult }) {
  return (
    <>
      <tr className={c.passed ? '' : 'row-fail'}>
        <td>{c.regulation.replace('IS Code 2008 ', '')}</td>
        <td>{c.description}</td>
        <td className="num">{c.comparator === '>=' ? '≥ ' : '≤ '}{unitFmt(c.required, c.unit)}</td>
        <td className="num">{unitFmt(c.actual, c.unit)}</td>
        <td className="num">{c.marginAbs >= 0 ? '+' : ''}{unitFmt(c.marginAbs, c.unit)}</td>
        <td className="num">{c.marginPct >= 0 ? '+' : ''}{f(c.marginPct, 1)} %</td>
        <td><StatusBadge pass={c.passed} /></td>
      </tr>
      {c.explanation && <tr className="explain"><td /><td colSpan={6}>{c.explanation}</td></tr>}
    </>
  );
}

export function VesselData({ vessel }: { vessel: Vessel }) {
  return (
    <div className="stack">
      <div className="notice">This is the <strong>demo vessel</strong> (a box-shaped barge with exactly calculable data). Your real vessel data will be loaded here after you provide it and we verify it together.</div>
      <div className="cards">
        <section className="panel">
          <div className="panel-head"><h2>General particulars</h2></div>
          <table className="grid"><tbody>
            {([
              ['Ship name', vessel.name], ['IMO number', vessel.imo], ['Call sign', vessel.callSign],
              ['Length BP', `${f(vessel.lbp, 2)} m`], ['Breadth', `${f(vessel.breadth, 2)} m`], ['Depth', `${f(vessel.depth, 2)} m`],
              ['Reference density', `${f(vessel.rhoRef, 3)} t/m³`], ['Max draft', vessel.maxDraft ? `${f(vessel.maxDraft, 3)} m` : '—'],
              ['Bilge type', vessel.bilgeType], ['Bilge keel area', `${f(vessel.bilgeKeelArea, 1)} m²`],
            ] as [string, string][]).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{v}</td></tr>)}
          </tbody></table>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Lightship</h2></div>
          <table className="grid"><tbody>
            <tr><td>Weight</td><td className="num">{f(vessel.lightship.weight, 1)} t</td></tr>
            <tr><td>LCG (from AP)</td><td className="num">{f(vessel.lightship.lcg, 3)} m</td></tr>
            <tr><td>TCG</td><td className="num">{f(vessel.lightship.tcg, 3)} m</td></tr>
            <tr><td>VCG</td><td className="num">{f(vessel.lightship.vcg, 3)} m</td></tr>
          </tbody></table>
          <div className="panel-head"><h2>Down-flooding openings</h2></div>
          <table className="grid">
            <thead><tr><th>Opening</th><th className="num">X</th><th className="num">Y</th><th className="num">Z</th></tr></thead>
            <tbody>{vessel.openings.map((o) => <tr key={o.name}><td>{o.name}</td><td className="num">{f(o.x, 2)}</td><td className="num">{f(o.y, 2)}</td><td className="num">{f(o.z, 2)}</td></tr>)}</tbody>
          </table>
        </section>
      </div>
      <section className="panel">
        <div className="panel-head"><h2>Hydrostatic table</h2><span className="muted">ρ = {vessel.hydro.rhoRef} t/m³ · {vessel.hydro.rows.length} rows</span></div>
        <div className="table-wrap tall">
          <table className="grid">
            <thead><tr><th className="num">Draft m</th><th className="num">Δ t</th><th className="num">LCB m</th><th className="num">LCF m</th><th className="num">KB m</th><th className="num">KM m</th><th className="num">TPC t/cm</th><th className="num">MTC t·m/cm</th><th className="num">C_B</th></tr></thead>
            <tbody>
              {vessel.hydro.rows.map((h) => (
                <tr key={h.draft}><td className="num">{f(h.draft, 2)}</td><td className="num">{f(h.displacement, 1)}</td><td className="num">{f(h.lcb, 3)}</td><td className="num">{f(h.lcf, 3)}</td><td className="num">{f(h.kb, 3)}</td><td className="num">{f(h.kmt, 3)}</td><td className="num">{f(h.tpc, 2)}</td><td className="num">{f(h.mtc, 1)}</td><td className="num">{f(h.cb, 3)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Tanks</h2></div>
        <table className="grid">
          <thead><tr><th>Tank</th><th>Group</th><th className="num">Capacity m³</th><th className="num">Density</th><th>Consumable</th><th className="num">Calibration rows</th></tr></thead>
          <tbody>{vessel.tanks.map((t) => <tr key={t.id}><td><span className={`dot g-${t.group}`} />{t.name}</td><td>{t.group.replace('_', ' ')}</td><td className="num">{f(t.capacity, 1)}</td><td className="num">{f(t.density, 3)}</td><td>{t.isConsumable ? 'Yes' : 'No'}</td><td className="num">{t.calibration.length}</td></tr>)}</tbody>
        </table>
      </section>
    </div>
  );
}

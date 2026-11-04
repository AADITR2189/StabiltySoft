import type { CriteriaGroupResult, CriterionResult, LoadCase, Results, Vessel } from '../engine/types';
import { Fragment } from 'react';
import { CATEGORY_LABEL, groupByType, tankTypes } from '../engine/tankTypes';
import { f, unitFmt } from './format';
import { GzChart } from './GzChart';
import { ConfirmDelete } from './CriteriaLibrary';

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
        <span>Stability criteria</span>
        <StatusBadge pass={r.overallPass} />
      </div>
      <ul className="group-list">
        {r.groups.map((g) => (
          <li key={g.id}><span>{g.name.replace('IS Code 2008: ', 'IS 2008 ')}</span><StatusBadge pass={g.passed} /></li>
        ))}
        {r.groups.length === 0 && <li className="fail-text">No stability group selected</li>}
      </ul>
      {r.warnings.length > 0 && (
        <ul className="warnings">{r.warnings.map((w, i) => <li key={i}>⚠ {w.message}</li>)}</ul>
      )}
    </aside>
  );
}

export function Dashboard({ vessel, status, source, cases, activeId, calc, onOpen, onDuplicate, onCreate, onRemove }: {
  vessel: Vessel; status: string; source: string; cases: LoadCase[]; activeId: string;
  calc: (lc: LoadCase) => { r: Results | null; error: string | null };
  onOpen: (id: string) => void; onDuplicate: (id: string) => void; onCreate: () => void; onRemove: (id: string) => void;
}) {
  const rows = cases.map((c) => ({ c, ...calc(c) }));
  const groupIds = Array.from(new Set(rows.flatMap((x) => x.r?.groups.map((g) => g.id) ?? [])));
  const groupName = (id: string) => rows.flatMap((x) => x.r?.groups ?? []).find((g) => g.id === id)?.name ?? id;
  const ls = vessel.lightship;
  const particulars: [string, string][] = [
    ['Ship name', vessel.name], ['IMO number', vessel.imo], ['Call sign', vessel.callSign],
    ['Length BP', `${f(vessel.lbp, 2)} m`], ['Breadth (moulded)', `${f(vessel.breadth, 2)} m`], ['Depth (moulded)', `${f(vessel.depth, 2)} m`],
    ['Load line draft', vessel.maxDraft ? `${f(vessel.maxDraft, 3)} m` : '—'], ['Water density (tables)', `${f(vessel.rhoRef, 3)} t/m³`],
    ['Lightship weight', `${f(ls.weight, 2)} t`],
    ['Lightship LCG', `${f(Math.abs(ls.lcg - vessel.lbp / 2), 3)} m ${ls.lcg - vessel.lbp / 2 < 0 ? 'aft of' : 'fwd of'} midship`],
    ['Lightship TCG', `${f(Math.abs(ls.tcg), 3)} m ${ls.tcg < 0 ? 'port' : ls.tcg > 0 ? 'starboard' : ''}`],
    ['Lightship VCG', `${f(ls.vcg, 3)} m above base`],
  ];
  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h2>General particulars</h2>
          <span className={`data-badge ${status.toLowerCase()}`}>{status === 'UNVERIFIED' ? 'Data not verified' : status === 'DEMO' ? 'Demo data' : 'Verified'}</span>
        </div>
        <dl className="particulars">
          {particulars.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
        <p className="muted small">Source: {source}</p>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Load cases summary ({cases.length})</h2><button onClick={onCreate}>+ Add load case</button></div>
        <div className="table-wrap">
          <table className="grid summary">
            <thead>
              <tr>
                <th>Load case</th><th>Type</th><th className="num">Displ. t</th><th className="num">Draft AP m</th><th className="num">Draft FP m</th>
                <th className="num">Trim m</th><th className="num">Heel °</th><th className="num">GM fluid m</th>
                {groupIds.map((id) => <th key={id} className="wrap">{groupName(id)}</th>)}
                <th>Result</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, r, error }) => (
                <tr key={c.id} className={c.id === activeId ? 'selected' : ''}>
                  <td className="wrap"><button className="link" onClick={() => onOpen(c.id)}>{c.name}</button></td>
                  <td>{c.type}</td>
                  {r ? (
                    <>
                      <td className="num">{f(r.displacement, 1)}</td>
                      <td className="num">{f(r.draftAP, 3)}</td>
                      <td className="num">{f(r.draftFP, 3)}</td>
                      <td className="num">{f(Math.abs(r.trim), 3)} {r.trim >= 0 ? 'A' : 'F'}</td>
                      <td className="num">{f(Math.abs(r.heel), 2)} {r.heel > 0.005 ? 'S' : r.heel < -0.005 ? 'P' : ''}</td>
                      <td className="num">{f(r.gmFluid, 3)}</td>
                      {groupIds.map((id) => {
                        const g = r.groups.find((x) => x.id === id);
                        return <td key={id}>{g ? <StatusBadge pass={g.passed} /> : <span className="muted">not checked</span>}</td>;
                      })}
                      <td><StatusBadge pass={r.overallPass} /></td>
                    </>
                  ) : (
                    <td colSpan={7 + groupIds.length} className="fail-text wrap">Cannot calculate: {error}</td>
                  )}
                  <td className="actions">
                    <button className="ghost" onClick={() => onOpen(c.id)}>Open</button>
                    <button className="ghost" onClick={() => onDuplicate(c.id)}>Duplicate</button>
                    {cases.length > 1 && <ConfirmDelete label={`Delete ${c.name}`} onConfirm={() => onRemove(c.id)} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function Criteria({ r, lc, onChange }: { r: Results; lc: LoadCase; onChange: (lc: LoadCase) => void }) {
  return (
    <div className="stack">
      <section className="panel summary-strip">
        <div><span className="muted">Overall result</span> <StatusBadge pass={r.overallPass} /></div>
        {r.groups.map((g) => (
          <a key={g.id} href={`#group-${g.id}`} className="chip">
            {g.name} <StatusBadge pass={g.passed} />
          </a>
        ))}
        {r.groups.length === 0 && <span className="fail-text">No stability group is selected for this load case. Select groups in the Load Case screen.</span>}
      </section>
      {r.groups.map((g) => <GroupSection key={g.id} g={g} r={r} lc={lc} onChange={onChange} />)}
      {r.warnings.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2>Warnings</h2></div>
          <ul className="warnings">{r.warnings.map((w, i) => <li key={i}>⚠ <strong>{w.code}</strong>: {w.message}</li>)}</ul>
        </section>
      )}
    </div>
  );
}

function GroupSection({ g, r, lc, onChange }: { g: CriteriaGroupResult; r: Results; lc: LoadCase; onChange: (lc: LoadCase) => void }) {
  const w = r.weather;
  return (
    <section className={`panel group ${g.passed ? 'g-pass' : 'g-fail'}`} id={`group-${g.id}`}>
      <div className="panel-head">
        <div>
          <h3>{g.name}</h3>
          <p className="muted small">{g.regulation} · {g.description}</p>
        </div>
        <div className="group-score">
          <span className="muted">{g.criteria.filter((c) => c.passed).length} of {g.criteria.length} passed</span>
          <StatusBadge pass={g.passed} />
        </div>
      </div>
      {g.error && <div className="error-box">{g.error}</div>}
      {!g.error && (
        <>
          <div className="legend">
            <i className="l-gz" />GZ{r.side < 0 ? ' (heel to port)' : ''}
            {g.chart === 'GENERAL' && <><i className="l-1" /><i className="l-2" />Areas of this group <i className="l-ref" />Criterion limits <i className="l-gm" />GM tangent</>}
            {g.chart === 'WEATHER' && <><i className="l-wind" />Wind levers l_w1 / l_w2 <i className="l-a" />Area a <i className="l-b" />Area b <i className="l-ref" />θ0, θ0−θ1, θ2</>}
            {g.chart === 'FIFI' && <><i className="l-wind" />Heeling arm (monitors + thruster) <i className="l-ref" />Equilibrium</>}
            {g.chart === 'CRANE' && <><i className="l-wind" />Wind lever during lift <i className="l-2" />Residual area to 20° <i className="l-b" />ARL (to φ2) <i className="l-ref" />φ1, φ2, deck edge</>}
            <i className="l-flood" />Flooding angle
          </div>
          <GzChart r={r} mode={g.chart === 'GENERAL' ? 'general' : g.chart === 'WEATHER' ? 'weather' : g.chart === 'FIFI' ? 'fifi' : 'crane'} criteria={g.criteria} />
        </>
      )}
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th>Ref</th><th>Criterion</th><th className="num">Required</th><th className="num">Actual</th><th className="num">Margin</th><th className="num">Margin %</th><th>Status</th></tr></thead>
          <tbody>{g.criteria.map((c) => <CritRow key={c.code} c={c} />)}</tbody>
        </table>
      </div>
      {g.chart === 'WEATHER' && <WindPressureControl lc={lc} onChange={onChange} isA562={g.id === 'IMO_A562'} />}
      <GroupTables g={g} side={r.side} />
      {g.chart === 'WEATHER' && w && (
        <details className="calc-details">
          <summary>Weather criterion calculation details</summary>
          <table className="grid">
            <tbody>
              {([
                ['Wind pressure P', `${w.P} N/m²`],
                ['Lateral windage area A', `${f(w.A, 1)} m²`],
                ['Centroid of A above base', `${f(w.hA, 3)} m`],
                ['Lever Z (to half draft)', `${f(w.Z, 3)} m`],
                ['Steady wind lever l_w1 = P·A·Z / (1000·g·Δ)', `${f(w.lw1, 4)} m`],
                ['Gust wind lever l_w2 = 1.5·l_w1', `${f(w.lw2, 4)} m`],
                ['B/d', f(w.Bd, 3)],
                ['Block coefficient C_B', f(w.Cb, 3)],
                ['X1 / X2 / k', `${f(w.X1, 3)} / ${f(w.X2, 3)} / ${f(w.k, 3)}`],
                ['Roll factor k basis (A 2.3.4)', w.kBasis],
                ['OG / r = 0.73 + 0.6·OG/d', `${f(w.OG, 3)} m / ${f(w.r, 4)}`],
                ['C / Roll period T = 2·C·B/√GM', `${f(w.C, 4)} / ${f(w.Troll, 2)} s`],
                ['s', f(w.s, 4)],
                ['θ0 steady wind heel', `${f(w.theta0, 2)}°`],
                ['θ1 = 109·k·X1·X2·√(r·s)', `${f(w.theta1, 2)}°`],
                ['Roll-back angle θ0 − θ1', `${f(w.thetaR, 2)}°`],
                ['θ2 = min(θf, 50°, θc)', `${f(w.theta2, 2)}°`],
                ['Area a', `${f(w.areaA, 4)} m·rad`],
                ['Area b', `${f(w.areaB, 4)} m·rad`],
                ['Ratio b / a', w.areaA > 0 ? f(w.areaB / w.areaA, 2) : '—'],
              ] as [string, string][]).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{v}</td></tr>)}
            </tbody>
          </table>
        </details>
      )}
      {g.chart === 'FIFI' && r.fifi && (
        <details className="calc-details">
          <summary>Fire-fighting heeling moment details</summary>
          <table className="grid"><tbody>
            <tr><td>Monitors: n · R · (h − T/2)</td><td className="num">{f(r.fifi.monitorMoment, 2)} t·m</td></tr>
            <tr><td>Thruster: S · (T/2 − e)</td><td className="num">{f(r.fifi.thrusterMoment, 2)} t·m</td></tr>
            <tr><td>Total heeling moment M</td><td className="num">{f(r.fifi.moment, 2)} t·m</td></tr>
            <tr><td>Heeling arm at 0° = M / Δ (varies with cos φ)</td><td className="num">{f(r.fifi.arm0, 4)} m</td></tr>
            <tr><td>Equilibrium heel (towards {r.fifi.side < 0 ? 'port' : 'starboard'})</td><td className="num">{f(r.fifi.equilibrium, 2)}°</td></tr>
          </tbody></table>
        </details>
      )}
      {g.chart === 'CRANE' && r.crane && (
        <details className="calc-details">
          <summary>Crane operation calculation details</summary>
          <table className="grid"><tbody>
            <tr><td>Wind heeling moment during lift</td><td className="num">{f(r.crane.moment, 2)} t·m</td></tr>
            <tr><td>Wind heeling lever</td><td className="num">{f(r.crane.lw, 4)} m</td></tr>
            <tr><td>φ1 equilibrium heel (crane load in weights + wind)</td><td className="num">{f(r.crane.phi1, 2)}°</td></tr>
            <tr><td>φ2 = min(θf, angle of vanishing stability, 2nd intercept)</td><td className="num">{f(r.crane.phi2, 2)}°</td></tr>
            <tr><td>ARL area under righting lever φ1→φ2</td><td className="num">{f(r.crane.arl, 4)} m·rad</td></tr>
            <tr><td>AHL area under wind lever φ1→φ2</td><td className="num">{f(r.crane.ahl, 4)} m·rad</td></tr>
            <tr><td>Residual area φ1 → 20° (or θf)</td><td className="num">{f(r.crane.areaTo20, 4)} m·rad</td></tr>
            <tr><td>Deck edge immersion angle</td><td className="num">{f(r.crane.deckEdgeAngle, 2)}°</td></tr>
          </tbody></table>
        </details>
      )}
    </section>
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

export function VesselData({ vessel, status, source }: { vessel: Vessel; status: string; source: string }) {
  return (
    <div className="stack">
      {status === 'DEMO' ? (
        <div className="notice">This is the <strong>demo vessel</strong> (a box-shaped barge with exactly calculable data).</div>
      ) : status === 'VERIFIED' ? (
        <div className="notice ok-notice"><strong>All data sets imported and verified.</strong> Source: {source}. See the data record above for who verified what and from which file.</div>
      ) : source.startsWith('Created') || source.startsWith('Copy') ? (
        <div className="notice warn-notice"><strong>Your vessel: not all data sets are verified yet.</strong> Source: {source}. The list above shows what is still to import and verify.</div>
      ) : (
        <div className="notice warn-notice">
          <strong>Data extracted from the booklet, not yet verified.</strong> Source: {source}. All values must be checked against the booklet pages before this vessel is used for real decisions.
          {vessel.hydro.trims && <> Hydrostatics and cross curves: {vessel.hydro.trims.length} trim tables (free-trim method).</>}
        </div>
      )}
      <div className="cards">
        <section className="panel">
          <div className="panel-head"><h2>General particulars</h2></div>
          <table className="grid"><tbody>
            {([
              ['Ship name', vessel.name], ['IMO number', vessel.imo], ['Call sign', vessel.callSign],
              ['Length BP', `${f(vessel.lbp, 2)} m`], ['Breadth', `${f(vessel.breadth, 2)} m`], ['Depth', `${f(vessel.depth, 2)} m`],
              ['Reference density', `${f(vessel.rhoRef, 3)} t/m³`], ['Max draft', vessel.maxDraft ? `${f(vessel.maxDraft, 3)} m` : '—'],
              ['Bilge type', vessel.bilgeType === 'SHARP' ? 'sharp' : 'round'],
              ['Bilge keels / bar keel', (vessel.hasBilgeKeels ?? vessel.bilgeKeelArea > 0) && vessel.bilgeKeelArea > 0 ? `fitted, A_k = ${f(vessel.bilgeKeelArea, 2)} m² (k from table)` : `area not given (k = ${vessel.bilgeType === 'SHARP' ? '0.7' : '1.0'})`],
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
          {vessel.lightshipItems && vessel.lightshipItems.length > 1 && (
            <details className="calc-details">
              <summary>Lightship breakdown ({vessel.lightshipItems.length} items)</summary>
              <table className="grid">
                <thead><tr><th>Item</th><th className="num">t</th><th className="num">LCG</th><th className="num">TCG</th><th className="num">VCG</th></tr></thead>
                <tbody>{vessel.lightshipItems.map((x, i) => <tr key={i}><td>{x.description}</td><td className="num">{f(x.weight, 2)}</td><td className="num">{f(x.lcg, 3)}</td><td className="num">{f(x.tcg, 3)}</td><td className="num">{f(x.vcg, 3)}</td></tr>)}</tbody>
              </table>
            </details>
          )}
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
        <div className="panel-head"><h2>Tanks by type</h2><span className="muted small">{vessel.tanks.length} tanks · {tankTypes(vessel).length} types</span></div>
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>Tank</th><th>Category</th><th className="num">Capacity m³</th><th className="num">Density t/m³</th><th>Consumable</th><th className="num">Calibration rows</th></tr></thead>
            <tbody>
              {groupByType(vessel, vessel.tanks, (t) => t).map((g) => (
                <Fragment key={g.type.name}>
                  <tr className="type-head" style={{ ['--type-color' as string]: g.type.color }}><td colSpan={6}><span className="dot" style={{ background: g.type.color }} /><b>{g.type.name}</b><span className="muted small"> · {g.items.length} tank{g.items.length > 1 ? 's' : ''}{g.type.density !== undefined ? ` · default ρ ${g.type.density}` : ''}</span></td></tr>
                  {g.items.map((t) => <tr key={t.id}><td className="tank-name">{t.name}</td><td>{CATEGORY_LABEL[t.group]}</td><td className="num">{f(t.capacity, 1)}</td><td className="num">{f(t.density, 3)}</td><td>{t.isConsumable ? 'Yes' : 'No'}</td><td className="num">{t.calibration.length}</td></tr>)}
                  <tr className="type-total"><td colSpan={2}>Subtotal {g.type.name}</td><td className="num">{f(g.items.reduce((s2, t) => s2 + t.capacity, 0), 1)}</td><td colSpan={3} /></tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** GZ table of one group (with heeling and residual arms) and the calculation of each moment. */
function GroupTables({ g, side }: { g: CriteriaGroupResult; side: 1 | -1 }) {
  if (g.error || !g.table.length) return null;
  const hasArms = g.moments.length > 0;
  return (
    <div className="group-tables">
      <details className="calc-details" open>
        <summary>GZ table: {g.name}{side < 0 ? ' (heel to port)' : ''}</summary>
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th className="num">Heel °</th><th className="num">KN m</th><th className="num">KG·sin φ m</th><th className="num">TCG·cos φ m</th><th className="num">GZ m</th>
                {g.moments.map((m) => <th key={m.id} className="num wrap">Heeling arm m<div className="muted small">{m.name}</div></th>)}
                {hasArms && <th className="num">Residual arm m<div className="muted small">GZ − {g.moments[0].name.split(' ').slice(0, 3).join(' ')}</div></th>}
              </tr>
            </thead>
            <tbody>
              {g.table.map((t) => (
                <tr key={t.heel}>
                  <td className="num">{t.heel}</td><td className="num">{f(t.kn, 3)}</td><td className="num">{f(t.kgSin, 3)}</td><td className="num">{f(t.tcgCos, 3)}</td>
                  <td className={`num ${t.gz < 0 ? 'fail-text' : ''}`}>{f(t.gz, 3)}</td>
                  {t.arms.map((a, i) => <td key={i} className="num">{f(a, 4)}</td>)}
                  {t.residual !== null && <td className={`num ${t.residual < 0 ? 'fail-text' : ''}`}>{f(t.residual, 3)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {g.moments.map((m) => (
        <details key={m.id} className="calc-details">
          <summary>Moment calculation: {m.name}</summary>
          <p className="mono small">{m.formula}</p>
          {m.inputs.length > 0 && (
            <table className="grid">
              <thead><tr><th>Symbol</th><th>Taken from</th><th className="num">Value</th></tr></thead>
              <tbody>{m.inputs.map((i) => <tr key={i.name}><td className="mono">{i.name}</td><td>{i.source}</td><td className="num">{i.value === null ? 'each angle θ' : `${f(i.value, 4)} ${i.unit}`}</td></tr>)}</tbody>
            </table>
          )}
          {m.note && <p className="muted small">{m.note}</p>}
          <table className="grid">
            <thead><tr><th className="num">Heel θ °</th><th className="num">Moment t·m</th><th className="num">Heeling arm m</th></tr></thead>
            <tbody>{m.rows.map((x) => <tr key={x.heel}><td className="num">{x.heel}</td><td className="num">{x.moment === null ? '—' : f(x.moment, 3)}</td><td className="num">{f(x.arm, 4)}</td></tr>)}</tbody>
          </table>
        </details>
      ))}
    </div>
  );
}

/** Change the weather-criterion wind pressure where its effect is visible. */
function WindPressureControl({ lc, onChange, isA562 }: { lc: LoadCase; onChange: (lc: LoadCase) => void; isA562: boolean }) {
  const rule = isA562 ? 504.2 : 504;
  const cur = lc.ops?.windPressure;
  const set = (v: number | undefined) => onChange({ ...lc, ops: { ...(lc.ops ?? {}), windPressure: v } });
  return (
    <div className="wind-ctl">
      <label htmlFor={`wp-${isA562 ? 'a' : 'i'}`}>Wind pressure P</label>
      <input
        id={`wp-${isA562 ? 'a' : 'i'}`} key={cur ?? 'rule'} type="number" step="any" defaultValue={cur ?? rule}
        onBlur={(e) => { const v = Number(e.target.value); if (e.target.value.trim() !== '' && Number.isFinite(v) && v > 0) set(Math.abs(v - rule) < 1e-9 ? undefined : v); else e.target.value = String(cur ?? rule); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      <span className="muted">N/m²</span>
      {cur !== undefined ? (
        <><span className="warn-text small">Changed from the rule value {rule} N/m²</span><button type="button" className="ghost tiny" onClick={() => set(undefined)}>Reset</button></>
      ) : <span className="muted small">Rule value {isA562 ? '0.0514 t/m² (504.2 N/m²)' : '504 N/m²'}, unrestricted service</span>}
    </div>
  );
}

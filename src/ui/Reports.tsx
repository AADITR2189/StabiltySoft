// Reports: one load case → PDF stability report and Excel workbook (same numbers in both).
import { useState } from 'react';
import type { LoadCase, Results, Vessel } from '../engine/types';

interface Props {
  vessel: Vessel; status: string; source: string;
  cases: LoadCase[]; activeId: string;
  calc: (lc: LoadCase) => { r: Results | null; error: string | null };
}

export function ReportsScreen({ vessel, status, source, cases, activeId, calc }: Props) {
  const [caseId, setCaseId] = useState(activeId);
  const [preparedBy, setPreparedBy] = useState('');
  const [checkedBy, setCheckedBy] = useState('');
  const [remarks, setRemarks] = useState('');
  const [includeAll, setIncludeAll] = useState(true);
  const [busy, setBusy] = useState<'' | 'pdf' | 'xlsx'>('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);

  const lc = cases.find((c) => c.id === caseId) ?? cases[0];
  const res = lc ? calc(lc) : { r: null, error: 'No load case' };

  async function make(kind: 'pdf' | 'xlsx') {
    if (!lc || !res.r) return;
    setBusy(kind); setMsg({ kind: 'info', text: kind === 'pdf' ? 'Building PDF report…' : 'Building Excel workbook…' });
    try {
      const [{ safeFileName }, { saveFile }] = await Promise.all([import('../report/reportData'), import('../report/save')]);
      const input = {
        vessel, lc, r: res.r,
        meta: { preparedBy, checkedBy, remarks, dataStatus: status, dataSource: source, createdAt: new Date() },
        allCases: includeAll ? cases.map((c) => ({ lc: c, ...calc(c) })) : undefined,
      };
      const blob = kind === 'pdf'
        ? await (await import('../report/pdf')).buildPdf(input)
        : await (await import('../report/excel')).buildXlsx(input);
      const date = new Date().toISOString().slice(0, 10);
      const name = `${safeFileName(`${vessel.name}_${lc.name}_${date}`)}.${kind}`;
      const out = await saveFile(name, blob);
      setMsg(out === 'saved' ? { kind: 'ok', text: `${name} (${Math.round(blob.size / 1024)} KB) ready.` }
        : out === 'declined' ? { kind: 'info', text: 'Save cancelled.' }
        : { kind: 'err', text: 'Saving files is not available in this view.' });
    } catch (e) {
      setMsg({ kind: 'err', text: `Report failed: ${e instanceof Error ? e.message : String(e)}` });
    } finally { setBusy(''); }
  }

  return (
    <div className="stack">
      <p className="notice">Create a stability report for one load case. The PDF and the Excel workbook carry the same numbers and the same report ID (SHA-256 of the inputs and results).</p>
      <section className="panel">
        <div className="panel-head"><h2>Report details</h2></div>
        <div className="form-row">
          <label>Load case
            <select value={lc?.id ?? ''} onChange={(e) => setCaseId(e.target.value)}>
              {cases.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>Prepared by<input value={preparedBy} onChange={(e) => setPreparedBy(e.target.value)} placeholder="Name / rank" /></label>
          <label>Checked by<input value={checkedBy} onChange={(e) => setCheckedBy(e.target.value)} placeholder="Name / rank" /></label>
          <label style={{ flexBasis: '100%' }}>Remarks<textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></label>
          <label style={{ flexDirection: 'row', alignItems: 'center' }}><input type="checkbox" checked={includeAll} onChange={(e) => setIncludeAll(e.target.checked)} /> Add summary of all {cases.length} load cases (Excel)</label>
        </div>
        {res.r ? (
          <p>Result: <span className={`badge ${res.r.overallPass ? 'pass' : 'fail'}`}>{res.r.overallPass ? 'PASS' : 'FAIL'}</span> · {res.r.groups.length} stability groups · Δ {res.r.displacement.toFixed(1)} t</p>
        ) : <div className="error-box">Cannot report this load case: {res.error}</div>}
        <div className="form-row" style={{ marginTop: 8 }}>
          <button className="primary" disabled={!res.r || !!busy} onClick={() => make('pdf')}>{busy === 'pdf' ? 'Building…' : '⬇ Download PDF report'}</button>
          <button disabled={!res.r || !!busy} onClick={() => make('xlsx')}>{busy === 'xlsx' ? 'Building…' : '⬇ Download Excel workbook'}</button>
        </div>
        {msg && <p role="status" className={msg.kind === 'err' ? 'fail-text' : 'muted'}>{msg.text}</p>}
      </section>
      <section className="panel">
        <div className="panel-head"><h2>What the report contains</h2></div>
        <ul>
          <li><b>PDF:</b> result summary, vessel particulars, loading condition and GM, weights, tanks, all criteria, one page per stability group (GZ curve, criteria, GZ table, moment calculations), warnings and calculation trace. Every page carries the report ID and the disclaimer.</li>
          <li><b>Excel:</b> Summary, Weights, Tanks, Criteria, one GZ sheet per stability group with moment tables, All load cases, Trace. Plain values with number formats, ready for your own checks.</li>
        </ul>
      </section>
    </div>
  );
}

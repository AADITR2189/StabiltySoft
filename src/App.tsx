import { useEffect, useMemo, useState } from 'react';
import { VESSELS } from './data/vessels';
import { calculate, ENGINE_VERSION } from './engine/stability';
import { EngineError } from './engine/math';
import type { LoadCase, Results } from './engine/types';
import { newId, toEntry, useLibrary, useLoadCases, useUserVessels } from './store';
import type { VesselEntry } from './data/vessels';
import type { DbData } from './importer/dbFile';
import { DataImportScreen } from './ui/DataImport';
import { VesselManager } from './ui/VesselManager';
import { CriteriaLibraryScreen } from './ui/CriteriaLibrary';
import { ReportsScreen } from './ui/Reports';
import { LoadCaseEditor } from './ui/LoadCaseEditor';
import { Criteria, Dashboard, ResultsSidebar, VesselData } from './ui/Screens';

type Screen = 'dashboard' | 'loadcase' | 'criteria' | 'library' | 'vessel' | 'reports' | 'import';
const NAV: { id: Screen; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '▣' },
  { id: 'vessel', label: 'Vessel Database', icon: '⛴' },
  { id: 'import', label: 'Data Import', icon: '⇪' },
  { id: 'loadcase', label: 'Load Case', icon: '☰' },
  { id: 'criteria', label: 'Stability Criteria', icon: '✓' },
  { id: 'library', label: 'Criteria Library', icon: '⚖' },
  { id: 'reports', label: 'Reports', icon: '⎙' },
];

export default function App() {
  const userVessels = useUserVessels();
  const entries = useMemo(() => [...VESSELS, ...userVessels.list.map(toEntry)], [userVessels.list]);
  const store = useLoadCases(entries);
  const library = useLibrary();
  const vessel = store.entry.vessel;
  const status = store.entry.status;
  const lc = store.active;
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const calc = useMemo(() => (x: LoadCase): { r: Results | null; error: string | null } => {
    const missing = [!vessel.hydro.rows.length && 'hydrostatic table', !vessel.kn.displacements.length && 'cross curves (KN)', !(vessel.lbp > 0) && 'particulars', !(vessel.lightship.weight > 0) && 'lightship'].filter(Boolean);
    if (missing.length) return { r: null, error: `Vessel data incomplete: ${missing.join(', ')} missing. Add them in Vessel Database or Data Import.` };
    try {
      return { r: calculate(vessel, x, library.lib), error: null };
    } catch (e) {
      if (e instanceof EngineError) return { r: null, error: e.message };
      return { r: null, error: String(e) };
    }
  }, [vessel, library.lib]);
  const { r, error } = useMemo(() => calc(lc), [calc, lc]);

  const makeCopy = (e: VesselEntry): string => {
    const id = `u-${newId()}`;
    userVessels.save({ id, vessel: { ...structuredClone(e.vessel), name: `${e.vessel.name} (my copy)` }, source: `Copy of ${e.vessel.name}: ${e.source}`, createdAt: new Date().toISOString(), provenance: structuredClone(e.provenance ?? {}) });
    const cs = store.all[e.id]?.length ? store.all[e.id] : e.defaultLoadCases;
    store.setCasesFor(id, cs.map((c) => ({ ...structuredClone(c), id: newId() })));
    return id;
  };
  const dbData = (): DbData => {
    const ids = new Set(entries.map((e) => e.id));
    return { vessels: userVessels.list, loadCases: Object.fromEntries(Object.entries(store.all).filter(([k]) => ids.has(k))), library: library.lib };
  };
  const applyDb = (d: DbData) => { userVessels.replaceAll(d.vessels); store.replaceAll(d.loadCases); library.replace(d.library); };

  const showSidebar = screen === 'loadcase' || screen === 'criteria';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">⚓ StabilitySoft</div>
        <div className="ctx">
          <select className="ctx-vessel" aria-label="Vessel" value={store.entry.id} onChange={(e) => store.setVessel(e.target.value)}>
            {entries.map((v) => <option key={v.id} value={v.id}>{v.vessel.name}{v.user ? ' (mine)' : ''}</option>)}
          </select>
          <span className="muted">IMO {vessel.imo}</span>
          <span className={`data-badge ${status.toLowerCase()}`}>{status === 'UNVERIFIED' ? 'Data not verified' : status === 'DEMO' ? 'Demo data' : 'Verified'}</span>
        </div>
        <label className="ctx">
          <span className="muted">Load case</span>
          <select value={lc.id} onChange={(e) => store.setActive(e.target.value)}>
            {store.cases.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <div className="spacer" />
      </header>

      <nav className="sidenav">
        {NAV.map((n) => (
          <button key={n.id} className={screen === n.id ? 'active' : ''} onClick={() => setScreen(n.id)}>
            <span className="icon">{n.icon}</span>{n.label}
          </button>
        ))}
        <div className="nav-note">Coming next:<br />Settings · Damage stability</div>
      </nav>

      <main className={`workspace ${showSidebar ? 'with-sidebar' : ''}`}>
        <div className="content">
          {screen === 'dashboard' && (
            <Dashboard vessel={vessel} status={status} source={store.entry.source} cases={store.cases} activeId={lc.id} calc={calc}
              onOpen={(id) => { store.setActive(id); setScreen('loadcase'); }}
              onDuplicate={store.duplicate} onCreate={store.create} onRemove={store.remove} />
          )}
          {screen === 'loadcase' && <LoadCaseEditor vessel={vessel} lc={lc} r={r} onChange={store.update} customGroups={library.lib.groups} />}
          {screen === 'library' && <CriteriaLibraryScreen {...library} preview={r} lcName={lc.name} />}
          {screen === 'criteria' && (r ? <Criteria r={r} lc={lc} onChange={store.update} /> : <div className="error-box">{error}</div>)}
          {screen === 'reports' && <ReportsScreen key={vessel.name} vessel={vessel} status={status} source={store.entry.source} cases={store.cases} activeId={lc.id} calc={calc} />}
          {screen === 'vessel' && <>
            <VesselManager entries={entries} current={store.entry} userVessels={userVessels.list} saveUserVessel={userVessels.save}
              removeUserVessel={(id) => { userVessels.remove(id); store.removeVesselCases(id); if (id === store.entry.id) store.setVessel(VESSELS[0].id); }}
              makeCopy={makeCopy} openVessel={store.setVessel} dbData={dbData} applyDb={applyDb} builtinIds={VESSELS.map((v) => v.id)} storageError={userVessels.saveError} />
            <VesselData vessel={vessel} status={status} source={store.entry.source} />
          </>}
          {screen === 'import' && <DataImportScreen entries={entries} current={store.entry} userVessels={userVessels.list} saveUserVessel={userVessels.save}
            lc={lc} updateLoadCase={store.update} makeCopy={makeCopy} openVessel={store.setVessel} />}
        </div>
        {showSidebar && <ResultsSidebar r={r} error={error} />}
      </main>

      <footer className="statusbar">
        <span className={online ? 'ok' : 'off'}>● {online ? 'Online' : 'Offline: all functions available'}</span>
        <span>Data: {status === 'UNVERIFIED' ? 'extracted from booklet, NOT verified' : status === 'DEMO' ? 'demo vessel' : 'verified'}</span>
        <span>Engine {ENGINE_VERSION}</span>
        <span className="disclaimer">⚠ Not an approved stability instrument. For planning and testing only.</span>
      </footer>
    </div>
  );
}

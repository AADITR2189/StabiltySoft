import { useEffect, useMemo, useState } from 'react';
import { demoVessel } from './data/demoVessel';
import { calculate, ENGINE_VERSION } from './engine/stability';
import { EngineError } from './engine/math';
import type { Results } from './engine/types';
import { useLoadCases } from './store';
import { LoadCaseEditor } from './ui/LoadCaseEditor';
import { Criteria, Dashboard, ResultsSidebar, VesselData } from './ui/Screens';

type Screen = 'dashboard' | 'loadcase' | 'criteria' | 'vessel';
const NAV: { id: Screen; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '▣' },
  { id: 'vessel', label: 'Vessel Database', icon: '⛴' },
  { id: 'loadcase', label: 'Load Case', icon: '☰' },
  { id: 'criteria', label: 'Stability Criteria', icon: '✓' },
];

export default function App() {
  const vessel = demoVessel;
  const store = useLoadCases();
  const lc = store.active;
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const sys = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    try { return (localStorage.getItem('stabilitysoft.theme') as 'dark' | 'light') ?? sys; } catch { return sys; }
  });
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('stabilitysoft.theme', theme); } catch { /* ignore */ }
  }, [theme]);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const { r, error } = useMemo((): { r: Results | null; error: string | null } => {
    try {
      return { r: calculate(vessel, lc), error: null };
    } catch (e) {
      if (e instanceof EngineError) return { r: null, error: e.message };
      return { r: null, error: String(e) };
    }
  }, [vessel, lc]);

  const showSidebar = screen !== 'vessel';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">⚓ StabilitySoft</div>
        <div className="ctx">
          <span className="ctx-vessel">{vessel.name}</span>
          <span className="muted">IMO {vessel.imo}</span>
        </div>
        <label className="ctx">
          <span className="muted">Load case</span>
          <select value={lc.id} onChange={(e) => store.setActive(e.target.value)}>
            {store.cases.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <div className="spacer" />
        <button className="ghost" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☀ Light' : '☾ Dark'}</button>
      </header>

      <nav className="sidenav">
        {NAV.map((n) => (
          <button key={n.id} className={screen === n.id ? 'active' : ''} onClick={() => setScreen(n.id)}>
            <span className="icon">{n.icon}</span>{n.label}
          </button>
        ))}
        <div className="nav-note">Coming next:<br />Import · Reports · Hydrostatics editor · Tanks editor · Settings</div>
      </nav>

      <main className={`workspace ${showSidebar ? 'with-sidebar' : ''}`}>
        <div className="content">
          {screen === 'dashboard' && (
            <Dashboard vessel={vessel} cases={store.cases} active={lc} r={r}
              onOpen={(id) => { store.setActive(id); setScreen('loadcase'); }}
              onDuplicate={store.duplicate} onCreate={store.create} onRemove={store.remove} />
          )}
          {screen === 'loadcase' && <LoadCaseEditor vessel={vessel} lc={lc} r={r} onChange={store.update} />}
          {screen === 'criteria' && (r ? <Criteria r={r} /> : <div className="error-box">{error}</div>)}
          {screen === 'vessel' && <VesselData vessel={vessel} />}
        </div>
        {showSidebar && <ResultsSidebar r={r} error={error} />}
      </main>

      <footer className="statusbar">
        <span className={online ? 'ok' : 'off'}>● {online ? 'Online' : 'Offline: all functions available'}</span>
        <span>Data: DEMO vessel</span>
        <span>Engine {ENGINE_VERSION}</span>
        <span className="disclaimer">⚠ Not an approved stability instrument. For planning and testing only.</span>
      </footer>
    </div>
  );
}

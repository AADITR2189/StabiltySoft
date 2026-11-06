// App shell pieces: storage status, backup reminder, install button and update notice.
import { useEffect, useState } from 'react';
import * as storage from '../storage';
import type { DbData } from '../importer/dbFile';
import { buildDbFile } from '../importer/dbFile';
import { saveFile } from '../report/save';

export function useStorageStatus() {
  const [st, setSt] = useState(storage.getStatus());
  useEffect(() => storage.onStatus(setSt), []);
  return st;
}

/** Save the whole database to a file and record the backup. */
export async function saveDatabaseFile(data: DbData): Promise<string> {
  const text = await buildDbFile(data);
  const name = `StabilitySoft_database_${new Date().toISOString().slice(0, 10)}.json`;
  const out = await saveFile(name, new Blob([text], { type: 'application/json' }));
  if (out === 'saved') storage.markBackedUp();
  return out === 'saved' ? `${name} (${Math.round(text.length / 1024)} KB) saved.` : out === 'declined' ? 'Save cancelled.' : 'Saving files is not available here.';
}

const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const d = (Date.now() - Date.parse(iso)) / 86400e3;
  return d < 1 / 24 ? 'just now' : d < 1 ? `${Math.round(d * 24)} h ago` : `${Math.floor(d)} day${Math.floor(d) === 1 ? '' : 's'} ago`;
};

export function StorageBadge() {
  const st = useStorageStatus();
  const b = storage.backupDue();
  const label = st.error ? '⚠ Not saved' : st.backend === 'indexeddb' ? `Saved on this device${st.persistent ? ' (kept permanently)' : ''}` : st.backend === 'localStorage' ? 'Saved in browser (basic storage)' : '⚠ Not stored';
  return (
    <span className={st.error || st.backend === 'memory' ? 'off' : 'ok'} title={`Storage: ${st.backend}; used ${storage.fmtBytes(st.usage)} of ${storage.fmtBytes(st.quota)}; last saved ${st.lastSaved ? new Date(st.lastSaved).toLocaleString() : '—'}; last database backup ${ago(b.lastBackup)}`}>
      ● {label} · backup {ago(b.lastBackup)}
    </span>
  );
}

export function BackupBanner({ dbData }: { dbData: () => DbData }) {
  const st = useStorageStatus();
  const [, force] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const b = storage.backupDue();
  if (st.error) {
    return <div className="banner banner-fail" role="alert">⚠ {st.error} <button onClick={async () => { setMsg(await saveDatabaseFile(dbData())); force((x) => x + 1); }}>⬇ Save database to file now</button>{msg && <span className="small"> {msg}</span>}</div>;
  }
  if (!b.due) return msg ? <div className="banner" role="status">✓ {msg}</div> : null;
  return (
    <div className="banner" role="alert">
      <span>💾 Your changes are only on this device. Last database backup: <b>{ago(b.lastBackup)}</b> (reminder every {b.days} days).</span>
      <button onClick={async () => { setMsg(await saveDatabaseFile(dbData())); force((x) => x + 1); }}>⬇ Save database to file</button>
      <button className="ghost" onClick={() => { storage.snoozeReminder(24); force((x) => x + 1); }}>Remind me tomorrow</button>
    </div>
  );
}

/** Storage gauge and settings for the Vessel Database screen. */
export function StoragePanel() {
  const st = useStorageStatus();
  const [, force] = useState(0);
  const b = storage.backupDue();
  const pct = st.usage !== null && st.quota ? (st.usage / st.quota) * 100 : null;
  useEffect(() => { void storage.refreshEstimate(); }, []);
  return (
    <section className="panel">
      <div className="panel-head"><h2>Storage on this device</h2></div>
      <table className="grid"><tbody>
        <tr><td>Where</td><td>{st.backend === 'indexeddb' ? 'Browser database (IndexedDB) of this app on this computer' : st.backend === 'localStorage' ? 'Browser storage (basic, about 5 MB): the browser database is not available here' : 'Not stored: this browser window does not allow saving'}</td></tr>
        <tr><td>Used (app files for offline use + your data)</td><td>{storage.fmtBytes(st.usage)} of {storage.fmtBytes(st.quota)} available{pct !== null && <> · <progress max={100} value={Math.max(0.5, pct)} style={{ width: 160, verticalAlign: 'middle' }} /> {pct < 0.1 ? '< 0.1' : pct.toFixed(1)} %</>}</td></tr>
        <tr><td>Kept permanently</td><td>{st.persistent ? <span className="pass-text">✓ yes: the browser will not delete this data to free space</span> : st.persistent === false ? <><span className="warn-text">not granted yet: the browser may clear it if the disk is very full.</span> <button className="ghost tiny" onClick={async () => { await storage.requestPersistence(); force((x) => x + 1); }}>Ask again</button><div className="muted small">Installing the app (Install button, top right) usually lets the browser grant this.</div></> : <span className="muted">the browser does not say</span>}</td></tr>
        <tr><td>Last saved</td><td>{st.lastSaved ? new Date(st.lastSaved).toLocaleString() : 'no change saved in this session yet'}</td></tr>
        <tr><td>Last database backup (file)</td><td>{b.lastBackup ? new Date(b.lastBackup).toLocaleString() : <span className="warn-text">never</span>}{b.lastChange && (!b.lastBackup || Date.parse(b.lastChange) > Date.parse(b.lastBackup)) && <span className="warn-text"> · changes since then are only on this device</span>}</td></tr>
        <tr><td>Backup reminder</td><td>
          <select value={b.days} onChange={(e) => { storage.setBackupDays(Number(e.target.value)); force((x) => x + 1); }} aria-label="Backup reminder">
            {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>every {d} day{d > 1 ? 's' : ''} (when there are changes)</option>)}
            <option value={0}>off</option>
          </select>
        </td></tr>
        {st.migrated > 0 && <tr><td>Moved</td><td className="pass-text">✓ {st.migrated} data set(s) of the older storage were moved into the browser database at this start.</td></tr>}
      </tbody></table>
      <p className="muted small">Data stays on this computer, in this browser, for this web address. Another computer or browser starts empty: use the database file to back up and to move data.</p>
    </section>
  );
}

// ---------- install and update ----------
type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export function InstallButton() {
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(() => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true));
  const [hint, setHint] = useState(false);
  useEffect(() => {
    const on = (e: Event) => { e.preventDefault(); setEvt(e as BIPEvent); };
    const done = () => { setInstalled(true); setEvt(null); void storage.requestPersistence(); };
    window.addEventListener('beforeinstallprompt', on);
    window.addEventListener('appinstalled', done);
    return () => { window.removeEventListener('beforeinstallprompt', on); window.removeEventListener('appinstalled', done); };
  }, []);
  if (installed) return <span className="muted small" title="Running as an installed app">✓ Installed app</span>;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return (
    <span className="install">
      <button className="ghost" onClick={async () => {
        if (evt) { await evt.prompt(); const c = await evt.userChoice; if (c.outcome === 'accepted') setEvt(null); }
        else setHint(!hint);
      }}>⬇ Install app</button>
      {hint && <span className="install-hint small" role="status">{ios ? 'In Safari: Share → “Add to Home Screen”.' : 'Use the install icon in the browser’s address bar, or the browser menu → “Install StabilitySoft” / “Apps → Install this site as an app”. (Not available inside previews.)'}</span>}
    </span>
  );
}

// Local database of the app: the browser's IndexedDB (hundreds of MB, kept permanently once the
// browser grants "persistent storage"). Everything is loaded into memory at start-up, so the app
// reads synchronously; every change is written to IndexedDB straight away.
// Data from older versions (localStorage) is moved over automatically on first start.
// If IndexedDB is not available (some private windows), localStorage is used as before.

const DB_NAME = 'stabilitysoft';
const STORE = 'kv';
/** Keys that hold the user's data (and older localStorage keys moved on first start). */
export const DATA_KEYS = ['stabilitysoft.uservessels.v1', 'stabilitysoft.loadcases.v3', 'stabilitysoft.library.v1', 'stabilitysoft.active.v3'];
export const META = { lastBackup: 'meta.lastBackup', lastChange: 'meta.lastChange', backupDays: 'settings.backupDays', remindAfter: 'meta.remindAfter', migrated: 'meta.migratedFromLocalStorage' };

export type Backend = 'indexeddb' | 'localStorage' | 'memory';
export interface StorageStatus {
  backend: Backend;
  persistent: boolean | null;   // null = browser does not say
  usage: number | null;         // bytes used by this app (estimate)
  quota: number | null;         // bytes available to this app (estimate)
  lastSaved: string | null;
  error: string | null;
  migrated: number;             // keys moved from localStorage at this start
}

const cache = new Map<string, unknown>();
let db: IDBDatabase | null = null;
let status: StorageStatus = { backend: 'memory', persistent: null, usage: null, quota: null, lastSaved: null, error: null, migrated: 0 };
const listeners = new Set<(s: StorageStatus) => void>();
const setStatus = (patch: Partial<StorageStatus>) => { status = { ...status, ...patch }; listeners.forEach((l) => l(status)); };

export const getStatus = () => status;
export function onStatus(l: (s: StorageStatus) => void): () => void { listeners.add(l); return () => listeners.delete(l); }

const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

function openDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = idb.open(DB_NAME, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('database blocked by another open window'));
  });
}

function lsGet(k: string): unknown {
  try { const raw = globalThis.localStorage?.getItem(k); return raw === null || raw === undefined ? undefined : JSON.parse(raw); } catch { return undefined; }
}

/** Load everything (and move old localStorage data) before the app starts. */
export async function initStorage(opts: { idb?: IDBFactory | null } = {}): Promise<StorageStatus> {
  cache.clear();
  const idb = opts.idb === undefined ? globalThis.indexedDB : opts.idb;
  try {
    if (!idb) throw new Error('IndexedDB not available');
    db = await openDb(idb);
    const tx = db.transaction(STORE, 'readonly');
    const keys = (await req(tx.objectStore(STORE).getAllKeys())) as string[];
    const values = await req(tx.objectStore(STORE).getAll());
    keys.forEach((k, i) => cache.set(k, values[i]));
    // first start with IndexedDB: move the data of older versions over
    let migrated = 0;
    if (!cache.has(META.migrated)) {
      const wtx = db.transaction(STORE, 'readwrite');
      for (const k of DATA_KEYS) {
        const v = lsGet(k);
        if (v !== undefined && !cache.has(k)) { cache.set(k, v); wtx.objectStore(STORE).put(v, k); migrated++; }
      }
      cache.set(META.migrated, new Date().toISOString());
      wtx.objectStore(STORE).put(cache.get(META.migrated), META.migrated);
      await new Promise<void>((res, rej) => { wtx.oncomplete = () => res(); wtx.onerror = () => rej(wtx.error); });
      // the old copy stays in localStorage as a fallback; it is no longer written
    }
    setStatus({ backend: 'indexeddb', migrated, error: null });
  } catch (e) {
    db = null;
    // fallback: localStorage (as in older versions)
    for (const k of [...DATA_KEYS, ...Object.values(META)]) { const v = lsGet(k); if (v !== undefined) cache.set(k, v); }
    setStatus({ backend: globalThis.localStorage ? 'localStorage' : 'memory', error: globalThis.localStorage ? null : `Data cannot be stored in this browser window (${e instanceof Error ? e.message : e}). Save the database to a file before closing.` });
  }
  void refreshEstimate();
  return status;
}

/** Ask the browser to keep the data even when disk space runs low (no prompt in most browsers). */
export async function requestPersistence(): Promise<boolean | null> {
  const sm = globalThis.navigator?.storage;
  if (!sm?.persist) { setStatus({ persistent: null }); return null; }
  try {
    const already = sm.persisted ? await sm.persisted() : false;
    const ok = already || (await sm.persist());
    setStatus({ persistent: ok });
    return ok;
  } catch { setStatus({ persistent: null }); return null; }
}

export async function refreshEstimate(): Promise<void> {
  const sm = globalThis.navigator?.storage;
  if (!sm?.estimate) return;
  try { const e = await sm.estimate(); setStatus({ usage: e.usage ?? null, quota: e.quota ?? null }); } catch { /* not available */ }
}

export function get<T>(key: string): T | undefined { return cache.get(key) as T | undefined; }

const pending = new Map<string, unknown>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Save a value: in memory at once, to the database within a moment (several quick changes are written together). */
export function set(key: string, value: unknown, opts: { userData?: boolean } = { userData: true }): void {
  const had = cache.has(key);
  if (had && DATA_KEYS.includes(key)) {
    // unchanged data (e.g. written again at start-up) is not a change
    try { if (JSON.stringify(cache.get(key)) === JSON.stringify(value)) return; } catch { /* compare failed: save */ }
  }
  cache.set(key, value);
  pending.set(key, value);
  if (had && opts.userData !== false && DATA_KEYS.includes(key) && key !== 'stabilitysoft.active.v3') {
    const now = new Date().toISOString();
    cache.set(META.lastChange, now);
    pending.set(META.lastChange, now);
  }
  if (!flushTimer) flushTimer = setTimeout(() => { void flush(); }, 150);
}

export async function flush(): Promise<void> {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (!pending.size) return;
  const items = [...pending.entries()];
  pending.clear();
  try {
    if (db) {
      const tx = db.transaction(STORE, 'readwrite');
      for (const [k, v] of items) tx.objectStore(STORE).put(v, k);
      await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error ?? new Error('write aborted')); });
    } else if (globalThis.localStorage) {
      for (const [k, v] of items) globalThis.localStorage.setItem(k, JSON.stringify(v));
    } else return;
    setStatus({ lastSaved: new Date().toISOString(), error: null });
    void refreshEstimate();
  } catch (e) {
    for (const [k, v] of items) if (!pending.has(k)) pending.set(k, v); // retry with the next change
    const quota = e instanceof DOMException && /quota/i.test(e.name + e.message);
    setStatus({ error: quota ? 'The browser storage is full: the latest changes are NOT saved. Save the database to a file now, then free space or delete unused vessels.' : `Saving failed: ${e instanceof Error ? e.message : String(e)}. Save the database to a file now.` });
  }
}

/** Write pending changes when the window is hidden or closed. */
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { void flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flush(); });
}

// ---------- backup reminder ----------
export const DEFAULT_BACKUP_DAYS = 7;
export function markBackedUp(): void { set(META.lastBackup, new Date().toISOString(), { userData: false }); set(META.remindAfter, null, { userData: false }); void flush(); }
export function snoozeReminder(hours = 24): void { set(META.remindAfter, new Date(Date.now() + hours * 3600e3).toISOString(), { userData: false }); }
export function setBackupDays(days: number): void { set(META.backupDays, days, { userData: false }); }

/** Is a backup reminder due? Only when there are changes not yet in a database file. */
export function backupDue(now = Date.now()): { due: boolean; lastBackup: string | null; lastChange: string | null; days: number } {
  const lastBackup = get<string>(META.lastBackup) ?? null;
  const lastChange = get<string>(META.lastChange) ?? null;
  const days = get<number>(META.backupDays) ?? DEFAULT_BACKUP_DAYS;
  const snooze = get<string>(META.remindAfter);
  if (!lastChange || days <= 0) return { due: false, lastBackup, lastChange, days };
  if (snooze && Date.parse(snooze) > now) return { due: false, lastBackup, lastChange, days };
  const unsaved = !lastBackup || Date.parse(lastChange) > Date.parse(lastBackup);
  const old = !lastBackup || now - Date.parse(lastBackup) > days * 86400e3;
  // never backed up: remind once there are changes older than a day
  const firstTime = !lastBackup && now - Date.parse(lastChange) > 86400e3;
  return { due: unsaved && (lastBackup ? old : firstTime), lastBackup, lastChange, days };
}

export const fmtBytes = (b: number | null) => (b === null ? '—' : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : b < 1024 ** 3 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${(b / 1024 ** 3).toFixed(1)} GB`);

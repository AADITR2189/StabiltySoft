import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import * as storage from '../src/storage';

// minimal localStorage for node
class MemLS { m = new Map<string, string>(); getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }

describe('local database (IndexedDB)', () => {
  let idb: IDBFactory;
  beforeEach(() => { idb = new IDBFactory(); (globalThis as unknown as { localStorage: MemLS }).localStorage = new MemLS(); });

  it('moves the data of older versions from localStorage on first start, once', async () => {
    const vessels = [{ id: 'u-1', vessel: { name: 'OLD VESSEL' }, source: 'x', createdAt: '', provenance: {} }];
    globalThis.localStorage.setItem('stabilitysoft.uservessels.v1', JSON.stringify(vessels));
    globalThis.localStorage.setItem('stabilitysoft.library.v1', JSON.stringify({ criteria: [], groups: [] }));
    const st = await storage.initStorage({ idb });
    expect(st.backend).toBe('indexeddb');
    expect(st.migrated).toBe(2);
    expect(storage.get<typeof vessels>('stabilitysoft.uservessels.v1')![0].vessel.name).toBe('OLD VESSEL');
    // restart: read from IndexedDB, nothing moved again (even if localStorage changes)
    globalThis.localStorage.setItem('stabilitysoft.uservessels.v1', JSON.stringify([]));
    const st2 = await storage.initStorage({ idb });
    expect(st2.migrated).toBe(0);
    expect(storage.get<typeof vessels>('stabilitysoft.uservessels.v1')![0].vessel.name).toBe('OLD VESSEL');
  });

  it('changes are written and survive a restart', async () => {
    await storage.initStorage({ idb });
    storage.set('stabilitysoft.library.v1', { criteria: [{ id: 'c1' }], groups: [] });
    await storage.flush();
    expect(storage.getStatus().lastSaved).not.toBeNull();
    await storage.initStorage({ idb });
    expect(storage.get<{ criteria: { id: string }[] }>('stabilitysoft.library.v1')!.criteria[0].id).toBe('c1');
  });

  it('falls back to localStorage when IndexedDB is not available', async () => {
    globalThis.localStorage.setItem('stabilitysoft.library.v1', JSON.stringify({ criteria: [{ id: 'ls' }], groups: [] }));
    const st = await storage.initStorage({ idb: null });
    expect(st.backend).toBe('localStorage');
    storage.set('stabilitysoft.library.v1', { criteria: [{ id: 'ls2' }], groups: [] });
    await storage.flush();
    expect(JSON.parse(globalThis.localStorage.getItem('stabilitysoft.library.v1')!).criteria[0].id).toBe('ls2');
  });
});

describe('backup reminder', () => {
  beforeEach(async () => { (globalThis as unknown as { localStorage: MemLS }).localStorage = new MemLS(); await storage.initStorage({ idb: new IDBFactory() }); });
  const day = 86400e3;
  it('no reminder without changes; start-up writes are not changes', () => {
    storage.set('stabilitysoft.loadcases.v3', { a: 1 }); // first write = initial data
    storage.set('stabilitysoft.loadcases.v3', { a: 1 }); // unchanged
    expect(storage.backupDue().due).toBe(false);
  });
  it('due after changes and days without a database file; not after a backup; snooze', async () => {
    storage.set('stabilitysoft.loadcases.v3', { a: 1 });
    storage.set('stabilitysoft.loadcases.v3', { a: 2 }); // a real change
    expect(storage.backupDue().due).toBe(false);                     // never backed up, change < 1 day old
    expect(storage.backupDue(Date.now() + 2 * day).due).toBe(true);  // never backed up, change older than a day
    storage.markBackedUp();
    expect(storage.backupDue(Date.now() + 30 * day).due).toBe(false); // nothing changed since the backup
    await new Promise((r) => setTimeout(r, 5));
    storage.set('stabilitysoft.loadcases.v3', { a: 3 });
    expect(storage.backupDue(Date.now() + 3 * day).due).toBe(false);  // backup is 3 days old (< 7)
    expect(storage.backupDue(Date.now() + 8 * day).due).toBe(true);
    storage.snoozeReminder(24);
    expect(storage.backupDue(Date.now() + 0.5 * day).due).toBe(false);
    storage.setBackupDays(0);
    expect(storage.backupDue(Date.now() + 100 * day).due).toBe(false); // reminders switched off
  });
});

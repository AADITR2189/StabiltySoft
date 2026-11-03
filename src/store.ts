// Local persistence of load cases per vessel (browser storage). Works offline.
// Phase 1 MVP: localStorage. Planned: IndexedDB + sync (see docs/03-System-Architecture.md §10).
import { useEffect, useState } from 'react';
import { VESSELS } from './data/vessels';
import type { LoadCase } from './engine/types';

const KEY = 'stabilitysoft.loadcases.v2';
const ACTIVE = 'stabilitysoft.active.v2';

type Saved = Record<string, LoadCase[]>; // vesselId -> load cases

function load(): Saved {
  let saved: Saved = {};
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) saved = JSON.parse(raw) as Saved;
  } catch { /* storage unavailable */ }
  for (const v of VESSELS) {
    if (!Array.isArray(saved[v.id]) || saved[v.id].length === 0) saved[v.id] = structuredClone(v.defaultLoadCases);
  }
  return saved;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function useLoadCases() {
  const [all, setAll] = useState<Saved>(load);
  const [active, setActiveState] = useState<{ vesselId: string; caseId: string }>(() => {
    try {
      const a = JSON.parse(localStorage.getItem(ACTIVE) ?? 'null');
      if (a && VESSELS.some((v) => v.id === a.vesselId)) return a;
    } catch { /* ignore */ }
    return { vesselId: VESSELS[0].id, caseId: '' };
  });

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* ignore */ } }, [all]);
  useEffect(() => { try { localStorage.setItem(ACTIVE, JSON.stringify(active)); } catch { /* ignore */ } }, [active]);

  const entry = VESSELS.find((v) => v.id === active.vesselId) ?? VESSELS[0];
  const cases = all[entry.id] ?? [];
  const lc = cases.find((c) => c.id === active.caseId) ?? cases[0];
  const setCases = (fn: (cs: LoadCase[]) => LoadCase[]) => setAll((a) => ({ ...a, [entry.id]: fn(a[entry.id] ?? []) }));

  return {
    entry,
    cases,
    active: lc,
    setVessel: (vesselId: string) => setActiveState({ vesselId, caseId: '' }),
    setActive: (caseId: string) => setActiveState({ vesselId: entry.id, caseId }),
    update: (x: LoadCase) => setCases((cs) => cs.map((c) => (c.id === x.id ? x : c))),
    duplicate: (id: string) => {
      const src = cases.find((c) => c.id === id);
      if (!src) return;
      const copy: LoadCase = { ...structuredClone(src), id: newId(), name: `${src.name} (copy)` };
      setCases((cs) => [...cs, copy]);
      setActiveState({ vesselId: entry.id, caseId: copy.id });
    },
    create: () => {
      const base = structuredClone(entry.defaultLoadCases[0]);
      const lc2: LoadCase = { ...base, id: newId(), name: 'New load case' };
      setCases((cs) => [...cs, lc2]);
      setActiveState({ vesselId: entry.id, caseId: lc2.id });
    },
    remove: (id: string) => setCases((cs) => (cs.length > 1 ? cs.filter((c) => c.id !== id) : cs)),
    resetToBooklet: () => setCases(() => structuredClone(entry.defaultLoadCases)),
  };
}

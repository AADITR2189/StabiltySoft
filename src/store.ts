// Local persistence of load cases (browser storage). Works offline.
// Phase 1 MVP: localStorage. Planned: IndexedDB + sync (see docs/03-System-Architecture.md §10).
import { useEffect, useState } from 'react';
import { demoLoadCase } from './data/demoVessel';
import type { LoadCase } from './engine/types';

const KEY = 'stabilitysoft.loadcases.v1';
const ACTIVE = 'stabilitysoft.active.v1';

function load(): LoadCase[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const list = JSON.parse(raw) as LoadCase[];
      if (Array.isArray(list) && list.length) return list;
    }
  } catch { /* storage unavailable */ }
  return [structuredClone(demoLoadCase)];
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function useLoadCases() {
  const [cases, setCases] = useState<LoadCase[]>(load);
  const [activeId, setActiveId] = useState<string>(() => {
    try { return localStorage.getItem(ACTIVE) ?? ''; } catch { return ''; }
  });

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(cases)); } catch { /* ignore */ }
  }, [cases]);
  useEffect(() => {
    try { localStorage.setItem(ACTIVE, activeId); } catch { /* ignore */ }
  }, [activeId]);

  const active = cases.find((c) => c.id === activeId) ?? cases[0];

  return {
    cases,
    active,
    setActive: (id: string) => setActiveId(id),
    update: (lc: LoadCase) => setCases((cs) => cs.map((c) => (c.id === lc.id ? lc : c))),
    duplicate: (id: string) => {
      const src = cases.find((c) => c.id === id);
      if (!src) return;
      const copy: LoadCase = { ...structuredClone(src), id: newId(), name: `${src.name} (copy)` };
      setCases((cs) => [...cs, copy]);
      setActiveId(copy.id);
    },
    create: () => {
      const lc: LoadCase = { ...structuredClone(demoLoadCase), id: newId(), name: 'New load case' };
      setCases((cs) => [...cs, lc]);
      setActiveId(lc.id);
    },
    remove: (id: string) => {
      setCases((cs) => (cs.length > 1 ? cs.filter((c) => c.id !== id) : cs));
    },
  };
}

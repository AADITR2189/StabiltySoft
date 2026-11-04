// Arrival condition from a departure: consumables used up by a percentage per tank type (and
// optionally per variable weight item, e.g. provisions). Everything else is copied unchanged.
import type { LoadCase, Results, TankStatus, Vessel } from './types';
import { tankTypes, typeOf } from './tankTypes';
import { defaultLimits } from './opLimits';

export interface ArrivalSpec {
  name: string;
  /** % consumed per tank type name (0–100). Types not listed: unchanged. */
  consumedByType: Record<string, number>;
  /** % consumed per variable weight item id (0–100). */
  consumedByWeight: Record<string, number>;
}

/** The usual starting point: consumable types 90 % used (10 % remaining, IMO standard arrival). */
export function defaultSpec(v: Vessel, dep: LoadCase): ArrivalSpec {
  return {
    name: `${dep.name.replace(/\bdeparture\b/i, 'arrival')}${/departure/i.test(dep.name) ? '' : ' (arrival)'}`,
    consumedByType: Object.fromEntries(tankTypes(v).filter((t) => t.consumable).map((t) => [t.name, 90])),
    consumedByWeight: {},
  };
}

export function generateArrival(v: Vessel, dep: LoadCase, rDep: Results | null, spec: ArrivalSpec, newId: () => string): { lc: LoadCase; changes: string[] } {
  const changes: string[] = [];
  const tanks: Record<string, TankStatus> = {};
  for (const t of v.tanks) {
    const st = dep.tanks[t.id] ?? { input: { mode: 'VOLUME' as const, value: 0 } };
    const c = Math.min(100, Math.max(0, spec.consumedByType[typeOf(t)] ?? 0));
    if (!c) { tanks[t.id] = structuredClone(st); continue; }
    const k = 1 - c / 100;
    const inp = st.input;
    let next: TankStatus['input'];
    if (inp.mode === 'FILLED') next = { mode: 'PERCENT', value: 100 * k };
    else if (inp.mode === 'SOUNDING') {
      const vol = rDep?.tanks.find((x) => x.tankId === t.id)?.volume;
      if (vol === undefined) throw new Error(`${t.name}: entered by sounding; calculate the departure first.`);
      next = { mode: 'VOLUME', value: vol * k };
    } else next = { ...inp, value: inp.value * k };
    tanks[t.id] = { ...st, input: next };
    const before = rDep?.tanks.find((x) => x.tankId === t.id);
    if ((inp.mode === 'FILLED' || inp.value > 0) && before) changes.push(`${t.name}: ${before.weight.toFixed(2)} t → ${(before.weight * k).toFixed(2)} t (${c} % used)`);
  }
  const weights = dep.weights.map((w) => {
    const c = Math.min(100, Math.max(0, spec.consumedByWeight[w.id] ?? 0));
    if (!c) return { ...w, id: newId() };
    changes.push(`${w.description}: ${w.weight} t → ${(w.weight * (1 - c / 100)).toFixed(3)} t (${c} % used)`);
    return { ...w, id: newId(), weight: w.weight * (1 - c / 100) };
  });
  const used = Object.entries(spec.consumedByType).filter(([, x]) => x > 0).map(([n, x]) => `${n} ${x} %`).join(', ');
  const lc: LoadCase = {
    ...structuredClone(dep), id: newId(), name: spec.name, type: 'Arrival', tanks, weights,
    opLimits: dep.opLimits ? structuredClone(dep.opLimits) : defaultLimits(v),
    generatedFrom: { id: dep.id, name: dep.name, note: `Arrival generated from "${dep.name}": consumed ${used || 'nothing'}${Object.keys(spec.consumedByWeight).length ? '; weight items reduced' : ''}.` },
  };
  return { lc, changes };
}

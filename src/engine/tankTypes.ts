// Tank types: the booklet's own grouping of tanks ("WATER BALLAST", "BRINE", "SCALE INHIBITOR" …).
// Each type has a category (used for consumables and colours), a colour, a default density and a
// consumable flag. Tank tables are shown split by type with a subtotal per type.
import type { Tank, TankGroup, TankResult, Vessel } from './types';

export interface TankTypeDef { name: string; category: TankGroup; color: string; density?: number; consumable: boolean }

export const CATEGORIES: TankGroup[] = ['BALLAST', 'FUEL_OIL', 'DIESEL_OIL', 'LUB_OIL', 'FRESH_WATER', 'MISC'];
export const CATEGORY_LABEL: Record<TankGroup, string> = { BALLAST: 'Ballast', FUEL_OIL: 'Fuel oil', DIESEL_OIL: 'Diesel oil', LUB_OIL: 'Lub oil', FRESH_WATER: 'Fresh water', MISC: 'Other' };
const CATEGORY_COLOR: Record<TankGroup, string> = { BALLAST: '#4FC3F7', FUEL_OIL: '#F45B0B', DIESEL_OIL: '#FFB74D', LUB_OIL: '#C792EA', FRESH_WATER: '#4ADE80', MISC: '#A8C9C8' };
/** Contrast colours on the dark background for further types. */
export const PALETTE = ['#4FC3F7', '#F45B0B', '#4ADE80', '#FFD23F', '#C792EA', '#FF8A80', '#80CBC4', '#F48FB1', '#AED581', '#FFB74D', '#9FA8DA', '#E6EE9C', '#BCAAA4', '#A8C9C8'];

export const typeOf = (t: Tank): string => t.type?.trim() || CATEGORY_LABEL[t.group].toUpperCase();

/** The vessel's tank types in display order: the stored list, plus any type used by a tank but not listed. */
export function tankTypes(v: Vessel): TankTypeDef[] {
  const out: TankTypeDef[] = (v.tankTypes ?? []).map((x) => ({ ...x }));
  const used = new Set<string>();
  for (const t of v.tanks) {
    const name = typeOf(t);
    if (out.some((x) => x.name === name)) continue;
    if (used.has(name)) continue;
    used.add(name);
    const sameCat = out.filter((x) => x.category === t.group).length;
    out.push({ name, category: t.group, color: sameCat ? PALETTE[out.length % PALETTE.length] : CATEGORY_COLOR[t.group], density: t.density, consumable: t.isConsumable });
  }
  return out;
}

export function groupByType<T>(v: Vessel, items: T[], tankOf: (x: T) => Tank | undefined): { type: TankTypeDef; items: T[] }[] {
  const types = tankTypes(v);
  return types.map((type) => ({ type, items: items.filter((x) => { const t = tankOf(x); return !!t && typeOf(t) === type.name; }) })).filter((g) => g.items.length > 0);
}

export function typeTotals(rs: TankResult[]) {
  const W = rs.reduce((s, r) => s + r.weight, 0);
  const m = (k: 'lcg' | 'tcg' | 'vcg') => (W > 0 ? rs.reduce((s, r) => s + r.weight * r[k], 0) / W : 0);
  return { volume: rs.reduce((s, r) => s + r.volume, 0), weight: W, lcg: m('lcg'), tcg: m('tcg'), vcg: m('vcg'), fsm: rs.reduce((s, r) => s + r.fsm, 0) };
}

/** Category guessed from a type name ("WATER BALLAST" → BALLAST, "FUEL OIL" → FUEL_OIL …). */
export function categoryOf(name: string): TankGroup {
  const s = name.toUpperCase();
  if (/BALLAST/.test(s)) return 'BALLAST';
  if (/LUB/.test(s)) return 'LUB_OIL';
  if (/DIESEL|MGO|MDO|GAS\s*OIL/.test(s)) return 'DIESEL_OIL';
  if (/FUEL|HFO|IFO/.test(s)) return 'FUEL_OIL';
  if (/FRESH|POTABLE|DRINK|DISTILL/.test(s)) return 'FRESH_WATER';
  return 'MISC';
}

export interface TypeEdit extends TankTypeDef { /** name before editing (null = new type) */ orig: string | null; applyDensity: boolean }

/**
 * Apply edited tank types to the vessel: renames, category / consumable carried to the tanks of each
 * type, density carried only where asked, tanks moved between types. Returns the change list
 * (for the edit log), per tank as well.
 */
export function applyTypeEdits(v: Vessel, types: TypeEdit[], tankType: Record<string, string>): { vessel: Vessel; changes: string[]; perTank: Record<string, string[]> } {
  const before = tankTypes(v);
  const changes: string[] = [];
  const perTank: Record<string, string[]> = {};
  const note = (tank: string, c: string) => { (perTank[tank] ??= []).push(c); };
  for (const t of types) {
    const b = t.orig !== null ? before.find((x) => x.name === t.orig) : undefined;
    if (!b) { changes.push(`type added: ${t.name} (${CATEGORY_LABEL[t.category]})`); continue; }
    if (b.name !== t.name) changes.push(`type renamed: ${b.name} → ${t.name}`);
    if (b.category !== t.category) changes.push(`${t.name}: category ${CATEGORY_LABEL[b.category]} → ${CATEGORY_LABEL[t.category]}`);
    if (b.consumable !== t.consumable) changes.push(`${t.name}: consumable ${b.consumable ? 'yes' : 'no'} → ${t.consumable ? 'yes' : 'no'}`);
    if ((b.density ?? null) !== (t.density ?? null)) changes.push(`${t.name}: default density ${b.density ?? '—'} → ${t.density ?? '—'}${t.applyDensity ? ' (set for its tanks)' : ''}`);
    if (b.color !== t.color) changes.push(`${t.name}: colour changed`);
  }
  for (const b of before) if (!types.some((t) => t.orig === b.name)) changes.push(`type deleted: ${b.name}`);
  const n = structuredClone(v);
  n.tankTypes = types.map(({ name, category, color, density, consumable }) => ({ name, category, color, ...(density !== undefined ? { density } : {}), consumable }));
  for (const tank of n.tanks) {
    const oldType = typeOf(tank);
    const renamed = types.find((t) => t.orig === oldType)?.name;
    const newType = tankType[tank.name] ?? renamed ?? oldType;
    const def = types.find((t) => t.name === newType);
    if (!def) throw new Error(`Tank ${tank.name} has type "${newType}", which is not in the list.`);
    if (newType !== oldType) { const c = renamed === newType ? `type ${oldType} → ${newType} (renamed)` : `moved: ${oldType} → ${newType}`; note(tank.name, c); if (renamed !== newType) changes.push(`${tank.name} ${c}`); }
    if (tank.group !== def.category) note(tank.name, `category ${CATEGORY_LABEL[tank.group]} → ${CATEGORY_LABEL[def.category]}`);
    if (tank.isConsumable !== def.consumable) note(tank.name, `consumable → ${def.consumable ? 'yes' : 'no'}`);
    tank.type = newType; tank.group = def.category; tank.isConsumable = def.consumable;
    if (def.applyDensity && def.density !== undefined && tank.density !== def.density) { note(tank.name, `density ${tank.density} → ${def.density}`); tank.density = def.density; }
  }
  return { vessel: n, changes, perTank };
}

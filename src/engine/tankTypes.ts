// Tank types: the booklet's own grouping of tanks ("WATER BALLAST", "BRINE", "SCALE INHIBITOR" …).
// Each type has a category (used for consumables and colours), a colour, a default density and a
// consumable flag. Tank tables are shown split by type with a subtotal per type.
import type { Tank, TankGroup, TankResult, Vessel } from './types';

export interface TankTypeDef { name: string; category: TankGroup; color: string; density?: number; consumable: boolean }

export interface TankCategoryDef { id: string; label: string; color: string; consumable: boolean }

export const BUILTIN_CATEGORIES: TankCategoryDef[] = [
  { id: 'BALLAST', label: 'Ballast', color: '#4FC3F7', consumable: false },
  { id: 'FUEL_OIL', label: 'Fuel oil', color: '#F45B0B', consumable: true },
  { id: 'DIESEL_OIL', label: 'Diesel oil', color: '#FFB74D', consumable: true },
  { id: 'LUB_OIL', label: 'Lub oil', color: '#C792EA', consumable: true },
  { id: 'FRESH_WATER', label: 'Fresh water', color: '#4ADE80', consumable: true },
  { id: 'MISC', label: 'Other', color: '#A8C9C8', consumable: false },
];
export const CATEGORIES: TankGroup[] = BUILTIN_CATEGORIES.map((c) => c.id);
/** Labels of the built-in categories (also used for default type names). */
export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(BUILTIN_CATEGORIES.map((c) => [c.id, c.label]));
const CATEGORY_COLOR: Record<string, string> = Object.fromEntries(BUILTIN_CATEGORIES.map((c) => [c.id, c.color]));

/** The vessel's categories: its own list (or the built-in one), plus any category used by a type or tank but not listed. */
export function categories(v: Vessel): TankCategoryDef[] {
  const out: TankCategoryDef[] = (v.tankCategories ?? BUILTIN_CATEGORIES).map((c) => ({ ...c }));
  const used = [...(v.tankTypes ?? []).map((t) => t.category), ...v.tanks.map((t) => t.group)];
  for (const id of used) if (!out.some((c) => c.id === id)) { const b = BUILTIN_CATEGORIES.find((c) => c.id === id); out.push(b ? { ...b } : { id, label: id, color: PALETTE[out.length % PALETTE.length], consumable: false }); }
  return out;
}
export const catLabel = (v: Vessel, id: string) => categories(v).find((c) => c.id === id)?.label ?? CATEGORY_LABEL[id] ?? id;

/** A new category id from its label: "Brine & chemicals" → "BRINE_CHEMICALS" (unique). */
export function categoryId(label: string, taken: string[]): string {
  const base = label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'CATEGORY';
  let id = base, i = 2;
  while (taken.includes(id)) id = `${base}_${i++}`;
  return id;
}
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
    out.push({ name, category: t.group, color: sameCat || !CATEGORY_COLOR[t.group] ? PALETTE[out.length % PALETTE.length] : CATEGORY_COLOR[t.group], density: t.density, consumable: t.isConsumable });
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
export interface CategoryEdit extends TankCategoryDef { /** id before editing (null = new) */ orig: string | null }

export function applyTypeEdits(v: Vessel, types: TypeEdit[], tankType: Record<string, string>, cats?: CategoryEdit[]): { vessel: Vessel; changes: string[]; perTank: Record<string, string[]> } {
  const before = tankTypes(v);
  const changes: string[] = [];
  const catsBefore = categories(v);
  const L = (id: string) => (cats ?? catsBefore).find((c) => c.id === id)?.label ?? catLabel(v, id);
  const Lb = (id: string) => catLabel(v, id);
  if (cats) {
    for (const c of cats) {
      const b = c.orig !== null ? catsBefore.find((x) => x.id === c.orig) : undefined;
      if (!b) { changes.push(`category added: ${c.label}${c.consumable ? ' (consumable)' : ''}`); continue; }
      if (b.label !== c.label) changes.push(`category renamed: ${b.label} → ${c.label}`);
      if (b.consumable !== c.consumable) changes.push(`category ${c.label}: consumable by default ${b.consumable ? 'yes' : 'no'} → ${c.consumable ? 'yes' : 'no'}`);
      if (b.color !== c.color) changes.push(`category ${c.label}: colour changed`);
    }
    for (const b of catsBefore) if (!cats.some((c) => c.orig === b.id)) changes.push(`category deleted: ${b.label}`);
    for (const t of types) if (!cats.some((c) => c.id === t.category)) throw new Error(`Type ${t.name} uses a category that is not in the list.`);
  }
  const perTank: Record<string, string[]> = {};
  const note = (tank: string, c: string) => { (perTank[tank] ??= []).push(c); };
  for (const t of types) {
    const b = t.orig !== null ? before.find((x) => x.name === t.orig) : undefined;
    if (!b) { changes.push(`type added: ${t.name} (${L(t.category)})`); continue; }
    if (b.name !== t.name) changes.push(`type renamed: ${b.name} → ${t.name}`);
    if (b.category !== t.category) changes.push(`${t.name}: category ${Lb(b.category)} → ${L(t.category)}`);
    if (b.consumable !== t.consumable) changes.push(`${t.name}: consumable ${b.consumable ? 'yes' : 'no'} → ${t.consumable ? 'yes' : 'no'}`);
    if ((b.density ?? null) !== (t.density ?? null)) changes.push(`${t.name}: default density ${b.density ?? '—'} → ${t.density ?? '—'}${t.applyDensity ? ' (set for its tanks)' : ''}`);
    if (b.color !== t.color) changes.push(`${t.name}: colour changed`);
  }
  for (const b of before) if (!types.some((t) => t.orig === b.name)) changes.push(`type deleted: ${b.name}`);
  const n = structuredClone(v);
  if (cats) n.tankCategories = cats.map(({ id, label, color, consumable }) => ({ id, label, color, consumable }));
  n.tankTypes = types.map(({ name, category, color, density, consumable }) => ({ name, category, color, ...(density !== undefined ? { density } : {}), consumable }));
  for (const tank of n.tanks) {
    const oldType = typeOf(tank);
    const renamed = types.find((t) => t.orig === oldType)?.name;
    const newType = tankType[tank.name] ?? renamed ?? oldType;
    const def = types.find((t) => t.name === newType);
    if (!def) throw new Error(`Tank ${tank.name} has type "${newType}", which is not in the list.`);
    if (newType !== oldType) { const c = renamed === newType ? `type ${oldType} → ${newType} (renamed)` : `moved: ${oldType} → ${newType}`; note(tank.name, c); if (renamed !== newType) changes.push(`${tank.name} ${c}`); }
    if (tank.group !== def.category) note(tank.name, `category ${Lb(tank.group)} → ${L(def.category)}`);
    if (tank.isConsumable !== def.consumable) note(tank.name, `consumable → ${def.consumable ? 'yes' : 'no'}`);
    tank.type = newType; tank.group = def.category; tank.isConsumable = def.consumable;
    if (def.applyDensity && def.density !== undefined && tank.density !== def.density) { note(tank.name, `density ${tank.density} → ${def.density}`); tank.density = def.density; }
  }
  return { vessel: n, changes, perTank };
}

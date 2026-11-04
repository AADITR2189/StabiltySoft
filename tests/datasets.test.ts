import { describe, expect, it } from 'vitest';
import { applyTable, checkTable, columnsOf, diffRows, listDatasets, tableOf } from '../src/importer/datasetTables';
import { VESSELS } from '../src/data/vessels';

const marsol = VESSELS[0].vessel;

describe('every data set as an editable table', () => {
  const list = listDatasets(marsol);
  it('lists particulars, lightship, 5 hydro + 5 KN trims, windage, openings and 54 tanks', () => {
    expect(list.filter((d) => d.kind === 'HYDRO').length).toBe(5);
    expect(list.filter((d) => d.kind === 'KN').length).toBe(5);
    expect(list.filter((d) => d.kind === 'TANK').length).toBe(54);
  });
  it('saving an unchanged table stores exactly the same data (all data sets)', () => {
    for (const d of list) {
      if (d.kind === 'PARTICULARS' || d.kind === 'LIGHTSHIP_SUMMARY' || d.kind === 'TANK_TYPES') continue;
      const cols = columnsOf(marsol, d);
      const rows = tableOf(marsol, d);
      const r = applyTable(marsol, d, cols, rows);
      expect(r.ok, `${d.key}: ${r.text}`).toBe(true);
      expect(tableOf(r.vessel, d), d.key).toEqual(rows);
    }
  });
  it('an edit is applied, checked and described', () => {
    const d = list.find((x) => x.key === 'OPENINGS')!;
    const cols = columnsOf(marsol, d);
    const rows = tableOf(marsol, d);
    const edited = rows.map((r, i) => ({ orig: i as number | null, vals: i === 3 ? [r[0], r[1], 6.3, r[3]] : [...r] }));
    expect(diffRows(cols, rows, edited)).toEqual(['row 4 Y + stbd: -6.3 → 6.3']);
    expect(checkTable(marsol, d, cols, edited.map((e) => e.vals)).find((c) => /port \/ starboard/i.test(c.title))?.level).toBe('warn');
    const res = applyTable(marsol, d, cols, edited.map((e) => e.vals));
    expect(res.vessel.openings[3].y).toBe(6.3);
    expect(diffRows(cols, rows, [...edited.slice(0, 2), { orig: null, vals: ['NEW', 1, 2, 3] }])).toEqual(['row 3 deleted (Opening POSITION 2(S))', 'row 4 deleted (Opening POSITION 2(P))', 'row added at 3 (Opening NEW)']);
  });
});

describe('tank types', async () => {
  const { tankTypes, groupByType, applyTypeEdits, typeOf } = await import('../src/engine/tankTypes');
  it('MARSOL keeps the booklet types: 10 types, 54 tanks', () => {
    const types = tankTypes(marsol);
    expect(new Set(types.map((t) => t.name))).toEqual(new Set(['WATER BALLAST', 'FRESH WATER', 'FUEL OIL', 'MISC', 'SCALE INHIBITOR', 'CORROSION INHIBITOR', 'ACID', 'BRINE', 'TREATED INJECTION WATER', 'TK ON MAIN DECK']));
    expect(types.length).toBe(10);
    expect(groupByType(marsol, marsol.tanks, (t) => t).reduce((s, g) => s + g.items.length, 0)).toBe(54);
    expect(types.find((t) => t.name === 'WATER BALLAST')!.category).toBe('BALLAST');
  });
  it('rename, move a tank, category and density carried to tanks, change list', () => {
    const types = tankTypes(marsol).map((t) => ({ ...t, orig: t.name, applyDensity: false }));
    const brine = types.find((t) => t.name === 'BRINE')!;
    brine.name = 'BRINE TANKS'; brine.density = 1.2; brine.applyDensity = true;
    const map = Object.fromEntries(marsol.tanks.map((t) => [t.name, typeOf(t) === 'BRINE' ? 'BRINE TANKS' : typeOf(t)]));
    const acidTank = marsol.tanks.find((t) => typeOf(t) === 'ACID')!.name;
    map[acidTank] = 'BRINE TANKS';
    const res = applyTypeEdits(marsol, types, map);
    expect(res.changes).toContain('type renamed: BRINE → BRINE TANKS');
    expect(res.changes.some((c) => c.startsWith(`${acidTank} moved: ACID → BRINE TANKS`))).toBe(true);
    const moved = res.vessel.tanks.filter((t) => t.type === 'BRINE TANKS');
    expect(moved.length).toBe(6);
    expect(moved.every((t) => t.density === 1.2)).toBe(true);
    expect(res.vessel.tanks.filter((t) => t.type === 'BRINE').length).toBe(0);
  });
});

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
      if (d.kind === 'PARTICULARS' || d.kind === 'LIGHTSHIP_SUMMARY') continue;
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

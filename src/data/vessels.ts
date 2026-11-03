// Vessel registry. Each vessel carries its data status: demo, or extracted-but-unverified booklet data.
import type { LoadCase, Vessel } from '../engine/types';
import { demoLoadCase, demoVessel } from './demoVessel';
import { vesselFromBooklet, type BookletExtract } from './fromBooklet';
import marsolExtract from '../../vessels/marsol-splendor/marsol-splendor.extracted.json';

export type DataStatus = 'DEMO' | 'UNVERIFIED' | 'VERIFIED';

export interface VesselEntry {
  id: string;
  vessel: Vessel;
  status: DataStatus;
  source: string;
  defaultLoadCases: LoadCase[];
}

interface ExtractCondition {
  id: string; name: string; fsmUsed: number[];
  fixedWeights: { description: string; weight: number; lcg: number; tcg: number; vcg: number }[];
  tanks: { name: string; sg: number; percent: number }[];
}

const marsol = vesselFromBooklet(marsolExtract as unknown as BookletExtract);
const marsolCases: LoadCase[] = (marsolExtract.conditions as unknown as ExtractCondition[])
  .filter((c) => ['C2', 'C3', 'C4', 'C5'].includes(c.id))
  .map((c) => ({
    id: `marsol-${c.id}`,
    name: `${c.name.replace(/^Condition (\d+): /, 'Cond. $1: ')} (booklet)`,
    type: /arrival/i.test(c.name) ? 'Arrival' : 'Departure',
    seaDensity: 1.025,
    fsmMethod: 'MANUAL_TOTAL',
    fsmTotal: c.fsmUsed[0] ?? 0,
    tanks: Object.fromEntries(
      marsol.tanks.map((t) => {
        const ct = c.tanks.find((x) => x.name === t.id);
        return [t.id, { input: { mode: 'PERCENT' as const, value: ct ? ct.percent : 0 }, density: ct ? ct.sg : t.density }];
      }),
    ),
    weights: c.fixedWeights
      .filter((w) => w.description !== 'LIGHT SHIP')
      .map((w, i) => ({ id: `${c.id}-w${i}`, description: w.description, weight: w.weight, lcg: w.lcg, tcg: w.tcg, vcg: w.vcg })),
  }));

export const VESSELS: VesselEntry[] = [
  {
    id: 'marsol-splendor',
    vessel: marsol,
    status: 'UNVERIFIED',
    source: 'Preliminary Intact Stability Booklet DU5864/1022 Rev.0 (Aries Marine, 28.10.2026)',
    defaultLoadCases: marsolCases,
  },
  { id: 'demo', vessel: demoVessel, status: 'DEMO', source: 'Fictional box barge with exactly calculable data', defaultLoadCases: [demoLoadCase] },
];

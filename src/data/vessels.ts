// Vessel registry. Each vessel carries its data status: demo, or extracted-but-unverified booklet data.
import type { LoadCase, Vessel } from '../engine/types';
import type { Provenance } from '../importer/apply';
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
  /** true for vessels created or imported by the user (stored in the browser, editable) */
  user?: boolean;
  /** user vessels: where each dataset came from and who verified it */
  provenance?: Record<string, Provenance>;
}

interface ExtractCondition {
  id: string; name: string; fsmUsed: number[];
  fixedWeights: { description: string; weight: number; lcg: number; tcg: number; vcg: number }[];
  tanks: { name: string; sg: number; percent: number }[];
}

const marsol = vesselFromBooklet(marsolExtract as unknown as BookletExtract);
const marsolCases: LoadCase[] = (marsolExtract.conditions as unknown as ExtractCondition[])
  .filter((c) => c.id !== 'C1')
  .map((c) => ({
    id: `marsol-${c.id}`,
    name: `${c.name.replace(/^Condition ([\d.]+): /, 'Cond. $1: ')} (booklet)`,
    type: /crane/i.test(c.name) ? 'Crane operation' : /arrival/i.test(c.name) ? 'Arrival' : 'Departure',
    criteriaGroups: /crane/i.test(c.name) ? ['CRANE_OPS'] : marsol.criteriaGroups,
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

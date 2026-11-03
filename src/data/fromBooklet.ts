// Builds an engine Vessel from data extracted by tools/extract_booklet.py.
// The extract is unverified until a person checks it against the booklet pages.
import type { HydroRow, Opening, Tank, TankCalRow, TankGroup, Vessel } from '../engine/types';

export interface BookletExtract {
  particulars: {
    name: string; imo: string; callSign: string; lbp: number; breadth: number; depth: number;
    summerDraft: number; rhoRef: number; midshipFromAP: number;
    lightship: { weight: number; lcg: number; tcg: number; vcg: number };
  };
  hydrostatics: { trim: number; rows: { draft: number; displacement: number; lcb: number; lcf: number; kb: number; tpc: number; mtc: number; kmt: number }[] }[];
  crossCurves: { trim: number; angles: number[]; rows: { displacement: number; kn: number[] }[] }[];
  floodPoints: { name: string; x: number; y: number; z: number }[];
  windage?: { draft: number; area: number; centroidZ: number; underwaterCentroidZ: number }[];
  tanks: { name: string; group: string; density: number; rows: { percent: number; volume: number; lcg: number | null; tcg: number | null; vcg: number | null; fsm: number | null }[] }[];
}

const GROUPS: Record<string, TankGroup> = {
  'WATER BALLAST': 'BALLAST', 'FRESH WATER': 'FRESH_WATER', 'FUEL OIL': 'FUEL_OIL',
};

export function vesselFromBooklet(x: BookletExtract): Vessel {
  const p = x.particulars;
  const mapRows = (rows: BookletExtract['hydrostatics'][number]['rows']): HydroRow[] =>
    rows.map((r) => ({ draft: r.draft, displacement: r.displacement, lcb: r.lcb, lcf: r.lcf, kb: r.kb, kmt: r.kmt, tpc: r.tpc, mtc: r.mtc }));
  const h0 = x.hydrostatics.find((t) => t.trim === 0)!;
  const k0 = x.crossCurves.find((t) => t.trim === 0)!;

  const tanks: Tank[] = x.tanks.map((t) => {
    const firstFull = t.rows.find((r) => r.lcg !== null)!;
    const maxFsm = Math.max(...t.rows.map((r) => r.fsm ?? 0));
    const calibration: TankCalRow[] = t.rows.map((r, i) => ({
      volume: r.volume,
      lcg: r.lcg ?? firstFull.lcg!,
      tcg: r.tcg ?? firstFull.tcg!,
      vcg: r.vcg ?? firstFull.vcg!,
      // FSM is printed at the tank's density; store as inertia. The 100 % row has no FSM printed.
      inertia: (r.fsm ?? (i === t.rows.length - 1 ? (t.rows[i - 1].fsm ?? maxFsm) : 0)) / t.density,
    }));
    return {
      id: t.name, name: t.name, group: GROUPS[t.group] ?? 'MISC', capacity: t.rows[t.rows.length - 1].volume,
      density: t.density, isConsumable: ['FUEL_OIL', 'FRESH_WATER'].includes(GROUPS[t.group] ?? ''), calibration,
    };
  });

  const openings: Opening[] = x.floodPoints.map((f) => ({ name: f.name, x: f.x, y: f.y, z: f.z }));

  return {
    name: p.name, imo: p.imo, callSign: p.callSign, lbp: p.lbp, breadth: p.breadth, depth: p.depth,
    rhoRef: p.rhoRef, bilgeType: 'ROUND', bilgeKeelArea: 0,
    lightship: p.lightship,
    hydro: { rhoRef: p.rhoRef, rows: mapRows(h0.rows), trims: x.hydrostatics.map((t) => ({ trim: t.trim, rows: mapRows(t.rows) })) },
    kn: {
      rhoRef: p.rhoRef, angles: k0.angles, displacements: k0.rows.map((r) => r.displacement), kn: k0.rows.map((r) => r.kn),
      trims: x.crossCurves.map((t) => ({ trim: t.trim, displacements: t.rows.map((r) => r.displacement), kn: t.rows.map((r) => r.kn) })),
    },
    tanks,
    windage: (x.windage ?? []).map((w) => ({ draft: w.draft, area: w.area, centroidZ: w.centroidZ, underwaterCentroidZ: w.underwaterCentroidZ })),
    openings,
    maxDraft: p.summerDraft,
    draftOriginX: p.midshipFromAP,
    // Fire-fighting (booklet p.27/46): 2 monitors × 1.530 t at 19.600 m; bow thruster 18 t at 1.200 m above base.
    fifi: { monitorForce: 1.53, monitorCount: 2, monitorHeight: 19.6, thrusterForce: 18, thrusterHeight: 1.2, maxHeel: 5 },
    // Crane (booklet p.7, 51): design heel 5°, wind 20 kn during lifting. The wind coefficient 1.12 is the
    // area-and-lever weighted mean of the booklet's shape (Cs) and height (Ch) coefficients on p.51 (derived).
    crane: { maxHeel: 5, windSpeedKnots: 20, airDensity: 1.22, windCoefficient: 1.12 },
    criteriaGroups: ['OSV_INTACT', 'IS2008_WEATHER', 'BV_FIFI'],
  };
}

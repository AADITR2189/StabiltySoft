// DEMO VESSEL — a fictional box-shaped barge.
// All tables are generated from exact geometry, so engine results can be checked by hand.
// NOT a real ship. Replace with real vessel data imported from an approved stability booklet.
import type { HydroRow, KNTable, LoadCase, Tank, TankCalRow, TankGroup, Vessel, WindRow } from '../engine/types';
import { boxKN } from './boxGeometry';

export const DEMO = { L: 100, B: 16, D: 9, rho: 1.025 };
const { L, B, D, rho } = DEMO;

function hydroRow(T: number): HydroRow {
  const vol = L * B * T;
  return {
    draft: T,
    displacement: vol * rho,
    lcb: L / 2,
    lcf: L / 2,
    kb: T / 2,
    kmt: T / 2 + (B * B) / (12 * T),
    tpc: (L * B * rho) / 100,
    mtc: (rho * B * L * L) / 1200,
    cb: 1,
    lwl: L,
  };
}

const hydroRows: HydroRow[] = [];
for (let i = 10; i <= 85; i++) hydroRows.push(hydroRow(i / 10));

const knAngles = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90];
const knDrafts: number[] = [];
for (let i = 2; i <= 17; i++) knDrafts.push(i / 2); // 1.0 … 8.5
const kn: KNTable = {
  rhoRef: rho,
  displacements: knDrafts.map((T) => L * B * T * rho),
  angles: knAngles,
  kn: knDrafts.map((T) => knAngles.map((a) => boxKN(B, D, T, a))),
};

function boxTank(
  id: string, name: string, group: TankGroup, density: number, consumable: boolean,
  x1: number, x2: number, y1: number, y2: number, z1: number, z2: number,
): Tank {
  const l = x2 - x1, b = y2 - y1, h = z2 - z1;
  const n = Math.round(h / 0.1);
  const calibration: TankCalRow[] = [];
  for (let i = 0; i <= n; i++) {
    const s = (h * i) / n;
    calibration.push({
      sounding: s,
      volume: l * b * s,
      lcg: (x1 + x2) / 2,
      tcg: (y1 + y2) / 2,
      vcg: z1 + s / 2,
      inertia: (l * b ** 3) / 12,
    });
  }
  return { id, name, group, capacity: l * b * h, density, isConsumable: consumable, calibration, box: [x1, x2, y1, y2, z1, z2] };
}

const tanks: Tank[] = [
  boxTank('APT', 'Aft Peak Tank', 'BALLAST', 1.025, false, 0, 5, -5, 5, 2, 8),
  boxTank('FW', 'Fresh Water Tank', 'FRESH_WATER', 1.0, true, 5, 12, -3, 3, 1.2, 6),
  boxTank('FO1P', 'No.1 Fuel Oil (P)', 'FUEL_OIL', 0.95, true, 15, 25, -8, -4, 1.2, 6),
  boxTank('FO1S', 'No.1 Fuel Oil (S)', 'FUEL_OIL', 0.95, true, 15, 25, 4, 8, 1.2, 6),
  boxTank('DB2P', 'No.2 DB Ballast (P)', 'BALLAST', 1.025, false, 30, 60, -8, 0, 0, 1.2),
  boxTank('DB2S', 'No.2 DB Ballast (S)', 'BALLAST', 1.025, false, 30, 60, 0, 8, 0, 1.2),
  boxTank('DB1P', 'No.1 DB Ballast (P)', 'BALLAST', 1.025, false, 60, 80, -8, 0, 0, 1.2),
  boxTank('DB1S', 'No.1 DB Ballast (S)', 'BALLAST', 1.025, false, 60, 80, 0, 8, 0, 1.2),
  boxTank('FPT', 'Fore Peak Tank', 'BALLAST', 1.025, false, 94, 100, -6, 6, 0, 8),
];

const deckhouse = { area: 72, z: 12 }; // 12 m × 6 m deckhouse on deck, aft
const windage: WindRow[] = [];
for (let i = 2; i <= 17; i++) {
  const T = i / 2;
  const hull = L * (D - T);
  const area = hull + deckhouse.area;
  windage.push({ draft: T, area, centroidZ: (hull * (T + (D - T) / 2) + deckhouse.area * deckhouse.z) / area });
}

export const demoVessel: Vessel = {
  name: 'DEMO BOX BARGE',
  imo: '0000000',
  callSign: 'DEMO',
  lbp: L,
  breadth: B,
  depth: D,
  rhoRef: rho,
  bilgeType: 'SHARP',
  bilgeKeelArea: 0,
  lightship: { weight: 1800, lcg: 47.5, tcg: 0, vcg: 5.2 },
  hydro: { rhoRef: rho, rows: hydroRows },
  kn,
  tanks,
  windage,
  openings: [
    { name: 'Engine room ventilator', x: 8, y: 2.5, z: 15 },
    { name: 'FO tank air pipe (S)', x: 20, y: 7.6, z: 11.2 },
  ],
  maxDraft: 7.0,
};

export const demoLoadCase: LoadCase = {
  id: 'demo-departure',
  name: 'Departure (demo)',
  type: 'Departure',
  seaDensity: 1.025,
  fsmMethod: 'ACTUAL',
  tanks: {
    APT: { input: { mode: 'PERCENT', value: 0 } },
    FW: { input: { mode: 'FILLED' } },
    FO1P: { input: { mode: 'WEIGHT', value: 150 } },
    FO1S: { input: { mode: 'WEIGHT', value: 150 } },
    DB2P: { input: { mode: 'FILLED' } },
    DB2S: { input: { mode: 'FILLED' } },
    DB1P: { input: { mode: 'SOUNDING', value: 0.6 } },
    DB1S: { input: { mode: 'SOUNDING', value: 0.6 } },
    FPT: { input: { mode: 'VOLUME', value: 100 } },
  },
  weights: [
    { id: 'w1', description: 'Cargo in hold', weight: 5000, lcg: 51.8, tcg: 0, vcg: 4.6 },
    { id: 'w2', description: 'Crew, stores & provisions', weight: 25, lcg: 8, tcg: 0, vcg: 10 },
  ],
};

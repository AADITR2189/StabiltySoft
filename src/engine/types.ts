// Domain types for the StabilitySoft calculation engine.
// Conventions (see docs/A-Calculation-Methods.md §A.1):
//   X from Aft Perpendicular, positive forward (m)
//   Y from centreline, positive to starboard (m)
//   Z from baseline, positive upward (m)
//   Heel positive to starboard, trim positive by the stern.

export interface HydroRow {
  draft: number;        // m (even keel, moulded)
  displacement: number; // t at rhoRef
  lcb: number;          // m from AP
  lcf: number;          // m from AP
  kb: number;           // m
  kmt: number;          // m
  tpc: number;          // t/cm at rhoRef
  mtc: number;          // t·m/cm at rhoRef
  cb: number;           // block coefficient
  lwl: number;          // m
}

export interface HydroTable {
  rhoRef: number;
  rows: HydroRow[];
}

/** KN cross curves. kn[i][j] belongs to displacements[i] (t at rhoRef) and angles[j] (deg). */
export interface KNTable {
  rhoRef: number;
  displacements: number[];
  angles: number[];
  kn: number[][];
}

export interface TankCalRow {
  sounding: number; // m
  volume: number;   // m³
  lcg: number;
  tcg: number;
  vcg: number;
  inertia: number;  // transverse free-surface inertia i_T (m⁴)
}

export type TankGroup = 'BALLAST' | 'FUEL_OIL' | 'DIESEL_OIL' | 'LUB_OIL' | 'FRESH_WATER' | 'MISC';

export interface Tank {
  id: string;
  name: string;
  group: TankGroup;
  capacity: number;       // m³ at 100 %
  density: number;        // default liquid density t/m³
  isConsumable: boolean;
  calibration: TankCalRow[];
  /** simple box outline for diagrams: x1,x2,y1,y2,z1,z2 */
  box?: [number, number, number, number, number, number];
}

export interface WindRow {
  draft: number;
  area: number;      // projected lateral area above WL (m²)
  centroidZ: number; // height of area centroid above base (m)
}

export interface Opening {
  name: string;
  x: number;
  y: number;
  z: number;
}

export interface Lightship {
  weight: number;
  lcg: number;
  tcg: number;
  vcg: number;
}

export interface Vessel {
  name: string;
  imo: string;
  callSign: string;
  lbp: number;
  breadth: number;
  depth: number;
  rhoRef: number;
  bilgeType: 'ROUND' | 'SHARP';
  bilgeKeelArea: number; // A_k (m²)
  lightship: Lightship;
  hydro: HydroTable;
  kn: KNTable;
  tanks: Tank[];
  windage: WindRow[];
  openings: Opening[];
  maxDraft?: number;
}

export type TankInput =
  | { mode: 'FILLED' }
  | { mode: 'PERCENT'; value: number }
  | { mode: 'VOLUME'; value: number }
  | { mode: 'WEIGHT'; value: number }
  | { mode: 'SOUNDING'; value: number };

export interface TankStatus {
  input: TankInput;
  density?: number; // overrides tank default
}

export interface WeightItem {
  id: string;
  description: string;
  weight: number;
  lcg: number;
  tcg: number;
  vcg: number;
  windArea?: number;     // extra lateral windage (e.g. deck cargo), m²
  windCentroidZ?: number;
}

export type FsmMethod = 'ACTUAL' | 'MAXIMUM';

export interface LoadCase {
  id: string;
  name: string;
  type: string;
  seaDensity: number;
  fsmMethod: FsmMethod;
  tanks: Record<string, TankStatus>;
  weights: WeightItem[];
  gzMaxAngle?: number; // default 90
  /** Stability criteria groups applied to this load case (ids). Undefined = all built-in groups. */
  criteriaGroups?: string[];
}

// ---------- Results ----------

export interface Warning {
  code: string;
  message: string;
}

export interface TankResult {
  tankId: string;
  name: string;
  mode: TankInput['mode'];
  volume: number;
  weight: number;
  percent: number;
  density: number;
  lcg: number;
  tcg: number;
  vcg: number;
  fsm: number;
}

export interface GzPoint {
  heel: number;
  kn: number;
  kgSin: number;
  tcgCos: number;
  gz: number;
}

export interface CriterionResult {
  code: string;
  description: string;
  regulation: string;
  unit: string;
  comparator: '>=' | '<=';
  required: number;
  actual: number;
  passed: boolean;
  marginAbs: number;
  marginPct: number;
  explanation?: string;
}

export type GroupChart = 'GENERAL' | 'WEATHER';

export interface CriteriaGroupResult {
  id: string;
  name: string;
  regulation: string;
  description: string;
  chart: GroupChart;
  criteria: CriterionResult[];
  passed: boolean;
  /** Set when the group could not be evaluated (the group then fails). */
  error?: string;
}

export interface WeatherDetail {
  P: number; A: number; Z: number; hA: number;
  lw1: number; lw2: number;
  Bd: number; Cb: number; X1: number; X2: number; k: number; r: number; OG: number;
  C: number; Troll: number; s: number;
  theta0: number; theta1: number; thetaR: number; thetaX: number | null; thetaC: number | null; theta2: number;
  areaA: number; areaB: number;
  deckEdgeAngle: number;
}

export interface Results {
  displacement: number;
  deadweight: number;
  lcg: number;
  tcg: number;
  kg: number;
  sumFsm: number;
  fsc: number;
  kgFluid: number;
  draftMean: number; // even keel draft at LCF from hydrostatics
  draftAP: number;
  draftFP: number;
  draftMS: number;
  trim: number;
  heel: number;
  lcb: number;
  lcf: number;
  kmt: number;
  mtc: number;
  tpc: number;
  gmSolid: number;
  gmFluid: number;
  floodAngle: number;          // deg (90 if no openings)
  floodOpening: string | null;
  deckEdgeAngle: number;
  gzMax: number;
  gzMaxAngle: number;
  avs: number | null;
  gzTable: GzPoint[];
  gzCurve: { heel: number; gz: number }[];
  tanks: TankResult[];
  summary: { group: string; weight: number; lcg: number; tcg: number; vcg: number }[];
  criteria: CriterionResult[];        // all evaluated criteria (flat)
  groups: CriteriaGroupResult[];      // applied stability groups, each with its criteria
  weather: WeatherDetail | null;
  warnings: Warning[];
  overallPass: boolean;
}

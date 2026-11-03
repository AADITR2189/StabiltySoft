// Domain types for the StabilitySoft calculation engine.
// Conventions (see docs/A-Calculation-Methods.md §A.1):
//   X from Aft Perpendicular, positive forward (m)
//   Y from centreline, positive to starboard (m)
//   Z from baseline, positive upward (m)
//   Heel positive to starboard, trim positive by the stern.

export interface HydroRow {
  draft: number;        // m (even keel at LCF, or at the table origin for trimmed tables)
  displacement: number; // t at rhoRef
  lcb: number;          // m from AP
  lcf: number;          // m from AP
  kmt: number;          // m
  tpc: number;          // t/cm at rhoRef
  mtc: number;          // t·m/cm at rhoRef
  cb?: number;          // block coefficient (optional; derived if missing)
  lwl?: number;         // m (optional; LBP used if missing)
  kb?: number;
}

export interface HydroTable {
  rhoRef: number;
  rows: HydroRow[];
  /** Optional trimmed tables (free-trim method). Trim + by stern, m over LBP. */
  trims?: { trim: number; rows: HydroRow[] }[];
}

/** KN cross curves. kn[i][j] belongs to displacements[i] (t at rhoRef) and angles[j] (deg). */
export interface KNTable {
  rhoRef: number;
  displacements: number[];
  angles: number[];
  kn: number[][];
  /** Optional KN tables for several static trims (same angles). */
  trims?: { trim: number; displacements: number[]; kn: number[][] }[];
}

export interface TankCalRow {
  sounding?: number; // m (optional: some booklets give only % tables)
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
  /** Height above base of the centre of the underwater lateral area (m). If missing, half the draft is used. */
  underwaterCentroidZ?: number;
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
  /** Load line (summer) draft at midship, m. */
  maxDraft?: number;
  /** Fire-fighting ship data (BV): monitors and transverse thruster, forces in t, heights above base in m. */
  fifi?: { monitorForce: number; monitorCount: number; monitorHeight: number; thrusterForce: number; thrusterHeight: number; maxHeel: number };
  /** Crane operation data: maximum design heel of the crane and wind during lifting. */
  crane?: { maxHeel: number; windSpeedKnots: number; airDensity: number; windCoefficient: number };
  /** Stability groups that apply to this vessel by default (ids). */
  criteriaGroups?: string[];
  /** X (from AP) of the draft origin used by trimmed hydrostatic tables (default LBP/2). */
  draftOriginX?: number;
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
  fsm?: number;          // free surface moment carried by this item (t·m)
}

/** ACTUAL / MAXIMUM from tank tables; MANUAL_TOTAL = a total FSM entered by the user (e.g. as prescribed by the approved booklet). */
export type FsmMethod = 'ACTUAL' | 'MAXIMUM' | 'MANUAL_TOTAL';

export interface LoadCase {
  id: string;
  name: string;
  type: string;
  seaDensity: number;
  fsmMethod: FsmMethod;
  /** Total free surface moment (t·m) when fsmMethod = MANUAL_TOTAL. */
  fsmTotal?: number;
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

/** Drawing hints so each group's diagram can show exactly what its criteria measure. */
export type CriterionViz =
  | { type: 'area'; from: number; to: number }
  | { type: 'hline'; value: number; from: number; label: string }
  | { type: 'vline'; angle: number; label: string };

export interface CriterionResult {
  /** id of the criterion definition */
  id?: string;
  viz?: CriterionViz[];
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

export type GroupChart = 'GENERAL' | 'WEATHER' | 'FIFI' | 'CRANE';

/** Building blocks for user-defined criteria (all measured on the GZ curve towards the side of heel). */
export type CriterionKind =
  | 'AREA'          // area under GZ between two angles (optionally limited by the flooding angle)
  | 'GZ_AT'         // GZ at a given angle
  | 'GZ_MAX_FROM'   // largest GZ at angles ≥ a given angle
  | 'ANGLE_GZMAX'   // angle of maximum GZ
  | 'GM'            // initial metacentric height (corrected for free surface)
  | 'RANGE'         // range of positive stability (AVS − static heel)
  | 'HEEL'          // static heel angle
  | 'SPECIAL';      // engine-defined (OSV area rule, weather, fire-fighting, crane)

export interface CriterionDef {
  id: string;
  name: string;
  kind: CriterionKind;
  comparator: '>=' | '<=';
  required: number;
  params?: { from?: number; to?: number; angle?: number; capAtFlood?: boolean };
  regulation?: string;
  builtin?: boolean;
}

export interface GroupDef {
  id: string;
  name: string;
  regulation: string;
  description: string;
  chart: GroupChart;
  criterionIds: string[];
  builtin?: boolean;
}

export interface CriteriaLibrary {
  criteria: CriterionDef[];
  groups: GroupDef[];
}

export interface FifiDetail {
  monitorMoment: number; thrusterMoment: number; moment: number; arm0: number;
  equilibrium: number; side: 1 | -1;
}

export interface CraneDetail {
  moment: number; lw: number; phi1: number; phi2: number; arl: number; ahl: number;
  areaTo20: number; deckEdgeAngle: number; side: 1 | -1;
}

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
  /** Side the wind acts towards: 1 = starboard, −1 = port (side of the static heel). Angles are given on that side. */
  side: 1 | -1;
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
  /** Side the stability criteria and GZ curve refer to: 1 starboard, −1 port (side of static heel). */
  side: 1 | -1;
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
  fifi: FifiDetail | null;
  crane: CraneDetail | null;
  warnings: Warning[];
  overallPass: boolean;
}

// Built-in criteria and stability groups, defined as data.
// Users can combine any of these criteria (plus their own) into new groups.
import type { CriterionDef, GroupDef } from './types';

export const BUILTIN_CRITERIA: CriterionDef[] = [
  // IS Code 2008 Part A 2.2
  { id: 'IS-2.2.1.1', name: 'Area under GZ curve 0° to 30°', kind: 'AREA', comparator: '>=', required: 0.055, params: { from: 0, to: 30, capAtFlood: true }, regulation: 'IS Code 2008 A 2.2.1' },
  { id: 'IS-2.2.1.2', name: 'Area under GZ curve 0° to 40° or θf', kind: 'AREA', comparator: '>=', required: 0.09, params: { from: 0, to: 40, capAtFlood: true }, regulation: 'IS Code 2008 A 2.2.1' },
  { id: 'IS-2.2.1.3', name: 'Area under GZ curve 30° to 40° or θf', kind: 'AREA', comparator: '>=', required: 0.03, params: { from: 30, to: 40, capAtFlood: true }, regulation: 'IS Code 2008 A 2.2.1' },
  { id: 'IS-2.2.2', name: 'Righting lever GZ at an angle ≥ 30°', kind: 'GZ_MAX_FROM', comparator: '>=', required: 0.2, params: { from: 30 }, regulation: 'IS Code 2008 A 2.2.2' },
  { id: 'IS-2.2.3', name: 'Angle of maximum GZ ≥ 25°', kind: 'ANGLE_GZMAX', comparator: '>=', required: 25, regulation: 'IS Code 2008 A 2.2.3' },
  { id: 'IS-2.2.4', name: 'Initial metacentric height GM₀ ≥ 0.15 m', kind: 'GM', comparator: '>=', required: 0.15, regulation: 'IS Code 2008 A 2.2.4' },
  // OSV equivalent criteria (IS Code 2008 Part B 2.4.5)
  { id: 'OSV-1', name: 'Area 0° to θmax: 0.070 (θmax ≤ 15°) … 0.055 + 0.001·(30 − θmax) … 0.055 (θmax ≥ 30°)', kind: 'SPECIAL', comparator: '>=', required: 0.055, regulation: 'OSV 2.2 / IS 2008 B 2.4.5' },
  { id: 'OSV-2', name: 'Area under GZ curve 0° to 40° or θf', kind: 'AREA', comparator: '>=', required: 0.09, params: { from: 0, to: 40, capAtFlood: true }, regulation: 'OSV 2.2 / IS 2008 B 2.4.5' },
  { id: 'OSV-3', name: 'Area under GZ curve 30° to 40° or θf', kind: 'AREA', comparator: '>=', required: 0.03, params: { from: 30, to: 40, capAtFlood: true }, regulation: 'OSV 2.2 / IS 2008 B 2.4.5' },
  { id: 'OSV-4', name: 'Righting lever GZ at an angle ≥ 30°', kind: 'GZ_MAX_FROM', comparator: '>=', required: 0.2, params: { from: 30 }, regulation: 'OSV 2.2 / IS 2008 B 2.4.5' },
  { id: 'OSV-5', name: 'Angle of maximum GZ ≥ 15°', kind: 'ANGLE_GZMAX', comparator: '>=', required: 15, regulation: 'OSV 2.2 / IS 2008 B 2.4.5' },
  { id: 'OSV-6', name: 'Initial metacentric height GM₀ ≥ 0.15 m', kind: 'GM', comparator: '>=', required: 0.15, regulation: 'OSV 2.2 / IS 2008 B 2.4.5' },
  // IS Code 2008 Part A 2.3
  { id: 'IS-2.3-HEEL', name: 'Steady wind heel θ₀ ≤ 16° or 0.8 × deck edge angle', kind: 'SPECIAL', comparator: '<=', required: 16, regulation: 'IS Code 2008 A 2.3.1' },
  { id: 'IS-2.3-AREA', name: 'Weather criterion: area b ≥ area a', kind: 'SPECIAL', comparator: '>=', required: 0, regulation: 'IS Code 2008 A 2.3.1' },
  // BV fire-fighting ship
  { id: 'FIFI-1', name: 'Heel at equilibrium under water-jet reaction and thruster < 5°', kind: 'SPECIAL', comparator: '<=', required: 5, regulation: 'BV Fire-fighting ships' },
  // IS Code 2008 Part B 2.9.4 lifting operations
  { id: 'CRANE-1', name: 'Equilibrium heel with crane load and wind ≤ crane design heel', kind: 'SPECIAL', comparator: '<=', required: 5, regulation: 'IS 2008 B 2.9.3.2.1' },
  { id: 'CRANE-2', name: 'Area ratio ARL / AHL ≥ 1.4 (equilibrium to φ2)', kind: 'SPECIAL', comparator: '>=', required: 1.4, regulation: 'IS 2008 B 2.9.4.1.2' },
  { id: 'CRANE-3', name: 'Residual area from equilibrium to 20° or θf ≥ 0.03 m·rad', kind: 'SPECIAL', comparator: '>=', required: 0.03, regulation: 'IS 2008 B 2.9.4.1.2' },
  { id: 'CRANE-4', name: 'Deck edge not immersed at equilibrium', kind: 'SPECIAL', comparator: '>=', required: 0, regulation: 'IS 2008 B 2.9.4.1.2' },
  { id: 'CRANE-5', name: 'Freeboard to highest continuous deck at equilibrium ≥ 0.50 m (sheltered) / max(1.0 m, 0.75·Hs) (exposed)', kind: 'SPECIAL', comparator: '>=', required: 0.5, regulation: 'IS 2008 B 2.9.3.2.2 / .3' },
  // IS Code 2008 Part A 3.1 passenger ships
  { id: 'PAX-1', name: 'Heel due to passenger crowding to one side ≤ 10°', kind: 'SPECIAL', comparator: '<=', required: 10, regulation: 'IS Code 2008 A 3.1' },
  { id: 'PAX-2', name: 'Heel due to turning, M_R = 0.200·(v0²/L_WL)·Δ·(KG − d/2), ≤ 10°', kind: 'SPECIAL', comparator: '<=', required: 10, regulation: 'IS Code 2008 A 3.1' },
  // International Grain Code (IS Code 2008 A 3.4)
  { id: 'GRAIN-1', name: 'Heel due to grain shift ≤ 12° (or deck-edge immersion angle if less)', kind: 'SPECIAL', comparator: '<=', required: 12, regulation: 'International Grain Code A 7' },
  { id: 'GRAIN-2', name: 'Residual area (GZ − grain heeling arm) to 40°, θf or angle of maximum difference ≥ 0.075 m·rad', kind: 'SPECIAL', comparator: '>=', required: 0.075, regulation: 'International Grain Code A 7' },
  { id: 'GRAIN-3', name: 'Initial GM₀ ≥ 0.30 m (grain)', kind: 'GM', comparator: '>=', required: 0.3, regulation: 'International Grain Code A 7' },
  // IS Code 2008 Part B 2.2 pontoons
  { id: 'PONT-1', name: 'Area under GZ up to the angle of maximum GZ ≥ 0.08 m·rad', kind: 'SPECIAL', comparator: '>=', required: 0.08, regulation: 'IS Code 2008 B 2.2' },
  { id: 'PONT-2', name: 'Static heel under 540 N/m² wind ≤ angle immersing half the freeboard', kind: 'SPECIAL', comparator: '<=', required: 0, regulation: 'IS Code 2008 B 2.2' },
  { id: 'PONT-3', name: 'Range of stability ≥ 20°', kind: 'RANGE', comparator: '>=', required: 20, regulation: 'IS Code 2008 B 2.2' },
  // MODU Code 2009
  { id: 'MODU-1', name: 'Area under righting moment to 2nd intercept or θf ≥ 1.4 (surface / self-elevating) or 1.3 (column-stabilised) × wind heeling area', kind: 'SPECIAL', comparator: '>=', required: 1.4, regulation: 'MODU Code 2009 3.4' },
  { id: 'MODU-2', name: 'Righting moment positive from upright to the 2nd intercept', kind: 'SPECIAL', comparator: '>=', required: 0, regulation: 'MODU Code 2009 3.4' },
  // IMO A.167(ES.IV), 1968 (superseded)
  { id: 'A167-1', name: 'Area under GZ curve 0° to 30°', kind: 'AREA', comparator: '>=', required: 0.055, params: { from: 0, to: 30, capAtFlood: true }, regulation: 'IMO A.167(ES.IV)' },
  { id: 'A167-2', name: 'Area under GZ curve 0° to 40° or θf', kind: 'AREA', comparator: '>=', required: 0.09, params: { from: 0, to: 40, capAtFlood: true }, regulation: 'IMO A.167(ES.IV)' },
  { id: 'A167-3', name: 'Area under GZ curve 30° to 40° or θf', kind: 'AREA', comparator: '>=', required: 0.03, params: { from: 30, to: 40, capAtFlood: true }, regulation: 'IMO A.167(ES.IV)' },
  { id: 'A167-4', name: 'Righting lever GZ at an angle ≥ 30°', kind: 'GZ_MAX_FROM', comparator: '>=', required: 0.2, params: { from: 30 }, regulation: 'IMO A.167(ES.IV)' },
  { id: 'A167-5', name: 'Angle of maximum GZ ≥ 25° (preferably > 30°)', kind: 'ANGLE_GZMAX', comparator: '>=', required: 25, regulation: 'IMO A.167(ES.IV)' },
  { id: 'A167-6', name: 'Initial metacentric height GM₀ ≥ 0.15 m', kind: 'GM', comparator: '>=', required: 0.15, regulation: 'IMO A.167(ES.IV)' },
].map((c) => ({ ...(c as CriterionDef), builtin: true }));

export const BUILTIN_GROUPS: GroupDef[] = [
  {
    id: 'IS2008_GENERAL', name: 'IS Code 2008: General Criteria', regulation: 'IMO IS Code 2008, Part A, 2.2',
    description: 'Areas under the GZ curve, minimum righting lever, angle of maximum GZ and initial GM.',
    chart: 'GENERAL', criterionIds: ['IS-2.2.1.1', 'IS-2.2.1.2', 'IS-2.2.1.3', 'IS-2.2.2', 'IS-2.2.3', 'IS-2.2.4'],
  },
  {
    id: 'OSV_INTACT', name: 'OSV Intact Criteria (IS Code 2008 equivalent)', regulation: 'IS Code 2008 Part B 2.4.5 / OSV Chemical Code Ch.2, 2.2',
    description: 'Equivalent criteria for offshore supply vessels: area to the angle of maximum GZ, maximum GZ at 15° or more.',
    chart: 'GENERAL', criterionIds: ['OSV-1', 'OSV-2', 'OSV-3', 'OSV-4', 'OSV-5', 'OSV-6'],
  },
  {
    id: 'IS2008_WEATHER', name: 'IS Code 2008: Weather Criterion', regulation: 'IMO IS Code 2008, Part A, 2.3',
    description: 'Severe wind and rolling: steady wind heel and the balance of areas a and b under gust wind.',
    chart: 'WEATHER', criterionIds: ['IS-2.3-HEEL', 'IS-2.3-AREA'],
  },
  {
    id: 'BV_FIFI', name: 'Fire-Fighting Operation Criterion', regulation: 'Bureau Veritas, fire-fighting ships',
    description: 'Water-jet reaction of the monitors and transverse thruster in the beam direction: equilibrium heel below 5°.',
    chart: 'FIFI', criterionIds: ['FIFI-1'],
  },
  {
    id: 'CRANE_OPS', name: 'Crane Operation Criteria', regulation: 'IS Code 2008 Part B 2.9.3 / 2.9.4 (MSC.415(97))',
    description: 'Lifting with crane and load at the most unfavourable position, with wind during the lift.',
    chart: 'CRANE', criterionIds: ['CRANE-1', 'CRANE-2', 'CRANE-3', 'CRANE-4'],
  },
  {
    id: 'LIFT_293', name: 'Lifting Operations (IS Code B 2.9.3)', regulation: 'IS Code 2008 Part B 2.9.3 (MSC.415(97))',
    description: 'Crane and load in the loading condition: equilibrium heel within the crane design heel and minimum freeboard. Use together with the General and Weather groups.',
    chart: 'CRANE', criterionIds: ['CRANE-1', 'CRANE-5'],
  },
  {
    id: 'IS2008_PAX', name: 'Passenger Ships (IS Code 2008 A 3.1)', regulation: 'IMO IS Code 2008, Part A, 3.1',
    description: 'Heel due to passengers crowding to one side and heel due to turning, each ≤ 10°. Enter passengers and service speed in the load case.',
    chart: 'GENERAL', criterionIds: ['PAX-1', 'PAX-2'],
  },
  {
    id: 'GRAIN', name: 'Grain in Bulk (International Grain Code)', regulation: 'IS Code 2008 A 3.4 / International Grain Code A 7',
    description: 'Grain shift heeling arm λ0 = Σ(VHM / SF) / Δ, λ40 = 0.8·λ0. Enter the holds in the load case.',
    chart: 'GENERAL', criterionIds: ['GRAIN-1', 'GRAIN-2', 'GRAIN-3'],
  },
  {
    id: 'PONTOON', name: 'Pontoons (IS Code 2008 B 2.2)', regulation: 'IMO IS Code 2008, Part B, 2.2',
    description: 'Unmanned non-propelled pontoons: area to θmax, wind heel under 540 N/m², range of stability.',
    chart: 'GENERAL', criterionIds: ['PONT-1', 'PONT-2', 'PONT-3'],
  },
  {
    id: 'MODU', name: 'Mobile Offshore Drilling Units (MODU Code 2009)', regulation: 'MODU Code 2009, Chapter 3',
    description: 'Righting energy against wind heeling energy (36 m/s operating, 51.5 m/s severe storm). Enter unit type, wind speed and wind coefficient in the load case.',
    chart: 'GENERAL', criterionIds: ['MODU-1', 'MODU-2'],
  },
  {
    id: 'IMO_A167', name: 'IMO A.167(ES.IV), 1968 (superseded)', regulation: 'IMO Res. A.167(ES.IV)',
    description: 'Original general intact criteria, for existing ships approved under this resolution and for comparison.',
    chart: 'GENERAL', criterionIds: ['A167-1', 'A167-2', 'A167-3', 'A167-4', 'A167-5', 'A167-6'],
  },
  {
    id: 'IMO_A749', name: 'IMO A.749(18) IS Code 1993 (superseded)', regulation: 'IMO Res. A.749(18) as amended by MSC.75(69)',
    description: 'General and weather criteria of the 1993 IS Code (numerically the same as IS Code 2008 Part A 2.2 and 2.3).',
    chart: 'GENERAL', criterionIds: ['IS-2.2.1.1', 'IS-2.2.1.2', 'IS-2.2.1.3', 'IS-2.2.2', 'IS-2.2.3', 'IS-2.2.4', 'IS-2.3-HEEL', 'IS-2.3-AREA'],
  },
].map((g) => ({ ...(g as GroupDef), builtin: true }));

export const DEFAULT_GROUP_IDS = ['IS2008_GENERAL', 'IS2008_WEATHER'];

export const EMPTY_LIBRARY = { criteria: [] as CriterionDef[], groups: [] as GroupDef[] };

/** Human-readable descriptions of the building blocks for user-defined criteria. */
export const CRITERION_KINDS: { kind: Exclude<CriterionDef['kind'], 'SPECIAL'>; label: string; unit: string; comparator: '>=' | '<='; fields: ('from' | 'to' | 'angle' | 'capAtFlood' | 'moment')[] }[] = [
  { kind: 'AREA', label: 'Area under GZ curve between two angles', unit: 'm·rad', comparator: '>=', fields: ['from', 'to', 'capAtFlood'] },
  { kind: 'GZ_AT', label: 'Righting lever GZ at an angle', unit: 'm', comparator: '>=', fields: ['angle'] },
  { kind: 'GZ_MAX_FROM', label: 'Largest GZ at or beyond an angle', unit: 'm', comparator: '>=', fields: ['from'] },
  { kind: 'ANGLE_GZMAX', label: 'Angle of maximum GZ', unit: '°', comparator: '>=', fields: [] },
  { kind: 'GM', label: 'Initial metacentric height GM (fluid)', unit: 'm', comparator: '>=', fields: [] },
  { kind: 'RANGE', label: 'Range of positive stability', unit: '°', comparator: '>=', fields: [] },
  { kind: 'HEEL', label: 'Static heel angle (maximum)', unit: '°', comparator: '<=', fields: [] },
  { kind: 'HEEL_MOMENT', label: 'Heel at equilibrium under a heeling moment', unit: '°', comparator: '<=', fields: ['moment'] },
  { kind: 'RESID_AREA', label: 'Residual area (GZ − heeling arm) from equilibrium to an angle', unit: 'm·rad', comparator: '>=', fields: ['moment', 'to', 'capAtFlood'] },
  { kind: 'RESID_GZMAX', label: 'Largest residual arm (GZ − heeling arm)', unit: 'm', comparator: '>=', fields: ['moment'] },
  { kind: 'ARM_GZMAX_RATIO', label: 'Heeling arm at equilibrium ÷ maximum GZ (e.g. DDS 079-1: ≤ 0.6)', unit: '', comparator: '<=', fields: ['moment'] },
  { kind: 'RESERVE_RATIO', label: 'Reserve area ratio A1 ÷ A2 with roll-back angle (e.g. DDS 079-1: ≥ 1.4)', unit: '', comparator: '>=', fields: ['moment', 'angle', 'to', 'capAtFlood'] },
];

/** Load case values a moment formula symbol can be linked to. */
export const MOMENT_SOURCES: { source: import('./types').MomentSource; label: string; unit: string; guess: RegExp }[] = [
  { source: 'HEEL', label: 'Heel angle θ (each GZ angle)', unit: '°', guess: /^(theta|θ|phi|φ|heel)$/i },
  { source: 'DISPLACEMENT', label: 'Displacement Δ', unit: 't', guess: /^(disp|displacement|delta|Δ|W|D)$/ },
  { source: 'DRAFT_MS', label: 'Draft at midship', unit: 'm', guess: /^(T|d|draft|Tm)$/ },
  { source: 'DRAFT_MEAN', label: 'Mean draft (AP+FP)/2', unit: 'm', guess: /^(Tmean|dmean)$/i },
  { source: 'DRAFT_AP', label: 'Draft at AP', unit: 'm', guess: /^(Ta|TAP)$/i },
  { source: 'DRAFT_FP', label: 'Draft at FP', unit: 'm', guess: /^(Tf|TFP)$/i },
  { source: 'VCB', label: 'VCB (KB)', unit: 'm', guess: /^(VCB|KB)$/i },
  { source: 'KG', label: 'KG / VCG (solid)', unit: 'm', guess: /^(KG|VCG)$/i },
  { source: 'KG_FLUID', label: 'KG corrected for free surface', unit: 'm', guess: /^(KGf|KGo|KG0)$/i },
  { source: 'TCG', label: 'TCG', unit: 'm', guess: /^TCG$/i },
  { source: 'LCG', label: 'LCG (from AP)', unit: 'm', guess: /^LCG$/i },
  { source: 'GM', label: 'GM fluid', unit: 'm', guess: /^GM$/i },
  { source: 'KM', label: 'KM', unit: 'm', guess: /^(KM|KMT)$/i },
  { source: 'TRIM', label: 'Trim (+ by stern)', unit: 'm', guess: /^trim$/i },
  { source: 'STATIC_HEEL', label: 'Static heel of the load case', unit: '°', guess: /^$/ },
];

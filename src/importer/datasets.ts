// What can be imported, field by field. Each field knows its unit, whether it is a longitudinal (X)
// or transverse (Y) position (those get the reference / sign conversion), and header words used to
// guess the column automatically.
export type DatasetKind = 'HYDRO' | 'KN' | 'TANK' | 'WINDAGE' | 'OPENINGS' | 'WEIGHTS' | 'LIGHTSHIP';

export interface FieldDef {
  key: string;
  label: string;
  unit: string;
  required: boolean;
  type: 'num' | 'text';
  pos?: 'X' | 'Y';
  /** Only used for checks, not stored (e.g. weight of a tank row = volume × density). */
  checkOnly?: boolean;
  guess: RegExp;
}

export interface DatasetDef {
  kind: DatasetKind;
  label: string;
  help: string;
  fields: FieldDef[];
  /** KN: one column per heel angle in addition to the fields */
  angleColumns?: boolean;
}

export const DATASETS: DatasetDef[] = [
  {
    kind: 'HYDRO', label: 'Hydrostatic table', help: 'One row per draft. Import one table per trim (trim 0 = even keel).',
    fields: [
      { key: 'draft', label: 'Draft', unit: 'm', required: true, type: 'num', guess: /draft|^t\b|^d\b/i },
      { key: 'displacement', label: 'Displacement Δ', unit: 't', required: true, type: 'num', guess: /disp|Δ|delta/i },
      { key: 'lcb', label: 'LCB', unit: 'm', required: true, type: 'num', pos: 'X', guess: /lcb/i },
      { key: 'lcf', label: 'LCF', unit: 'm', required: true, type: 'num', pos: 'X', guess: /lcf/i },
      { key: 'kmt', label: 'KMT', unit: 'm', required: true, type: 'num', guess: /kmt|km\b|km\s*\(/i },
      { key: 'tpc', label: 'TPC', unit: 't/cm', required: true, type: 'num', guess: /tpc|tp\s*cm|tpcm|t\/cm/i },
      { key: 'mtc', label: 'MTC', unit: 't·m/cm', required: true, type: 'num', guess: /mtc|mt\s*cm|mtcm|mct/i },
      { key: 'kb', label: 'KB (VCB)', unit: 'm', required: false, type: 'num', guess: /kb|vcb/i },
      { key: 'cb', label: 'Block coefficient C_B', unit: '', required: false, type: 'num', guess: /cb\b|block/i },
    ],
  },
  {
    kind: 'KN', label: 'Cross curves (KN)', help: 'One row per displacement, one column per heel angle. Import one table per trim.',
    angleColumns: true,
    fields: [{ key: 'displacement', label: 'Displacement Δ', unit: 't', required: true, type: 'num', guess: /disp|Δ|delta/i }],
  },
  {
    kind: 'TANK', label: 'Tank calibration (one tank)', help: 'Sounding / ullage table of one tank: volume and centres for each filling.',
    fields: [
      { key: 'sounding', label: 'Sounding', unit: 'm', required: false, type: 'num', guess: /sound|level|height|ullage/i },
      { key: 'volume', label: 'Volume', unit: 'm³', required: true, type: 'num', guess: /vol/i },
      { key: 'lcg', label: 'LCG', unit: 'm', required: true, type: 'num', pos: 'X', guess: /lcg/i },
      { key: 'tcg', label: 'TCG', unit: 'm', required: true, type: 'num', pos: 'Y', guess: /tcg/i },
      { key: 'vcg', label: 'VCG', unit: 'm', required: true, type: 'num', guess: /vcg|kg\b/i },
      { key: 'inertia', label: 'Free-surface inertia i_T', unit: 'm⁴', required: false, type: 'num', guess: /inert|\bi[tx]?\b|m4|m⁴/i },
      { key: 'fsm', label: 'Free surface moment (at tank density)', unit: 't·m', required: false, type: 'num', guess: /fsm|free\s*surf/i },
      { key: 'percent', label: 'Filling % (check only)', unit: '%', required: false, type: 'num', checkOnly: true, guess: /%|load|fill|perc/i },
      { key: 'weight', label: 'Weight (check only)', unit: 't', required: false, type: 'num', checkOnly: true, guess: /weight|mass|\bwt\b|\(mt\)/i },
    ],
  },
  {
    kind: 'WINDAGE', label: 'Windage (lateral area)', help: 'Projected lateral area above the waterline for each draft.',
    fields: [
      { key: 'draft', label: 'Draft', unit: 'm', required: true, type: 'num', guess: /draft/i },
      { key: 'area', label: 'Lateral area A', unit: 'm²', required: true, type: 'num', guess: /area/i },
      { key: 'centroidZ', label: 'Centroid height above base', unit: 'm', required: true, type: 'num', guess: /cent|vcg|z\b|lever|height/i },
      { key: 'underwaterCentroidZ', label: 'Underwater centroid above base', unit: 'm', required: false, type: 'num', guess: /under|below/i },
    ],
  },
  {
    kind: 'OPENINGS', label: 'Down-flooding openings', help: 'Name and position of each unprotected opening.',
    fields: [
      { key: 'name', label: 'Opening', unit: '', required: true, type: 'text', guess: /name|open|point|desc|pos/i },
      { key: 'x', label: 'X (longitudinal)', unit: 'm', required: true, type: 'num', pos: 'X', guess: /^x|long|lcg/i },
      { key: 'y', label: 'Y (transverse)', unit: 'm', required: true, type: 'num', pos: 'Y', guess: /^y|trans|tcg/i },
      { key: 'z', label: 'Z (height above base)', unit: 'm', required: true, type: 'num', guess: /^z|vert|height|vcg/i },
    ],
  },
  {
    kind: 'LIGHTSHIP', label: 'Lightship: table of weight items', help: 'Lightship weight breakdown (hull, machinery, outfit …). The software adds up the items; a "total" line in the table is used only to check the sum.',
    fields: [
      { key: 'description', label: 'Item', unit: '', required: false, type: 'text', guess: /item|desc|name|group|component/i },
      { key: 'weight', label: 'Weight', unit: 't', required: true, type: 'num', guess: /weight|mass|\bwt\b|tonn|\(t\)|\(mt\)/i },
      { key: 'lcg', label: 'LCG', unit: 'm', required: true, type: 'num', pos: 'X', guess: /lcg/i },
      { key: 'tcg', label: 'TCG', unit: 'm', required: false, type: 'num', pos: 'Y', guess: /tcg/i },
      { key: 'vcg', label: 'VCG', unit: 'm', required: true, type: 'num', guess: /vcg|kg\b/i },
    ],
  },
  {
    kind: 'WEIGHTS', label: 'Load case weights', help: 'Deadweight items (cargo, stores, crew). They are added to the selected load case.',
    fields: [
      { key: 'description', label: 'Item', unit: '', required: true, type: 'text', guess: /item|desc|name/i },
      { key: 'weight', label: 'Weight', unit: 't', required: true, type: 'num', guess: /weight|mass|\bwt\b|tonn/i },
      { key: 'lcg', label: 'LCG', unit: 'm', required: true, type: 'num', pos: 'X', guess: /lcg/i },
      { key: 'tcg', label: 'TCG', unit: 'm', required: true, type: 'num', pos: 'Y', guess: /tcg/i },
      { key: 'vcg', label: 'VCG', unit: 'm', required: true, type: 'num', guess: /vcg|kg\b/i },
    ],
  },
];

export const datasetDef = (k: DatasetKind) => DATASETS.find((d) => d.kind === k)!;

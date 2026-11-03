// Whole-database file: your vessels, every load case and your criteria library in one JSON file,
// sealed with a SHA-256 checksum so a damaged or hand-edited file is detected on import.
import { ENGINE_VERSION } from '../engine/stability';
import type { CriteriaLibrary, LoadCase, Vessel } from '../engine/types';
import type { Provenance } from './apply';
import { sha256Hex } from './sources';

export const DB_FORMAT = 'StabilitySoft database';
export const DB_VERSION = 1;

export interface UserVesselEntry {
  id: string;
  vessel: Vessel;
  source: string;
  createdAt: string;
  provenance: Record<string, Provenance>;
}

export interface DbData {
  vessels: UserVesselEntry[];
  loadCases: Record<string, LoadCase[]>;
  library: CriteriaLibrary;
}

export interface DbFile {
  format: typeof DB_FORMAT;
  version: number;
  createdAt: string;
  engine: string;
  summary: { vessels: number; loadCases: number; criteria: number; groups: number; moments: number };
  sha256: string;
  data: DbData;
}

export async function buildDbFile(data: DbData): Promise<string> {
  const body = JSON.stringify(data);
  const file: DbFile = {
    format: DB_FORMAT, version: DB_VERSION, createdAt: new Date().toISOString(), engine: ENGINE_VERSION,
    summary: summarize(data), sha256: await sha256Hex(body), data,
  };
  return JSON.stringify(file, null, 1);
}

export function summarize(d: DbData) {
  return {
    vessels: d.vessels.length,
    loadCases: Object.values(d.loadCases).reduce((s, x) => s + x.length, 0),
    criteria: d.library.criteria.length, groups: d.library.groups.length, moments: d.library.moments?.length ?? 0,
  };
}

const isNum = (x: unknown) => typeof x === 'number' && Number.isFinite(x);

export function validateVessel(v: unknown, label: string): string[] {
  const e: string[] = [];
  const o = v as Partial<Vessel> | null;
  if (!o || typeof o !== 'object') return [`${label}: not a vessel record`];
  if (typeof o.name !== 'string' || !o.name) e.push(`${label}: name missing`);
  for (const k of ['lbp', 'breadth', 'depth', 'rhoRef'] as const) if (!isNum(o[k])) e.push(`${label}: ${k} is not a number`);
  if (!o.lightship || !['weight', 'lcg', 'tcg', 'vcg'].every((k) => isNum((o.lightship as unknown as Record<string, unknown>)[k]))) e.push(`${label}: lightship incomplete`);
  if (!o.hydro || !Array.isArray(o.hydro.rows)) e.push(`${label}: hydrostatic table missing`);
  if (!o.kn || !Array.isArray(o.kn.displacements) || !Array.isArray(o.kn.angles) || !Array.isArray(o.kn.kn)) e.push(`${label}: KN table missing`);
  else if (o.kn.kn.length !== o.kn.displacements.length) e.push(`${label}: KN rows do not match displacements`);
  for (const k of ['tanks', 'windage', 'openings'] as const) if (!Array.isArray(o[k])) e.push(`${label}: ${k} missing`);
  o.hydro?.rows?.forEach((r, i) => { if (!['draft', 'displacement', 'lcb', 'lcf', 'kmt', 'tpc', 'mtc'].every((k) => isNum((r as unknown as Record<string, unknown>)[k]))) e.push(`${label}: hydrostatic row ${i + 1} incomplete`); });
  o.tanks?.forEach((t) => { if (!t || !Array.isArray(t.calibration)) e.push(`${label}: tank ${t?.name ?? '?'} has no calibration`); });
  return e;
}

export function validateLoadCase(lc: unknown, label: string): string[] {
  const o = lc as Partial<LoadCase> | null;
  if (!o || typeof o !== 'object') return [`${label}: not a load case`];
  const e: string[] = [];
  if (typeof o.id !== 'string' || typeof o.name !== 'string') e.push(`${label}: id or name missing`);
  if (!isNum(o.seaDensity)) e.push(`${label}: sea density missing`);
  if (!o.tanks || typeof o.tanks !== 'object') e.push(`${label}: tank status missing`);
  if (!Array.isArray(o.weights)) e.push(`${label}: weights missing`);
  else o.weights.forEach((w, i) => { if (!['weight', 'lcg', 'tcg', 'vcg'].every((k) => isNum((w as unknown as Record<string, unknown>)[k]))) e.push(`${label}: weight item ${i + 1} incomplete`); });
  return e;
}

export interface DbPreview {
  file: DbFile;
  checksumOk: boolean;
  errors: string[];
  warnings: string[];
}

export async function readDbFile(text: string, knownVesselIds: string[]): Promise<DbPreview> {
  let file: DbFile;
  try { file = JSON.parse(text) as DbFile; } catch { throw new Error('This file is not a StabilitySoft database (not valid JSON).'); }
  if (!file || file.format !== DB_FORMAT || !file.data) throw new Error('This file is not a StabilitySoft database file.');
  if (typeof file.version !== 'number' || file.version > DB_VERSION) throw new Error(`Database file version ${file.version} is newer than this software understands (${DB_VERSION}). Update the software first.`);
  const errors: string[] = [], warnings: string[] = [];
  const checksumOk = (await sha256Hex(JSON.stringify(file.data))) === file.sha256;
  if (!checksumOk) errors.push('Checksum does not match: the file was changed or damaged after it was saved.');
  const d = file.data;
  if (!Array.isArray(d.vessels)) errors.push('Vessel list missing'); else d.vessels.forEach((v, i) => errors.push(...validateVessel(v?.vessel, `Vessel ${i + 1} (${v?.vessel?.name ?? '?'})`)));
  if (!d.loadCases || typeof d.loadCases !== 'object') errors.push('Load cases missing');
  else for (const [vid, cs] of Object.entries(d.loadCases)) {
    if (!Array.isArray(cs)) { errors.push(`Load cases of ${vid}: not a list`); continue; }
    if (!knownVesselIds.includes(vid) && !d.vessels?.some((v) => v.id === vid)) warnings.push(`${cs.length} load case(s) belong to a vessel not in this file or software (${vid}); they will be skipped.`);
    cs.forEach((lc, i) => errors.push(...validateLoadCase(lc, `Load case ${i + 1} of ${vid}`)));
  }
  if (!d.library || !Array.isArray(d.library.criteria) || !Array.isArray(d.library.groups)) errors.push('Criteria library missing');
  const s = summarize({ vessels: d.vessels ?? [], loadCases: d.loadCases ?? {}, library: d.library ?? { criteria: [], groups: [] } });
  if (file.summary && JSON.stringify(file.summary) !== JSON.stringify(s)) errors.push('Content counts differ from the summary written in the file.');
  return { file, checksumOk, errors, warnings };
}

/** Merge = add new items, replace items with the same id. Replace = imported content only. */
export function mergeDb(cur: DbData, inc: DbData, mode: 'MERGE' | 'REPLACE', builtinIds: string[]): DbData {
  const vesselIds = new Set([...builtinIds, ...inc.vessels.map((v) => v.id), ...(mode === 'MERGE' ? cur.vessels.map((v) => v.id) : [])]);
  const loadCases: Record<string, LoadCase[]> = mode === 'MERGE' ? structuredClone(cur.loadCases) : {};
  for (const [vid, cs] of Object.entries(inc.loadCases)) {
    if (!vesselIds.has(vid)) continue;
    const base = loadCases[vid] ?? [];
    loadCases[vid] = [...base.filter((c) => !cs.some((x) => x.id === c.id)), ...cs];
  }
  const byId = <T extends { id: string }>(a: T[], b: T[]) => [...a.filter((x) => !b.some((y) => y.id === x.id)), ...b];
  return mode === 'REPLACE'
    ? { vessels: inc.vessels, loadCases, library: inc.library }
    : {
      vessels: byId(cur.vessels, inc.vessels),
      loadCases,
      library: { criteria: byId(cur.library.criteria, inc.library.criteria), groups: byId(cur.library.groups, inc.library.groups), moments: byId(cur.library.moments ?? [], inc.library.moments ?? []) },
    };
}

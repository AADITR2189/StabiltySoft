// One load case as a portable file (JSON with a SHA-256 checksum), and reading it back into a vessel.
import type { LoadCase, Vessel } from '../engine/types';
import { ENGINE_VERSION } from '../engine/stability';
import { validateLoadCase } from './dbFile';
import { sha256Hex } from './sources';

export const LC_FORMAT = 'StabilitySoft load case';

export async function buildLoadCaseFile(v: Vessel, lc: LoadCase): Promise<string> {
  const body = JSON.stringify(lc);
  return JSON.stringify({ format: LC_FORMAT, version: 1, createdAt: new Date().toISOString(), engine: ENGINE_VERSION, vessel: { name: v.name, imo: v.imo }, sha256: await sha256Hex(body), loadCase: lc }, null, 1);
}

export interface LoadCaseImport { lc: LoadCase; errors: string[]; warnings: string[] }

export async function readLoadCaseFile(text: string, v: Vessel, newId: () => string): Promise<LoadCaseImport> {
  let f: { format?: string; version?: number; vessel?: { name: string; imo: string }; sha256?: string; loadCase?: LoadCase };
  try { f = JSON.parse(text); } catch { throw new Error('This file is not a StabilitySoft load case (not valid JSON).'); }
  if (!f || f.format !== LC_FORMAT || !f.loadCase) throw new Error('This file is not a StabilitySoft load case file.');
  const errors: string[] = [], warnings: string[] = [];
  if ((await sha256Hex(JSON.stringify(f.loadCase))) !== f.sha256) errors.push('Checksum does not match: the file was changed or damaged after it was saved.');
  errors.push(...validateLoadCase(f.loadCase, 'Load case'));
  if (f.vessel && (f.vessel.imo !== v.imo || f.vessel.name !== v.name)) warnings.push(`The file was saved for ${f.vessel.name} (IMO ${f.vessel.imo}); it is being read into ${v.name} (IMO ${v.imo}).`);
  const lc = structuredClone(f.loadCase);
  const known = new Set(v.tanks.map((t) => t.id));
  const unknown = Object.keys(lc.tanks ?? {}).filter((k) => !known.has(k));
  const filled = unknown.filter((k) => { const i = lc.tanks[k].input; return i.mode === 'FILLED' || i.value > 0; });
  if (filled.length) errors.push(`Tanks with contents that this vessel does not have: ${filled.join(', ')}.`);
  else if (unknown.length) warnings.push(`${unknown.length} empty tank(s) not in this vessel were left out.`);
  for (const k of unknown) delete lc.tanks[k];
  const missing = v.tanks.filter((t) => !lc.tanks[t.id]).map((t) => t.name);
  if (missing.length) warnings.push(`${missing.length} tank(s) of this vessel are not in the file and are set empty: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' …' : ''}.`);
  for (const t of v.tanks) if (!lc.tanks[t.id]) lc.tanks[t.id] = { input: { mode: 'PERCENT', value: 0 } };
  lc.id = newId();
  lc.weights = (lc.weights ?? []).map((w) => ({ ...w, id: newId() }));
  return { lc, errors, warnings };
}

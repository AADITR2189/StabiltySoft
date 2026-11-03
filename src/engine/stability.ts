// Intact stability calculation (docs/A-Calculation-Methods.md §A.3 – §A.10).
import {
  DEG, EngineError, assertIncreasing, firstCrossing, integrateDeg, kahanSum, lerp, pchip, tableFactor,
} from './math';
import { resolveTank } from './tanks';
import type {
  CraneDetail, CriteriaGroupResult, CriteriaLibrary, CriterionDef, CriterionResult, FifiDetail, GzPoint, LoadCase,
  Results, TankResult, Vessel, Warning, WeatherDetail,
} from './types';
import { BUILTIN_CRITERIA, BUILTIN_GROUPS, DEFAULT_GROUP_IDS, EMPTY_LIBRARY } from './criteriaGroups';
import { knAtCondition, solveHydrostatics } from './hydro';
import { evaluate, parseFormula } from './formula';
import type { MomentDef, MomentResult, GroupTableRow } from './types';

export const ENGINE_VERSION = '0.1.0';
const G = 9.81;
const WIND_P = 504; // N/m², unrestricted service

export function calculate(vessel: Vessel, lc: LoadCase, library: CriteriaLibrary = EMPTY_LIBRARY): Results {
  const warnings: Warning[] = [];
  if (!(lc.seaDensity > 0)) throw new EngineError('INVALID_DENSITY', 'Sea water density must be greater than 0.');

  // ---------- §A.4 Tanks ----------
  const tanks: TankResult[] = vessel.tanks.map((t) => resolveTank(t, lc.tanks[t.id], lc.fsmMethod, warnings));

  // ---------- §A.3 Summation ----------
  type Item = { group: string; w: number; x: number; y: number; z: number };
  const items: Item[] = [
    { group: 'Lightship', w: vessel.lightship.weight, x: vessel.lightship.lcg, y: vessel.lightship.tcg, z: vessel.lightship.vcg },
    ...tanks.map((t) => ({ group: 'Tanks', w: t.weight, x: t.lcg, y: t.tcg, z: t.vcg })),
    ...lc.weights.map((w) => ({ group: 'Variable weights', w: w.weight, x: w.lcg, y: w.tcg, z: w.vcg })),
  ];
  // Negative weight items are allowed: they remove a weight already included in the lightship
  // (e.g. a crane boom moved from its stowed position). They are reported as a warning.
  for (const w of lc.weights) {
    if (w.weight < 0) warnings.push({ code: 'WEIGHT_REMOVED', message: `"${w.description}" removes ${Math.abs(w.weight).toFixed(2)} t (negative weight).` });
  }
  const disp = kahanSum(items.map((i) => i.w));
  if (!(disp > 0)) throw new EngineError('NO_DISPLACEMENT', 'Total displacement must be greater than 0.');
  const lcg = kahanSum(items.map((i) => i.w * i.x)) / disp;
  const tcg = kahanSum(items.map((i) => i.w * i.y)) / disp;
  const kg = kahanSum(items.map((i) => i.w * i.z)) / disp;
  const sumFsm = lc.fsmMethod === 'MANUAL_TOTAL'
    ? (lc.fsmTotal ?? 0)
    : kahanSum([...tanks.map((t) => t.fsm), ...lc.weights.map((w) => w.fsm ?? 0)]);

  const summary = ['Lightship', 'Tanks', 'Variable weights'].map((group) => {
    const g = items.filter((i) => i.group === group);
    const w = kahanSum(g.map((i) => i.w));
    return {
      group,
      weight: w,
      lcg: w > 0 ? kahanSum(g.map((i) => i.w * i.x)) / w : 0,
      tcg: w > 0 ? kahanSum(g.map((i) => i.w * i.y)) / w : 0,
      vcg: w > 0 ? kahanSum(g.map((i) => i.w * i.z)) / w : 0,
    };
  });

  // ---------- §A.5 Hydrostatics (even keel or free trim) ----------
  const hs = solveHydrostatics(vessel, disp, lcg, lc.seaDensity, warnings);
  const { draft, lcb, lcf, kmt, mtc, tpc, trim, draftAP, draftFP, draftMS } = hs;
  const L = vessel.lbp;
  const draftMean = (draftAP + draftFP) / 2;
  const cb = hs.cb ?? (disp / lc.seaDensity) / (L * vessel.breadth * draftMean);
  const lwl = hs.lwl ?? L;
  // Load line draft is measured at midship; 5 mm tolerance for table rounding.
  if (vessel.maxDraft !== undefined && draftMS > vessel.maxDraft + 0.005) {
    warnings.push({ code: 'MAX_DRAFT_EXCEEDED', message: `Draft at midship ${draftMS.toFixed(3)} m exceeds the load line draft of ${vessel.maxDraft.toFixed(3)} m.` });
  }

  const fsc = sumFsm / disp;
  const kgFluid = kg + fsc;
  const gmSolid = kmt - kg;
  const gmFluid = kmt - kgFluid;

  // ---------- §A.7 GZ curve ----------
  const kn = vessel.kn;
  assertIncreasing(kn.angles, 'KN table (heel angle)');
  const knc = knAtCondition(kn, disp, lc.seaDensity, trim);
  const knFn = pchip(knc.angles, knc.values);
  const maxTableAngle = kn.angles[kn.angles.length - 1];
  const knOf = (deg: number) => Math.sign(deg) * knFn(Math.abs(deg));
  const gz = (deg: number) => knOf(deg) - kgFluid * Math.sin(deg * DEG) - tcg * Math.cos(deg * DEG);

  const gzEnd = Math.min(lc.gzMaxAngle ?? 90, maxTableAngle);

  // Static heel (root of GZ nearest upright)
  let heel = 0;
  const gz0 = gz(0);
  if (Math.abs(gz0) > 1e-12 || gmFluid <= 0) {
    const dir = gz0 < 0 || (gz0 === 0 && gmFluid <= 0) ? 1 : -1;
    const root = firstCrossing(gz, 0, dir * 1e-6, dir * Math.min(60, maxTableAngle), 0.1);
    if (root === null) {
      throw new EngineError('NO_EQUILIBRIUM', 'No equilibrium heel angle found within 60°: the vessel capsizes in this condition.');
    }
    heel = root;
    if (gmFluid <= 0) warnings.push({ code: 'NEGATIVE_INITIAL_GM', message: `GM fluid is ${gmFluid.toFixed(3)} m. Angle of loll ≈ ${Math.abs(heel).toFixed(1)}°.` });
  }

  // All stability criteria are measured towards the side to which the ship heels (worst case).
  // For port the curve is mirrored: gzS(φ) = −GZ(−φ) = KN − KG·sin φ − (−TCG)·cos φ.
  const side: 1 | -1 = heel < -1e-9 ? -1 : 1;
  const tcgS = side * tcg;
  const gzS = (deg: number) => side * gz(side * deg);

  const gzTable: GzPoint[] = kn.angles
    .filter((a) => a <= gzEnd)
    .map((a) => {
      const k = knOf(a);
      const kgSin = kgFluid * Math.sin(a * DEG);
      const tcgCos = tcgS * Math.cos(a * DEG);
      return { heel: a, kn: k, kgSin, tcgCos, gz: k - kgSin - tcgCos };
    });
  const gzCurve: { heel: number; gz: number }[] = [];
  for (let a = 0; a <= gzEnd + 1e-9; a += 1) gzCurve.push({ heel: a, gz: gzS(a) });

  // GZmax, angle of max, AVS (on the side of heel)
  let gzMax = -Infinity;
  let gzMaxAngle = 0;
  for (let a = 0; a <= gzEnd + 1e-9; a += 0.1) {
    const v = gzS(a);
    if (v > gzMax) { gzMax = v; gzMaxAngle = a; }
  }
  {
    let a = Math.max(0, gzMaxAngle - 0.1), b = Math.min(gzEnd, gzMaxAngle + 0.1);
    const g = (Math.sqrt(5) - 1) / 2;
    for (let i = 0; i < 40; i++) {
      const c = b - g * (b - a), d = a + g * (b - a);
      if (gzS(c) > gzS(d)) b = d; else a = c;
    }
    const m = 0.5 * (a + b);
    if (gzS(m) > gzMax) { gzMax = gzS(m); gzMaxAngle = m; }
  }
  const avs = firstCrossing(gzS, 0, gzMaxAngle, gzEnd, 0.1);

  // ---------- §A.7.3 Down-flooding & deck edge ----------
  let floodAngle = 90;
  let floodOpening: string | null = null;
  for (const o of vessel.openings) {
    const tLocal = draftAP + ((draftFP - draftAP) * o.x) / L;
    const free = o.z - tLocal;
    let ang: number;
    if (free <= 0) ang = 0;
    else if (Math.abs(o.y) < 1e-9) ang = 90;
    else ang = Math.atan(free / Math.abs(o.y)) / DEG;
    if (ang < floodAngle) { floodAngle = ang; floodOpening = o.name; }
  }
  if (floodOpening && floodAngle <= 0) {
    warnings.push({ code: 'OPENING_SUBMERGED', message: `Opening "${floodOpening}" is below the waterline.` });
  }
  if (floodAngle < 30) {
    warnings.push({ code: 'DOWNFLOODING_BELOW_30', message: `Down-flooding angle ${floodAngle.toFixed(1)}° is below 30°. Engineering review required.` });
  }
  // Deck edge immersion: lowest freeboard along the length (deck at side, no sheer), i.e. at the deeper end.
  const deckEdgeAngle = Math.atan(Math.max(0, vessel.depth - Math.max(draftAP, draftFP, draftMS)) / (vessel.breadth / 2)) / DEG;

  const area = (a: number, b: number) => (b > a ? integrateDeg(gzS, a, b) : 0);

  // ---------- User-defined heeling moments (formula + linked load case values) ----------
  const SOURCE_LABEL: Record<string, string> = {
    VALUE: 'Entered value', HEEL: 'Heel angle θ', DISPLACEMENT: 'Load case: displacement', DRAFT_MS: 'Load case: draft at midship',
    DRAFT_MEAN: 'Load case: mean draft', DRAFT_AP: 'Load case: draft AP', DRAFT_FP: 'Load case: draft FP', KG: 'Load case: KG (solid)',
    KG_FLUID: 'Load case: KG fluid', VCB: 'Load case: VCB (KB)', TCG: 'Load case: TCG', LCG: 'Load case: LCG', GM: 'Load case: GM fluid',
    KM: 'Load case: KM', TRIM: 'Load case: trim', STATIC_HEEL: 'Load case: static heel',
  };
  const lcValue = (src: string): number | null => {
    switch (src) {
      case 'DISPLACEMENT': return disp;
      case 'DRAFT_MS': return draftMS;
      case 'DRAFT_MEAN': return draftMean;
      case 'DRAFT_AP': return draftAP;
      case 'DRAFT_FP': return draftFP;
      case 'KG': return kg;
      case 'KG_FLUID': return kgFluid;
      case 'VCB': return hs.kb;
      case 'TCG': return tcg;
      case 'LCG': return lcg;
      case 'GM': return gmFluid;
      case 'KM': return kmt;
      case 'TRIM': return trim;
      case 'STATIC_HEEL': return Math.abs(heel);
      default: return null;
    }
  };
  const momentCache = new Map<string, { arm: (deg: number) => number; result: MomentResult }>();
  function userMoment(id: string) {
    const hit = momentCache.get(id);
    if (hit) return hit;
    const def: MomentDef | undefined = (library.moments ?? []).find((m) => m.id === id);
    if (!def) throw new EngineError('NO_MOMENT', 'the heeling moment used by this criterion no longer exists.');
    const f = parseFormula(def.formula);
    const fixed: Record<string, number> = {};
    let heelVar: string | null = null;
    const inputs: MomentResult['inputs'] = [];
    for (const name of f.variables) {
      const v = def.vars.find((x) => x.name === name);
      if (!v) throw new EngineError('FORMULA', `"${name}" in the formula of "${def.name}" is not linked to a value.`);
      if (v.source === 'HEEL') { heelVar = name; inputs.push({ name, source: SOURCE_LABEL.HEEL, value: null, unit: '°' }); continue; }
      const val = v.source === 'VALUE' ? v.value ?? NaN : lcValue(v.source);
      if (val === null || !Number.isFinite(val)) {
        throw new EngineError('FORMULA', `"${name}" in "${def.name}": ${v.source === 'VCB' ? 'VCB is not available in the hydrostatic tables' : 'no value entered'}.`);
      }
      fixed[name] = val;
      inputs.push({ name, source: SOURCE_LABEL[v.source] ?? v.source, value: val, unit: v.unit ?? '' });
    }
    const momentAt = (deg: number) => evaluate(f, heelVar ? { ...fixed, [heelVar]: deg } : fixed);
    const arm = (deg: number) => (def.result === 'ARM' ? momentAt(deg) : momentAt(deg) / disp);
    const rows = tableAngles().map((a) => ({ heel: a, moment: def.result === 'ARM' ? null : momentAt(a), arm: arm(a) }));
    const out = {
      arm,
      result: {
        id: def.id, name: def.name, formula: def.formula, inputs, rows,
        note: def.result === 'ARM' ? 'The formula gives the heeling arm directly.' : `Heeling arm = moment / displacement (Δ = ${disp.toFixed(2)} t).${heelVar ? '' : ' The moment does not depend on heel.'}`,
      },
    };
    momentCache.set(id, out);
    return out;
  }
  /** Sum of several moments: arm_total(θ) = Σ arm_i(θ). */
  function combinedMoment(ids: string[], key: string) {
    const hit = momentCache.get(key);
    if (hit) return hit;
    const parts = ids.map(userMoment);
    if (parts.length === 1) return parts[0];
    const arm = (deg: number) => parts.reduce((sum, x) => sum + x.arm(deg), 0);
    const allMoments = parts.every((x) => x.result.rows.every((r) => r.moment !== null));
    const out = {
      arm,
      result: {
        id: key,
        name: `Combined heeling moment (${parts.map((x) => x.result.name).join(' + ')})`,
        formula: parts.map((x) => x.result.name).join(' + '),
        inputs: parts.map((x) => ({ name: x.result.name, source: 'Connected moment (arm at 0°)', value: x.arm(0), unit: 'm' })),
        rows: tableAngles().map((a) => ({
          heel: a,
          moment: allMoments ? parts.reduce((sum, x) => sum + x.arm(a) * disp, 0) : null,
          arm: arm(a),
        })),
        note: 'Combined heeling arm = sum of the heeling arms of all moments connected to the group.',
      },
    };
    momentCache.set(key, out);
    return out;
  }
  // moments connected to the group currently being evaluated
  let currentGroupMomentIds: string[] = [];
  let currentGroupKey = '';
  function groupMoment() {
    if (!currentGroupMomentIds.length) {
      throw new EngineError('NO_GROUP_MOMENT', 'this group uses "the group\'s combined heeling moment", but no heeling moment is connected to the group.');
    }
    return combinedMoment(currentGroupMomentIds, `GROUP:${currentGroupKey}`);
  }
  function tableAngles(): number[] {
    const set = new Set<number>(kn.angles.filter((a) => a <= gzEnd));
    for (let a = 0; a <= gzEnd + 1e-9; a += 5) set.add(a);
    return [...set].sort((a, b) => a - b);
  }
  const equilibriumUnder = (arm: (d: number) => number, name: string) => {
    const eq = firstCrossing((x) => gzS(x) - arm(x), 0, 0, gzEnd, 0.05);
    if (eq === null) throw new EngineError('MOMENT_EXCEEDS_GZ', `the heeling arm of "${name}" exceeds the righting lever at all angles.`);
    return eq;
  };
  const angLabel = (to: number, cap: boolean) => (cap && floodAngle < to ? `θf (${floodAngle.toFixed(1)}°)` : `${to}°`);

  // ---------- Generic criteria (building blocks) ----------
  function evalGeneric(d: CriterionDef): CriterionResult {
    const p = d.params ?? {};
    const reg = d.regulation ?? 'User-defined';
    switch (d.kind) {
      case 'AREA': {
        const from = p.from ?? 0;
        const to = p.capAtFlood ? Math.min(p.to ?? 30, floodAngle) : (p.to ?? 30);
        const r = cmp(d, `Area under GZ curve ${from}° to ${angLabel(p.to ?? 30, !!p.capAtFlood)}`, reg, 'm·rad', area(from, to));
        r.viz = [{ type: 'area', from, to: Math.max(from, to) }];
        return r;
      }
      case 'GZ_AT': {
        const a = p.angle ?? 30;
        const r = cmp(d, `Righting lever GZ at ${a}°`, reg, 'm', gzS(a));
        r.viz = [{ type: 'hline', value: d.required, from: a, label: `GZ ${d.comparator === '>=' ? '≥' : '≤'} ${d.required} m at ${a}°` }, { type: 'vline', angle: a, label: `${a}°` }];
        return r;
      }
      case 'GZ_MAX_FROM': {
        const a = p.from ?? 30;
        let v = -Infinity;
        for (let x = a; x <= gzEnd + 1e-9; x += 0.1) v = Math.max(v, gzS(x));
        const r = cmp(d, `Righting lever GZ at an angle ≥ ${a}°`, reg, 'm', v);
        r.viz = [{ type: 'hline', value: d.required, from: a, label: `GZ ≥ ${d.required} m at ≥ ${a}°` }];
        return r;
      }
      case 'ANGLE_GZMAX': {
        const r = cmp(d, `Angle of maximum GZ ${d.comparator === '>=' ? '≥' : '≤'} ${d.required}°`, reg, '°', gzMaxAngle);
        r.viz = [{ type: 'vline', angle: d.required, label: `${d.required}° (angle of GZmax)` }];
        return r;
      }
      case 'GM':
        return cmp(d, `Initial metacentric height GM₀ ${d.comparator === '>=' ? '≥' : '≤'} ${d.required} m`, reg, 'm', gmFluid);
      case 'RANGE':
        return cmp(d, 'Range of positive stability', reg, '°', (avs ?? gzEnd) - Math.abs(heel));
      case 'HEEL':
        return cmp(d, `Static heel ≤ ${d.required}°`, reg, '°', Math.abs(heel));
      case 'HEEL_MOMENT':
      case 'RESID_AREA':
      case 'RESID_GZMAX':
      case 'ARM_GZMAX_RATIO':
      case 'RESERVE_RATIO': {
        const m = (p.momentId ?? 'GROUP') === 'GROUP' ? groupMoment() : userMoment(p.momentId!);
        const pts = m.result.rows.map((x) => ({ heel: x.heel, arm: x.arm }));
        const eq = equilibriumUnder(m.arm, m.result.name);
        if (d.kind === 'HEEL_MOMENT') {
          const r = cmp(d, `Heel at equilibrium under ${m.result.name} ${d.comparator === '>=' ? '≥' : '≤'} ${d.required}°`, reg, '°', eq);
          r.viz = [{ type: 'arm', label: m.result.name, points: pts }, { type: 'vline', angle: eq, label: `Equilibrium ${eq.toFixed(2)}°` }];
          return r;
        }
        if (d.kind === 'ARM_GZMAX_RATIO') {
          const r = cmp(d, `Heeling arm at equilibrium (${eq.toFixed(2)}°) ÷ GZmax under ${m.result.name}`, reg, '', m.arm(eq) / gzMax);
          r.viz = [{ type: 'arm', label: m.result.name, points: pts }, { type: 'vline', angle: eq, label: `Equilibrium ${eq.toFixed(2)}°` }];
          return r;
        }
        if (d.kind === 'RESERVE_RATIO') {
          const roll = p.angle ?? 25;
          const second = firstCrossing((x) => gzS(x) - m.arm(x), 0, eq + 0.5, gzEnd, 0.05);
          const lim = Math.min(p.to ?? 70, p.capAtFlood ? floodAngle : Infinity, second ?? Infinity);
          const a1 = lim > eq ? integrateDeg((x) => gzS(x) - m.arm(x), eq, lim) : 0;
          const a2 = integrateDeg((x) => m.arm(x) - gzS(x), eq - roll, eq);
          if (-(eq - roll) > maxTableAngle) throw new EngineError('OUT_OF_TABLE_RANGE', `roll-back angle exceeds the KN table range.`);
          const r = cmp(d, `Reserve area A1 ÷ A2 under ${m.result.name} (roll ${roll}° to windward, A1 to ${lim.toFixed(1)}°)`, reg, '', a2 > 0 ? a1 / a2 : Infinity);
          r.viz = [{ type: 'arm', label: m.result.name, points: pts }, { type: 'residArea', from: eq, to: lim, points: pts }, { type: 'vline', angle: eq, label: `Equilibrium ${eq.toFixed(2)}°` }];
          return r;
        }
        if (d.kind === 'RESID_AREA') {
          const toA = p.capAtFlood ? Math.min(p.to ?? 40, floodAngle) : (p.to ?? 40);
          const val = toA > eq ? integrateDeg((x) => gzS(x) - m.arm(x), eq, toA) : 0;
          const r = cmp(d, `Residual area under ${m.result.name}, equilibrium (${eq.toFixed(2)}°) to ${angLabel(p.to ?? 40, !!p.capAtFlood)}`, reg, 'm·rad', val);
          r.viz = [{ type: 'arm', label: m.result.name, points: pts }, { type: 'residArea', from: eq, to: Math.max(eq, toA), points: pts }];
          return r;
        }
        let best = -Infinity;
        for (let x = eq; x <= gzEnd + 1e-9; x += 0.1) best = Math.max(best, gzS(x) - m.arm(x));
        const r = cmp(d, `Largest residual arm under ${m.result.name}`, reg, 'm', best);
        r.viz = [{ type: 'arm', label: m.result.name, points: pts }];
        return r;
      }
      default:
        throw new EngineError('UNKNOWN_CRITERION', `Criterion "${d.name}" has an unknown type.`);
    }
  }

  // ---------- Special criteria (engine-defined), computed on demand ----------
  let weather: WeatherDetail | null = null;
  let fifi: FifiDetail | null = null;
  let crane: CraneDetail | null = null;
  const special = new Map<string, CriterionResult>();

  function windTable(): { A: number; hA: number; hU: number } {
    const wd = vessel.windage.map((r) => r.draft);
    if (wd.length < 2) throw new EngineError('NO_WINDAGE', 'no wind area (windage) table is available for this vessel.');
    assertIncreasing(wd, 'Windage table (draft)');
    let A = lerp(wd, vessel.windage.map((r) => r.area), draftMS, 'Windage table');
    let hA = lerp(wd, vessel.windage.map((r) => r.centroidZ), draftMS, 'Windage table');
    const extra = lc.weights.filter((w) => (w.windArea ?? 0) > 0);
    if (extra.length) {
      const aSum = A + kahanSum(extra.map((w) => w.windArea!));
      hA = (A * hA + kahanSum(extra.map((w) => w.windArea! * (w.windCentroidZ ?? 0)))) / aSum;
      A = aSum;
    }
    const hasU = vessel.windage.every((r) => typeof r.underwaterCentroidZ === 'number');
    const hU = hasU ? lerp(wd, vessel.windage.map((r) => r.underwaterCentroidZ as number), draftMS, 'Windage table') : draftMean / 2;
    return { A, hA, hU };
  }

  function computeOSV1() {
    const tm = gzMaxAngle;
    let reqA: number, upTo: number, label: string;
    if (tm <= 15) { reqA = 0.07; upTo = 15; label = 'Area under GZ curve 0° to 15° (θmax ≤ 15°)'; }
    else if (tm >= 30) { reqA = 0.055; upTo = 30; label = 'Area under GZ curve 0° to 30° (θmax ≥ 30°)'; }
    else { reqA = 0.055 + 0.001 * (30 - tm); upTo = tm; label = `Area under GZ curve 0° to θmax (${tm.toFixed(2)}°): 0.055 + 0.001·(30 − θmax)`; }
    const to = Math.min(upTo, floodAngle);
    const r = ge('OSV-1', label, 'OSV 2.2 / IS 2008 B 2.4.5', 'm·rad', reqA, area(0, to));
    r.viz = [{ type: 'area', from: 0, to }];
    special.set('OSV-1', r);
  }

  function computeWeather() {
    const { A, hA, hU } = windTable();
    const d = draftMean;
    const Z = hA - hU;
    const P = lc.ops?.windPressure ?? WIND_P;
    if (P < WIND_P) warnings.push({ code: 'REDUCED_WIND_PRESSURE', message: `Reduced wind pressure ${P} N/m² used for the weather criterion: allowed only for restricted service with Administration approval.` });
    const lw1 = (P * A * Z) / (1000 * G * disp);
    const lw2 = 1.5 * lw1;
    const B = vessel.breadth;
    const Bd = B / d;
    const X1 = tableFactor([2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3.0, 3.1, 3.2, 3.4, 3.5], [1.0, 0.98, 0.96, 0.95, 0.93, 0.91, 0.9, 0.88, 0.86, 0.82, 0.8], Bd).value;
    const X2 = tableFactor([0.45, 0.5, 0.55, 0.6, 0.65, 0.7], [0.75, 0.82, 0.89, 0.95, 0.97, 1.0], cb).value;
    let k: number;
    if (vessel.bilgeType === 'SHARP') k = 0.7;
    else if (vessel.bilgeKeelArea <= 0) k = 1.0;
    else k = tableFactor([0, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0], [1.0, 0.98, 0.95, 0.88, 0.79, 0.74, 0.72, 0.7], (vessel.bilgeKeelArea * 100) / (lwl * B)).value;
    // OG uses KG corrected for free surface (conservative choice, documented in Appendix A).
    const OG = kgFluid - d;
    const r = 0.73 + (0.6 * OG) / d;
    if (gmFluid <= 0) throw new EngineError('NEGATIVE_INITIAL_GM', 'roll period cannot be computed with GM ≤ 0.');
    const C = 0.373 + 0.023 * Bd - 0.043 * (lwl / 100);
    const Troll = (2 * C * B) / Math.sqrt(gmFluid);
    const s = tableFactor([6, 7, 8, 12, 14, 16, 18, 20], [0.1, 0.098, 0.093, 0.065, 0.053, 0.044, 0.038, 0.035], Troll).value;
    const theta1 = 109 * k * X1 * X2 * Math.sqrt(Math.max(0, r * s));
    if (Bd >= 3.5) warnings.push({ code: 'WEATHER_PARAM_RANGE', message: `B/d = ${Bd.toFixed(2)} is outside the validated range (< 3.5) of the roll-angle formula.` });
    const kgd = kgFluid / d - 1;
    if (kgd < -0.3 || kgd > 0.5) warnings.push({ code: 'WEATHER_PARAM_RANGE', message: `KG/d − 1 = ${kgd.toFixed(2)} is outside the validated range (−0.3 to 0.5) of the roll-angle formula.` });
    if (Troll > 20) warnings.push({ code: 'WEATHER_PARAM_RANGE', message: `Roll period ${Troll.toFixed(1)} s exceeds 20 s (validated range of the roll-angle formula).` });

    const theta0 = firstCrossing(gzS, lw1, 0, gzEnd, 0.05);
    if (theta0 === null) throw new EngineError('WIND_EXCEEDS_GZ', 'steady wind lever exceeds the maximum righting lever.');
    const thetaR = theta0 - theta1;
    if (-thetaR > maxTableAngle) throw new EngineError('OUT_OF_TABLE_RANGE', `roll-back angle ${thetaR.toFixed(1)}° exceeds the KN table range.`);
    const thetaX = firstCrossing(gzS, lw2, 0, gzEnd, 0.05);
    let thetaC: number | null = null;
    let areaA = 0;
    let areaB = 0;
    let theta2 = Math.min(floodAngle, 50);
    if (thetaX !== null) {
      thetaC = firstCrossing(gzS, lw2, thetaX + 0.01, gzEnd, 0.05);
      theta2 = Math.min(floodAngle, 50, thetaC ?? Infinity);
      areaA = integrateDeg((x) => lw2 - gzS(x), thetaR, thetaX);
      areaB = theta2 > thetaX ? integrateDeg((x) => gzS(x) - lw2, thetaX, theta2) : 0;
    }
    const heelLimit = Math.min(16, 0.8 * deckEdgeAngle);
    special.set('IS-2.3-HEEL', le('IS-2.3-HEEL', `Steady wind heel θ₀ ≤ ${heelLimit < 16 ? '0.8 × deck edge angle' : '16°'}`, 'IS Code 2008 A 2.3.1', '°', heelLimit, theta0));
    const areaCrit = ge('IS-2.3-AREA', 'Weather criterion: area b ≥ area a', 'IS Code 2008 A 2.3.1', 'm·rad', areaA, areaB);
    if (thetaX === null) {
      areaCrit.passed = false;
      areaCrit.explanation = 'The gust wind heeling lever exceeds the maximum righting lever: the ship cannot resist the gust.';
    }
    special.set('IS-2.3-AREA', areaCrit);
    weather = {
      P, A, Z, hA, lw1, lw2, Bd, Cb: cb, X1, X2, k, r, OG, C, Troll, s,
      theta0, theta1, thetaR, thetaX, thetaC, theta2, areaA, areaB, deckEdgeAngle, side,
    };
  }

  function computeFifi() {
    const f = vessel.fifi;
    if (!f) throw new EngineError('NO_FIFI_DATA', 'no fire-fighting monitor / thruster data is entered for this vessel.');
    // BV: heeling arm = [Σ R·(h − T/2) + S·(T/2 − e)]·cos φ / Δ  (forces in t, Δ in t)
    const half = draftMS / 2;
    const monitorMoment = f.monitorForce * f.monitorCount * (f.monitorHeight - half);
    const thrusterMoment = f.thrusterForce * (half - f.thrusterHeight);
    const moment = monitorMoment + thrusterMoment;
    const arm0 = moment / disp;
    const eq = firstCrossing((x) => gzS(x) - arm0 * Math.cos(x * DEG), 0, 0, gzEnd, 0.05);
    if (eq === null) throw new EngineError('FIFI_EXCEEDS_GZ', 'the fire-fighting heeling arm exceeds the righting lever.');
    fifi = { monitorMoment, thrusterMoment, moment, arm0, equilibrium: eq, side };
    const c = le('FIFI-1', `Heel at equilibrium under water-jet reaction and thruster < ${f.maxHeel}°`, 'Bureau Veritas, fire-fighting ships', '°', f.maxHeel, eq);
    c.passed = eq < f.maxHeel;
    special.set('FIFI-1', c);
  }

  function computeCrane() {
    const cr = vessel.crane;
    if (!cr) throw new EngineError('NO_CRANE_DATA', 'no crane data (design heel, lifting wind) is entered for this vessel.');
    const { A, hA, hU } = windTable();
    const v = cr.windSpeedKnots * 0.514444;
    const q = 0.5 * cr.airDensity * v * v; // N/m²
    const moment = (q * cr.windCoefficient * A * (hA - hU)) / 9806.65; // t·m
    const lw = moment / disp;
    const phi1 = firstCrossing(gzS, lw, 0, gzEnd, 0.05);
    if (phi1 === null) throw new EngineError('CRANE_EXCEEDS_GZ', 'the wind heeling lever during lifting exceeds the righting lever.');
    const second = firstCrossing(gzS, lw, phi1 + 0.5, gzEnd, 0.05);
    const avsS = firstCrossing(gzS, 0, Math.max(phi1 + 0.5, gzMaxAngle), gzEnd, 0.05) ?? gzEnd;
    const phi2 = Math.min(floodAngle, avsS, second ?? Infinity);
    const arl = phi2 > phi1 ? integrateDeg(gzS, phi1, phi2) : 0;
    const ahl = phi2 > phi1 ? integrateDeg(() => lw, phi1, phi2) : 0;
    const to20 = Math.min(20, floodAngle);
    const areaTo20 = to20 > phi1 ? integrateDeg((x) => gzS(x) - lw, phi1, to20) : 0;
    crane = { moment, lw, phi1, phi2, arl, ahl, areaTo20, deckEdgeAngle, side };
    special.set('CRANE-1', le('CRANE-1', `Equilibrium heel with crane load and ${cr.windSpeedKnots} kn wind ≤ ${cr.maxHeel}° (crane design heel)`, 'IS 2008 B 2.9.3.2.1', '°', cr.maxHeel, phi1));
    const r2 = ge('CRANE-2', 'Area ratio ARL / AHL ≥ 1.4 (equilibrium to φ2)', 'IS 2008 B 2.9.4.1.2', '', 1.4, ahl > 0 ? arl / ahl : 0);
    special.set('CRANE-2', r2);
    const r3 = ge('CRANE-3', `Residual area from equilibrium to ${to20 < 20 ? 'θf' : '20°'}`, 'IS 2008 B 2.9.4.1.2', 'm·rad', 0.03, areaTo20);
    r3.viz = [{ type: 'area', from: phi1, to: Math.max(phi1, to20) }];
    special.set('CRANE-3', r3);
    {
      const lift = lc.ops?.lifting ?? { exposed: false, hs: 0 };
      const req = lift.exposed ? Math.max(1.0, 0.75 * lift.hs) : 0.5;
      const fb = vessel.depth - Math.max(draftAP, draftFP) - (vessel.breadth / 2) * Math.tan(phi1 * DEG);
      special.set('CRANE-5', ge('CRANE-5', `Freeboard to deck at side at equilibrium (${lift.exposed ? `exposed waters, Hs ${lift.hs} m` : 'non-exposed waters'})`, lift.exposed ? 'IS 2008 B 2.9.3.2.3' : 'IS 2008 B 2.9.3.2.2', 'm', req, fb));
    }
    special.set('CRANE-4', ge('CRANE-4', 'Deck edge not immersed at equilibrium (deck immersion angle ≥ equilibrium heel)', 'IS 2008 B 2.9.4.1.2', '°', phi1, deckEdgeAngle));
  }

  // ---------- moments of built-in groups (shown as moment tables) ----------
  const specialMoment = new Map<string, { arm: (deg: number) => number; result: MomentResult }>();
  function builtMoment(id: string, name: string, formula: string, inputs: MomentResult['inputs'], arm: (deg: number) => number, note: string) {
    const m = { arm, result: { id, name, formula, inputs, rows: tableAngles().map((a) => ({ heel: a, moment: arm(a) * disp, arm: arm(a) })), note } };
    return m;
  }
  const ops = lc.ops ?? {};
  const lcIn = (name: string, source: string, value: number, unit: string) => ({ name, source, value, unit });

  function computePaxCrowd() {
    const p = ops.passengers;
    if (!p || !(p.count > 0)) throw new EngineError('NO_OPS_DATA', 'enter the number of passengers, mass per passenger and crowd lever in the load case (Operation data).');
    const M0 = p.count * p.massEach * p.lever;
    const m = builtMoment('pax-crowd', 'Passenger crowding moment', 'M = N · w · y · cos θ', [
      lcIn('N', 'Load case: operation data', p.count, 'persons'), lcIn('w', 'Load case: operation data', p.massEach, 't'),
      lcIn('y', 'Load case: transverse lever of crowd', p.lever, 'm'), lcIn('Δ', 'Load case: displacement', disp, 't')],
      (x) => (M0 * Math.cos(x * DEG)) / disp, 'IS Code 2008 A 3.1: 75 kg per passenger, 4 persons/m², centre 1.0 m above deck (standing). Heeling arm = M / Δ.');
    specialMoment.set('PAX-1', m);
    const eq = equilibriumUnder(m.arm, m.result.name);
    const r = le('PAX-1', 'Heel due to passenger crowding to one side', 'IS Code 2008 A 3.1', '°', 10, eq);
    r.viz = [{ type: 'arm', label: m.result.name, points: m.result.rows }, { type: 'vline', angle: eq, label: `Crowding heel ${eq.toFixed(2)}°` }];
    special.set('PAX-1', r);
  }
  function computePaxTurn() {
    const kn = ops.serviceSpeedKnots;
    if (!(kn && kn > 0)) throw new EngineError('NO_OPS_DATA', 'enter the service speed in the load case (Operation data).');
    const v0 = kn * 0.514444;
    if (hs.lwl === null) warnings.push({ code: 'LWL_ASSUMED', message: 'Waterline length is not in the hydrostatic tables: LBP used for the turning heel.' });
    const arm0 = (0.2 * v0 * v0 / lwl) * (kg - draftMean / 2) / G;
    const m = builtMoment('pax-turn', 'Turning moment M_R', 'M_R = 0.200 · (v0² / L_WL) · Δ · (KG − d/2) · cos θ   [kN·m → t·m ÷ g]', [
      lcIn('v0', 'Load case: service speed', v0, 'm/s'), lcIn('L_WL', hs.lwl === null ? 'LBP (no L_WL in tables)' : 'Hydrostatics', lwl, 'm'),
      lcIn('KG', 'Load case: KG (solid)', kg, 'm'), lcIn('d', 'Load case: mean draft', draftMean, 'm'), lcIn('Δ', 'Load case: displacement', disp, 't')],
      (x) => arm0 * Math.cos(x * DEG), 'Heeling arm = M_R / (g · Δ).');
    specialMoment.set('PAX-2', m);
    const eq = equilibriumUnder(m.arm, m.result.name);
    const r = le('PAX-2', 'Heel due to turning', 'IS Code 2008 A 3.1', '°', 10, eq);
    r.viz = [{ type: 'arm', label: m.result.name, points: m.result.rows }, { type: 'vline', angle: eq, label: `Turning heel ${eq.toFixed(2)}°` }];
    special.set('PAX-2', r);
  }
  function computeGrain() {
    const g = ops.grain;
    if (!g || !g.holds.length) throw new EngineError('NO_OPS_DATA', 'enter the grain holds (volumetric heeling moment and stowage factor) in the load case (Operation data).');
    for (const h of g.holds) if (!(h.sf > 0)) throw new EngineError('NO_OPS_DATA', `stowage factor of hold "${h.name}" must be greater than 0.`);
    const sumM = kahanSum(g.holds.map((h) => h.vhm / h.sf));
    const l0 = sumM / disp, l40 = 0.8 * l0;
    const arm = (x: number) => l0 - ((l0 - l40) * x) / 40;
    const m = builtMoment('grain', 'Grain heeling arm (λ0 → λ40 = 0.8·λ0)', 'λ0 = Σ(VHM / SF) / Δ ; λ(θ) = λ0 − 0.2·λ0·θ/40', [
      ...g.holds.map((h) => lcIn(`VHM ${h.name}`, `Hold ${h.name}: VHM ÷ SF = ${(h.vhm / h.sf).toFixed(1)} t·m`, h.vhm, 'm⁴')),
      lcIn('Σ VHM/SF', 'Sum over holds', sumM, 't·m'), lcIn('Δ', 'Load case: displacement', disp, 't'), lcIn('λ0', 'Heeling arm at 0°', l0, 'm')],
      arm, 'Straight line through λ0 at 0° and λ40 at 40° (International Grain Code A 7), extended beyond 40°.');
    specialMoment.set('GRAIN-1', m); specialMoment.set('GRAIN-2', m);
    const eq = equilibriumUnder(arm, m.result.name);
    const lim = g.deckEdgeLimit ? Math.min(12, deckEdgeAngle) : 12;
    const r1 = le('GRAIN-1', `Heel due to grain shift ≤ ${g.deckEdgeLimit && deckEdgeAngle < 12 ? 'deck-edge immersion angle' : '12°'}`, 'International Grain Code A 7', '°', lim, eq);
    r1.viz = [{ type: 'arm', label: m.result.name, points: m.result.rows }, { type: 'vline', angle: eq, label: `Grain heel ${eq.toFixed(2)}°` }];
    special.set('GRAIN-1', r1);
    let maxDiffAng = eq, maxDiff = -Infinity;
    for (let x = eq; x <= Math.min(40, gzEnd) + 1e-9; x += 0.1) { const d = gzS(x) - arm(x); if (d > maxDiff) { maxDiff = d; maxDiffAng = x; } }
    const to = Math.min(40, floodAngle, maxDiffAng);
    const area2 = to > eq ? integrateDeg((x) => gzS(x) - arm(x), eq, to) : 0;
    const r2 = ge('GRAIN-2', `Residual area from ${eq.toFixed(2)}° to ${to.toFixed(1)}° (lesser of 40°, θf, angle of maximum difference)`, 'International Grain Code A 7', 'm·rad', 0.075, area2);
    r2.viz = [{ type: 'arm', label: m.result.name, points: m.result.rows }, { type: 'residArea', from: eq, to: Math.max(eq, to), points: m.result.rows }];
    special.set('GRAIN-2', r2);
  }
  function computePontoon() {
    const r1 = ge('PONT-1', `Area under GZ curve 0° to θmax (${gzMaxAngle.toFixed(1)}°)`, 'IS Code 2008 B 2.2', 'm·rad', 0.08, area(0, Math.min(gzMaxAngle, floodAngle)));
    r1.viz = [{ type: 'area', from: 0, to: Math.min(gzMaxAngle, floodAngle) }];
    special.set('PONT-1', r1);
    const { A, hA, hU } = windTable();
    const lw = (540 * A * (hA - hU)) / (1000 * G * disp);
    const m = builtMoment('pontoon-wind', 'Wind heeling lever, 540 N/m²', 'l_w = 540 · A · Z / (1000 · g · Δ)', [
      lcIn('A', 'Windage table at draft', A, 'm²'), lcIn('Z', 'Windage table at draft', hA - hU, 'm'), lcIn('Δ', 'Load case: displacement', disp, 't')], () => lw, 'Constant with heel.');
    specialMoment.set('PONT-2', m);
    const eq = equilibriumUnder(m.arm, m.result.name);
    const fb = vessel.depth - Math.max(draftAP, draftFP);
    const halfFb = Math.atan(Math.max(0, fb / 2) / (vessel.breadth / 2)) / DEG;
    const r2 = le('PONT-2', `Static heel under 540 N/m² wind ≤ half-freeboard angle (${halfFb.toFixed(2)}°)`, 'IS Code 2008 B 2.2', '°', halfFb, eq);
    r2.viz = [{ type: 'arm', label: m.result.name, points: m.result.rows }, { type: 'vline', angle: eq, label: `Wind heel ${eq.toFixed(2)}°` }, { type: 'vline', angle: halfFb, label: `Half freeboard ${halfFb.toFixed(1)}°` }];
    special.set('PONT-2', r2);
  }
  function computeModu() {
    const mo = ops.modu;
    if (!mo) throw new EngineError('NO_OPS_DATA', 'enter the MODU unit type, wind speed and wind coefficient in the load case (Operation data).');
    const { A, hA, hU } = windTable();
    const q = 0.5 * 1.222 * mo.windSpeed * mo.windSpeed; // N/m²
    const M = (q * mo.coefficient * A * (hA - hU)) / 9806.65; // t·m
    const lw = M / disp;
    const m = builtMoment('modu-wind', `Wind heeling moment, ${mo.windSpeed} m/s`, 'M = ½ · ρ · V² · C · A · Z / 9806.65', [
      lcIn('V', 'Load case: operation data', mo.windSpeed, 'm/s'), lcIn('ρ', 'Air density', 1.222, 'kg/m³'), lcIn('C', 'Load case: Cs·Ch coefficient', mo.coefficient, ''),
      lcIn('A', 'Windage table at draft', A, 'm²'), lcIn('Z', 'Windage table at draft', hA - hU, 'm'), lcIn('Δ', 'Load case: displacement', disp, 't')],
      () => lw, 'Wind heeling moment taken constant with heel (conservative simplification); heeling arm = M / Δ.');
    specialMoment.set('MODU-1', m); specialMoment.set('MODU-2', m);
    const eq = equilibriumUnder(m.arm, m.result.name);
    const second = firstCrossing((x) => gzS(x) - lw, 0, eq + 0.5, gzEnd, 0.05);
    const lim = Math.min(second ?? gzEnd, floodAngle);
    const ratio = integrateDeg(gzS, 0, lim) / integrateDeg(() => lw, 0, lim);
    const req = mo.unitType === 'COLUMN' ? 1.3 : 1.4;
    const r1 = ge('MODU-1', `Righting / wind heeling area to ${second !== null && second < floodAngle ? '2nd intercept' : 'θf'} (${lim.toFixed(1)}°), ${mo.unitType === 'COLUMN' ? 'column-stabilised' : 'surface / self-elevating'} unit`, 'MODU Code 2009 3.4', '', req, ratio);
    r1.viz = [{ type: 'arm', label: m.result.name, points: m.result.rows }, { type: 'area', from: 0, to: lim }];
    special.set('MODU-1', r1);
    let minGz = Infinity;
    for (let x = Math.max(0, eq * 0); x <= lim + 1e-9; x += 0.1) if (x >= 0.5) minGz = Math.min(minGz, gzS(x));
    special.set('MODU-2', ge('MODU-2', 'Smallest righting lever between upright and the 2nd intercept', 'MODU Code 2009 3.4', 'm', 0, minGz));
    special.get('MODU-2')!.passed = minGz > 0;
  }

  const SPECIAL_SOURCE: Record<string, () => void> = {
    'PAX-1': computePaxCrowd, 'PAX-2': computePaxTurn, 'GRAIN-1': computeGrain, 'GRAIN-2': computeGrain,
    'PONT-1': computePontoon, 'PONT-2': computePontoon, 'MODU-1': computeModu, 'MODU-2': computeModu, 'CRANE-5': computeCrane,
    'OSV-1': computeOSV1, 'IS-2.3-HEEL': computeWeather, 'IS-2.3-AREA': computeWeather,
    'FIFI-1': computeFifi, 'CRANE-1': computeCrane, 'CRANE-2': computeCrane, 'CRANE-3': computeCrane, 'CRANE-4': computeCrane,
  };
  const specialErrors = new Map<() => void, string>();
  function evalSpecial(id: string): CriterionResult {
    if (!special.has(id)) {
      const fn = SPECIAL_SOURCE[id];
      if (!fn) throw new EngineError('UNKNOWN_CRITERION', `Unknown criterion ${id}.`);
      if (specialErrors.has(fn)) throw new EngineError('GROUP_ERROR', specialErrors.get(fn)!);
      try { fn(); } catch (e) {
        if (e instanceof EngineError) { specialErrors.set(fn, e.message); throw e; }
        throw e;
      }
    }
    return special.get(id)!;
  }

  // ---------- Groups ----------
  const allCriteria = [...BUILTIN_CRITERIA, ...library.criteria];
  const allGroups = [...BUILTIN_GROUPS, ...library.groups];
  const selectedIds = lc.criteriaGroups ?? vessel.criteriaGroups ?? DEFAULT_GROUP_IDS;
  const groups: CriteriaGroupResult[] = [];
  for (const g of allGroups.filter((x) => selectedIds.includes(x.id))) {
    const list: CriterionResult[] = [];
    let error: string | undefined;
    currentGroupMomentIds = (g.momentIds ?? []).filter((id) => (library.moments ?? []).some((m) => m.id === id));
    currentGroupKey = g.id;
    if ((g.momentIds ?? []).length !== currentGroupMomentIds.length) error = 'A heeling moment connected to this group no longer exists.';
    for (const cid of g.criterionIds) {
      const def = allCriteria.find((c) => c.id === cid);
      if (!def) { error = `Criterion ${cid} no longer exists.`; continue; }
      try {
        const r = { ...(def.kind === 'SPECIAL' ? evalSpecial(def.id) : evalGeneric(def)) };
        r.id = def.id;
        list.push(r);
      } catch (e) {
        if (!(e instanceof EngineError)) throw e;
        const msg = e.message.charAt(0).toUpperCase() + e.message.slice(1);
        error = error ? (error.includes(msg) ? error : `${error} ${msg}`) : `This group could not be evaluated. ${msg}`;
      }
    }
    if (error && !warnings.some((w) => w.message === error)) warnings.push({ code: 'GROUP_NOT_EVALUATED', message: `${g.name}: ${error}` });
    // heeling moments / levers of this group
    const moments: MomentResult[] = [];
    const arms: ((d: number) => number)[] = [];
    const angles = tableAngles();
    const constRows = (lever: number) => angles.map((a) => ({ heel: a, moment: lever * disp, arm: lever }));
    if (!error) {
      if (g.chart === 'WEATHER' && weather) {
        const w = weather as WeatherDetail;
        moments.push({ id: 'lw2', name: 'Gust wind heeling lever l_w2 = 1.5 · l_w1', formula: 'l_w2 = 1.5 · P·A·Z / (1000·g·Δ)', inputs: [
          { name: 'P', source: 'IS Code 2008', value: w.P, unit: 'N/m²' }, { name: 'A', source: 'Windage table at draft', value: w.A, unit: 'm²' },
          { name: 'Z', source: 'Windage table at draft', value: w.Z, unit: 'm' }, { name: 'Δ', source: 'Load case: displacement', value: disp, unit: 't' }],
          rows: constRows(w.lw2), note: 'Wind levers are constant at all heel angles (IS Code 2008 A 2.3).' });
        moments.push({ id: 'lw1', name: 'Steady wind heeling lever l_w1', formula: 'l_w1 = P·A·Z / (1000·g·Δ)', inputs: [], rows: constRows(w.lw1) });
        arms.push(() => w.lw2, () => w.lw1);
      }
      if (g.chart === 'FIFI' && fifi) {
        const ff = fifi as FifiDetail; const fv = vessel.fifi!;
        moments.push({ id: 'fifi', name: 'Fire-fighting heeling moment', formula: 'M = [n·R·(h − T/2) + S·(T/2 − e)] · cos θ', inputs: [
          { name: 'n', source: 'Vessel data', value: fv.monitorCount, unit: '' }, { name: 'R', source: 'Vessel data', value: fv.monitorForce, unit: 't' },
          { name: 'h', source: 'Vessel data', value: fv.monitorHeight, unit: 'm' }, { name: 'S', source: 'Vessel data', value: fv.thrusterForce, unit: 't' },
          { name: 'e', source: 'Vessel data', value: fv.thrusterHeight, unit: 'm' }, { name: 'T', source: 'Load case: draft at midship', value: draftMS, unit: 'm' },
          { name: 'Δ', source: 'Load case: displacement', value: disp, unit: 't' }, { name: 'θ', source: 'Heel angle θ', value: null, unit: '°' }],
          rows: angles.map((a) => ({ heel: a, moment: ff.moment * Math.cos(a * DEG), arm: ff.arm0 * Math.cos(a * DEG) })), note: 'Heeling arm = M / Δ.' });
        arms.push((x) => ff.arm0 * Math.cos(x * DEG));
      }
      if (g.chart === 'CRANE' && crane) {
        const c = crane as CraneDetail; const cv = vessel.crane!;
        moments.push({ id: 'crane', name: `Wind heeling moment during lifting (${cv.windSpeedKnots} kn)`, formula: 'M = ½·ρ·V²·C·A·Z / 9806.65', inputs: [
          { name: 'V', source: 'Vessel data', value: cv.windSpeedKnots, unit: 'kn' }, { name: 'ρ', source: 'Vessel data', value: cv.airDensity, unit: 't/m³ ×1000' },
          { name: 'C', source: 'Vessel data', value: cv.windCoefficient, unit: '' }, { name: 'Δ', source: 'Load case: displacement', value: disp, unit: 't' }],
          rows: constRows(c.lw), note: 'Crane and lifted load are included in the loading condition; only wind acts as a heeling moment.' });
        arms.push(() => c.lw);
      }
      // group's connected moments: combined first (used for the residual), then each one
      if (currentGroupMomentIds.length) {
        if (currentGroupMomentIds.length > 1) {
          const c = groupMoment();
          moments.push(c.result); arms.push(c.arm);
        }
        for (const id of currentGroupMomentIds) {
          const um = userMoment(id);
          moments.push(um.result); arms.push(um.arm);
        }
      }
      for (const cr of list) {
        const sm = specialMoment.get(cr.id ?? '');
        if (sm && !moments.some((m) => m.id === sm.result.id)) { moments.push(sm.result); arms.push(sm.arm); }
      }
      for (const cr of list) {
        const id = allCriteria.find((x) => x.id === cr.id)?.params?.momentId;
        if (id && id !== 'GROUP' && !moments.some((m) => m.id === id)) {
          const um = userMoment(id);
          moments.push(um.result);
          arms.push(um.arm);
        }
      }
    }
    const table: GroupTableRow[] = angles.map((a) => {
      const k = knOf(a), kgSin = kgFluid * Math.sin(a * DEG), tcgCos = tcgS * Math.cos(a * DEG);
      const gzv = k - kgSin - tcgCos;
      const av = arms.map((fn) => fn(a));
      return { heel: a, kn: k, kgSin, tcgCos, gz: gzv, arms: av, residual: av.length ? gzv - av[0] : null };
    });
    groups.push({
      id: g.id, name: g.name, regulation: g.regulation, description: g.description, chart: g.chart,
      criteria: list, error, passed: !error && list.length > 0 && list.every((c) => c.passed), moments, table,
    });
  }

  // ---------- §A.10 Explanations ----------
  for (const g of groups) for (const c of g.criteria) if (!c.passed && !c.explanation) c.explanation = explain(c);
  function explain(c: CriterionResult): string {
    const shortBy = `${fmt(Math.abs(c.marginAbs), c.unit)} (${Math.abs(c.marginPct).toFixed(1)} %)`;
    let s = `${c.description}: actual ${fmt(c.actual, c.unit)} ${c.comparator === '>=' ? 'is below the minimum' : 'exceeds the maximum'} of ${fmt(c.required, c.unit)} by ${shortBy}.`;
    if (c.code === 'IS-2.3-HEEL') return s + ' Reduce the wind heeling lever (less windage area) or increase GM.';
    if (c.code.startsWith('CRANE')) return s + ' Reduce the lifted load or outreach, lower the crane, or add counter-ballast on the opposite side.';
    const slack = [...tanks].filter((t) => t.fsm > 0).sort((a, b) => b.fsm - a.fsm);
    s += ` KG corrected for free surface is ${kgFluid.toFixed(3)} m, of which ${fsc.toFixed(3)} m is free surface correction`;
    s += slack.length ? ` from ${slack.length} slack tank(s) (largest: ${slack[0].name}, ${slack[0].fsm.toFixed(0)} t·m).` : '.';
    s += ' Consider lowering the centre of gravity: press up or empty slack tanks, fill double-bottom ballast, or lower/reduce high weights.';
    return s;
  }

  const seen = new Set<string>();
  const appliedCriteria = groups.flatMap((g) => g.criteria).filter((c) => (seen.has(c.code) ? false : (seen.add(c.code), true)));
  const overallPass = groups.length > 0 && groups.every((g) => g.passed) && !warnings.some((w) => w.code === 'NEGATIVE_INITIAL_GM');

  return {
    displacement: disp,
    deadweight: disp - vessel.lightship.weight,
    lcg, tcg, kg, sumFsm, fsc, kgFluid,
    draftMean: draft, draftAP, draftFP, draftMS, trim, heel, side,
    lcb, lcf, kmt, kb: hs.kb, mtc, tpc, gmSolid, gmFluid,
    floodAngle, floodOpening, deckEdgeAngle,
    gzMax, gzMaxAngle, avs,
    gzTable, gzCurve, tanks, summary, criteria: appliedCriteria, groups, weather, fifi, crane, warnings, overallPass,
  };
}

function cmp(d: CriterionDef, description: string, regulation: string, unit: string, actual: number): CriterionResult {
  return d.comparator === '<='
    ? le(d.id, description, regulation, unit, d.required, actual)
    : ge(d.id, description, regulation, unit, d.required, actual);
}

function ge(code: string, description: string, regulation: string, unit: string, required: number, actual: number): CriterionResult {
  const marginAbs = actual - required;
  return { code, description, regulation, unit, comparator: '>=', required, actual, passed: actual >= required, marginAbs, marginPct: required !== 0 ? (marginAbs / Math.abs(required)) * 100 : 0 };
}

function le(code: string, description: string, regulation: string, unit: string, required: number, actual: number): CriterionResult {
  const marginAbs = required - actual;
  return { code, description, regulation, unit, comparator: '<=', required, actual, passed: actual <= required, marginAbs, marginPct: required !== 0 ? (marginAbs / Math.abs(required)) * 100 : 0 };
}

function fmt(v: number, unit: string): string {
  if (unit === 'm·rad') return `${v.toFixed(4)} m·rad`;
  if (unit === '°') return `${v.toFixed(1)}°`;
  if (unit === '') return v.toFixed(3);
  return `${v.toFixed(3)} ${unit}`;
}

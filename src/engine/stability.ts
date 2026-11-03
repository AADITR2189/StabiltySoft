// Intact stability calculation (docs/A-Calculation-Methods.md §A.3 – §A.10).
import {
  DEG, EngineError, assertIncreasing, firstCrossing, integrateDeg, kahanSum, lerp, pchip, tableFactor,
} from './math';
import { resolveTank } from './tanks';
import type {
  CriterionResult, GzPoint, LoadCase, Results, TankResult, Vessel, Warning, WeatherDetail,
} from './types';

export const ENGINE_VERSION = '0.1.0';
const G = 9.81;
const WIND_P = 504; // N/m², unrestricted service

export function calculate(vessel: Vessel, lc: LoadCase): Results {
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
  for (const it of items) {
    if (it.w < 0) throw new EngineError('NEGATIVE_QUANTITY', 'Weights cannot be negative.');
  }
  const disp = kahanSum(items.map((i) => i.w));
  if (!(disp > 0)) throw new EngineError('NO_DISPLACEMENT', 'Total displacement must be greater than 0.');
  const lcg = kahanSum(items.map((i) => i.w * i.x)) / disp;
  const tcg = kahanSum(items.map((i) => i.w * i.y)) / disp;
  const kg = kahanSum(items.map((i) => i.w * i.z)) / disp;
  const sumFsm = kahanSum(tanks.map((t) => t.fsm));

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

  // ---------- §A.5 Hydrostatics ----------
  const rows = vessel.hydro.rows;
  const dispCol = rows.map((r) => r.displacement);
  assertIncreasing(dispCol, 'Hydrostatic table (displacement)');
  assertIncreasing(rows.map((r) => r.draft), 'Hydrostatic table (draft)');
  const rhoRef = vessel.hydro.rhoRef;
  const dispRef = (disp * rhoRef) / lc.seaDensity;
  const h = (key: keyof (typeof rows)[number]) => lerp(dispCol, rows.map((r) => r[key]), dispRef, 'Hydrostatic table');
  const draft = h('draft');
  const lcb = h('lcb');
  const lcf = h('lcf');
  const kmt = h('kmt');
  const cb = h('cb');
  const lwl = h('lwl');
  const mtc = (h('mtc') * lc.seaDensity) / rhoRef;
  const tpc = (h('tpc') * lc.seaDensity) / rhoRef;

  const L = vessel.lbp;
  const trim = (disp * (lcb - lcg)) / (100 * mtc);
  const draftAP = draft + (trim * lcf) / L;
  const draftFP = draft - (trim * (L - lcf)) / L;
  const draftMS = draft + (trim * (lcf - L / 2)) / L;
  const draftMean = (draftAP + draftFP) / 2;
  if (Math.abs(trim) > 0.01 * L) {
    warnings.push({ code: 'LARGE_TRIM_ACCURACY', message: `Trim ${trim.toFixed(2)} m exceeds 1 % of LBP; even-keel hydrostatics lose accuracy.` });
  }
  if (vessel.maxDraft !== undefined && Math.max(draftAP, draftFP) > vessel.maxDraft) {
    warnings.push({ code: 'MAX_DRAFT_EXCEEDED', message: `Maximum draft ${Math.max(draftAP, draftFP).toFixed(3)} m exceeds the limit of ${vessel.maxDraft.toFixed(3)} m.` });
  }

  const fsc = sumFsm / disp;
  const kgFluid = kg + fsc;
  const gmSolid = kmt - kg;
  const gmFluid = kmt - kgFluid;

  // ---------- §A.7 GZ curve ----------
  const kn = vessel.kn;
  assertIncreasing(kn.displacements, 'KN table (displacement)');
  assertIncreasing(kn.angles, 'KN table (heel angle)');
  const knDispRef = (disp * kn.rhoRef) / lc.seaDensity;
  // KN interpolated across displacement with a shape-preserving cubic (PCHIP); see Appendix A §A.2.
  lerp(kn.displacements, kn.displacements, knDispRef, 'KN table'); // range check (no extrapolation)
  const knAtAngles = kn.angles.map((_, j) => pchip(kn.displacements, kn.kn.map((row) => row[j]))(knDispRef));
  const knFn = pchip(kn.angles, knAtAngles);
  const maxTableAngle = kn.angles[kn.angles.length - 1];
  const knOf = (deg: number) => Math.sign(deg) * knFn(Math.abs(deg));
  const gz = (deg: number) => knOf(deg) - kgFluid * Math.sin(deg * DEG) - tcg * Math.cos(deg * DEG);

  const gzEnd = Math.min(lc.gzMaxAngle ?? 90, maxTableAngle);
  const gzTable: GzPoint[] = kn.angles
    .filter((a) => a <= gzEnd)
    .map((a) => {
      const k = knOf(a);
      const kgSin = kgFluid * Math.sin(a * DEG);
      const tcgCos = tcg * Math.cos(a * DEG);
      return { heel: a, kn: k, kgSin, tcgCos, gz: k - kgSin - tcgCos };
    });
  const gzCurve: { heel: number; gz: number }[] = [];
  for (let a = 0; a <= gzEnd + 1e-9; a += 1) gzCurve.push({ heel: a, gz: gz(a) });

  // Static heel (root of GZ nearest upright)
  let heel = 0;
  const gz0 = gz(0);
  if (Math.abs(gz0) > 1e-12 || gmFluid <= 0) {
    const side = gz0 < 0 || (gz0 === 0 && gmFluid <= 0) ? 1 : -1;
    const lim = side * Math.min(60, maxTableAngle);
    const root = firstCrossing(gz, 0, side * 1e-6, lim, 0.1);
    if (root === null) {
      throw new EngineError('NO_EQUILIBRIUM', 'No equilibrium heel angle found within 60°: the vessel capsizes in this condition.');
    }
    heel = root;
    if (gmFluid <= 0) warnings.push({ code: 'NEGATIVE_INITIAL_GM', message: `GM fluid is ${gmFluid.toFixed(3)} m. Angle of loll ≈ ${Math.abs(heel).toFixed(1)}°.` });
  }

  // GZmax, angle of max, AVS (to starboard)
  let gzMax = -Infinity;
  let gzMaxAngle = 0;
  for (let a = 0; a <= gzEnd + 1e-9; a += 0.1) {
    const v = gz(a);
    if (v > gzMax) { gzMax = v; gzMaxAngle = a; }
  }
  // golden-section refinement around the sample maximum
  {
    let a = Math.max(0, gzMaxAngle - 0.1), b = Math.min(gzEnd, gzMaxAngle + 0.1);
    const r = (Math.sqrt(5) - 1) / 2;
    for (let i = 0; i < 40; i++) {
      const c = b - r * (b - a), d = a + r * (b - a);
      if (gz(c) > gz(d)) b = d; else a = c;
    }
    const m = 0.5 * (a + b);
    if (gz(m) > gzMax) { gzMax = gz(m); gzMaxAngle = m; }
  }
  const avs = firstCrossing(gz, 0, gzMaxAngle, gzEnd, 0.1);

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
  const deckEdgeAngle = Math.atan(Math.max(0, vessel.depth - draftMS) / (vessel.breadth / 2)) / DEG;

  // ---------- §A.8 IS Code 2008 Part A §2.2 ----------
  const criteria: CriterionResult[] = [];
  const area = (a: number, b: number) => integrateDeg(gz, a, b);
  const lim40 = Math.min(40, floodAngle);
  if (floodAngle < 30) {
    warnings.push({ code: 'DOWNFLOODING_BELOW_30', message: `Down-flooding angle ${floodAngle.toFixed(1)}° is below 30°. Engineering review required.` });
  }
  criteria.push(ge('IS-2.2.1.1', 'Area under GZ curve 0° to 30°', 'IS Code 2008 A 2.2.1', 'm·rad', 0.055, area(0, Math.min(30, floodAngle))));
  criteria.push(ge('IS-2.2.1.2', `Area under GZ curve 0° to ${lim40 < 40 ? 'θf (' + lim40.toFixed(1) + '°)' : '40°'}`, 'IS Code 2008 A 2.2.1', 'm·rad', 0.09, area(0, lim40)));
  criteria.push(ge('IS-2.2.1.3', `Area under GZ curve 30° to ${lim40 < 40 ? 'θf (' + lim40.toFixed(1) + '°)' : '40°'}`, 'IS Code 2008 A 2.2.1', 'm·rad', 0.03, lim40 > 30 ? area(30, lim40) : 0));
  let gzAt30 = -Infinity;
  for (let a = 30; a <= gzEnd + 1e-9; a += 0.1) gzAt30 = Math.max(gzAt30, gz(a));
  criteria.push(ge('IS-2.2.2', 'Righting lever GZ at an angle ≥ 30°', 'IS Code 2008 A 2.2.2', 'm', 0.2, gzAt30));
  criteria.push(ge('IS-2.2.3', 'Angle of maximum GZ', 'IS Code 2008 A 2.2.3', '°', 25, gzMaxAngle));
  criteria.push(ge('IS-2.2.4', 'Initial metacentric height GM₀', 'IS Code 2008 A 2.2.4', 'm', 0.15, gmFluid));

  // ---------- §A.9 Weather criterion ----------
  let weather: WeatherDetail | null = null;
  try {
    weather = weatherCriterion();
  } catch (e) {
    if (e instanceof EngineError) warnings.push({ code: e.code, message: `Weather criterion: ${e.message}` });
    else throw e;
  }

  function weatherCriterion(): WeatherDetail {
    const wd = vessel.windage.map((r) => r.draft);
    assertIncreasing(wd, 'Windage table (draft)');
    let A = lerp(wd, vessel.windage.map((r) => r.area), draftMean, 'Windage table');
    let hA = lerp(wd, vessel.windage.map((r) => r.centroidZ), draftMean, 'Windage table');
    const extra = lc.weights.filter((w) => (w.windArea ?? 0) > 0);
    if (extra.length) {
      const aSum = A + kahanSum(extra.map((w) => w.windArea!));
      hA = (A * hA + kahanSum(extra.map((w) => w.windArea! * (w.windCentroidZ ?? 0)))) / aSum;
      A = aSum;
    }
    const d = draftMean;
    const Z = hA - d / 2;
    const lw1 = (WIND_P * A * Z) / (1000 * G * disp);
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

    const theta0 = firstCrossing(gz, lw1, 0, gzEnd, 0.05);
    if (theta0 === null) throw new EngineError('WIND_EXCEEDS_GZ', 'steady wind lever exceeds the maximum righting lever.');
    const thetaR = theta0 - theta1;
    if (-thetaR > maxTableAngle) throw new EngineError('OUT_OF_TABLE_RANGE', `roll-back angle ${thetaR.toFixed(1)}° exceeds the KN table range.`);
    const thetaX = firstCrossing(gz, lw2, 0, gzEnd, 0.05);
    let thetaC: number | null = null;
    let areaA = 0;
    let areaB = 0;
    let theta2 = Math.min(floodAngle, 50);
    if (thetaX !== null) {
      thetaC = firstCrossing(gz, lw2, thetaX + 0.01, gzEnd, 0.05);
      theta2 = Math.min(floodAngle, 50, thetaC ?? Infinity);
      areaA = integrateDeg((x) => lw2 - gz(x), thetaR, thetaX);
      areaB = theta2 > thetaX ? integrateDeg((x) => gz(x) - lw2, thetaX, theta2) : 0;
    }

    const heelLimit = Math.min(16, 0.8 * deckEdgeAngle);
    criteria.push(le('IS-2.3-HEEL', `Steady wind heel θ₀ ≤ ${heelLimit < 16 ? '0.8 × deck edge angle' : '16°'}`, 'IS Code 2008 A 2.3.1', '°', heelLimit, theta0));
    const areaCrit = ge('IS-2.3-AREA', 'Weather criterion: area b ≥ area a', 'IS Code 2008 A 2.3.1', 'm·rad', areaA, areaB);
    if (thetaX === null) {
      areaCrit.passed = false;
      areaCrit.explanation = 'The gust wind heeling lever exceeds the maximum righting lever: the ship cannot resist the gust.';
    }
    criteria.push(areaCrit);

    return {
      P: WIND_P, A, Z, hA, lw1, lw2, Bd, Cb: cb, X1, X2, k, r, OG, C, Troll, s,
      theta0, theta1, thetaR, thetaX, thetaC, theta2, areaA, areaB, deckEdgeAngle,
    };
  }

  // ---------- §A.10 Explanations ----------
  for (const c of criteria) {
    if (!c.passed && !c.explanation) c.explanation = explain(c);
  }
  function explain(c: CriterionResult): string {
    const shortBy = `${fmt(Math.abs(c.marginAbs), c.unit)} (${Math.abs(c.marginPct).toFixed(1)} %)`;
    let s = `${c.description}: actual ${fmt(c.actual, c.unit)} ${c.comparator === '>=' ? 'is below the minimum' : 'exceeds the maximum'} of ${fmt(c.required, c.unit)} by ${shortBy}.`;
    if (c.code !== 'IS-2.3-HEEL') {
      const slack = [...tanks].filter((t) => t.fsm > 0).sort((a, b) => b.fsm - a.fsm);
      s += ` KG corrected for free surface is ${kgFluid.toFixed(3)} m, of which ${fsc.toFixed(3)} m is free surface correction`;
      s += slack.length ? ` from ${slack.length} slack tank(s) (largest: ${slack[0].name}, ${slack[0].fsm.toFixed(0)} t·m).` : '.';
      s += ' Consider lowering the centre of gravity: press up or empty slack tanks, fill double-bottom ballast, or lower/reduce high weights.';
    } else {
      s += ' Reduce the wind heeling lever (less windage area) or increase GM.';
    }
    return s;
  }

  const overallPass = criteria.every((c) => c.passed) && !warnings.some((w) => w.code === 'NEGATIVE_INITIAL_GM');

  return {
    displacement: disp,
    deadweight: disp - vessel.lightship.weight,
    lcg, tcg, kg, sumFsm, fsc, kgFluid,
    draftMean: draft, draftAP, draftFP, draftMS, trim, heel,
    lcb, lcf, kmt, mtc, tpc, gmSolid, gmFluid,
    floodAngle, floodOpening, deckEdgeAngle,
    gzMax, gzMaxAngle, avs,
    gzTable, gzCurve, tanks, summary, criteria, weather, warnings, overallPass,
  };
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
  return `${v.toFixed(3)} ${unit}`;
}


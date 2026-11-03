// Heeling levers of IMO Res. MSC.415(97) (IS Code 2008 Part B 2.7–2.9), as written in the resolution.
// Pure functions; units as stated per function.
const DEG = Math.PI / 180;
export const G = 9.81;

/** Anchor handling input (2.7.2). Tensions and bollard pull in the same unit (t). */
export interface AnchorInput {
  fp: number;     // permissible tension Fp (t), not greater than Fd
  fd: number;     // design maximum wire tension Fd (t)
  bp: number;     // bollard pull (t)
  alpha: number;  // horizontal angle α (deg), positive outboard
  h: number;      // vertical distance from centre of propulsive force to the top of the towing pin (m)
  y0: number;     // centreline to inner part of the towing pin (m)
  x: number;      // longitudinal distance stern to towing pin (m)
  xStern: number; // X (from AP) where Fv acts (stern roller), m
  zStern: number; // height above base where Fv acts (stern roller), m
  lLL: number;    // Load Line length L (m)
}

/** 2.7.2.1: transverse distance y, vertical angle β, vertical load Fv and moment M_AH. */
export function anchorGeometry(a: AnchorInput, breadth: number) {
  const al = a.alpha * DEG;
  const y = Math.min(a.y0 + a.x * Math.tan(al), breadth / 2);
  // β at the maximum heeling moment angle, tan⁻¹(y / (h·sin α)), but not less than cos⁻¹(1.5·BP / (Fp·cos α))
  const betaMax = Math.atan2(y, a.h * Math.sin(al)) / DEG;
  const c = a.fp > 0 ? (1.5 * a.bp) / (a.fp * Math.cos(al)) : Infinity;
  const betaMin = c < 1 ? Math.acos(c) / DEG : 0; // when 1.5·BP ≥ Fp·cos α the lower limit does not apply
  const beta = Math.max(betaMax, betaMin);
  const be = beta * DEG;
  const fv = a.fp * Math.sin(be);
  const mah = a.fp * (a.h * Math.sin(al) * Math.cos(be) + y * Math.sin(be));
  return { y, beta, betaMax, betaMin, fv, mah };
}

/** Towing input (2.8.2). Bollard pull in t (converted to kN with g = 9.81). */
export interface TowingInput {
  bp: number;                                  // bollard pull (t)
  propulsion: 'CONVENTIONAL' | 'AZIMUTH' | 'OTHER';
  azimuthMin: 0.7 | 0.5;                       // 0.7: ASD over stern / tractor over bow; 0.5: ASD over bow / tractor over stern
  ctOther?: number;                            // C_T agreed with the Administration (OTHER)
  l: number;                                   // towing point to vertical centreline of propulsion unit (m)
  zTow: number;                                // towing point height above base (m)
  zProp: number;                               // horizontal centreline of propulsion unit above base (m)
  r: number;                                   // towing point off centreline (m)
  ls: number;                                  // AP to towing point (m)
  ap: number;                                  // lateral projected area of the underwater hull (m²)
  lLL: number;                                 // Load Line length (m)
}

/** 2.8.2.1 C_T. */
export function towCT(t: TowingInput): number {
  if (t.propulsion === 'CONVENTIONAL') return 0.5;
  if (t.propulsion === 'OTHER') return t.ctOther ?? NaN;
  return Math.max(0.9 / (1 + t.l / t.lLL), t.azimuthMin);
}

/** 2.8.2.1 self-tripping heeling lever HLφ = BP·C_T·(h cos φ − r sin φ) / (g·Δ), BP in kN. */
export function selfTrippingLever(t: TowingInput, disp: number, deg: number): number {
  const bpkN = t.bp * G;
  const h = t.zTow - t.zProp;
  return (bpkN * towCT(t) * (h * Math.cos(deg * DEG) - t.r * Math.sin(deg * DEG))) / (G * disp);
}

/** 2.8.2.2 tow-tripping coefficients and heeling lever. f = freeboard amidships, d = mean draught. */
export function towTripping(t: TowingInput, lpp: number, breadth: number, f: number, d: number, rho: number, disp: number, draftMS: number) {
  const C1 = Math.min(1, Math.max(0.1, 2.8 * (t.ls / lpp - 0.1)));
  const phiD = Math.atan((2 * f) / breadth) / DEG;
  const h = t.zTow - draftMS; // waterline to towing point
  const V = 2.57;
  const lever = (deg: number) => {
    const C2 = Math.max(1, deg / (3 * phiD) + 0.5);
    const C3 = Math.min(0.83, Math.max(0.5, (deg / phiD) * 0.26 + 0.3));
    return (C1 * C2 * rho * V * V * t.ap * (h * Math.cos(deg * DEG) - t.r * Math.sin(deg * DEG) + C3 * d)) / (2 * G * disp);
  };
  return { C1, phiD, h, V, lever };
}

/** 2.9.1.2 threshold heeling moment M_L = 0.67·Δ·GM·(f/B) (t·m). */
export function liftThreshold(disp: number, gm: number, f: number, breadth: number): number {
  return 0.67 * disp * gm * (f / breadth);
}

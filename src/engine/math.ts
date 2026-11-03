// Numerical building blocks. Pure functions, no I/O.

export class EngineError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

export const DEG = Math.PI / 180;
const EPS = 1e-9;

/** Kahan compensated summation (reduces floating point drift). */
export function kahanSum(values: number[]): number {
  let sum = 0;
  let c = 0;
  for (const v of values) {
    const y = v - c;
    const t = sum + y;
    c = t - sum - y;
    sum = t;
  }
  return sum;
}

export function assertIncreasing(xs: number[], label: string): void {
  for (let i = 1; i < xs.length; i++) {
    if (!(xs[i] > xs[i - 1])) {
      throw new EngineError('TABLE_NOT_MONOTONIC', `${label}: values must be strictly increasing (row ${i + 1}).`);
    }
  }
}

/** Index i such that xs[i] <= x <= xs[i+1]. Throws if x is outside the table (no extrapolation). */
function bracket(xs: number[], x: number, label: string): number {
  const n = xs.length;
  if (n < 2) throw new EngineError('TABLE_TOO_SHORT', `${label}: at least 2 rows are required.`);
  const lo = xs[0];
  const hi = xs[n - 1];
  const tol = EPS * Math.max(1, Math.abs(lo), Math.abs(hi));
  if (x < lo - tol || x > hi + tol || Number.isNaN(x)) {
    throw new EngineError(
      'OUT_OF_TABLE_RANGE',
      `${label}: value ${round(x, 4)} is outside the table range ${round(lo, 4)} – ${round(hi, 4)}.`,
    );
  }
  let a = 0;
  let b = n - 1;
  while (b - a > 1) {
    const m = (a + b) >> 1;
    if (xs[m] <= x) a = m;
    else b = m;
  }
  return a;
}

/** Linear interpolation without extrapolation. */
export function lerp(xs: number[], ys: number[], x: number, label: string): number {
  const i = bracket(xs, x, label);
  const x0 = xs[i];
  const x1 = xs[i + 1];
  const t = Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
  return ys[i] + t * (ys[i + 1] - ys[i]);
}

/**
 * Monotone piecewise cubic Hermite interpolation (PCHIP, Fritsch–Carlson).
 * Shape preserving: no overshoot between tabulated points.
 */
export function pchip(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length;
  const h: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i]);
    d.push((ys[i + 1] - ys[i]) / h[i]);
  }
  const m = new Array<number>(n).fill(0);
  if (n === 2) {
    m[0] = m[1] = d[0];
  } else {
    for (let k = 1; k < n - 1; k++) {
      if (d[k - 1] * d[k] <= 0) m[k] = 0;
      else {
        const w1 = 2 * h[k] + h[k - 1];
        const w2 = h[k] + 2 * h[k - 1];
        m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k]);
      }
    }
    m[0] = endSlope(h[0], h[1], d[0], d[1]);
    m[n - 1] = endSlope(h[n - 2], h[n - 3], d[n - 2], d[n - 3]);
  }
  return (x: number) => {
    const i = bracket(xs, x, 'Interpolation');
    const t = (x - xs[i]) / h[i];
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return h00 * ys[i] + h10 * h[i] * m[i] + h01 * ys[i + 1] + h11 * h[i] * m[i + 1];
  };
}

function endSlope(h0: number, h1: number, d0: number, d1: number): number {
  let m = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
  if (Math.sign(m) !== Math.sign(d0)) m = 0;
  else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(m) > Math.abs(3 * d0)) m = 3 * d0;
  return m;
}

/** Composite Simpson integration of f over [a,b] (x in degrees, result per radian). Step ≤ 0.1°. */
export function integrateDeg(f: (deg: number) => number, a: number, b: number): number {
  if (b <= a) return 0;
  let n = Math.ceil((b - a) / 0.1);
  if (n % 2 === 1) n += 1;
  const hDeg = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += (i % 2 === 1 ? 4 : 2) * f(a + i * hDeg);
  return (s * hDeg * DEG) / 3;
}

/** Bisection root finder on [a,b] where f(a) and f(b) have opposite signs. */
export function bisect(f: (x: number) => number, a: number, b: number, tol = 1e-6): number {
  let fa = f(a);
  for (let i = 0; i < 200; i++) {
    const m = 0.5 * (a + b);
    const fm = f(m);
    if (fm === 0 || (b - a) / 2 < tol) return m;
    if (Math.sign(fm) === Math.sign(fa)) {
      a = m;
      fa = fm;
    } else b = m;
  }
  return 0.5 * (a + b);
}

/**
 * Scans f from `from` to `to` (step `step`) for the first sign change of f(x) - level
 * and refines it by bisection. Returns null if no crossing exists.
 */
export function firstCrossing(
  f: (x: number) => number,
  level: number,
  from: number,
  to: number,
  step = 0.05,
): number | null {
  const g = (x: number) => f(x) - level;
  let x0 = from;
  let g0 = g(x0);
  if (g0 === 0) return x0;
  const dir = to >= from ? 1 : -1;
  while ((x0 - to) * dir < 0) {
    const x1 = dir > 0 ? Math.min(x0 + step, to) : Math.max(x0 - step, to);
    const g1 = g(x1);
    if (g1 === 0) return x1;
    if (Math.sign(g1) !== Math.sign(g0)) return bisect(g, Math.min(x0, x1), Math.max(x0, x1));
    x0 = x1;
    g0 = g1;
  }
  return null;
}

/** Linear interpolation on an IMO factor table with clamping at the ends (tables define ≤ / ≥ end values). */
export function tableFactor(xs: number[], ys: number[], x: number): { value: number; outOfRange: boolean } {
  if (x <= xs[0]) return { value: ys[0], outOfRange: x < xs[0] };
  if (x >= xs[xs.length - 1]) return { value: ys[ys.length - 1], outOfRange: x > xs[xs.length - 1] };
  return { value: lerp(xs, ys, x, 'IMO table'), outOfRange: false };
}

export function round(x: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

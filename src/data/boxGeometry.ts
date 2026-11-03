// Exact geometry of a box-shaped (rectangular section) hull.
// Used to generate the DEMO vessel and as an independent reference in tests.

type P = [number, number];

/** Clip polygon to the half-plane  z·cosφ − y·sinφ ≤ c  (submerged side). */
function clip(poly: P[], phi: number, c: number): P[] {
  const s = Math.sin(phi), co = Math.cos(phi);
  const f = (p: P) => p[1] * co - p[0] * s - c;
  const out: P[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const fa = f(a), fb = f(b);
    if (fa <= 0) out.push(a);
    if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

function areaCentroid(poly: P[]): { area: number; y: number; z: number } {
  let A = 0, cy = 0, cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const [y0, z0] = poly[i];
    const [y1, z1] = poly[(i + 1) % poly.length];
    const cr = y0 * z1 - y1 * z0;
    A += cr;
    cy += (y0 + y1) * cr;
    cz += (z0 + z1) * cr;
  }
  A /= 2;
  if (Math.abs(A) < 1e-12) return { area: 0, y: 0, z: 0 };
  return { area: Math.abs(A), y: cy / (6 * A), z: cz / (6 * A) };
}

/**
 * Exact KN (m) of a box section of breadth B and depth D, floating at even-keel draft T,
 * heeled to starboard by `deg` degrees (KN = yB·cosφ + zB·sinφ).
 */
export function boxKN(B: number, D: number, T: number, deg: number): number {
  if (deg === 0) return 0;
  const phi = (deg * Math.PI) / 180;
  const rect: P[] = [[-B / 2, 0], [B / 2, 0], [B / 2, D], [-B / 2, D]];
  const target = B * T;
  // c ranges over the projection of the rectangle on the "up" direction
  const proj = rect.map(([y, z]) => z * Math.cos(phi) - y * Math.sin(phi));
  let lo = Math.min(...proj), hi = Math.max(...proj);
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (areaCentroid(clip(rect, phi, mid)).area < target) lo = mid; else hi = mid;
  }
  const g = areaCentroid(clip(rect, phi, 0.5 * (lo + hi)));
  return g.y * Math.cos(phi) + g.z * Math.sin(phi);
}

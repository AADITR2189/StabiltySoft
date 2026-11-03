// Engineering-style stability diagrams (pure SVG, printable).
//   mode 'plain'   : GZ curve with GM tangent, flooding angle, GZmax
//   mode 'general' : IS Code 2008 §2.2 group: areas 0–30°, 30–40°/θf, GZ 0.20 m line, 25° line
//   mode 'weather' : IS Code 2008 §2.3 group: wind levers, roll-back angle, areas a and b
import type { Results } from '../engine/types';

type Mode = 'plain' | 'general' | 'weather';
type Pt = { heel: number; gz: number };

export function GzChart({ r, mode = 'plain' }: { r: Results; mode?: Mode }) {
  const W = 800, H = 380, m = { l: 56, r: 24, t: 26, b: 44 };
  // Weather diagram is drawn on the side the wind acts towards (mirrored for port).
  const mirror = mode === 'weather' && r.weather?.side === -1;
  const pts = mirror ? r.gzCurve.map((p) => ({ heel: p.heel, gz: p.gz + 2 * r.tcg * Math.cos((p.heel * Math.PI) / 180) })) : r.gzCurve;
  const tcgS = mirror ? -r.tcg : r.tcg;
  const xMax = pts[pts.length - 1]?.heel ?? 90;
  const w = mode === 'weather' ? r.weather : null;
  const xMin = w ? Math.min(-10, Math.floor((w.thetaR - 5) / 10) * 10) : 0;

  // GZ for negative angles from symmetry: GZ(−φ) = −GZ(φ) − 2·TCG·cos φ
  const neg: Pt[] = [];
  for (let a = xMin; a < 0; a++) {
    const p = pts[-a];
    if (p) neg.push({ heel: a, gz: -p.gz - 2 * tcgS * Math.cos((a * Math.PI) / 180) });
  }
  const curve: Pt[] = [...neg, ...pts];
  const gzAt = (x: number) => interp(curve, x);

  const visible = curve.map((p) => p.gz);
  const yTop = Math.max(0.3, ...visible) * 1.12;
  const yMax = niceCeil(yTop);
  const yMin = Math.min(0, niceFloor(Math.min(...visible) * 1.05));
  const sx = (x: number) => m.l + ((x - xMin) / (xMax - xMin)) * (W - m.l - m.r);
  const sy = (y: number) => m.t + ((yMax - y) / (yMax - yMin)) * (H - m.t - m.b);
  const yStep = niceStep((yMax - yMin) / 6);
  const yTicks: number[] = [];
  for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax + 1e-9; y += yStep) yTicks.push(Math.round(y * 1000) / 1000);
  const xTicks: number[] = [];
  for (let x = xMin; x <= xMax; x += 10) xTicks.push(x);

  const line = (c: Pt[]) => c.map((p, i) => `${i ? 'L' : 'M'}${sx(p.heel).toFixed(1)},${sy(p.gz).toFixed(1)}`).join(' ');
  /** closed shape between the GZ curve and a horizontal level, from a to b */
  const band = (a: number, b: number, level: number) => {
    if (!(b > a)) return '';
    const seg = [{ heel: a, gz: gzAt(a) }, ...curve.filter((p) => p.heel > a && p.heel < b), { heel: b, gz: gzAt(b) }];
    return `M${sx(a)},${sy(level)} ${seg.map((p) => `L${sx(p.heel)},${sy(p.gz)}`).join(' ')} L${sx(b)},${sy(level)} Z`;
  };
  // row ≥ 0: label rows from the top; row < 0: label rows from the bottom of the plot
  const vline = (x: number, cls: string, label?: string, row = 0, anchor: 'start' | 'end' = 'start') =>
    x >= xMin && x <= xMax ? (
      <g>
        <line x1={sx(x)} x2={sx(x)} y1={m.t} y2={H - m.b} className={cls} />
        {label && (
          <text x={sx(x) + (anchor === 'start' ? 4 : -4)} y={row >= 0 ? m.t + 10 + row * 14 : H - m.b - 6 + (row + 1) * 14} textAnchor={anchor} className="tick">
            {label}
          </text>
        )}
      </g>
    ) : null;
  // GM tangent: from origin to (57.3°, GM), clipped at the top of the plot
  const gmEnd = r.gmFluid > yMax ? { x: (57.3 * yMax) / r.gmFluid, y: yMax } : { x: 57.3, y: r.gmFluid };

  const crit = (code: string) => r.criteria.find((c) => c.code === code);
  const mark = (code: string) => (crit(code) ? (crit(code)!.passed ? ' ✔' : ' ✖') : '');
  const lim40 = Math.min(40, r.floodAngle);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`GZ curve, ${mode} view`}>
      {yTicks.map((y) => (
        <g key={`y${y}`}>
          <line x1={m.l} x2={W - m.r} y1={sy(y)} y2={sy(y)} className={Math.abs(y) < 1e-9 ? 'axis' : 'grid'} />
          <text x={m.l - 6} y={sy(y) + 4} textAnchor="end" className="tick">{fmtTick(y, yStep)}</text>
        </g>
      ))}
      {xTicks.map((x) => (
        <g key={`x${x}`}>
          <line y1={m.t} y2={H - m.b} x1={sx(x)} x2={sx(x)} className={x === 0 ? 'axis' : 'grid'} />
          <text x={sx(x)} y={H - m.b + 16} textAnchor="middle" className="tick">{x}</text>
        </g>
      ))}
      <text x={(W + m.l) / 2} y={H - 6} textAnchor="middle" className="label">{mirror ? 'Heel angle to port (°)' : 'Heel angle (°)'}</text>
      <text x={14} y={(H - m.b) / 2} textAnchor="middle" className="label" transform={`rotate(-90 14 ${(H - m.b) / 2})`}>GZ (m)</text>

      {mode === 'general' && (
        <>
          <path d={band(0, Math.min(30, r.floodAngle), 0)} className="area-1" />
          {lim40 > 30 && <path d={band(30, lim40, 0)} className="area-2" />}
          <text x={sx(Math.min(30, r.floodAngle) * 0.62)} y={sy(gzAt(Math.min(30, r.floodAngle) * 0.62) * 0.35)} textAnchor="middle" className="area-label">
            {`0–30°: ${crit('IS-2.2.1.1')?.actual.toFixed(4)}${mark('IS-2.2.1.1')}`}
          </text>
          {lim40 > 30 && (
            <text x={sx((30 + lim40) / 2)} y={sy(gzAt(30) * 0.35)} textAnchor="middle" className="area-label">
              {`${crit('IS-2.2.1.3')?.actual.toFixed(4)}${mark('IS-2.2.1.3')}`}
            </text>
          )}
          {vline(25, 'ref', `25° (min. angle of GZmax)${mark('IS-2.2.3')}`, 0, 'end')}
          {vline(30, 'ref', '30°', 1)}
          {lim40 < 40 ? null : vline(40, 'ref', '40°', 1)}
          <line x1={sx(30)} x2={sx(xMax)} y1={sy(0.2)} y2={sy(0.2)} className="ref" />
          <text x={sx(xMax) - 4} y={sy(0.2) - 5} textAnchor="end" className="tick">{`GZ ≥ 0.20 m at ≥ 30°${mark('IS-2.2.2')}`}</text>
        </>
      )}

      {w && (
        <>
          {w.thetaX !== null && <path d={band(w.thetaR, w.thetaX, w.lw2)} className="area-a" />}
          {w.thetaX !== null && <path d={band(w.thetaX, w.theta2, w.lw2)} className="area-b" />}
          <line x1={sx(xMin)} x2={sx(xMax)} y1={sy(w.lw1)} y2={sy(w.lw1)} className="wind1" />
          <line x1={sx(xMin)} x2={sx(xMax)} y1={sy(w.lw2)} y2={sy(w.lw2)} className="wind2" />
          <text x={sx(xMax) - 4} y={sy(w.lw2) - 5} textAnchor="end" className="tick">{`l_w2 (gust) ${w.lw2.toFixed(4)} m`}</text>
          <text x={sx(xMax) - 4} y={sy(w.lw1) + 14} textAnchor="end" className="tick">{`l_w1 (steady) ${w.lw1.toFixed(4)} m`}</text>
          {vline(w.thetaR, 'ref', `θ0−θ1 = ${w.thetaR.toFixed(1)}°`, 0)}
          {vline(w.theta0, 'ref', `θ0 = ${w.theta0.toFixed(1)}°${mark('IS-2.3-HEEL')}`, 1)}
          {vline(w.theta2, 'ref', `θ2 = ${w.theta2.toFixed(1)}°`, 2)}
          {w.thetaX !== null && (
            <>
              <text x={sx((w.thetaR + w.thetaX) / 2)} y={sy(w.lw2) - 8} textAnchor="middle" className="area-label">{`a = ${w.areaA.toFixed(4)}`}</text>
              <text x={sx((w.thetaX + w.theta2) / 2)} y={sy((gzAt((w.thetaX + w.theta2) / 2) + w.lw2) / 2)} textAnchor="middle" className="area-label">
                {`b = ${w.areaB.toFixed(4)}${mark('IS-2.3-AREA')}`}
              </text>
            </>
          )}
        </>
      )}

      {r.gmFluid > 0 && mode !== 'weather' && (
        <>
          <line x1={sx(0)} y1={sy(0)} x2={sx(gmEnd.x)} y2={sy(gmEnd.y)} className="gm" />
          <line x1={sx(57.3)} x2={sx(57.3)} y1={sy(0)} y2={sy(Math.min(r.gmFluid, yMax))} className="gm" />
          <text x={sx(57.3) + 4} y={sy(0) - 6} className="tick">{`1 rad · GM ${r.gmFluid.toFixed(3)} m`}</text>
        </>
      )}
      {r.floodAngle < xMax && vline(r.floodAngle, 'flood', `θf ${r.floodAngle.toFixed(1)}°`, -1)}
      <path d={line(curve)} className="gz" />
      {mode !== 'weather' && (
        <>
          <circle cx={sx(r.gzMaxAngle)} cy={sy(r.gzMax)} r={4} className="gzmax" />
          <text x={sx(r.gzMaxAngle) + 8} y={sy(r.gzMax) - 9} textAnchor="start" className="tick">
            {`GZmax ${r.gzMax.toFixed(3)} m @ ${r.gzMaxAngle.toFixed(1)}°`}
          </text>
        </>
      )}
    </svg>
  );
}

function interp(c: Pt[], x: number): number {
  for (let i = 0; i < c.length - 1; i++) {
    if (c[i].heel <= x && x <= c[i + 1].heel) {
      const t = (x - c[i].heel) / (c[i + 1].heel - c[i].heel || 1);
      return c[i].gz + t * (c[i + 1].gz - c[i].gz);
    }
  }
  return c[c.length - 1].gz;
}

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
function niceCeil(v: number) { const s = niceStep(v / 5); return Math.ceil(v / s) * s; }
function niceFloor(v: number) { if (v >= 0) return 0; const s = niceStep(-v / 3); return Math.floor(v / s) * s; }
function fmtTick(y: number, step: number) { return y.toFixed(step < 0.1 ? 2 : 1); }

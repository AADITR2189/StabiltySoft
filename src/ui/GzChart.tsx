// Engineering-style GZ curve chart (pure SVG, printable).
import type { Results } from '../engine/types';

interface Props {
  r: Results;
  showWeather?: boolean;
}

export function GzChart({ r, showWeather = true }: Props) {
  const W = 760, H = 360, m = { l: 56, r: 20, t: 18, b: 42 };
  const pts = r.gzCurve;
  const xMax = pts[pts.length - 1]?.heel ?? 90;
  const w = r.weather;
  const xMin = showWeather && w ? Math.min(0, Math.floor(w.thetaR / 10) * 10) : 0;
  const gzVals = pts.map((p) => p.gz);
  const yMaxRaw = Math.max(0.2, ...gzVals, r.gmFluid > 0 ? Math.min(r.gmFluid, 3) : 0);
  const yMax = Math.ceil(yMaxRaw * 5) / 5;
  const yMin = Math.min(0, Math.floor(Math.min(...gzVals, showWeather && w ? -yMax * 0.6 : 0) * 5) / 5);
  const sx = (x: number) => m.l + ((x - xMin) / (xMax - xMin)) * (W - m.l - m.r);
  const sy = (y: number) => m.t + ((yMax - y) / (yMax - yMin)) * (H - m.t - m.b);

  // negative side of the curve (needed for the weather criterion roll-back)
  const neg: { heel: number; gz: number }[] = [];
  if (xMin < 0) {
    for (let a = xMin; a < 0; a += 1) {
      const p = pts.find((q) => q.heel === -a);
      if (p) neg.push({ heel: a, gz: -p.gz - 2 * r.tcg * Math.cos((a * Math.PI) / 180) });
    }
  }
  const curve = [...neg, ...pts];
  const path = curve.map((p, i) => `${i ? 'L' : 'M'}${sx(p.heel).toFixed(1)},${sy(p.gz).toFixed(1)}`).join(' ');

  const xTicks: number[] = [];
  for (let x = xMin; x <= xMax; x += 10) xTicks.push(x);
  const yTicks: number[] = [];
  const yStep = yMax - yMin > 2 ? 0.5 : yMax - yMin > 1 ? 0.2 : 0.1;
  for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax + 1e-9; y += yStep) yTicks.push(Math.round(y * 100) / 100);

  // shaded areas a and b (weather criterion)
  const areaPath = (from: number, to: number, lw: number) => {
    if (to <= from) return '';
    const seg = curve.filter((p) => p.heel >= from && p.heel <= to);
    const ptsA = [{ heel: from, gz: interp(curve, from) }, ...seg, { heel: to, gz: interp(curve, to) }];
    return `M${sx(from)},${sy(lw)} ` + ptsA.map((p) => `L${sx(p.heel)},${sy(p.gz)}`).join(' ') + ` L${sx(to)},${sy(lw)} Z`;
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="GZ righting lever curve">
      {yTicks.map((y) => (
        <g key={`y${y}`}>
          <line x1={m.l} x2={W - m.r} y1={sy(y)} y2={sy(y)} className={y === 0 ? 'axis' : 'grid'} />
          <text x={m.l - 6} y={sy(y) + 4} textAnchor="end" className="tick">{y.toFixed(1)}</text>
        </g>
      ))}
      {xTicks.map((x) => (
        <g key={`x${x}`}>
          <line y1={m.t} y2={H - m.b} x1={sx(x)} x2={sx(x)} className={x === 0 ? 'axis' : 'grid'} />
          <text x={sx(x)} y={H - m.b + 16} textAnchor="middle" className="tick">{x}</text>
        </g>
      ))}
      <text x={(W + m.l) / 2} y={H - 6} textAnchor="middle" className="label">Heel angle (°)</text>
      <text x={14} y={(H - m.b) / 2} textAnchor="middle" className="label" transform={`rotate(-90 14 ${(H - m.b) / 2})`}>GZ (m)</text>

      {showWeather && w && w.thetaX !== null && (
        <>
          <path d={areaPath(w.thetaR, w.thetaX, w.lw2)} className="area-a" />
          <path d={areaPath(w.thetaX, w.theta2, w.lw2)} className="area-b" />
          <line x1={sx(xMin)} x2={sx(xMax)} y1={sy(w.lw1)} y2={sy(w.lw1)} className="wind1" />
          <line x1={sx(xMin)} x2={sx(xMax)} y1={sy(w.lw2)} y2={sy(w.lw2)} className="wind2" />
          <text x={sx(xMax) - 4} y={sy(w.lw2) - 4} textAnchor="end" className="tick">l_w2 {w.lw2.toFixed(3)} m</text>
        </>
      )}

      {r.gmFluid > 0 && (
        <line x1={sx(0)} y1={sy(0)} x2={sx(57.3)} y2={sy(r.gmFluid)} className="gm" />
      )}
      {r.floodAngle < xMax && (
        <>
          <line x1={sx(r.floodAngle)} x2={sx(r.floodAngle)} y1={m.t} y2={H - m.b} className="flood" />
          <text x={sx(r.floodAngle) + 4} y={m.t + 12} className="tick">θf {r.floodAngle.toFixed(1)}°</text>
        </>
      )}
      <path d={path} className="gz" />
      <circle cx={sx(r.gzMaxAngle)} cy={sy(r.gzMax)} r={4} className="gzmax" />
      <text x={sx(r.gzMaxAngle)} y={sy(r.gzMax) - 8} textAnchor="middle" className="tick">
        GZmax {r.gzMax.toFixed(3)} m @ {r.gzMaxAngle.toFixed(1)}°
      </text>
    </svg>
  );
}

function interp(c: { heel: number; gz: number }[], x: number): number {
  for (let i = 0; i < c.length - 1; i++) {
    if (c[i].heel <= x && x <= c[i + 1].heel) {
      const t = (x - c[i].heel) / (c[i + 1].heel - c[i].heel || 1);
      return c[i].gz + t * (c[i + 1].gz - c[i].gz);
    }
  }
  return c[c.length - 1].gz;
}

// Engineering-style stability diagrams (pure SVG, printable). The GZ curve is drawn towards
// the side of heel (as calculated by the engine).
//   plain   : GZ curve with GM tangent, flooding angle, GZmax
//   general : GZ curve annotated from the group's own criteria (areas, limit lines)
//   weather : IS Code 2008 §2.3: wind levers, roll-back angle, areas a and b
//   fifi    : fire-fighting heeling arm (M·cos φ / Δ) and equilibrium angle
//   crane   : lifting wind lever, φ1, φ2, ARL / AHL areas
import type { ReactElement } from 'react';
import type { CriterionResult, Results } from '../engine/types';

type Mode = 'plain' | 'general' | 'weather' | 'fifi' | 'crane';
type Pt = { heel: number; gz: number };

const AREA_CLASSES = ['area-1', 'area-2', 'area-3', 'area-4'];

export function GzChart({ r, mode = 'plain', criteria = [] }: { r: Results; mode?: Mode; criteria?: CriterionResult[] }) {
  const W = 800, H = 380, m = { l: 56, r: 24, t: 26, b: 44 };
  const pts = r.gzCurve;
  const xMax = pts[pts.length - 1]?.heel ?? 90;
  const w = mode === 'weather' ? r.weather : null;
  const xMin = w ? Math.min(-10, Math.floor((w.thetaR - 5) / 10) * 10) : 0;
  const tcgS = r.side * r.tcg;

  // GZ for negative angles from symmetry: GZ(−φ) = −GZ(φ) − 2·TCG·cos φ
  const neg: Pt[] = [];
  for (let a = xMin; a < 0; a++) {
    const p = pts[-a];
    if (p) neg.push({ heel: a, gz: -p.gz - 2 * tcgS * Math.cos((a * Math.PI) / 180) });
  }
  const curve: Pt[] = [...neg, ...pts];
  const gzAt = (x: number) => interp(curve, x);

  const visible = curve.map((p) => p.gz);
  const yMax = niceCeil(Math.max(0.3, ...visible) * 1.12);
  const yMin = Math.min(0, niceFloor(Math.min(...visible) * 1.05));
  const sx = (x: number) => m.l + ((x - xMin) / (xMax - xMin)) * (W - m.l - m.r);
  const sy = (y: number) => m.t + ((yMax - y) / (yMax - yMin)) * (H - m.t - m.b);
  const yStep = niceStep((yMax - yMin) / 6);
  const yTicks: number[] = [];
  for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax + 1e-9; y += yStep) yTicks.push(Math.round(y * 1000) / 1000);
  const xTicks: number[] = [];
  for (let x = xMin; x <= xMax; x += 10) xTicks.push(x);

  const line = (c: Pt[]) => c.map((p, i) => `${i ? 'L' : 'M'}${sx(p.heel).toFixed(1)},${sy(p.gz).toFixed(1)}`).join(' ');
  /** closed shape between the GZ curve and a level (constant or a function of heel), from a to b */
  const band = (a: number, b: number, level: number | ((x: number) => number)) => {
    if (!(b > a)) return '';
    const lv = typeof level === 'number' ? () => level : level;
    const xs = [a, ...curve.filter((p) => p.heel > a && p.heel < b).map((p) => p.heel), b];
    const top = xs.map((x) => `L${sx(x)},${sy(gzAt(x))}`).join(' ');
    const bottom = [...xs].reverse().map((x) => `L${sx(x)},${sy(lv(x))}`).join(' ');
    return `M${sx(a)},${sy(lv(a))} ${top} ${bottom} Z`;
  };
  let labelRow = 0;
  const vline = (x: number, cls: string, label?: string, row?: number, anchor: 'start' | 'end' = 'start') => {
    if (x < xMin || x > xMax) return null;
    const rr = row ?? labelRow++;
    return (
      <g key={`v${cls}${x}${label}`}>
        <line x1={sx(x)} x2={sx(x)} y1={m.t} y2={H - m.b} className={cls} />
        {label && (
          <text x={sx(x) + (anchor === 'start' ? 4 : -4)} y={rr >= 0 ? m.t + 10 + rr * 14 : H - m.b - 6 + (rr + 1) * 14} textAnchor={anchor} className="tick">
            {label}
          </text>
        )}
      </g>
    );
  };
  const gmEnd = r.gmFluid > yMax ? { x: (57.3 * yMax) / r.gmFluid, y: yMax } : { x: 57.3, y: r.gmFluid };
  const mark = (c?: CriterionResult) => (c ? (c.passed ? ' ✔' : ' ✖') : '');

  // ---- general: annotations from the group's criteria ----
  const general: ReactElement[] = [];
  if (mode === 'general') {
    let ai = 0;
    const areas = criteria.flatMap((c) => (c.viz ?? []).filter((v) => v.type === 'area').map((v) => ({ v, c })))
      .sort((p, q) => (q.v.type === 'area' && p.v.type === 'area' ? (q.v.to - q.v.from) - (p.v.to - p.v.from) : 0));
    areas.forEach(({ v, c }, i) => {
      if (v.type !== 'area' || v.to <= v.from) return;
      const cls = AREA_CLASSES[ai++ % AREA_CLASSES.length];
      general.push(<path key={`a${i}`} d={band(v.from, v.to, 0)} className={cls} />);
      const mid = (v.from + v.to) / 2;
      general.push(
        <text key={`al${i}`} x={sx(mid)} y={sy(Math.max(0, gzAt(mid)) * (0.2 + 0.18 * i))} textAnchor="middle" className="area-label">
          {`${v.from.toFixed(0)}–${v.to.toFixed(1)}°: ${c.actual.toFixed(4)}${mark(c)}`}
        </text>,
      );
    });
    const drawnArms = new Set<string>();
    criteria.forEach((c, i) => (c.viz ?? []).forEach((v, j) => {
      if (v.type === 'residArea' && v.to > v.from) {
        const lv = (x: number) => interpArm(v.points, x);
        general.push(<path key={`r${i}${j}`} d={band(v.from, v.to, lv)} className="area-b" />);
        const mid = (v.from + v.to) / 2;
        general.push(<text key={`rl${i}${j}`} x={sx(mid)} y={sy((gzAt(mid) + lv(mid)) / 2)} textAnchor="middle" className="area-label">{`residual ${c.actual.toFixed(4)}${mark(c)}`}</text>);
      } else if (v.type === 'arm' && !drawnArms.has(v.label)) {
        drawnArms.add(v.label);
        general.push(<path key={`m${i}${j}`} d={line(v.points.filter((p) => p.heel <= xMax).map((p) => ({ heel: p.heel, gz: p.arm })))} className="wind2" fill="none" />);
        const p0 = v.points[Math.min(2, v.points.length - 1)];
        general.push(<text key={`ml${i}${j}`} x={sx(p0.heel) + 4} y={sy(p0.arm) - 6} className="tick">{`Heeling arm: ${v.label}`}</text>);
      } else if (v.type === 'hline') {
        general.push(<line key={`h${i}${j}`} x1={sx(v.from)} x2={sx(xMax)} y1={sy(v.value)} y2={sy(v.value)} className="ref" />);
        general.push(<text key={`hl${i}${j}`} x={sx(xMax) - 4} y={sy(v.value) - 5} textAnchor="end" className="tick">{v.label + mark(c)}</text>);
      } else if (v.type === 'vline') {
        const el = vline(v.angle, 'ref', v.label + mark(c), undefined, v.angle < 30 ? 'end' : 'start');
        if (el) general.push(el);
      }
    }));
  }

  const f = mode === 'fifi' ? r.fifi : null;
  const cr = mode === 'crane' ? r.crane : null;
  const critOf = (code: string) => r.criteria.find((c) => c.code === code);

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
      <text x={(W + m.l) / 2} y={H - 6} textAnchor="middle" className="label">{r.side < 0 ? 'Heel angle to port (°)' : 'Heel angle (°)'}</text>
      <text x={14} y={(H - m.b) / 2} textAnchor="middle" className="label" transform={`rotate(-90 14 ${(H - m.b) / 2})`}>GZ (m)</text>

      {general}

      {w && (
        <>
          {w.thetaX !== null && <path d={band(w.thetaR, w.thetaX, w.lw2)} className="area-a" />}
          {w.thetaX !== null && <path d={band(w.thetaX, w.theta2, w.lw2)} className="area-b" />}
          <line x1={sx(xMin)} x2={sx(xMax)} y1={sy(w.lw1)} y2={sy(w.lw1)} className="wind1" />
          <line x1={sx(xMin)} x2={sx(xMax)} y1={sy(w.lw2)} y2={sy(w.lw2)} className="wind2" />
          <text x={sx(xMax) - 4} y={sy(w.lw2) - 5} textAnchor="end" className="tick">{`l_w2 (gust) ${w.lw2.toFixed(4)} m`}</text>
          {vline(w.thetaR, 'ref', `θ0−θ1 = ${w.thetaR.toFixed(1)}°`, 0)}
          {vline(w.theta0, 'ref', `θ0 = ${w.theta0.toFixed(1)}°${mark(critOf('IS-2.3-HEEL') ?? critOf('A562-HEEL'))}`, 1)}
          {vline(w.theta2, 'ref', `θ2 = ${w.theta2.toFixed(1)}°`, 2)}
          {w.thetaX !== null && (
            <>
              <text x={sx((w.thetaR + w.thetaX) / 2)} y={sy(w.lw2) - 8} textAnchor="middle" className="area-label">{`a = ${w.areaA.toFixed(4)}`}</text>
              <text x={sx((w.thetaX + w.theta2) / 2)} y={sy((gzAt((w.thetaX + w.theta2) / 2) + w.lw2) / 2)} textAnchor="middle" className="area-label">
                {`b = ${w.areaB.toFixed(4)}${mark(critOf('IS-2.3-AREA') ?? critOf('A562-AREA'))}`}
              </text>
            </>
          )}
        </>
      )}

      {f && (
        <>
          <path d={line(pts.map((p) => ({ heel: p.heel, gz: f.arm0 * Math.cos((p.heel * Math.PI) / 180) })))} className="wind2" fill="none" />
          <text x={sx(xMax * 0.55)} y={sy(f.arm0) - 6} className="tick">{`Heeling arm ${f.arm0.toFixed(4)}·cos φ m (M = ${f.moment.toFixed(1)} t·m)`}</text>
          {vline(f.equilibrium, 'ref', `Equilibrium ${f.equilibrium.toFixed(2)}°${mark(critOf('FIFI-1'))}`, 0)}
          {vline(5, 'flood', 'Limit 5°', 1)}
        </>
      )}

      {cr && (
        <>
          <path d={band(cr.phi1, cr.phi2, cr.lw)} className="area-b" />
          <path d={band(cr.phi1, Math.min(20, r.floodAngle), cr.lw)} className="area-2" />
          <line x1={sx(0)} x2={sx(xMax)} y1={sy(cr.lw)} y2={sy(cr.lw)} className="wind2" />
          <text x={sx(xMax) - 4} y={sy(cr.lw) - 5} textAnchor="end" className="tick">{`Wind lever during lift ${cr.lw.toFixed(4)} m`}</text>
          {vline(cr.phi1, 'ref', `φ1 = ${cr.phi1.toFixed(2)}°${mark(critOf('CRANE-1'))}`, 0)}
          {vline(cr.phi2, 'ref', `φ2 = ${cr.phi2.toFixed(1)}°`, 1)}
          {vline(cr.deckEdgeAngle, 'ref', `Deck edge ${cr.deckEdgeAngle.toFixed(1)}°${mark(critOf('CRANE-4'))}`, 2)}
          <text x={sx((cr.phi1 + Math.min(20, r.floodAngle)) / 2)} y={sy(gzAt(10) * 0.45)} textAnchor="middle" className="area-label">
            {`to 20°: ${cr.areaTo20.toFixed(3)}${mark(critOf('CRANE-3'))}`}
          </text>
          <text x={sx((20 + cr.phi2) / 2)} y={sy(gzAt((20 + cr.phi2) / 2) * 0.5)} textAnchor="middle" className="area-label">
            {`ARL/AHL ${(cr.ahl > 0 ? cr.arl / cr.ahl : 0).toFixed(1)}${mark(critOf('CRANE-2'))}`}
          </text>
        </>
      )}

      {r.gmFluid > 0 && (mode === 'plain' || mode === 'general') && (
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
  if (x <= c[0].heel) return c[0].gz;
  for (let i = 0; i < c.length - 1; i++) {
    if (c[i].heel <= x && x <= c[i + 1].heel) {
      const t = (x - c[i].heel) / (c[i + 1].heel - c[i].heel || 1);
      return c[i].gz + t * (c[i + 1].gz - c[i].gz);
    }
  }
  return c[c.length - 1].gz;
}

function interpArm(pts: { heel: number; arm: number }[], x: number): number {
  return interp(pts.map((p) => ({ heel: p.heel, gz: p.arm })), x);
}

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
function niceCeil(v: number) { const s = niceStep(v / 5); return Math.ceil(v / s) * s; }
function niceFloor(v: number) { if (v >= 0) return 0; const s = niceStep(-v / 3); return Math.floor(v / s) * s; }
function fmtTick(y: number, step: number) { return y.toFixed(step < 0.1 ? 2 : 1); }

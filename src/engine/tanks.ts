// Tank content conversion (docs/A-Calculation-Methods.md §A.4).
import { EngineError, assertIncreasing, lerp } from './math';
import type { FsmMethod, Tank, TankResult, TankStatus, Warning } from './types';

const FULL_TOL = 1e-6;

export function resolveTank(
  tank: Tank,
  status: TankStatus | undefined,
  fsmMethod: FsmMethod,
  warnings: Warning[],
  overfillWarnPct = 98,
): TankResult {
  const density = status?.density ?? tank.density;
  const input = status?.input ?? { mode: 'VOLUME', value: 0 };
  const cal = tank.calibration;
  const vols = cal.map((r) => r.volume);
  assertIncreasing(vols, `${tank.name} calibration (volume)`);

  if (!(density > 0)) throw new EngineError('INVALID_DENSITY', `${tank.name}: liquid density must be greater than 0.`);

  let volume: number;
  switch (input.mode) {
    case 'FILLED':
      volume = tank.capacity;
      break;
    case 'PERCENT':
      volume = (input.value / 100) * tank.capacity;
      break;
    case 'VOLUME':
      volume = input.value;
      break;
    case 'WEIGHT':
      volume = input.value / density;
      break;
    case 'SOUNDING': {
      if (cal.some((r) => r.sounding === undefined)) {
        throw new EngineError('NO_SOUNDING_TABLE', `${tank.name}: no sounding table is available. Enter the tank by %, volume or weight.`);
      }
      const snd = cal.map((r) => r.sounding as number);
      assertIncreasing(snd, `${tank.name} calibration (sounding)`);
      volume = lerp(snd, vols, input.value, `${tank.name} sounding`);
      break;
    }
  }

  if (volume < -FULL_TOL) throw new EngineError('NEGATIVE_QUANTITY', `${tank.name}: quantity cannot be negative.`);
  volume = Math.max(0, volume);
  if (volume > tank.capacity * (1 + FULL_TOL)) {
    throw new EngineError(
      'TANK_OVERFILLED',
      `${tank.name}: ${volume.toFixed(1)} m³ exceeds the 100 % capacity of ${tank.capacity.toFixed(1)} m³.`,
    );
  }
  const percent = (volume / tank.capacity) * 100;
  // Pressed-up (100 %) tanks are normal practice; warn only for fillings between the limit and 100 %.
  if (percent > overfillWarnPct + 1e-9 && percent < 100 - 1e-6) {
    warnings.push({ code: 'TANK_ABOVE_98', message: `${tank.name} is filled to ${percent.toFixed(1)} % (between ${overfillWarnPct} % and 100 %). Press up or reduce.` });
  }

  const weight = volume * density;
  let lcg = 0, tcg = 0, vcg = 0, fsm = 0;
  if (volume > 0) {
    const label = `${tank.name} calibration`;
    lcg = lerp(vols, cal.map((r) => r.lcg), volume, label);
    tcg = lerp(vols, cal.map((r) => r.tcg), volume, label);
    vcg = lerp(vols, cal.map((r) => r.vcg), volume, label);
    const slack = volume < tank.capacity * (1 - FULL_TOL);
    if (slack && fsmMethod !== 'MANUAL_TOTAL') {
      const inertia =
        fsmMethod === 'MAXIMUM'
          ? Math.max(...cal.map((r) => r.inertia))
          : lerp(vols, cal.map((r) => r.inertia), volume, label);
      fsm = inertia * density;
    }
  }

  return { tankId: tank.id, name: tank.name, mode: input.mode, volume, weight, percent, density, lcg, tcg, vcg, fsm };
}

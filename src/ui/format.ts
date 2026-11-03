export function f(v: number | null | undefined, dp: number): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function unitFmt(v: number, unit: string): string {
  if (unit === 'm·rad') return `${f(v, 4)} m·rad`;
  if (unit === '°') return `${f(v, 1)}°`;
  return `${f(v, 3)} ${unit}`;
}

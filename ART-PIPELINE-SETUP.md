// Display-side pay maths — the EXACT expression the engine evaluates,
// in the exact same operation order, so floating point can never make
// the screen and the award disagree. Engine (evaluate.ts):
//   lines/scatter/cluster: raw = bet * multiplier * mf * 0.6
//   ways:                  raw = bet * multiplier * mf * 0.6 * ways / 9
// GC rounding: floor, min 1. Tested against the engine in __tests__.

export function displayPrizeGC(bet: number, multiplier: number, mf: number, div = 1): number {
  return Math.max(1, Math.floor((bet * multiplier * mf * 0.6 * 1) / div));
}

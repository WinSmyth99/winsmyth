// Cascades (tumbling wins) + reel-strip construction — ported from v19
// with the DOM coupling removed. The cascade chain operates on the
// logical grid alone; presentation animates the deltas the engine
// reports. RNG is injectable for deterministic tests.

import {
  Cell, CellRef, EvalResult, FreeSpinCtx, Grid, GridSym, MoneyMode,
  ROWS, Rng, SlotDef, Win,
} from './types';
import { evaluateGrid } from './evaluate';

export const CASCADE_MULTS = [1, 2, 3, 5];
export function cascadeMult(step: number): number {
  return CASCADE_MULTS[Math.min(step, CASCADE_MULTS.length - 1)];
}

const VOL_FACTOR: Record<SlotDef['volatility'], number> = {
  low: 0.4, medium: 1, high: 1.6, insane: 2.8,
};

// Weighted refill draw: same volatility weighting as the strip, plus a
// small wild chance. Never scatters — free spins trigger from the
// initial drop only.
export function drawRefillSymbol(slot: SlotDef, rng: Rng = Math.random): GridSym {
  if (rng() < 0.06) {
    return { ...slot.wildSymbol, multiplier: 0, isWild: true };
  }
  const vf = VOL_FACTOR[slot.volatility] ?? 1;
  const pool: GridSym[] = [];
  slot.symbols.forEach((s, i) => {
    const w = Math.max(1, Math.round((slot.symbols.length - i) * (1 + vf * 0.25)));
    for (let j = 0; j < w; j++) pool.push(s);
  });
  return pool[Math.floor(rng() * pool.length)];
}

// The set of grid cells consumed by a result's wins.
export function winCells(wins: Win[]): Set<string> {
  const cells = new Set<string>();
  wins.forEach((lw) => lw.cells.forEach((c) => cells.add(`${c.reel}:${c.row}`)));
  return cells;
}

// Mutate the logical grid: remove consumed cells, drop survivors,
// refill from the top. Returns the affected reel indices.
export function collapseGrid(
  slot: SlotDef, grid: Grid, cells: Set<string>, rng: Rng = Math.random,
): Set<number> {
  const affected = new Set<number>();
  cells.forEach((k) => affected.add(Number(k.split(':')[0])));
  for (const reel of affected) {
    const kept: Cell[] = [];
    for (let row = 0; row < ROWS; row++) {
      if (!cells.has(`${reel}:${row}`)) kept.push(grid[reel][row]);
    }
    const fresh: Cell[] = [];
    for (let k = 0; k < ROWS - kept.length; k++) {
      fresh.push({ sym: drawRefillSymbol(slot, rng) });
    }
    grid[reel] = fresh.concat(kept);
  }
  return affected;
}

export interface CascadeStep {
  result: EvalResult;
  mult: number;
  stepPrize: number;
  consumed: CellRef[];
  gridAfter: Grid; // deep snapshot after collapse
  affectedReels: number[];
}

export interface CascadeOutcome {
  steps: CascadeStep[];
  totalWin: number;
  bestMult: number;
  totalWins: number;
  cascades: number;
  finalGrid: Grid;
}

const snapshot = (grid: Grid): Grid => grid.map((col) => col.map((c) => ({ sym: { ...c.sym } })));

// Resolve the full chain up-front. Presentation replays the steps on
// its own clock — the engine decides everything before a frame renders.
export function resolveCascades(
  slot: SlotDef, startGrid: Grid, bet: number,
  mode: MoneyMode = 'gc', fs?: FreeSpinCtx, rng: Rng = Math.random,
): CascadeOutcome {
  const grid = snapshot(startGrid);
  const steps: CascadeStep[] = [];
  let step = 0; let totalWin = 0; let bestMult = 0; let totalWins = 0;
  let result = evaluateGrid(slot, grid, bet, mode, fs);
  while (result.lineWins.length) {
    const mult = cascadeMult(step);
    const stepPrize = mode === 'gc'
      ? Math.floor(result.totalPrize * mult)
      : Math.round(result.totalPrize * mult * 100) / 100;
    totalWin += stepPrize;
    totalWins += result.lineWins.length;
    bestMult = Math.max(bestMult, ...result.lineWins.map((w) => w.symbol.multiplier));
    const cells = winCells(result.lineWins);
    const consumed: CellRef[] = [...cells].map((k) => {
      const [reel, row] = k.split(':').map(Number);
      return { reel, row };
    });
    const affected = collapseGrid(slot, grid, cells, rng);
    steps.push({
      result, mult, stepPrize, consumed,
      gridAfter: snapshot(grid),
      affectedReels: [...affected],
    });
    step++;
    if (step > 60) break; // hard safety net; stress-tested max observed is 6
    result = evaluateGrid(slot, grid, bet, mode, fs);
  }
  // Max-win cap: total award per spin is capped at 5,000× bet (industry-
  // standard ceiling; matches the certified-template model). Applied once
  // at outcome level so cascade/free-spin chains can never exceed it.
  const cap = bet * 5000;
  if (totalWin > cap) totalWin = cap;
  return { steps, totalWin, bestMult, totalWins, cascades: step, finalGrid: grid };
}

// ── Reel strips + spin outcome ─────────────────────────────────────
export function buildStrip(slot: SlotDef, rng: Rng = Math.random): GridSym[] {
  const vf = VOL_FACTOR[slot.volatility] ?? 1;
  const strip: GridSym[] = [];
  slot.symbols.forEach((s, i) => {
    const w = Math.max(1, Math.round((slot.symbols.length - i) * (1 + vf * 0.25)));
    for (let j = 0; j < w; j++) strip.push(s);
  });
  strip.push({ ...slot.wildSymbol, multiplier: 0, isWild: true });
  strip.push({ ...slot.wildSymbol, multiplier: 0, isWild: true });
  strip.push({ ...slot.bonusSymbol, multiplier: 0, isBonus: true });
  strip.push({ ...slot.bonusSymbol, multiplier: 0, isBonus: true });
  // shuffle (Fisher–Yates)
  for (let i = strip.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [strip[i], strip[j]] = [strip[j], strip[i]];
  }
  return strip;
}

export interface SpinOutcome {
  grid: Grid;
  stops: number[]; // strip index landed per reel (for animation)
}

export function spinGrid(slot: SlotDef, strips: GridSym[][], rng: Rng = Math.random): SpinOutcome {
  const grid: Grid = [];
  const stops: number[] = [];
  for (let reel = 0; reel < slot.reels; reel++) {
    const strip = strips[reel];
    const top = Math.floor(rng() * strip.length);
    stops.push(top);
    const col: Cell[] = [];
    for (let row = 0; row < ROWS; row++) {
      col.push({ sym: { ...strip[(top + row) % strip.length] } });
    }
    grid.push(col);
  }
  return { grid, stops };
}

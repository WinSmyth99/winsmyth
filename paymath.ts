// The four win-evaluation mechanics behind one dispatcher — ported from
// the v19 prototype with globals removed (free-spin context and money
// mode are explicit parameters). The paytable contracts from v19 hold:
// paylines 5-of-a-kind at multiplier m pays bet * m * 0.6 per full line
// (the 300x = 450,000 GC at 2,500 bet regression anchor).

import {
  Cell, CellRef, EvalResult, FreeSpinCtx, Grid, GridSym, MoneyMode,
  ROWS, SlotDef, Win,
} from './types';

// 9 paylines on a 5x3 grid (row index per reel). 3-reel machines use
// the first 5 truncated to 3 reels.
export const PAYLINES_5: number[][] = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 1, 2, 1],
  [1, 2, 1, 0, 1],
];

export function paylinesFor(reels: number): number[][] {
  if (reels >= 5) return PAYLINES_5;
  return PAYLINES_5.slice(0, 5).map((l) => l.slice(0, reels));
}

function roundPrize(raw: number, mode: MoneyMode): number {
  return mode === 'gc'
    ? Math.max(1, Math.floor(raw))
    : Math.max(0.01, Math.round(raw * 100) / 100);
}

function countScatters(grid: Grid, bonusEmoji: string): number {
  let n = 0;
  grid.forEach((col) => col.forEach((c) => { if (c.sym.emoji === bonusEmoji) n++; }));
  return n;
}

function expandBoost(sym: GridSym, fs?: FreeSpinCtx): number {
  return fs && fs.expandEmoji && sym.emoji === fs.expandEmoji ? 2 : 1;
}

// ── CLASSIC LINES ──────────────────────────────────────────────────
export function evaluateLines(
  slot: SlotDef, grid: Grid, bet: number, mode: MoneyMode = 'gc', fs?: FreeSpinCtx,
): EvalResult {
  const lines = paylinesFor(slot.reels);
  const wildE = slot.wildSymbol.emoji;
  const wins: Win[] = [];

  lines.forEach((line, lineIdx) => {
    const cells: Cell[] = line.map((row, reel) => grid[reel][row]);
    // find the base symbol: first non-wild in the run
    let base: GridSym | null = null;
    for (const c of cells) {
      if (c.sym.emoji !== wildE && !c.sym.isBonus) { base = c.sym; break; }
      if (c.sym.isBonus) return; // scatter breaks a line at its position
    }
    if (!base || base.multiplier <= 0) return;
    let count = 0;
    for (const c of cells) {
      if (c.sym.emoji === base.emoji || c.sym.emoji === wildE) count++;
      else break;
    }
    const minMatch = base.tier === 'premium' ? 2 : 3;
    if (count < minMatch) return;
    const nr = slot.reels;
    let mf = count === nr ? 1 : count === nr - 1 ? 1 / 3 : count === nr - 2 ? 1 / 10 : 1 / 30;
    mf *= expandBoost(base, fs);
    // NOTE: bet * mult * mf * 0.6 directly — mathematically identical to
    // perLineBet * lines * ..., but the divide-then-multiply round-trip
    // loses 1 unit to floating point on some cells (149,999 vs 150,000).
    // The paytable display (lib/paymath) mirrors this exact expression.
    const raw = bet * base.multiplier * mf * 0.6;
    const prize = roundPrize(raw, mode);
    wins.push({
      lineIdx, rows: line, symbol: base, count, prize,
      cells: line.slice(0, count).map((row, reel) => ({ reel, row })),
    });
  });

  return {
    totalPrize: wins.reduce((a, w) => a + w.prize, 0),
    lineWins: wins,
    scatterCount: countScatters(grid, slot.bonusSymbol.emoji),
  };
}

// ── ALL WAYS ───────────────────────────────────────────────────────
// Matching symbols on consecutive reels, any row. Ways = product of
// per-reel hit counts. WAYS_UNIT: each way pays 1/9 of the full-line
// equivalent — a tuning constant, revisited at the RTP rebalance.
export function evaluateWays(
  slot: SlotDef, grid: Grid, bet: number, mode: MoneyMode = 'gc', fs?: FreeSpinCtx,
): EvalResult {
  const wildE = slot.wildSymbol.emoji;
  const wins: Win[] = [];
  slot.symbols.forEach((base) => {
    let count = 0; let ways = 1; const cells: CellRef[] = [];
    for (let reel = 0; reel < slot.reels; reel++) {
      const hits: number[] = [];
      for (let row = 0; row < ROWS; row++) {
        const e = grid[reel][row].sym.emoji;
        if (e === base.emoji || e === wildE) hits.push(row);
      }
      if (!hits.length) break;
      count++; ways *= hits.length;
      hits.forEach((row) => cells.push({ reel, row }));
    }
    const minMatch = base.tier === 'premium' ? 2 : 3;
    if (count < minMatch) return;
    const nr = slot.reels;
    let mf = count === nr ? 1 : count === nr - 1 ? 1 / 3 : count === nr - 2 ? 1 / 10 : 1 / 30;
    mf *= expandBoost(base, fs);
    const raw = (bet * base.multiplier * mf * 0.6 * ways) / 9;
    wins.push({ symbol: base, count, ways, prize: roundPrize(raw, mode), cells });
  });
  return {
    totalPrize: wins.reduce((a, w) => a + w.prize, 0),
    lineWins: wins,
    scatterCount: countScatters(grid, slot.bonusSymbol.emoji),
  };
}

// ── SCATTER PAYS ───────────────────────────────────────────────────
// N+ matching anywhere. Threshold scales with grid size: 15 cells → 6+,
// 9 cells → 4+. Wilds count toward every symbol's tally.
export function scatterMinHit(slot: Pick<SlotDef, 'reels'>): number {
  return Math.max(4, Math.ceil(slot.reels * ROWS * 0.4));
}

export function evaluateScatterPays(
  slot: SlotDef, grid: Grid, bet: number, mode: MoneyMode = 'gc', fs?: FreeSpinCtx,
): EvalResult {
  const wildE = slot.wildSymbol.emoji;
  const bonusE = slot.bonusSymbol.emoji;
  const cellsBy: Record<string, CellRef[]> = {};
  const wildCells: CellRef[] = [];
  grid.forEach((col, reel) => col.forEach((c, row) => {
    const e = c.sym.emoji;
    if (e === wildE) { wildCells.push({ reel, row }); return; }
    if (e === bonusE) return;
    (cellsBy[e] = cellsBy[e] || []).push({ reel, row });
  }));
  const minHit = scatterMinHit(slot);
  const wins: Win[] = [];
  Object.entries(cellsBy).forEach(([e, cells]) => {
    const n = cells.length + wildCells.length;
    if (n < minHit) return;
    const sym = slot.symbols.find((s) => s.emoji === e);
    if (!sym) return;
    let mf = n >= minHit + 5 ? 1 : n >= minHit + 2 ? 1 / 3 : 1 / 10;
    mf *= expandBoost(sym, fs);
    const raw = bet * sym.multiplier * mf * 0.6;
    wins.push({ symbol: sym, count: n, prize: roundPrize(raw, mode), cells: cells.concat(wildCells) });
  });
  return {
    totalPrize: wins.reduce((a, w) => a + w.prize, 0),
    lineWins: wins,
    scatterCount: countScatters(grid, bonusE),
  };
}

// ── CLUSTER PAYS ───────────────────────────────────────────────────
// 5+ matching symbols touching horizontally/vertically. Wilds join any
// cluster but cannot seed one.
export function evaluateCluster(
  slot: SlotDef, grid: Grid, bet: number, mode: MoneyMode = 'gc', fs?: FreeSpinCtx,
): EvalResult {
  const wildE = slot.wildSymbol.emoji;
  const wins: Win[] = [];
  slot.symbols.forEach((base) => {
    const seen = new Set<string>();
    for (let reel = 0; reel < slot.reels; reel++) {
      for (let row = 0; row < ROWS; row++) {
        if (seen.has(`${reel}:${row}`)) continue;
        if (grid[reel][row].sym.emoji !== base.emoji) continue;
        const stack: [number, number][] = [[reel, row]];
        const cluster: CellRef[] = [];
        const vis = new Set<string>();
        while (stack.length) {
          const [r, w] = stack.pop()!;
          const k = `${r}:${w}`;
          if (vis.has(k)) continue;
          vis.add(k);
          const e = grid[r][w].sym.emoji;
          if (e !== base.emoji && e !== wildE) continue;
          cluster.push({ reel: r, row: w });
          ([[r + 1, w], [r - 1, w], [r, w + 1], [r, w - 1]] as [number, number][]).forEach(([rr, ww]) => {
            if (rr >= 0 && rr < slot.reels && ww >= 0 && ww < ROWS) stack.push([rr, ww]);
          });
        }
        cluster.forEach((c) => seen.add(`${c.reel}:${c.row}`));
        if (cluster.length >= 5) {
          const sz = cluster.length;
          let mf = sz >= 9 ? 1 : sz >= 8 ? 1 / 2 : sz >= 7 ? 1 / 3 : sz >= 6 ? 1 / 5 : 1 / 10;
          mf *= expandBoost(base, fs);
          const raw = bet * base.multiplier * mf * 0.6;
          wins.push({ symbol: base, count: sz, prize: roundPrize(raw, mode), cells: cluster });
        }
      }
    }
  });
  return {
    totalPrize: wins.reduce((a, w) => a + w.prize, 0),
    lineWins: wins,
    scatterCount: countScatters(grid, slot.bonusSymbol.emoji),
  };
}

// ── DISPATCHER — the single evaluation entry point ─────────────────
export function evaluateGrid(
  slot: SlotDef, grid: Grid, bet: number, mode: MoneyMode = 'gc', fs?: FreeSpinCtx,
): EvalResult {
  switch (slot.gameType) {
    case 'ways': return evaluateWays(slot, grid, bet, mode, fs);
    case 'scatter': return evaluateScatterPays(slot, grid, bet, mode, fs);
    case 'cluster': return evaluateCluster(slot, grid, bet, mode, fs);
    default: return evaluateLines(slot, grid, bet, mode, fs);
  }
}

// Screen-vs-engine agreement: what the paytable displays must be what
// the engine pays. One constructed grid per game type.

import { describe, expect, it } from 'vitest';
import { displayPrizeGC } from '../paymath';
import { evaluateCluster, evaluateLines, evaluateScatterPays, evaluateWays } from '../../engine/evaluate';
import { Cell, Grid, GridSym, SlotDef, SymbolDef } from '../../engine/types';

const syms: SymbolDef[] = [
  { emoji: 'A', name: 'a', multiplier: 5, tier: 'low' },
  { emoji: 'B', name: 'b', multiplier: 8, tier: 'low' },
  { emoji: 'C', name: 'c', multiplier: 12, tier: 'low' },
  { emoji: 'D', name: 'd', multiplier: 25, tier: 'mid' },
  { emoji: 'E', name: 'e', multiplier: 40, tier: 'mid' },
  { emoji: 'F', name: 'f', multiplier: 60, tier: 'mid' },
  { emoji: 'G', name: 'g', multiplier: 120, tier: 'premium' },
  { emoji: 'H', name: 'h', multiplier: 300, tier: 'premium' },
];
const slot: SlotDef = {
  name: 'Fixture', tagline: '', color: '#FF3DA5', themeStyle: 'default',
  reels: 5, gameType: 'paylines', volatility: 'medium', symbols: syms,
  wildSymbol: { emoji: 'W', name: 'wild' },
  bonusSymbol: { emoji: 'S', name: 'scatter' },
};
const find = (e: string): GridSym => ({ ...syms.find((s) => s.emoji === e)! });
const mkGrid = (rows: string[]): Grid => {
  const g: Grid = [];
  for (let reel = 0; reel < 5; reel++) {
    const col: Cell[] = [];
    for (let row = 0; row < 3; row++) col.push({ sym: find(rows[row][reel]) });
    g.push(col);
  }
  return g;
};

describe('paytable display equals engine award', () => {
  it('paylines: 3xB (the v19 display-bug case) — engine pays what the table shows', () => {
    const r = evaluateLines(slot, mkGrid(['ACDEF', 'BBBAC', 'CDEFA']), 2500);
    const w = r.lineWins.find((x) => x.symbol.emoji === 'B' && x.count === 3)!;
    expect(w.prize).toBe(displayPrizeGC(2500, 8, 1 / 10)); // 1,200 — not the old displayed 1,500
    expect(w.prize).toBe(1200);
  });

  it('paylines: all counts × representative symbols agree', () => {
    ([['H', 300, 5, 1], ['H', 300, 4, 1 / 3], ['D', 25, 3, 1 / 10], ['G', 120, 2, 1 / 30]] as const)
      .forEach(([e, mult, count, mf]) => {
        const line = `${e.repeat(count)}${'ACDE'.slice(0, 5 - count)}`;
        const r = evaluateLines(slot, mkGrid(['ABCDE'.replace(e, 'A'), line, 'CDEFA'.replace(e, 'C')]), 2500);
        const w = r.lineWins.find((x) => x.symbol.emoji === e && x.count === count)!;
        expect(w.prize).toBe(displayPrizeGC(2500, mult, mf));
      });
  });

  it('ways: per-way display × ways equals engine total (floored once)', () => {
    const g = mkGrid(['EEEAB', 'ABCDA', 'CDABC']);
    const r = evaluateWays({ ...slot, gameType: 'ways' }, g, 2500);
    const w = r.lineWins.find((x) => x.symbol.emoji === 'E')!;
    expect(w.ways).toBe(1);
    expect(w.prize).toBe(displayPrizeGC(2500, 40, 1 / 10, 9));
  });

  it('scatter: 6 hits displays and pays identically', () => {
    const r = evaluateScatterPays({ ...slot, gameType: 'scatter' }, mkGrid(['DDABC', 'DDABC', 'DDABC']), 2500);
    const w = r.lineWins.find((x) => x.symbol.emoji === 'D')!;
    expect(w.count).toBe(6);
    expect(w.prize).toBe(displayPrizeGC(2500, 25, 1 / 10));
  });

  it('cluster: 5-cluster displays and pays identically', () => {
    const r = evaluateCluster({ ...slot, gameType: 'cluster' }, mkGrid(['AABDE', 'AACDE', 'ABCDE']), 2500);
    const w = r.lineWins.find((x) => x.symbol.emoji === 'A')!;
    expect(w.prize).toBe(displayPrizeGC(2500, 5, 1 / 10));
  });
});

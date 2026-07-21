// The v19 QA suite ported to vitest. The numeric anchors are contracts:
// if a change moves them, the change is wrong until proven otherwise.

import { describe, expect, it } from 'vitest';
import {
  evaluateCluster, evaluateGrid, evaluateLines, evaluateScatterPays,
  evaluateWays, scatterMinHit,
} from '../evaluate';
import {
  cascadeMult, collapseGrid, drawRefillSymbol, resolveCascades, winCells,
} from '../cascade';
import { Cell, Grid, GridSym, SlotDef, SymbolDef } from '../types';

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

const find = (e: string): GridSym => {
  if (e === 'W') return { emoji: 'W', name: 'wild', multiplier: 0, isWild: true };
  if (e === 'S') return { emoji: 'S', name: 'scatter', multiplier: 0, isBonus: true };
  return { ...syms.find((s) => s.emoji === e)! };
};

// rows: 3 strings of `reels` chars (row-major) → grid[reel][row]
const mkGrid = (rows: string[]): Grid => {
  const g: Grid = [];
  for (let reel = 0; reel < rows[0].length; reel++) {
    const col: Cell[] = [];
    for (let row = 0; row < 3; row++) col.push({ sym: find(rows[row][reel]) });
    g.push(col);
  }
  return g;
};

describe('paylines regression (v19 contracts)', () => {
  it('5xH on line 0 at bet 2,500 pays exactly 450,000 GC', () => {
    const r = evaluateLines(slot, mkGrid(['ABCDE', 'HHHHH', 'ABCDE']), 2500);
    const w = r.lineWins.find((x) => x.symbol.emoji === 'H' && x.count === 5);
    expect(w?.prize).toBe(450000);
  });

  it('wild substitution completes 3xH', () => {
    const r = evaluateLines(slot, mkGrid(['ABCDE', 'HWHAB', 'ABCDE']), 2500);
    expect(r.lineWins.some((w) => w.symbol.emoji === 'H' && w.count === 3)).toBe(true);
  });

  it('premium pays at 2', () => {
    const r = evaluateLines(slot, mkGrid(['ABCDE', 'GGABC', 'ABCDE']), 2500);
    expect(r.lineWins.some((w) => w.symbol.emoji === 'G' && w.count === 2)).toBe(true);
  });

  it('scatter-anywhere counts 3', () => {
    expect(evaluateLines(slot, mkGrid(['SABCS', 'ABCDE', 'ABSDE']), 2500).scatterCount).toBe(3);
  });

  it('dispatcher default and explicit paylines both hold the 450k anchor', () => {
    const g = mkGrid(['ABCDE', 'HHHHH', 'ABCDE']);
    expect(evaluateGrid(slot, g, 2500).lineWins[0].prize).toBe(450000);
    expect(evaluateGrid({ ...slot, gameType: 'paylines' }, g, 2500).lineWins[0].prize).toBe(450000);
  });
});

describe('cascade mechanics', () => {
  it('ladder is 1,2,3,5 capped', () => {
    expect([0, 1, 2, 3, 4, 9].map(cascadeMult).join()).toBe('1,2,3,5,5,5');
  });

  it('only the matched run is consumed', () => {
    const r = evaluateLines(slot, mkGrid(['ABCDE', 'DDDAB', 'ABCDE']), 2500);
    const cells = winCells(r.lineWins);
    expect(cells.size).toBe(3);
    expect(cells.has('0:1') && cells.has('1:1') && cells.has('2:1')).toBe(true);
    expect(cells.has('3:1')).toBe(false);
  });

  it('collapse drops survivors in order and refills from the top', () => {
    const g = mkGrid(['ABCDE', 'DDDAB', 'FGHFG']);
    const affected = collapseGrid(slot, g, new Set(['0:1', '1:1', '2:1']), () => 0.5);
    expect([...affected].sort().join()).toBe('0,1,2');
    expect(g[0][1].sym.emoji).toBe('A');
    expect(g[0][2].sym.emoji).toBe('F');
    expect(g[3][0].sym.emoji).toBe('D');
    expect(g[3][1].sym.emoji).toBe('A');
    expect(g[3][2].sym.emoji).toBe('F');
  });

  it('refills never contain scatters; wild rate ~6%', () => {
    let wilds = 0;
    let seed = 42;
    const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 20000; i++) {
      const s = drawRefillSymbol(slot, rng);
      expect(s.isBonus).toBeFalsy();
      if (s.isWild) wilds++;
      else expect(syms.some((x) => x.emoji === s.emoji)).toBe(true);
    }
    expect(wilds).toBeGreaterThan(800);
    expect(wilds).toBeLessThan(1700);
  });

  it('resolveCascades: chain terminates, total is finite and >= first step', () => {
    let seed = 7;
    const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const pick = 'AAABBBCCDDEEFGHW';
    for (let t = 0; t < 2000; t++) {
      const g: Grid = [];
      for (let reel = 0; reel < 5; reel++) {
        const col: Cell[] = [];
        for (let row = 0; row < 3; row++) col.push({ sym: find(pick[Math.floor(rng() * pick.length)]) });
        g.push(col);
      }
      const first = evaluateGrid(slot, g, 2500).totalPrize;
      const out = resolveCascades(slot, g, 2500, 'gc', undefined, rng);
      expect(out.cascades).toBeLessThanOrEqual(60);
      expect(Number.isFinite(out.totalWin)).toBe(true);
      expect(out.totalWin).toBeGreaterThanOrEqual(Math.floor(first));
    }
  });
});

describe('all ways', () => {
  it('3-run with 2 ways pays 10,000 and records contributing cells', () => {
    const g: Grid = [
      [{ sym: find('H') }, { sym: find('A') }, { sym: find('B') }],
      [{ sym: find('H') }, { sym: find('H') }, { sym: find('C') }],
      [{ sym: find('H') }, { sym: find('D') }, { sym: find('E') }],
      [{ sym: find('A') }, { sym: find('B') }, { sym: find('C') }],
      [{ sym: find('A') }, { sym: find('B') }, { sym: find('C') }],
    ];
    const r = evaluateWays({ ...slot, gameType: 'ways' }, g, 2500);
    const hw = r.lineWins.find((w) => w.symbol.emoji === 'H');
    expect(hw?.count).toBe(3);
    expect(hw?.ways).toBe(2);
    expect(hw?.prize).toBe(10000);
    expect(hw?.cells.length).toBe(4);
  });
});

describe('scatter pays', () => {
  it('threshold: 6 on 5 reels, 4 on 3 reels', () => {
    expect(scatterMinHit({ reels: 5 })).toBe(6);
    expect(scatterMinHit({ reels: 3 })).toBe(4);
  });

  it('5xD + wild = 6 hits pays 3,750', () => {
    const r = evaluateScatterPays({ ...slot, gameType: 'scatter' }, mkGrid(['DDABC', 'DDABC', 'DWABC']), 2500);
    const w = r.lineWins.find((x) => x.symbol.emoji === 'D');
    expect(w?.count).toBe(6);
    expect(w?.prize).toBe(3750);
  });

  it('5 hits on 15 cells does not pay', () => {
    const r = evaluateScatterPays({ ...slot, gameType: 'scatter' }, mkGrid(['DDABC', 'DDABC', 'DABCE']), 2500);
    expect(r.lineWins.some((w) => w.symbol.emoji === 'D')).toBe(false);
  });
});

describe('cluster pays', () => {
  it('L-shaped 5-cluster pays 750', () => {
    const r = evaluateCluster({ ...slot, gameType: 'cluster' }, mkGrid(['AABDE', 'AACDE', 'ABCDE']), 2500);
    const w = r.lineWins.find((x) => x.symbol.emoji === 'A');
    expect(w?.count).toBe(5);
    expect(w?.prize).toBe(750);
  });

  it('diagonal touches do not cluster', () => {
    const r = evaluateCluster({ ...slot, gameType: 'cluster' }, mkGrid(['ABCBA', 'BABAB', 'CBABC']), 2500);
    expect(r.lineWins.length).toBe(0);
  });

  it('wild bridges a 6-cluster', () => {
    const r = evaluateCluster({ ...slot, gameType: 'cluster' }, mkGrid(['ABCDE', 'AAWAA', 'FGHFG']), 2500);
    const w = r.lineWins.find((x) => x.symbol.emoji === 'A');
    expect(w?.count).toBe(6);
  });
});

describe('cross-type stress', () => {
  (['ways', 'scatter', 'cluster'] as const).forEach((gt) => {
    it(`${gt}: 1000 cascade chains terminate`, () => {
      const vols = { ways: 'medium', scatter: 'high', cluster: 'insane' } as const;
      const s2: SlotDef = { ...slot, gameType: gt, volatility: vols[gt] };
      let seed = 99;
      const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const pick = 'AAABBBCCDDEEFGHW';
      let maxSteps = 0;
      for (let t = 0; t < 1000; t++) {
        const g: Grid = [];
        for (let reel = 0; reel < 5; reel++) {
          const col: Cell[] = [];
          for (let row = 0; row < 3; row++) col.push({ sym: find(pick[Math.floor(rng() * pick.length)]) });
          g.push(col);
        }
        const out = resolveCascades(s2, g, 2500, 'gc', undefined, rng);
        expect(Number.isFinite(out.totalWin)).toBe(true);
        maxSteps = Math.max(maxSteps, out.cascades);
      }
      expect(maxSteps).toBeLessThanOrEqual(60);
    });
  });
});

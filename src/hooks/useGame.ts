// useGame — Phase B presentation clock. The engine still resolves the
// entire spin up front; this hook now runs a per-reel timeline with
// scatter anticipation, drives the sound vocabulary, and paces the win
// presentation by tier. Engine untouched.

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  buildStrip, CascadeOutcome, FreeSpinCtx, Grid, GridSym,
  resolveCascades, SlotDef, spinGrid,
} from '../engine';
import { sound, WinTier } from '../sound/engine';

export type Phase = 'idle' | 'spinning' | 'cascading' | 'celebrating';
export type ReelPhase = 'idle' | 'spinning' | 'anticipating' | 'stopped';

export interface StepView {
  grid: Grid;
  highlight: Set<string>;
  popping: Set<string>;
  badgeMult: number | null;
  runningTotal: number;
}

export interface GameState {
  balance: number;
  bet: number;
  phase: Phase;
  grid: Grid | null;
  reelPhases: ReelPhase[];
  view: StepView | null;
  outcome: CascadeOutcome | null;
  freeSpins: number;
  expandEmoji: string | null;
  lastWin: number;
  rollup: number | null; // animated count-up value during celebration
  tier: WinTier | null;
}

const BETS = [500, 1000, 2500, 5000, 10000];
const SPIN_BASE = 1000;
const SPIN_STAGGER = 300;
const ANTICIPATION_EXTRA = 1400;
const STEP_HIGHLIGHT = 720;
const STEP_POP = 300;
const STEP_SETTLE = 340;

export function tierFor(bestMult: number, cascades: number): WinTier {
  if (bestMult >= 100) return 'jackpot';
  if (bestMult >= 30) return 'mega';
  if (bestMult >= 10 || cascades >= 3) return 'big';
  return 'small';
}

export function useGame(slot: SlotDef | null) {
  const [balance, setBalance] = useState(2_250_000);
  const [betIdx, setBetIdx] = useState(2);
  const [phase, setPhase] = useState<Phase>('idle');
  const [grid, setGrid] = useState<Grid | null>(null);
  const [reelPhases, setReelPhases] = useState<ReelPhase[]>([]);
  const [view, setView] = useState<StepView | null>(null);
  const [outcome, setOutcome] = useState<CascadeOutcome | null>(null);
  const [freeSpins, setFreeSpins] = useState(0);
  const [expandEmoji, setExpandEmoji] = useState<string | null>(null);
  const [lastWin, setLastWin] = useState(0);
  const [rollup, setRollup] = useState<number | null>(null);
  const [tier, setTier] = useState<WinTier | null>(null);
  const timers = useRef<number[]>([]);
  const raf = useRef<number>(0);

  const strips = useMemo<GridSym[][]>(() => {
    if (!slot) return [];
    return Array.from({ length: slot.reels }, () => buildStrip(slot));
  }, [slot]);

  const bet = BETS[betIdx];

  const clearAll = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    if (raf.current) cancelAnimationFrame(raf.current);
  };
  const after = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const runRollup = (total: number, dur: number) => {
    const start = performance.now();
    let lastTick = 0;
    const frame = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - (1 - p) ** 3;
      setRollup(Math.floor(total * eased));
      if (now - lastTick > 90 && p < 1) { sound.coinTick(Math.floor(now / 90)); lastTick = now; }
      if (p < 1) raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
  };

  const spin = useCallback(() => {
    if (!slot || phase !== 'idle') return;
    const isFree = freeSpins > 0;
    if (!isFree && balance < bet) return;
    clearAll();
    if (!isFree) setBalance((b) => b - bet);
    else setFreeSpins((n) => n - 1);

    const fs: FreeSpinCtx | undefined = isFree && expandEmoji ? { expandEmoji } : undefined;
    const { grid: landed } = spinGrid(slot, strips);
    const out = resolveCascades(slot, landed, bet, 'gc', fs);

    // ── Per-reel stop timeline with scatter anticipation ──
    // Outcome is known; anticipation is theatre. Once the 2nd scatter is
    // visible, every later reel slows and glows.
    const bonusE = slot.bonusSymbol.emoji;
    const scattersByReel = landed.map((col) => col.filter((c) => c.sym.emoji === bonusE).length);
    const stopAt: number[] = [];
    const anticip: boolean[] = [];
    let t = SPIN_BASE;
    let seen = 0;
    for (let r = 0; r < slot.reels; r++) {
      const anticipating = seen >= 2;
      anticip.push(anticipating);
      t += anticipating ? ANTICIPATION_EXTRA : SPIN_STAGGER;
      stopAt.push(t);
      seen += scattersByReel[r];
    }
    const spinDone = stopAt[stopAt.length - 1] + STEP_SETTLE;

    setPhase('spinning');
    setGrid(landed);
    setReelPhases(Array(slot.reels).fill('spinning'));
    setView(null);
    setOutcome(null);
    setLastWin(0);
    setRollup(null);
    setTier(null);
    sound.spinStart();

    stopAt.forEach((at, r) => {
      if (anticip[r]) {
        after(at - ANTICIPATION_EXTRA, () => {
          setReelPhases((p) => p.map((x, i) => (i === r ? 'anticipating' : x)));
          sound.anticipation(ANTICIPATION_EXTRA / 1000);
        });
      }
      after(at, () => {
        setReelPhases((p) => p.map((x, i) => (i === r ? 'stopped' : x)));
        sound.reelStop(r);
        if (scattersByReel[r] > 0) sound.scatterLand();
      });
    });

    const initialScatters = landed.flat().filter((c) => c.sym.emoji === bonusE).length;

    after(spinDone, () => {
      if (initialScatters >= 3) {
        setFreeSpins((n) => n + 8);
        const mids = slot.symbols.filter((s) => s.tier === 'mid');
        setExpandEmoji(mids[Math.floor(Math.random() * mids.length)]?.emoji ?? null);
      }
      if (!out.steps.length) { setPhase('idle'); return; }

      setPhase('cascading');
      let tt = 0;
      let running = 0;
      out.steps.forEach((s, i) => {
        const gridBefore = i === 0 ? landed : out.steps[i - 1].gridAfter;
        const cells = new Set(s.consumed.map((c) => `${c.reel}:${c.row}`));
        const stepTotal = running + s.stepPrize;
        after(tt, () => {
          setView({ grid: gridBefore, highlight: cells, popping: new Set(), badgeMult: i > 0 ? s.mult : null, runningTotal: stepTotal });
          if (i > 0) sound.cascadePop(i);
          else sound.win('small');
        });
        tt += STEP_HIGHLIGHT;
        after(tt, () => setView({ grid: gridBefore, highlight: new Set(), popping: cells, badgeMult: null, runningTotal: stepTotal }));
        tt += STEP_POP;
        after(tt, () => setView({ grid: s.gridAfter, highlight: new Set(), popping: new Set(), badgeMult: null, runningTotal: stepTotal }));
        tt += STEP_SETTLE;
        running = stepTotal;
      });
      after(tt, () => {
        const wtier = tierFor(out.bestMult, out.cascades);
        setOutcome(out);
        setTier(wtier);
        setBalance((b) => b + out.totalWin);
        setLastWin(out.totalWin);
        setPhase('celebrating');
        sound.win(wtier);
        const rollDur = wtier === 'small' ? 600 : wtier === 'big' ? 1300 : wtier === 'mega' ? 1900 : 2600;
        runRollup(out.totalWin, rollDur);
        const hold = wtier === 'small' ? 900 : wtier === 'big' ? 2100 : wtier === 'mega' ? 2700 : 3400;
        after(hold, () => setPhase('idle'));
      });
    });
  }, [slot, phase, balance, bet, freeSpins, expandEmoji, strips]);

  return {
    state: {
      balance, bet, phase, grid, reelPhases, view, outcome,
      freeSpins, expandEmoji, lastWin, rollup, tier,
    } as GameState,
    bets: BETS,
    betIdx,
    setBetIdx,
    spin,
  };
}

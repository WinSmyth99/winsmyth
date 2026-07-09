// Winsmyth engine — shared types.
// The engine is pure and DOM-free: grids in, results out. Presentation
// animates what the engine decided, never the reverse (the same
// discipline that becomes server-authoritative at the VPS milestone).

export type Tier = 'low' | 'mid' | 'premium';
export type GameType = 'paylines' | 'ways' | 'scatter' | 'cluster';
export type MoneyMode = 'gc' | 'sc';

export interface SymbolDef {
  emoji: string;
  name: string;
  multiplier: number;
  tier: Tier;
}

export interface SpecialSymbol {
  emoji: string;
  name: string;
}

export interface SlotDef {
  name: string;
  tagline: string;
  color: string;
  themeStyle: string;
  symbols: SymbolDef[]; // exactly 8, ordered lowest → highest multiplier
  wildSymbol: SpecialSymbol;
  bonusSymbol: SpecialSymbol;
  reels: number; // 3 or 5
  gameType: GameType;
  volatility: 'low' | 'medium' | 'high' | 'insane';
}

// A grid cell. Wilds/scatters are represented by marker objects so the
// evaluators can compare on emoji alone.
export interface GridSym {
  emoji: string;
  name: string;
  multiplier: number;
  tier?: Tier;
  isWild?: boolean;
  isBonus?: boolean;
}

export interface Cell {
  sym: GridSym;
}

export type Grid = Cell[][]; // grid[reel][row], rows = 3

export interface CellRef {
  reel: number;
  row: number;
}

export interface Win {
  symbol: GridSym;
  count: number;
  prize: number;
  cells: CellRef[];
  lineIdx?: number;
  rows?: number[];
  ways?: number;
}

export interface EvalResult {
  totalPrize: number;
  lineWins: Win[];
  scatterCount: number;
}

export interface FreeSpinCtx {
  expandEmoji: string | null;
}

export const ROWS = 3;
export type Rng = () => number;

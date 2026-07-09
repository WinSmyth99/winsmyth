// Generation schema — the single source of truth shared by the client
// and the Netlify function. The SYS prompt is ported verbatim from v19;
// the clamps enforce the multiplier bands server-side rather than
// trusting the model (the same rule the Make/S1 pipeline specifies).

import { SlotDef, SymbolDef, Tier } from '../engine/types';

export const SYS = `You are a slot machine designer for a sweepstakes social casino. Return ONLY valid JSON.
Schema:
{
  "name": "2-4 word regal casino machine name",
  "tagline": "max 8 word exciting subtitle",
  "color": "#hexcolor matching theme mood",
  "themeStyle": "egyptian|nautical|vegas|space|wizard|default — pick the closest match for the prompt",
  "symbols": [
    { "emoji": "single emoji", "name": "Symbol name", "multiplier": number, "tier": "premium|mid|low" }
  ],
  "wildSymbol": { "emoji": "single emoji", "name": "Wild name" },
  "bonusSymbol": { "emoji": "single emoji", "name": "Scatter name" }
}
Rules:
- EXACTLY 8 symbols ordered LOWEST to HIGHEST multiplier
- "tier": 2-3 as "premium", 2-3 as "mid", 3 as "low"
- Premium pays for 2+ matches; others need 3+
- 5-of-a-kind multipliers: low 5-15x, mid 20-60x, premium 80-300x
- 3-of-a-kind approx 1/10th of 5-of-a-kind; 4-of-a-kind approx 1/3rd
- Color: warm and saturated
- themeStyle: "egyptian" for ancient Egypt/desert/pyramid themes, "nautical" for sea/pirate/fishing themes, "vegas" for classic/fruits/Vegas themes, "space" for sci-fi/futuristic/cosmic themes, "wizard" for fantasy/mystical/dragon themes, "default" otherwise
- ONLY return the JSON object`;

const BANDS: Record<Tier, [number, number]> = {
  low: [5, 15],
  mid: [20, 60],
  premium: [80, 300],
};

const THEME_STYLES = ['egyptian', 'nautical', 'vegas', 'space', 'wizard', 'default'];

export interface GeneratedSpec {
  name: string;
  tagline: string;
  color: string;
  themeStyle: string;
  symbols: SymbolDef[];
  wildSymbol: { emoji: string; name: string };
  bonusSymbol: { emoji: string; name: string };
}

// Validate hard shape; clamp soft values. Throws on unrecoverable shape
// problems (the caller falls back to a preset).
export function validateAndClamp(raw: unknown): GeneratedSpec {
  const d = raw as Partial<GeneratedSpec>;
  if (!d || typeof d !== 'object') throw new Error('not an object');
  if (!Array.isArray(d.symbols) || d.symbols.length !== 8) throw new Error('bad symbols');
  if (!d.wildSymbol?.emoji) throw new Error('bad wildSymbol');
  if (!d.bonusSymbol?.emoji) throw new Error('bad bonusSymbol');

  const symbols: SymbolDef[] = d.symbols.map((s) => {
    const tier: Tier = s.tier === 'premium' || s.tier === 'mid' || s.tier === 'low' ? s.tier : 'low';
    const [lo, hi] = BANDS[tier];
    const mult = Math.min(hi, Math.max(lo, Math.round(Number(s.multiplier) || lo)));
    return {
      emoji: String(s.emoji ?? '❔').slice(0, 8),
      name: String(s.name ?? 'Symbol').slice(0, 24),
      multiplier: mult,
      tier,
    };
  });
  symbols.sort((a, b) => a.multiplier - b.multiplier);

  const color = /^#[0-9a-fA-F]{6}$/.test(String(d.color)) ? String(d.color) : '#FF3DA5';
  const themeStyle = THEME_STYLES.includes(String(d.themeStyle)) ? String(d.themeStyle) : 'default';

  return {
    name: String(d.name ?? 'Untitled Machine').slice(0, 40),
    tagline: String(d.tagline ?? '').slice(0, 60),
    color,
    themeStyle,
    symbols,
    wildSymbol: { emoji: String(d.wildSymbol.emoji).slice(0, 8), name: String(d.wildSymbol.name ?? 'Wild').slice(0, 24) },
    bonusSymbol: { emoji: String(d.bonusSymbol.emoji).slice(0, 8), name: String(d.bonusSymbol.name ?? 'Scatter').slice(0, 24) },
  };
}

export function toSlotDef(
  spec: GeneratedSpec, reels: number, gameType: SlotDef['gameType'],
  vol: SlotDef['volatility'],
): SlotDef {
  return { ...spec, reels, gameType, volatility: vol };
}

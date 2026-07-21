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
    { "emoji": "single emoji", "name": "Symbol name", "multiplier": number, "tier": "premium|mid|low", "archetype": "one archetype from the list" }
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
- "archetype": for EACH symbol pick the SINGLE best-fitting category from this list (use "other" only if none fit): amphibian, reptile, serpent, bird, feline, canine, sea-creature, insect, mythic-beast, humanoid-figure, deity-idol, vessel-potion, blade-weapon, ranged-weapon, tool-implement, book-scroll, key-lock, coin-treasure, gem-crystal, container-chest, ring-amulet, orb-sphere, plant-flower, fruit, fungus, tree, element-fire, element-water, element-air, celestial, weather, building, vehicle, vessel-ship, emblem-symbol, food-drink, mask-face, card-dice, bell-horn, skull-bone, other
- ONLY return the JSON object`;


// Archetype vocabulary for concept-based asset reuse (see
// specs/concept-tagging.md). Chosen to cover the symbol space of the
// themes the product generates — creatures, objects, nature, structures,
// casino staples — with 'other' as the safe fallback. The generation
// model assigns one per symbol; validateAndClamp coerces anything off-list.
export const ARCHETYPES = [
  // creatures
  'amphibian', 'reptile', 'serpent', 'bird', 'feline', 'canine',
  'sea-creature', 'insect', 'mythic-beast', 'humanoid-figure', 'deity-idol',
  // objects
  'vessel-potion', 'blade-weapon', 'ranged-weapon', 'tool-implement',
  'book-scroll', 'key-lock', 'coin-treasure', 'gem-crystal', 'container-chest',
  'ring-amulet', 'orb-sphere',
  // nature
  'plant-flower', 'fruit', 'fungus', 'tree', 'element-fire', 'element-water',
  'element-air', 'celestial', 'weather',
  // structures / vehicles / misc
  'building', 'vehicle', 'vessel-ship', 'emblem-symbol', 'food-drink',
  'mask-face', 'card-dice', 'bell-horn', 'skull-bone',
  'other',
] as const;
export type Archetype = typeof ARCHETYPES[number];

export function coerceArchetype(v: unknown): Archetype {
  const s = String(v ?? '').toLowerCase().trim();
  return (ARCHETYPES as readonly string[]).includes(s) ? (s as Archetype) : 'other';
}

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
      archetype: coerceArchetype((s as { archetype?: unknown }).archetype),
    };
  });
  symbols.sort((a, b) => a.multiplier - b.multiplier);

  // Emoji uniqueness is a hard shape rule: the engine matches cells on
  // emoji alone, so a duplicate (or a wild/scatter colliding with a
  // symbol) would double-evaluate wins and cross-wire art mapping.
  const wildEmoji = String(d.wildSymbol.emoji).slice(0, 8);
  const bonusEmoji = String(d.bonusSymbol.emoji).slice(0, 8);
  const allEmoji = [...symbols.map((s) => s.emoji), wildEmoji, bonusEmoji];
  if (new Set(allEmoji).size !== allEmoji.length) throw new Error('duplicate emoji');

  const color = /^#[0-9a-fA-F]{6}$/.test(String(d.color)) ? String(d.color) : '#FF3DA5';
  const themeStyle = THEME_STYLES.includes(String(d.themeStyle)) ? String(d.themeStyle) : 'default';

  return {
    name: String(d.name ?? 'Untitled Machine').slice(0, 40),
    tagline: String(d.tagline ?? '').slice(0, 60),
    color,
    themeStyle,
    symbols,
    wildSymbol: { emoji: wildEmoji, name: String(d.wildSymbol.name ?? 'Wild').slice(0, 24) },
    bonusSymbol: { emoji: bonusEmoji, name: String(d.bonusSymbol.name ?? 'Scatter').slice(0, 24) },
  };
}

export function toSlotDef(
  spec: GeneratedSpec, reels: number, gameType: SlotDef['gameType'],
  vol: SlotDef['volatility'],
): SlotDef {
  return { ...spec, reels, gameType, volatility: vol };
}

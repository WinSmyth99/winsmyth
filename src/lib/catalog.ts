// Session catalogue: the ten presets (always present) plus this
// session's builds (in memory only — the deliberate zero-moving-parts
// demo choice; Airtable persistence arrives with the soft-launch plan).

import { GameType, SlotDef } from '../engine/types';
import { TYPE_PROFILES } from '../engine';
import { FALLBACK_PRESETS } from '../generation/presets';

export interface CatalogEntry {
  id: string;
  slot: SlotDef;
  source: 'preset' | 'session';
}

export function presetEntries(): CatalogEntry[] {
  return FALLBACK_PRESETS.map((p, i) => {
    const gameType: GameType = (['paylines', 'ways', 'scatter', 'cluster'] as GameType[])[i % 4];
    return {
      id: `preset-${i}`,
      source: 'preset' as const,
      slot: {
        name: p.name, tagline: p.tagline, color: p.color, themeStyle: p.themeStyle,
        symbols: p.symbols, wildSymbol: p.wildSymbol, bonusSymbol: p.bonusSymbol,
        reels: 5, gameType, volatility: TYPE_PROFILES[gameType].vol,
      },
    };
  });
}

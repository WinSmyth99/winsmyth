// Session catalogue: the ten presets (always present) plus this
// session's builds (in memory only — the deliberate zero-moving-parts
// demo choice; Airtable persistence arrives with the soft-launch plan).

import { GameType, SlotDef } from '../engine/types';
import { TYPE_PROFILES } from '../engine';
import { FALLBACK_PRESETS } from '../generation/presets';

export interface CatalogEntry {
  id: string;
  slot: SlotDef;
  source: 'preset' | 'session' | 'community' | 'house';
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

// Shared catalogue from the catalog function. Empty until Airtable is
// configured — the lobby simply hides the Community row.
import { toSlotDef, validateAndClamp } from '../generation/schema';

export async function fetchCommunity(): Promise<CatalogEntry[]> {
  try {
    const res = await fetch('/api/catalog');
    if (!res.ok) return [];
    const d = await res.json() as { machines: { id: string; spec: unknown; gameType: string; reels: number; house?: boolean }[] };
    return (d.machines ?? []).flatMap((m) => {
      try {
        const gt = (['paylines', 'ways', 'scatter', 'cluster'] as GameType[]).includes(m.gameType as GameType)
          ? m.gameType as GameType : 'paylines';
        const slot = toSlotDef(validateAndClamp(m.spec), m.reels === 3 ? 3 : 5, gt, TYPE_PROFILES[gt].vol);
        if (/^rec[A-Za-z0-9]{14,17}$/.test(m.id)) slot.artId = m.id;
        return [{ id: m.id, source: (m.house ? 'house' : 'community') as 'house' | 'community', slot }];
      } catch { return []; }
    });
  } catch { return []; }
}

// Client-side generation: call the Netlify function; fall back to the
// preset library when unavailable (local dev without the function, key
// unset, rate limited, or model failure). The UI shows which path ran.

import { GameType, SlotDef } from '../engine/types';
import { TYPE_PROFILES } from '../engine';
import { GeneratedSpec, toSlotDef, validateAndClamp } from './schema';
import { fallbackFor } from './presets';

export interface BuildRequest {
  prompt: string;
  reels: number;
  gameType: GameType;
}

export interface BuildOutcome {
  slot: SlotDef;
  usedFallback: boolean;
}

export async function buildMachine(req: BuildRequest): Promise<BuildOutcome> {
  const vol = TYPE_PROFILES[req.gameType].vol;
  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: req.prompt }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const { spec } = (await res.json()) as { spec: GeneratedSpec };
    return { slot: toSlotDef(validateAndClamp(spec), req.reels, req.gameType, vol), usedFallback: false };
  } catch {
    const p = fallbackFor(req.prompt);
    return {
      slot: toSlotDef(
        { name: p.name, tagline: p.tagline, color: p.color, themeStyle: p.themeStyle, symbols: p.symbols, wildSymbol: p.wildSymbol, bonusSymbol: p.bonusSymbol },
        req.reels, req.gameType, vol,
      ),
      usedFallback: true,
    };
  }
}

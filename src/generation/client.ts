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
  artStyle?: string;
}

export interface BuildOutcome {
  slot: SlotDef;
  usedFallback: boolean;
  held: boolean;      // passed generation but held from the public catalogue
  rejected: boolean;  // blocked by triage
  unlisted: boolean;  // approved — creator decides whether to publish
}

// artId is attached to the slot when the machine persisted, so machine
// pages (and share links) can load its generated art.

export async function buildMachine(req: BuildRequest): Promise<BuildOutcome> {
  const vol = TYPE_PROFILES[req.gameType].vol;
  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: req.prompt, reels: req.reels, gameType: req.gameType, artStyle: req.artStyle ?? 'synthwave' }),
    });
    if (res.status === 422) {
      // triage block: no machine, and no silent fallback either
      return { slot: null as unknown as SlotDef, usedFallback: false, held: false, unlisted: false, rejected: true };
    }
    if (!res.ok) throw new Error(String(res.status));
    const d = (await res.json()) as { spec: GeneratedSpec; status?: string; id?: string };
    const slot = toSlotDef(validateAndClamp(d.spec), req.reels, req.gameType, vol);
    if (typeof d.id === 'string' && /^rec[A-Za-z0-9]{14,17}$/.test(d.id)) slot.artId = d.id;
    return {
      slot,
      usedFallback: false,
      held: d.status === 'pending',
      unlisted: d.status === 'unlisted',
      rejected: false,
    };
  } catch {
    const p = fallbackFor(req.prompt);
    return {
      slot: toSlotDef(
        { name: p.name, tagline: p.tagline, color: p.color, themeStyle: p.themeStyle, symbols: p.symbols, wildSymbol: p.wildSymbol, bonusSymbol: p.bonusSymbol },
        req.reels, req.gameType, vol,
      ),
      usedFallback: true,
      held: false,
      unlisted: false,
      rejected: false,
    };
  }
}

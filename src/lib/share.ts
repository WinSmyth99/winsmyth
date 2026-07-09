// Shareable machine URLs with zero backend: the full spec travels in the
// hash, base64url-encoded. Decoding runs through validateAndClamp so a
// tampered URL cannot smuggle out-of-band multipliers into the engine.

import { GameType, SlotDef } from '../engine/types';
import { TYPE_PROFILES } from '../engine';
import { toSlotDef, validateAndClamp } from '../generation/schema';

export function encodeSlot(slot: SlotDef): string {
  const json = JSON.stringify(slot);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeSlot(encoded: string): SlotDef | null {
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const raw = JSON.parse(decodeURIComponent(escape(atob(b64))));
    const spec = validateAndClamp(raw);
    const gameType: GameType = ['paylines', 'ways', 'scatter', 'cluster'].includes(raw.gameType)
      ? raw.gameType : 'paylines';
    const reels = raw.reels === 3 ? 3 : 5;
    return toSlotDef(spec, reels, gameType, TYPE_PROFILES[gameType].vol);
  } catch {
    return null;
  }
}

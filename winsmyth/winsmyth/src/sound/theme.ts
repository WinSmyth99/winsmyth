// Theme → sound profile mapping. Every machine speaks the same event
// vocabulary (spin, stops, scatter, cascades, wins) in its own musical
// voice: a scale, a root note, and an instrument character derived from
// the machine spec. Pure data + maths, no audio API here.

import { SlotDef } from '../engine/types';

export type Osc = 'sine' | 'triangle' | 'square' | 'sawtooth';

export interface SoundProfile {
  name: string;
  rootHz: number;       // tonal centre
  scale: number[];      // semitone offsets from root, ascending
  lead: Osc;            // melodic voice (fanfares, pops, chimes)
  bass: Osc;            // weight under big moments
  brightness: number;   // 0..1 — upper-partial gain
}

// Scales chosen for instant genre legibility at 3-note-arpeggio length.
const SCALES = {
  majorPent: [0, 2, 4, 7, 9, 12, 14, 16],
  minorPent: [0, 3, 5, 7, 10, 12, 15, 17],
  doubleHarmonic: [0, 1, 4, 5, 7, 8, 11, 12],   // egyptian/phrygian-dominant colour
  dorian: [0, 2, 3, 5, 7, 9, 10, 12],           // sea-shanty modal
  wholeTone: [0, 2, 4, 6, 8, 10, 12, 14],       // weightless space
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11, 12],    // arcane
} as const;

const NOTE = { C3: 130.81, D3: 146.83, E3: 164.81, G3: 196.0, A3: 220.0 };

const PROFILES: Record<string, Omit<SoundProfile, 'brightness'>> = {
  egyptian: { name: 'egyptian', rootHz: NOTE.D3, scale: [...SCALES.doubleHarmonic], lead: 'sawtooth', bass: 'sine' },
  nautical: { name: 'nautical', rootHz: NOTE.G3, scale: [...SCALES.dorian], lead: 'triangle', bass: 'triangle' },
  vegas:    { name: 'vegas',    rootHz: NOTE.C3, scale: [...SCALES.majorPent], lead: 'square', bass: 'triangle' },
  space:    { name: 'space',    rootHz: NOTE.E3, scale: [...SCALES.wholeTone], lead: 'sine', bass: 'sine' },
  wizard:   { name: 'wizard',   rootHz: NOTE.A3, scale: [...SCALES.harmonicMinor], lead: 'triangle', bass: 'sawtooth' },
  default:  { name: 'default',  rootHz: NOTE.A3, scale: [...SCALES.minorPent], lead: 'triangle', bass: 'sine' },
};

// Machine colour nudges brightness: warmer hue → brighter partials.
function hueBrightness(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0.5;
  let h = 0;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h = (h * 60 + 360) % 360;
  // reds/oranges/yellows (0–90) brightest; blues (200–280) darkest
  return h <= 90 ? 0.8 : h >= 200 && h <= 280 ? 0.3 : 0.55;
}

export function profileFor(slot: SlotDef): SoundProfile {
  const base = PROFILES[slot.themeStyle] ?? PROFILES.default;
  return { ...base, scale: [...base.scale], brightness: hueBrightness(slot.color) };
}

// Frequency of the nth scale degree (supports beyond-octave via wrap).
export function degreeHz(p: SoundProfile, degree: number, octave = 0): number {
  const len = p.scale.length;
  const wrapOct = Math.floor(degree / len);
  const semis = p.scale[((degree % len) + len) % len] + (octave + wrapOct) * 12;
  return p.rootHz * 2 ** (semis / 12);
}

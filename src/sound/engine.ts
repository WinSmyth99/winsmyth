// Winsmyth sound engine — fully synthesized WebAudio, zero audio files
// (so zero licensing questions at this stage; the tagged audio library
// from the Generation Quality doc replaces this at Layer 3 build-out).
// Autoplay-safe: the context initialises on first user gesture.

import { degreeHz, profileFor, SoundProfile } from './theme';
import { SlotDef } from '../engine/types';

type Tier = 'small' | 'big' | 'mega' | 'jackpot';

const DEFAULT_PROFILE: SoundProfile = {
  name: 'default', rootHz: 220, scale: [0, 3, 5, 7, 10, 12, 15, 17],
  lead: 'triangle', bass: 'sine', brightness: 0.5,
};

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;
  private profile: SoundProfile = DEFAULT_PROFILE;

  setMachine(slot: SlotDef | null) {
    this.profile = slot ? profileFor(slot) : DEFAULT_PROFILE;
  }

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  private tone(
    freq: number, dur: number, opts: {
      type?: OscillatorType; gain?: number; at?: number;
      slideTo?: number; attack?: number;
    } = {},
  ) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (opts.at ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur);
    const peak = opts.gain ?? 0.2;
    const atk = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  private noise(dur: number, opts: { gain?: number; at?: number; from?: number; to?: number } = {}) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (opts.at ?? 0);
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(opts.from ?? 1200, t0);
    filter.frequency.exponentialRampToValueAtTime(opts.to ?? 300, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain ?? 0.12, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter); filter.connect(g); g.connect(this.master);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  // ── Vocabulary — every event speaks in the machine's key/timbre ──
  private deg(degree: number, octave = 0): number {
    return degreeHz(this.profile, degree, octave);
  }

  spinStart() {
    this.noise(0.35, { gain: 0.10, from: 2400, to: 500 });
    this.tone(this.deg(0), 0.18, { type: this.profile.bass, gain: 0.12, slideTo: this.deg(0) / 2 });
  }

  reelStop(index: number) {
    // thunks walk DOWN the machine's scale; last reel lands heaviest
    const f = this.deg(-index, -1);
    this.tone(f, 0.10, { type: 'square', gain: 0.14 });
    this.noise(0.06, { gain: 0.08, from: 900, to: 200 });
  }

  scatterLand() {
    this.tone(this.deg(4, 1), 0.25, { type: this.profile.lead, gain: 0.16 });
    this.tone(this.deg(7, 1), 0.30, { type: 'sine', gain: 0.10, at: 0.06 });
  }

  anticipation(dur: number) {
    // riser sweeps from the sub-root to the octave in the machine's key
    this.tone(this.deg(0, -1), dur, { type: 'sawtooth', gain: 0.06, slideTo: this.deg(0, 1), attack: dur * 0.5 });
    this.noise(dur, { gain: 0.03, from: 300, to: 1800 });
  }

  cascadePop(step: number) {
    // pops climb the scale with the cascade chain
    const f = this.deg(step + 2, 1);
    this.tone(f, 0.09, { type: this.profile.lead, gain: 0.14 });
    this.tone(f * 1.5, 0.12, { type: this.profile.lead, gain: 0.06 + this.profile.brightness * 0.08, at: 0.04 });
  }

  coinTick(i: number) {
    this.tone(this.deg(i % 5, 2), 0.05, { type: 'square', gain: 0.05 });
  }

  // short signature motif when a machine opens: root → third → fifth
  welcome() {
    [0, 2, 4].forEach((d, i) => {
      this.tone(this.deg(d, 1), 0.28, { type: this.profile.lead, gain: 0.10, at: i * 0.13 });
    });
    this.tone(this.deg(0, 0), 0.6, { type: this.profile.bass, gain: 0.06, at: 0.26 });
  }

  win(tier: Tier) {
    // fanfares as scale-degree arpeggios — genre colour comes free from
    // the profile's scale (double-harmonic egyptian vs whole-tone space)
    const seq: Record<Tier, [number, number][]> = {
      small: [[0, 1], [2, 1], [4, 1]],
      big: [[0, 1], [2, 1], [4, 1], [0, 2], [2, 2]],
      mega: [[4, 0], [0, 1], [2, 1], [4, 1], [5, 1], [6, 1], [0, 2]],
      jackpot: [[0, 1], [2, 1], [4, 1], [0, 2], [4, 1], [0, 2], [2, 2], [4, 2], [0, 3]],
    };
    const gap = tier === 'small' ? 0.09 : 0.11;
    const bright = 0.10 + this.profile.brightness * 0.10;
    seq[tier].forEach(([d, o], i) => {
      this.tone(this.deg(d, o), 0.22, { type: this.profile.lead, gain: bright + 0.06, at: i * gap });
      if (tier !== 'small') this.tone(this.deg(d, o - 1), 0.3, { type: this.profile.bass, gain: 0.08, at: i * gap });
    });
  }
}

export const sound = new SoundEngine();
export type WinTier = Tier;

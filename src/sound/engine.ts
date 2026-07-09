// Winsmyth sound engine — fully synthesized WebAudio, zero audio files
// (so zero licensing questions at this stage; the tagged audio library
// from the Generation Quality doc replaces this at Layer 3 build-out).
// Autoplay-safe: the context initialises on first user gesture.

type Tier = 'small' | 'big' | 'mega' | 'jackpot';

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

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

  // ── Vocabulary ──
  spinStart() {
    this.noise(0.35, { gain: 0.10, from: 2400, to: 500 });
    this.tone(180, 0.18, { type: 'triangle', gain: 0.12, slideTo: 90 });
  }

  reelStop(index: number) {
    // pitched-down thunk per reel: 5th reel lands heaviest
    const f = 220 - index * 22;
    this.tone(f, 0.10, { type: 'square', gain: 0.14 });
    this.noise(0.06, { gain: 0.08, from: 900, to: 200 });
  }

  scatterLand() {
    this.tone(880, 0.25, { type: 'sine', gain: 0.16 });
    this.tone(1320, 0.30, { type: 'sine', gain: 0.10, at: 0.06 });
  }

  anticipation(dur: number) {
    // rising saw swell under the slowed reel
    this.tone(110, dur, { type: 'sawtooth', gain: 0.06, slideTo: 340, attack: dur * 0.5 });
    this.noise(dur, { gain: 0.03, from: 300, to: 1800 });
  }

  cascadePop(step: number) {
    const base = 420 + step * 90;
    this.tone(base, 0.09, { type: 'triangle', gain: 0.14 });
    this.tone(base * 1.5, 0.12, { type: 'triangle', gain: 0.10, at: 0.04 });
  }

  coinTick(i: number) {
    this.tone(1200 + (i % 5) * 160, 0.05, { type: 'square', gain: 0.05 });
  }

  win(tier: Tier) {
    const seq: Record<Tier, number[]> = {
      small: [523, 659, 784],
      big: [523, 659, 784, 1047, 1319],
      mega: [392, 523, 659, 784, 988, 1175, 1568],
      jackpot: [523, 659, 784, 1047, 784, 1047, 1319, 1568, 2093],
    };
    const gap = tier === 'small' ? 0.09 : 0.11;
    seq[tier].forEach((f, i) => {
      this.tone(f, 0.22, { type: 'triangle', gain: 0.16, at: i * gap });
      if (tier !== 'small') this.tone(f / 2, 0.3, { type: 'sine', gain: 0.08, at: i * gap });
    });
  }
}

export const sound = new SoundEngine();
export type WinTier = Tier;

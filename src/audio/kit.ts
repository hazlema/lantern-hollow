/**
 * Kit: a tiny synthesis toolkit over Web Audio graph nodes.
 *
 * The same code is used for:
 *  - pre-rendering SFX in OfflineAudioContexts (t0 = slot offset, live = false)
 *  - realtime music / ambience voices (t0 = 0, live = true: nodes disconnect on `ended`)
 *
 * All times passed to primitives are relative to `t0`.
 */
import {
  type NoiseColor,
  type Rng,
  type WaveName,
  driveCurve,
  noiseBuffer,
  periodicWave,
} from './dsp';

/** A constant, or an automation path of [time, value] points (exponential ramps between points). */
export type Path = number | ReadonlyArray<readonly [number, number]>;

export interface EnvOpts {
  /** start time (relative to the kit's t0) */
  t?: number;
  /** attack seconds (linear) */
  a?: number;
  /** hold seconds at peak / sustain */
  h?: number;
  /** decay-to-silence seconds (exponential, ~-60 dB at the end) */
  d: number;
  /** peak gain */
  v?: number;
  /** sustain level fraction during hold (default 1) */
  s?: number;
  /** decay-to-sustain seconds (default min(h, 0.1)) */
  sd?: number;
}

export interface FilterOpts {
  lp?: Path;
  lpQ?: number;
  hp?: Path;
  hpQ?: number;
  bp?: Path;
  q?: number;
  /** peaking EQ: [freq, gainDb, Q] */
  peq?: readonly [number, number, number];
}

export interface ToneOpts extends EnvOpts, FilterOpts {
  f: Path;
  wave?: OscillatorType | WaveName;
  det?: number;
  /** vibrato: [rate Hz, depth as fraction of the start frequency, delay seconds] */
  vib?: readonly [number, number, number?];
  /** tremolo / AM: [rate Hz, depth 0..1] */
  trem?: readonly [number, number];
  out?: AudioNode;
}

export interface NoiseOpts extends EnvOpts, FilterOpts {
  color?: NoiseColor;
  rate?: number;
  trem?: readonly [number, number];
  out?: AudioNode;
}

export interface FmOpts extends EnvOpts, FilterOpts {
  f: Path;
  ratio: number;
  /** modulation index at the start */
  index: number;
  /** modulation index after idxDecay (default index * 0.05) */
  index2?: number;
  idxDecay?: number;
  out?: AudioNode;
}

/** [frequency ratio, amplitude, decay seconds] */
export type Partial = readonly [number, number, number];

export interface PartialsOpts extends FilterOpts {
  t?: number;
  f: number;
  partials: readonly Partial[];
  a?: number;
  v?: number;
  /** pitch "bend-in": multiply f by this at the start and settle in `bendTime` */
  bend?: number;
  bendTime?: number;
  out?: AudioNode;
}

export type Vowel = 'a' | 'e' | 'i' | 'o' | 'u' | 'uh' | 'm' | 'n' | 'r';

/** F1, F2, F3 (Hz) and an openness gain. Slightly lowered "monster" formants. */
const VOWELS: Record<Vowel, readonly [number, number, number, number]> = {
  a: [720, 1090, 2440, 1],
  e: [530, 1800, 2480, 0.9],
  i: [380, 2000, 2600, 0.75],
  o: [470, 800, 2600, 0.95],
  u: [310, 820, 2240, 0.7],
  uh: [620, 1180, 2390, 0.95],
  m: [260, 1000, 2300, 0.28],
  n: [280, 1500, 2500, 0.3],
  r: [480, 1200, 1600, 0.75],
};

export interface VoiceOpts {
  t?: number;
  dur: number;
  f0: Path;
  vowels: ReadonlyArray<readonly [number, Vowel]>;
  v?: number;
  a?: number;
  r?: number;
  vib?: readonly [number, number];
  /** growl / flutter amplitude modulation [rate, depth] */
  growl?: readonly [number, number];
  breath?: number;
  lp?: number;
  out?: AudioNode;
}

export class Kit {
  readonly sr: number;

  constructor(
    readonly ctx: BaseAudioContext,
    public out: AudioNode,
    public t0 = 0,
    readonly r: Rng = Math.random,
    /** realtime voices: disconnect nodes when their source ends */
    readonly live = false,
  ) {
    this.sr = ctx.sampleRate;
  }

  rand(a: number, b: number): number {
    return a + (b - a) * this.r();
  }

  // ------------------------------------------------------------ automation helpers

  setPath(p: AudioParam, path: Path, t: number, mul = 1): number {
    if (typeof path === 'number') {
      // constants go straight to .value: an automation event would make Chrome
      // treat the param as sample-accurate (e.g. per-sample biquad coefficients)
      p.value = path * mul;
      return path * mul;
    }
    const v0 = path[0][1] * mul;
    p.setValueAtTime(v0, t + path[0][0]);
    for (let i = 1; i < path.length; i++) {
      p.exponentialRampToValueAtTime(Math.max(path[i][1] * mul, 1e-4), t + path[i][0]);
    }
    return v0;
  }

  /** Attack / hold(+sustain) / exponential decay. Returns the time the envelope is silent. */
  env(p: AudioParam, t: number, o: EnvOpts): number {
    const a = Math.max(0.0005, o.a ?? 0.003);
    const h = o.h ?? 0;
    const v = Math.max(1e-5, o.v ?? 1);
    const s = o.s ?? 1;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(v, t + a);
    if (h > 0) {
      if (s !== 1) {
        const sd = Math.min(o.sd ?? 0.1, h);
        p.exponentialRampToValueAtTime(Math.max(v * s, 1e-5), t + a + sd);
      }
      p.setValueAtTime(Math.max(v * s, 1e-5), t + a + h);
    }
    const end = t + a + h + o.d;
    p.exponentialRampToValueAtTime(Math.max(v * s, 1e-5) * 0.001, end);
    p.linearRampToValueAtTime(0, end + 0.004);
    return end + 0.01;
  }

  private dispose(src: AudioScheduledSourceNode, nodes: AudioNode[]): void {
    if (!this.live) return;
    src.onended = () => {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* already disconnected */
        }
      }
    };
  }

  /** Builds hp -> bp -> peq -> lp chain. Returns [input, output]; pushes nodes into `nodes`. */
  private filters(o: FilterOpts, t: number, nodes: AudioNode[]): [AudioNode, AudioNode] | null {
    const chain: BiquadFilterNode[] = [];
    const mk = (type: BiquadFilterType, f: Path, q: number) => {
      const b = this.ctx.createBiquadFilter();
      b.type = type;
      b.Q.value = q;
      this.setPath(b.frequency, f, t);
      chain.push(b);
    };
    if (o.hp !== undefined) mk('highpass', o.hp, o.hpQ ?? 0.7);
    if (o.bp !== undefined) mk('bandpass', o.bp, o.q ?? 1);
    if (o.peq) {
      const b = this.ctx.createBiquadFilter();
      b.type = 'peaking';
      b.frequency.value = o.peq[0];
      b.gain.value = o.peq[1];
      b.Q.value = o.peq[2];
      chain.push(b);
    }
    if (o.lp !== undefined) mk('lowpass', o.lp, o.lpQ ?? 0.7);
    if (!chain.length) return null;
    for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
    nodes.push(...chain);
    return [chain[0], chain[chain.length - 1]];
  }

  private lfo(rate: number, t: number, end: number, nodes: AudioNode[]): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.frequency.value = rate;
    o.start(t);
    o.stop(end);
    nodes.push(o);
    return o;
  }

  /**
   * Common voice tail: filters -> (tremolo) -> envelope gain -> out.
   * Returns the input node for sources and the end time.
   */
  private tail(
    o: EnvOpts & FilterOpts & { trem?: readonly [number, number]; out?: AudioNode },
    t: number,
    nodes: AudioNode[],
  ): { input: AudioNode; gain: GainNode; end: number } {
    const g = this.ctx.createGain();
    const end = this.env(g.gain, t, o);
    nodes.push(g);
    let input: AudioNode = g;
    const f = this.filters(o, t, nodes);
    if (f) {
      f[1].connect(input);
      input = f[0];
    }
    if (o.trem) {
      const am = this.ctx.createGain();
      am.gain.value = 1 - o.trem[1] / 2;
      const depth = this.ctx.createGain();
      depth.gain.value = o.trem[1] / 2;
      const l = this.lfo(o.trem[0], t, end, nodes);
      l.connect(depth).connect(am.gain);
      nodes.push(am, depth);
      am.connect(input);
      input = am;
    }
    g.connect(o.out ?? this.out);
    return { input, gain: g, end };
  }

  /** Start/stop the main source; LFOs and modulators were scheduled alongside it. */
  private finish(main: AudioScheduledSourceNode, nodes: AudioNode[], t: number, end: number): void {
    main.start(t);
    main.stop(end);
    this.dispose(main, nodes);
  }

  // ------------------------------------------------------------ primitives

  osc(wave: OscillatorType | WaveName | undefined): OscillatorNode {
    const o = this.ctx.createOscillator();
    const w = wave ?? 'sine';
    if (w === 'sine' || w === 'triangle' || w === 'square' || w === 'sawtooth') o.type = w;
    else if (w !== 'custom') o.setPeriodicWave(periodicWave(this.ctx, w));
    return o;
  }

  /** An oscillator voice with pitch path, envelope, filters, vibrato and tremolo. */
  tone(o: ToneOpts): void {
    const t = this.t0 + (o.t ?? 0);
    const nodes: AudioNode[] = [];
    const osc = this.osc(o.wave);
    nodes.push(osc);
    const f0 = this.setPath(osc.frequency, o.f, t);
    if (o.det) osc.detune.value = o.det;
    const { input, end } = this.tail(o, t, nodes);
    if (o.vib) {
      const l = this.lfo(o.vib[0], t, end, nodes);
      const dg = this.ctx.createGain();
      const delay = o.vib[2] ?? 0;
      if (delay > 0) {
        dg.gain.setValueAtTime(0, t);
        dg.gain.linearRampToValueAtTime(f0 * o.vib[1], t + delay);
      } else dg.gain.value = f0 * o.vib[1];
      nodes.push(dg);
      l.connect(dg).connect(osc.frequency);
    }
    osc.connect(input);
    this.finish(osc, nodes, t, end);
  }

  /** Filtered noise burst. */
  noise(o: NoiseOpts): void {
    const t = this.t0 + (o.t ?? 0);
    const nodes: AudioNode[] = [];
    const src = this.ctx.createBufferSource();
    const buf = noiseBuffer(o.color ?? 'white', this.sr);
    src.buffer = buf;
    src.loop = true;
    if (o.rate) src.playbackRate.value = o.rate;
    nodes.push(src);
    const { input, end } = this.tail(o, t, nodes);
    src.connect(input);
    src.start(t, this.r() * (buf.duration - 0.05));
    src.stop(end);
    this.dispose(src, nodes);
  }

  /** Two-operator FM (sine carrier, sine modulator). */
  fm(o: FmOpts): void {
    const t = this.t0 + (o.t ?? 0);
    const nodes: AudioNode[] = [];
    const car = this.ctx.createOscillator();
    const mod = this.ctx.createOscillator();
    const f0 = this.setPath(car.frequency, o.f, t);
    this.setPath(mod.frequency, o.f, t, o.ratio);
    const mg = this.ctx.createGain();
    const dev0 = Math.max(1e-3, o.index * f0 * o.ratio);
    const dev1 = Math.max(1e-3, (o.index2 ?? o.index * 0.05) * f0 * o.ratio);
    mg.gain.setValueAtTime(dev0, t);
    mg.gain.exponentialRampToValueAtTime(dev1, t + (o.idxDecay ?? 0.2));
    nodes.push(car, mod, mg);
    mod.connect(mg).connect(car.frequency);
    const { input, end } = this.tail(o, t, nodes);
    car.connect(input);
    mod.start(t);
    mod.stop(end);
    this.finish(car, nodes, t, end);
  }

  /** Additive sines with individual decays (bells, pots, marimba bars). */
  partials(o: PartialsOpts): void {
    const t = this.t0 + (o.t ?? 0);
    const nodes: AudioNode[] = [];
    const sum = this.ctx.createGain();
    sum.gain.value = o.v ?? 1;
    nodes.push(sum);
    let dest: AudioNode = o.out ?? this.out;
    const f = this.filters(o, t, nodes);
    if (f) {
      f[1].connect(dest);
      dest = f[0];
    }
    sum.connect(dest);
    let last: OscillatorNode | null = null;
    let lastEnd = 0;
    const a = o.a ?? 0.002;
    for (const [ratio, amp, dec] of o.partials) {
      const fr = o.f * ratio;
      if (fr > this.sr * 0.45) continue;
      const osc = this.ctx.createOscillator();
      if (o.bend && o.bend !== 1) {
        osc.frequency.setValueAtTime(fr * o.bend, t);
        osc.frequency.exponentialRampToValueAtTime(fr, t + (o.bendTime ?? 0.05));
      } else osc.frequency.value = fr;
      const g = this.ctx.createGain();
      const end = this.env(g.gain, t, { a, d: dec, v: amp });
      osc.connect(g).connect(sum);
      osc.start(t);
      osc.stop(end);
      nodes.push(osc, g);
      if (end >= lastEnd) {
        lastEnd = end;
        last = osc;
      }
    }
    if (last) this.dispose(last, nodes);
  }

  /** Plays an AudioBuffer (e.g. a Karplus-Strong pluck) with gain/filters. */
  buffer(o: { t?: number; buf: AudioBuffer; rate?: number; v?: number; d?: number; out?: AudioNode } & FilterOpts): void {
    const t = this.t0 + (o.t ?? 0);
    const nodes: AudioNode[] = [];
    const src = this.ctx.createBufferSource();
    src.buffer = o.buf;
    if (o.rate) src.playbackRate.value = o.rate;
    const g = this.ctx.createGain();
    nodes.push(src, g);
    let end = t + o.buf.duration / (o.rate ?? 1);
    if (o.d !== undefined) {
      // shorten with an exponential cut (pizzicato / damped)
      g.gain.setValueAtTime(o.v ?? 1, t);
      g.gain.setTargetAtTime(0, t + o.d * 0.4, o.d * 0.25);
      end = Math.min(end, t + o.d * 1.8);
    } else g.gain.value = o.v ?? 1;
    let dest: AudioNode = o.out ?? this.out;
    const f = this.filters(o, t, nodes);
    if (f) {
      f[1].connect(dest);
      dest = f[0];
    }
    src.connect(g).connect(dest);
    src.start(t);
    src.stop(end);
    this.dispose(src, nodes);
  }

  /**
   * Parallel-formant vocal synth: glottal source + breath noise -> F1/F2/F3 bandpasses,
   * plus a chest-resonance lowpass. Used for zombies and the boss.
   */
  voice(o: VoiceOpts): void {
    const ctx = this.ctx;
    const t = this.t0 + (o.t ?? 0);
    const nodes: AudioNode[] = [];
    const a = o.a ?? 0.1;
    const rel = o.r ?? 0.25;
    const end = t + o.dur + 0.02;

    const src = this.osc('glottal');
    const f0 = this.setPath(src.frequency, o.f0, t);
    nodes.push(src);
    if (o.vib) {
      const l = this.lfo(o.vib[0], t, end, nodes);
      const dg = ctx.createGain();
      dg.gain.value = f0 * o.vib[1];
      nodes.push(dg);
      l.connect(dg).connect(src.frequency);
    }
    const exc = ctx.createGain();
    nodes.push(exc);
    src.connect(exc);
    if (o.breath) {
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer('pink', this.sr);
      n.loop = true;
      const ng = ctx.createGain();
      ng.gain.value = o.breath;
      n.connect(ng).connect(exc);
      n.start(t, this.r() * 2);
      n.stop(end);
      nodes.push(n, ng);
    }

    const sum = ctx.createGain();
    const openness = ctx.createGain();
    nodes.push(sum, openness);
    const qs = [7, 11, 14];
    const gs = [1, 0.5, 0.22];
    const fs: BiquadFilterNode[] = [];
    for (let i = 0; i < 3; i++) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = qs[i];
      const g = ctx.createGain();
      g.gain.value = gs[i] * 2.2;
      exc.connect(bp).connect(g).connect(sum);
      fs.push(bp);
      nodes.push(bp, g);
    }
    const chest = ctx.createBiquadFilter();
    chest.type = 'lowpass';
    chest.frequency.value = 300;
    const cg = ctx.createGain();
    cg.gain.value = 0.25;
    exc.connect(chest).connect(cg).connect(sum);
    nodes.push(chest, cg);

    // vowel trajectory
    o.vowels.forEach(([vt, name], i) => {
      const [f1, f2, f3, open] = VOWELS[name];
      const tt = t + vt;
      const set = (p: AudioParam, v: number) => (i === 0 ? p.setValueAtTime(v, tt) : p.linearRampToValueAtTime(v, tt));
      set(fs[0].frequency, f1);
      set(fs[1].frequency, f2);
      set(fs[2].frequency, f3);
      set(openness.gain, open);
    });

    sum.connect(openness);
    let last: AudioNode = openness;
    if (o.growl) {
      const am = ctx.createGain();
      am.gain.value = 1 - o.growl[1] / 2;
      const dg = ctx.createGain();
      dg.gain.value = o.growl[1] / 2;
      const l = this.lfo(o.growl[0], t, end, nodes);
      l.connect(dg).connect(am.gain);
      last.connect(am);
      last = am;
      nodes.push(am, dg);
    }
    const env = ctx.createGain();
    const v = o.v ?? 1;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(v, t + a);
    env.gain.setValueAtTime(v, t + Math.max(a, o.dur - rel));
    env.gain.linearRampToValueAtTime(0, t + o.dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = o.lp ?? 3200;
    lp.Q.value = 0.5;
    nodes.push(env, lp);
    last.connect(env).connect(lp).connect(o.out ?? this.out);
    src.start(t);
    src.stop(end);
    this.dispose(src, nodes);
  }

  // ------------------------------------------------------------ post chains (offline only)

  /** Insert a processing chain in front of the current output (affects later voices). */
  post(o: FilterOpts & { drive?: number; gain?: number }): void {
    const nodes: AudioNode[] = [];
    let input: AudioNode = this.out;
    const f = this.filters(o, this.t0, nodes);
    if (f) {
      f[1].connect(input);
      input = f[0];
    }
    if (o.drive) {
      const ws = this.ctx.createWaveShaper();
      ws.curve = driveCurve(o.drive);
      ws.oversample = '2x';
      ws.connect(input);
      input = ws;
    }
    if (o.gain !== undefined) {
      const g = this.ctx.createGain();
      g.gain.value = o.gain;
      g.connect(input);
      input = g;
    }
    this.out = input;
  }

  /** A sub-bus feeding the current output, e.g. for a saturated layer. */
  bus(o: FilterOpts & { drive?: number; gain?: number } = {}): AudioNode {
    const saved = this.out;
    this.post(o);
    const b = this.out;
    this.out = saved;
    return b;
  }
}

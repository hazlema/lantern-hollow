/**
 * Ambience: soft looping wind (always), procedural birdsong by day,
 * crickets and a distant owl by night. Crossfaded by time of day.
 */
import { clamp, cricketChirp, noiseBuffer, pick, rand, randInt, smoothstep } from './dsp';
import * as I from './instruments';
import { Kit } from './kit';

interface Cricket {
  next: number;
  burstEnd: number;
  period: number;
  rate: number;
  gain: GainNode;
}

type Bird = 'tweet' | 'whistle' | 'warble' | 'trill' | 'chip';

export class Ambience {
  /** dry output: connect to the ambience volume bus */
  readonly output: GainNode;
  /** reverb send: connect to the hall (after the ambience volume) */
  readonly wet: GainNode;

  private readonly k: Kit;
  private readonly fade: GainNode;
  private readonly wetFade: GainNode;
  private readonly windBus: GainNode;
  private readonly dayBus: GainNode;
  private readonly nightBus: GainNode;
  private readonly farBus: GainNode;
  /** fixed stereo positions for day (birds) and night (crickets) voices */
  private readonly pans: StereoPannerNode[] = [];
  private readonly nightPans: StereoPannerNode[] = [];
  private windNodes: AudioNode[] = [];
  private windSources: AudioScheduledSourceNode[] = [];
  private windLow: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private windHigh: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private crickets: Cricket[] = [];
  private chirp: AudioBuffer | null = null;

  private running = false;
  private night = 0;
  private nextBird = 0;
  private nextOwl = 0;
  private nextGust = 0;

  constructor(private readonly ctx: BaseAudioContext) {
    this.output = ctx.createGain();
    this.wet = ctx.createGain();
    // start/stop fades for the dry and wet paths
    this.fade = ctx.createGain();
    this.wetFade = ctx.createGain();
    this.fade.gain.value = 0;
    this.wetFade.gain.value = 0;
    this.fade.connect(this.output);
    this.wetFade.connect(this.wet);

    this.windBus = ctx.createGain();
    this.dayBus = ctx.createGain();
    this.nightBus = ctx.createGain();
    this.farBus = ctx.createGain();
    this.windBus.connect(this.fade);
    this.dayBus.connect(this.fade);
    this.nightBus.connect(this.fade);
    const send = (from: AudioNode, amount: number) => {
      const g = ctx.createGain();
      g.gain.value = amount;
      from.connect(g).connect(this.wetFade);
    };
    send(this.dayBus, 0.35);
    send(this.nightBus, 0.25);
    // distant things (owls, far crickets): quiet dry, lots of reverb
    this.farBus.gain.value = 0.45;
    this.farBus.connect(this.nightBus);
    send(this.farBus, 1.4);

    for (const p of [-0.85, -0.5, -0.2, 0.2, 0.5, 0.85]) {
      for (const [list, bus] of [[this.pans, this.dayBus], [this.nightPans, this.nightBus]] as const) {
        const pan = ctx.createStereoPanner();
        pan.pan.value = p;
        pan.connect(bus);
        list.push(pan);
      }
    }
    this.k = new Kit(ctx, this.dayBus, 0, Math.random, true);
    this.applyTimeOfDay(ctx.currentTime, true);
  }

  get playing(): boolean {
    return this.running;
  }

  start(at = this.ctx.currentTime): void {
    if (this.running) return;
    this.running = true;
    for (const g of [this.fade.gain, this.wetFade.gain]) {
      g.cancelScheduledValues(at);
      g.setValueAtTime(g.value, at);
      g.linearRampToValueAtTime(1, at + 2.5);
    }
    this.startWind(at);
    this.nextBird = at + rand(0.5, 2);
    this.nextOwl = at + rand(4, 10);
    this.nextGust = at;
    if (!this.chirp) this.chirp = cricketChirp(this.ctx.sampleRate);
    this.crickets = [];
    const cricketPans = [0, 2, 3, 5, 1];
    for (let i = 0; i < 5; i++) {
      const g = this.ctx.createGain();
      const far = i >= 3;
      g.gain.value = far ? rand(0.035, 0.055) : rand(0.06, 0.1);
      g.connect(far ? this.farBus : this.nightPans[cricketPans[i]]);
      this.crickets.push({ next: at + rand(0, 2), burstEnd: 0, period: rand(0.42, 0.75), rate: rand(0.9, 1.1), gain: g });
    }
  }

  stop(fade = 2, at = this.ctx.currentTime): void {
    if (!this.running) return;
    this.running = false;
    for (const g of [this.fade.gain, this.wetFade.gain]) {
      g.cancelScheduledValues(at);
      g.setValueAtTime(g.value, at);
      g.linearRampToValueAtTime(0, at + fade);
    }
    const srcs = this.windSources;
    const nodes = this.windNodes;
    const crickets = this.crickets;
    this.windSources = [];
    this.windNodes = [];
    this.crickets = [];
    for (const s of srcs) s.stop(at + fade + 0.1);
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        for (const n of nodes) n.disconnect();
        for (const c of crickets) c.gain.disconnect();
      }, (fade + 1) * 1000);
    }
  }

  setNight(t: number, at = this.ctx.currentTime): void {
    this.night = clamp(t, 0, 1);
    this.applyTimeOfDay(at, false);
  }

  private dayAmount(): number {
    return 1 - smoothstep(0.3, 0.7, this.night);
  }

  private nightAmount(): number {
    return smoothstep(0.35, 0.8, this.night);
  }

  private applyTimeOfDay(at: number, immediate: boolean): void {
    const set = (p: AudioParam, v: number) => (immediate ? p.setValueAtTime(v, at) : p.setTargetAtTime(v, at, 1.5));
    set(this.dayBus.gain, this.dayAmount());
    set(this.nightBus.gain, this.nightAmount());
    set(this.windBus.gain, 0.9 + 0.12 * this.night);
  }

  // ------------------------------------------------------------ wind

  private startWind(at: number): void {
    const ctx = this.ctx;
    const nodes: AudioNode[] = [];
    const srcs: AudioScheduledSourceNode[] = [];
    const layer = (color: 'brown' | 'pink', variant: number, type: BiquadFilterType, freq: number, q: number, gain: number, pan: number) => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(color, ctx.sampleRate, 7, variant);
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      src.connect(f).connect(g).connect(p).connect(this.windBus);
      src.start(at, Math.random() * 6);
      nodes.push(src, f, g, p);
      srcs.push(src);
      return { gain: g, filter: f };
    };
    const lfo = (rate: number, depth: number, target: AudioParam) => {
      const o = ctx.createOscillator();
      o.frequency.value = rate;
      const g = ctx.createGain();
      g.gain.value = depth;
      o.connect(g).connect(target);
      o.start(at);
      nodes.push(o, g);
      srcs.push(o);
    };
    this.windLow = layer('brown', 1, 'lowpass', 380, 0.6, 0.26, -0.35);
    this.windHigh = layer('pink', 2, 'bandpass', 850, 0.7, 0.05, 0.4);
    lfo(0.061, 140, this.windLow.filter.frequency);
    lfo(0.043, 0.06, this.windLow.gain.gain);
    lfo(0.089, 320, this.windHigh.filter.frequency);
    lfo(0.071, 0.018, this.windHigh.gain.gain);
    this.windNodes = nodes;
    this.windSources = srcs;
  }

  private gust(t: number): void {
    if (!this.windLow || !this.windHigh) return;
    const strength = rand(0.35, 1) * (0.9 + 0.3 * this.night);
    const tau = rand(1.2, 2.8);
    this.windLow.gain.gain.setTargetAtTime(0.14 + 0.22 * strength, t, tau);
    this.windLow.filter.frequency.setTargetAtTime(260 + 380 * strength, t, tau);
    this.windHigh.gain.gain.setTargetAtTime(0.02 + 0.055 * strength, t, tau);
    this.windHigh.filter.frequency.setTargetAtTime(600 + 900 * strength, t, tau);
  }

  // ------------------------------------------------------------ scheduling

  scheduleUntil(now: number, until: number): void {
    if (!this.running) return;
    if (this.nextGust <= until) {
      this.gust(Math.max(now, this.nextGust));
      this.nextGust = Math.max(now, this.nextGust) + rand(3, 8);
    }
    if (this.nextBird <= until) {
      const day = this.dayAmount();
      const t = Math.max(now + 0.02, this.nextBird);
      if (day > 0.05) this.birdCall(t);
      this.nextBird = t + rand(1.8, 6.5) * (day > 0.5 ? 1 : 2.5);
    }
    if (this.nextOwl <= until) {
      const t = Math.max(now + 0.02, this.nextOwl);
      if (this.nightAmount() > 0.3) this.owlCall(t);
      this.nextOwl = t + rand(14, 34);
    }
    const nightOn = this.nightAmount() > 0.02;
    for (const c of this.crickets) {
      if (c.next < now - 1) c.next = now + rand(0, 0.5);
      while (c.next < until) {
        if (c.next >= c.burstEnd) {
          // pause, then a new burst of chirps
          c.next += rand(1, 5);
          c.burstEnd = c.next + rand(3, 11);
          continue;
        }
        if (nightOn && this.chirp) this.playChirp(c, c.next);
        c.next += c.period * rand(0.97, 1.03);
      }
    }
  }

  private playChirp(c: Cricket, t: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.chirp;
    src.playbackRate.value = c.rate * rand(0.995, 1.005);
    src.connect(c.gain);
    src.onended = () => src.disconnect();
    src.start(t);
  }

  private birdCall(t: number): void {
    const k = this.k;
    const out = pick(this.pans);
    const v = rand(0.05, 0.11);
    const sp: Bird = pick(['tweet', 'whistle', 'warble', 'trill', 'chip'] as const);
    switch (sp) {
      case 'tweet': {
        const n = randInt(2, 4);
        const f = rand(3600, 4600);
        const gap = rand(0.12, 0.16);
        for (let i = 0; i < n; i++) I.birdNote(k, t + i * gap, [[0, f], [0.07, f * 0.72]], 0.08, v, { out });
        break;
      }
      case 'whistle': {
        const f = rand(3500, 4100);
        I.birdNote(k, t, [[0, f], [0.28, f * 0.96]], 0.3, v * 0.75, { out });
        I.birdNote(k, t + 0.36, [[0, f * 0.84], [0.28, f * 0.8]], 0.3, v * 0.75, { out });
        break;
      }
      case 'warble': {
        const n = randInt(4, 7);
        let tt = t;
        for (let i = 0; i < n; i++) {
          const f = rand(2400, 3800);
          const len = rand(0.07, 0.13);
          I.birdNote(k, tt, [[0, f], [len, f * pick([1.25, 0.8, 1.1, 0.9])]], len, v * rand(0.6, 1), { out });
          tt += len + rand(0.03, 0.07);
        }
        break;
      }
      case 'trill': {
        const f = rand(3800, 4400);
        I.birdNote(k, t, [[0, f], [0.5, f * 0.92]], 0.5, v * 0.6, { trill: rand(22, 30), out });
        break;
      }
      case 'chip': {
        const n = randInt(3, 6);
        const gap = rand(0.06, 0.09);
        for (let i = 0; i < n; i++) {
          const f = rand(4400, 5200);
          I.birdNote(k, t + i * gap, [[0, f], [0.03, f * 0.85]], 0.035, v * 0.7, { out });
        }
        break;
      }
    }
  }

  private owlCall(t: number): void {
    const k = this.k;
    const f = rand(310, 380);
    const v = rand(0.25, 0.35);
    const out = this.farBus;
    if (Math.random() < 0.5) {
      // tawny: "hoo ... hu-hu-hooo"
      I.hoo(k, t, f, 0.5, v, out);
      I.hoo(k, t + 1.1, f * 1.02, 0.14, v * 0.8, out);
      I.hoo(k, t + 1.32, f * 1.04, 0.14, v * 0.8, out);
      I.hoo(k, t + 1.56, f, 0.8, v, out);
    } else {
      // great horned: "hoo h'hoo hoo hoo"
      I.hoo(k, t, f, 0.35, v, out);
      I.hoo(k, t + 0.5, f * 1.03, 0.16, v * 0.8, out);
      I.hoo(k, t + 0.72, f * 1.03, 0.16, v * 0.8, out);
      I.hoo(k, t + 1.05, f, 0.42, v, out);
      I.hoo(k, t + 1.62, f * 0.97, 0.45, v * 0.9, out);
    }
  }
}

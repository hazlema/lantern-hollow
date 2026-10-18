/**
 * Generative autumn waltz (3/4, ~84-90 BPM) in D minor / F major.
 *
 * A lookahead scheduler (driven by the engine's 25 ms tick) schedules one beat
 * at a time. At each bar start the bar's events are generated into an event
 * queue (positions in beats), so tempo changes and stop() take effect cleanly.
 *
 * Layers:
 *  - calm   (always): Karplus-Strong arpeggios, upright bass, warm pad, music-box melody
 *  - combat (intensity): kick, brushes, spiccato low strings, busier high plucks, pizzicato counter-line
 *  - boss   (boss mode): timpani + rolls, minor-second wobble pad, faster semitone ostinato
 *
 * Works on any BaseAudioContext, so it can also be rendered offline for level checks.
 */
import { chance, clamp, lerpExp, mtof, pick, pickWeighted, rand, randInt } from './dsp';
import * as I from './instruments';
import { Kit } from './kit';

// ---------------------------------------------------------------- harmony

interface Chord {
  name: string;
  root: number; // pitch class
  tones: readonly number[]; // intervals from root
  bass?: number; // pitch class for slash chords
}

const MAJ = [0, 4, 7];
const MIN = [0, 3, 7];
const DOM7 = [0, 4, 7, 10];
const MAJ7 = [0, 4, 7, 11];
const MIN7 = [0, 3, 7, 10];
const HDIM = [0, 3, 6, 10];

const ch = (name: string, root: number, tones: number[], bass?: number): Chord => ({ name, root, tones, bass });

const CHORDS = {
  Dm: ch('Dm', 2, MIN),
  Dm7: ch('Dm7', 2, MIN7),
  'Dm/C': ch('Dm/C', 2, MIN, 0),
  'Dm/F': ch('Dm/F', 2, MIN, 5),
  F: ch('F', 5, MAJ),
  Fmaj7: ch('Fmaj7', 5, MAJ7),
  C: ch('C', 0, MAJ),
  'C/E': ch('C/E', 0, MAJ, 4),
  Bb: ch('Bb', 10, MAJ),
  Bbmaj7: ch('Bbmaj7', 10, MAJ7),
  Gm: ch('Gm', 7, MIN),
  Gm7: ch('Gm7', 7, MIN7),
  A7: ch('A7', 9, DOM7),
  Am: ch('Am', 9, MIN),
  Em7b5: ch('Em7b5', 4, HDIM),
} as const;
type ChordName = keyof typeof CHORDS;

/** 8-bar progressions with day/night preference weights. */
const PROGRESSIONS: ReadonlyArray<{ bars: readonly ChordName[]; day: number; night: number }> = [
  { bars: ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A7'], day: 1, night: 1.4 },
  { bars: ['Dm', 'Gm', 'A7', 'Dm', 'F', 'C', 'Bb', 'A7'], day: 1, night: 1.2 },
  { bars: ['F', 'C/E', 'Dm', 'Bb', 'Gm', 'C', 'F', 'A7'], day: 1.6, night: 0.7 },
  { bars: ['Bbmaj7', 'F', 'Gm', 'Dm', 'Bb', 'F', 'Gm7', 'A7'], day: 1.2, night: 1 },
  { bars: ['Dm', 'Dm/C', 'Bbmaj7', 'A7', 'Gm', 'Dm/F', 'Em7b5', 'A7'], day: 0.8, night: 1.5 },
  { bars: ['F', 'Am', 'Bb', 'F', 'Gm', 'Dm', 'Bb', 'C'], day: 1.6, night: 0.5 },
  { bars: ['Dm7', 'Gm7', 'C', 'Fmaj7', 'Bbmaj7', 'Em7b5', 'A7', 'Dm'], day: 1, night: 1.3 },
  { bars: ['Dm', 'Dm', 'Bb', 'Bb', 'Gm', 'Gm', 'A7', 'A7'], day: 0.9, night: 1.2 },
];

/** Lowest midi >= lo with pitch class pc. */
const at = (pc: number, lo: number): number => lo + ((((pc - lo) % 12) + 12) % 12);
const pcOf = (c: Chord, i: number): number => (c.root + c.tones[i % c.tones.length]) % 12;
const chordPcs = (c: Chord): number[] => c.tones.map((iv) => (c.root + iv) % 12);

const D_MINOR_PENTA = [2, 5, 7, 9, 0];

/** Pentatonic flavour, minus notes that rub against the chord, plus the chord tones. */
function melodyScale(c: Chord): number[] {
  const tones = chordPcs(c);
  const out = new Set<number>(tones);
  for (const pc of D_MINOR_PENTA) {
    if (tones.includes(pc)) continue;
    const clash = tones.some((t) => {
      const d = Math.abs(t - pc) % 12;
      return d === 1 || d === 11;
    });
    if (!clash) out.add(pc);
  }
  return [...out].sort((a, b) => a - b);
}

/** Open, guitar-like arpeggio voicing: root, 5th, octave(7th), 10th, 12th, 15th. */
function arpVoicing(c: Chord): number[] {
  const r = at(c.root, 45);
  const third = c.tones[1];
  const fifth = c.tones[2];
  const top = c.tones.length > 3 ? r + 12 + c.tones[3] : r + 24;
  return [r, r + fifth, r + 12, r + 12 + third, r + 12 + fifth, top];
}

const ARP_PATTERNS: ReadonlyArray<ReadonlyArray<number | null>> = [
  [0, 2, 3, 4, 3, 2],
  [0, 3, 4, 5, 4, 3],
  [null, 2, 3, 1, 3, 2],
  [0, 1, 2, 3, 2, 1],
  [0, null, 3, 4, 5, 4],
  [0, 4, 2, 5, 3, 4],
  [0, 2, 4, 2, 3, 1],
];

const HIGH_PATTERNS: ReadonlyArray<ReadonlyArray<number>> = [
  [0, 1, 2, 3, 2, 1],
  [2, 1, 0, 1, 2, 4],
  [0, 2, 1, 3, 2, 4],
  [4, 3, 2, 1, 2, 3],
];

const OSTINATI: ReadonlyArray<ReadonlyArray<number | null>> = [
  [0, null, 7, null, 12, 7],
  [0, 0, 7, null, 12, null],
  [0, null, 0, 7, null, 7],
  [0, 12, 7, 12, 0, 7],
];

/** 2-bar melodic rhythms: [start, length] in eighth notes (12 per phrase). */
const RHYTHMS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0, 2], [2, 2], [4, 2], [6, 6]],
  [[0, 3], [3, 1], [4, 2], [6, 4]],
  [[2, 1], [3, 1], [4, 2], [6, 2], [8, 4]],
  [[0, 4], [4, 2], [6, 6]],
  [[0, 1], [1, 1], [2, 2], [4, 2], [6, 2], [8, 2], [10, 2]],
  [[4, 2], [6, 2], [8, 2], [10, 2]],
  [[0, 6], [6, 2], [8, 2], [10, 2]],
  [[0, 2], [4, 2], [6, 2], [8, 4]],
  [[0, 2], [2, 1], [3, 1], [4, 2], [6, 6]],
];

const STEP_WEIGHTS: ReadonlyArray<readonly [number, number]> = [
  [-2, 1], [-1, 3], [0, 0.5], [1, 3], [2, 1], [3, 0.4], [-3, 0.4],
];

const MEL_LO = 74; // D5
const MEL_HI = 93; // A6

// ---------------------------------------------------------------- layer state

interface Smooth {
  from: number;
  to: number;
  t0: number;
  tau: number;
}
const smoothAt = (s: Smooth, t: number): number => s.to + (s.from - s.to) * Math.exp(-Math.max(0, t - s.t0) / s.tau);

interface Session {
  gain: GainNode;
  calm: GainNode;
  combat: GainNode;
  boss: GainNode;
  pluck: AudioNode;
  melody: AudioNode;
  bass: AudioNode;
  pad: AudioNode;
  hiPluck: AudioNode;
  drums: AudioNode;
  strings: AudioNode;
  pizz: AudioNode;
  timp: AudioNode;
  wobble: AudioNode;
  ostinato: AudioNode;
  nodes: AudioNode[];
}

interface MusicEvent {
  beat: number; // absolute beat position
  fn: (t: number) => void;
}

export interface MusicState {
  playing: boolean;
  bpm: number;
  bar: number;
  chord: string;
  progression: string;
}

export class Music {
  /** Post-mix lowpass (darkens at night). Connect this to the music volume bus. */
  readonly output: BiquadFilterNode;
  private readonly k: Kit;
  private s: Session | null = null;
  private running = false;

  private baseBpm = rand(84, 90);
  private nextBeat = 0;
  private beat = 0; // 0..2 within bar
  private bar = 0; // 0..7 within progression
  private absBeat = 0;
  private events: MusicEvent[] = [];

  private prog: readonly ChordName[] = PROGRESSIONS[0].bars;
  private progIdx = -1;
  private arpPattern = ARP_PATTERNS[0];
  private hiPattern = HIGH_PATTERNS[0];
  private ostinato = OSTINATI[0];
  private strum = false;
  private lastPadChord = '';

  private melLast = 81;
  private motif: { rhythm: ReadonlyArray<readonly [number, number]>; steps: number[] } | null = null;
  private pizzLast = 72;

  private intensity: Smooth = { from: 0, to: 0, t0: 0, tau: 0.9 };
  private bossLvl: Smooth = { from: 0, to: 0, t0: 0, tau: 1.0 };
  private night = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    /** reverb send whose level follows time of day */
    private readonly hallSend: GainNode | null,
  ) {
    this.output = ctx.createBiquadFilter();
    this.output.type = 'lowpass';
    this.output.frequency.value = 9500;
    this.output.Q.value = 0.5;
    this.k = new Kit(ctx, this.output, 0, Math.random, true);
  }

  get playing(): boolean {
    return this.running;
  }

  private get beatDur(): number {
    const bossBoost = 1 + 0.06 * clamp(this.bossLvl.to, 0, 1);
    return 60 / (this.baseBpm * bossBoost);
  }

  getState(): MusicState {
    const c = CHORDS[this.prog[Math.max(0, this.bar - (this.beat === 0 ? 1 : 0)) % 8]];
    return {
      playing: this.running,
      bpm: Math.round(60 / this.beatDur),
      bar: this.bar,
      chord: c.name,
      progression: this.prog.join(' '),
    };
  }

  // ------------------------------------------------------------ controls

  start(at = this.ctx.currentTime): void {
    if (this.running) return;
    this.running = true;
    this.s = this.buildSession();
    const g = this.s.gain.gain;
    g.setValueAtTime(0, at);
    g.linearRampToValueAtTime(1, at + 1.5);
    this.applyLayerGains(at, true);
    this.nextBeat = at + 0.08;
    this.beat = 0;
    this.bar = 0;
    this.absBeat = 0;
    this.events = [];
    this.progIdx = -1;
    this.lastPadChord = '';
    this.baseBpm = rand(84, 90);
  }

  stop(fade = 1.5, at = this.ctx.currentTime): void {
    if (!this.running || !this.s) return;
    this.running = false;
    const s = this.s;
    this.s = null;
    const g = s.gain.gain;
    g.cancelScheduledValues(at);
    g.setValueAtTime(g.value, at);
    g.linearRampToValueAtTime(0, at + Math.max(0.02, fade));
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        for (const n of s.nodes) n.disconnect();
      }, (fade + 5) * 1000);
    }
  }

  setIntensity(v: number, at = this.ctx.currentTime): void {
    v = clamp(v, 0, 1);
    if (Math.abs(v - this.intensity.to) < 0.01) return;
    this.intensity = { from: smoothAt(this.intensity, at), to: v, t0: at, tau: 0.9 };
    this.applyLayerGains(at);
  }

  setBoss(on: boolean, at = this.ctx.currentTime): void {
    const v = on ? 1 : 0;
    if (v === this.bossLvl.to) return;
    this.bossLvl = { from: smoothAt(this.bossLvl, at), to: v, t0: at, tau: on ? 0.8 : 1.4 };
    this.applyLayerGains(at);
  }

  /** 0 = day, 1 = night: darker filter, a touch more reverb, moodier progressions. */
  setNight(t: number, at = this.ctx.currentTime): void {
    this.night = clamp(t, 0, 1);
    this.output.frequency.setTargetAtTime(lerpExp(9500, 3400, this.night), at, 1.2);
    this.hallSend?.gain.setTargetAtTime(0.26 + 0.12 * this.night, at, 1.2);
  }

  private applyLayerGains(at: number, immediate = false): void {
    if (!this.s) return;
    const set = (g: GainNode, sm: Smooth) => {
      if (immediate) g.gain.setValueAtTime(smoothAt(sm, at), at);
      g.gain.setTargetAtTime(sm.to, at, sm.tau);
    };
    set(this.s.combat, this.intensity);
    set(this.s.boss, this.bossLvl);
    // the calm layer leans back slightly when the band gets busy
    const calmTarget = 1 - 0.12 * this.intensity.to;
    if (immediate) this.s.calm.gain.setValueAtTime(calmTarget, at);
    this.s.calm.gain.setTargetAtTime(calmTarget, at, 1.2);
  }

  // ------------------------------------------------------------ graph

  private buildSession(): Session {
    const ctx = this.ctx;
    const nodes: AudioNode[] = [];
    const gain = ctx.createGain();
    gain.connect(this.output);
    nodes.push(gain);
    const layer = (): GainNode => {
      const g = ctx.createGain();
      g.connect(gain);
      nodes.push(g);
      return g;
    };
    const calm = layer();
    const combat = layer();
    const boss = layer();
    combat.gain.value = 0;
    boss.gain.value = 0;
    const bus = (dest: AudioNode, o: { gain?: number; pan?: number; lp?: number; peq?: [number, number, number] } = {}): AudioNode => {
      const chain: AudioNode[] = [];
      const g = ctx.createGain();
      g.gain.value = o.gain ?? 1;
      chain.push(g);
      if (o.peq) {
        const p = ctx.createBiquadFilter();
        p.type = 'peaking';
        [p.frequency.value, p.gain.value, p.Q.value] = o.peq;
        chain.push(p);
      }
      if (o.lp) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = o.lp;
        f.Q.value = 0.5;
        chain.push(f);
      }
      if (o.pan) {
        const p = ctx.createStereoPanner();
        p.pan.value = o.pan;
        chain.push(p);
      }
      for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
      chain[chain.length - 1].connect(dest);
      nodes.push(...chain);
      return chain[0];
    };
    return {
      gain,
      calm,
      combat,
      boss,
      nodes,
      // bus gains balanced by weighted-loudness measurement of each instrument solo
      pluck: bus(calm, { gain: 1.0, pan: -0.22, lp: 4200, peq: [210, 3, 1] }),
      melody: bus(calm, { gain: 1.0, pan: 0.22 }),
      bass: bus(calm, { gain: 0.45 }),
      pad: bus(calm, { gain: 0.62, lp: 2600 }),
      hiPluck: bus(combat, { gain: 0.85, pan: 0.4, lp: 5000 }),
      drums: bus(combat, { gain: 0.5, pan: 0.05 }),
      strings: bus(combat, { gain: 1.2, pan: -0.1 }),
      pizz: bus(combat, { gain: 0.65, pan: 0.32, lp: 4000 }),
      timp: bus(boss, { gain: 0.27 }),
      wobble: bus(boss, { gain: 0.52, lp: 1200 }),
      ostinato: bus(boss, { gain: 0.95, pan: -0.15 }),
    };
  }

  // ------------------------------------------------------------ scheduling

  /** Schedule all beats starting before `until`. */
  scheduleUntil(now: number, until: number): void {
    if (!this.running || !this.s) return;
    if (this.nextBeat < now - 0.15) {
      // main thread stalled (or tab throttled): skip ahead instead of bunching notes
      this.nextBeat = now + 0.05;
    }
    while (this.nextBeat < until) {
      const lilt = this.beat === 0 ? 0.985 : this.beat === 1 ? 1.02 : 0.995;
      const dur = this.beatDur * lilt;
      if (this.beat === 0) this.onBar();
      this.flushEvents(this.nextBeat, dur);
      this.nextBeat += dur;
      this.absBeat++;
      this.beat++;
      if (this.beat >= 3) {
        this.beat = 0;
        this.bar = (this.bar + 1) % 8;
      }
    }
  }

  private flushEvents(t: number, dur: number): void {
    const b0 = this.absBeat;
    const keep: MusicEvent[] = [];
    for (const e of this.events) {
      if (e.beat < b0 + 1 - 1e-6) {
        const off = Math.max(0, e.beat - b0);
        try {
          e.fn(t + off * dur);
        } catch {
          /* a single bad note must never kill the band */
        }
      } else keep.push(e);
    }
    this.events = keep;
  }

  private add(beatInBar: number, fn: (t: number) => void): void {
    this.events.push({ beat: this.absBeat + beatInBar, fn });
  }

  private hum(): number {
    return (Math.random() - 0.5) * 0.012;
  }

  private chooseProgression(): void {
    const night = this.night;
    const items = PROGRESSIONS.map((p, i) => [i, i === this.progIdx ? 0.05 : p.day * (1 - night) + p.night * night] as const);
    this.progIdx = pickWeighted(items);
    this.prog = PROGRESSIONS[this.progIdx].bars;
  }

  private onBar(): void {
    const s = this.s;
    if (!s) return;
    if (this.bar === 0) this.chooseProgression();
    const c = CHORDS[this.prog[this.bar]];
    const next = CHORDS[this.prog[(this.bar + 1) % 8]];
    const barStartTime = this.nextBeat;

    if (this.bar % 2 === 0) {
      this.arpPattern = pick(ARP_PATTERNS);
      this.hiPattern = pick(HIGH_PATTERNS);
      this.ostinato = pick(OSTINATI);
      this.strum = chance(0.28);
    }

    this.calmBar(s, c, next);
    if (this.bar % 2 === 0) this.planMelody(s, c, CHORDS[this.prog[(this.bar + 1) % 8]]);
    if (smoothAt(this.intensity, barStartTime) > 0.01 || this.intensity.to > 0.01) this.combatBar(s, c);
    if (smoothAt(this.bossLvl, barStartTime) > 0.01 || this.bossLvl.to > 0.01) this.bossBar(s, c);
  }

  // ------------------------------------------------------------ calm layer

  private calmBar(s: Session, c: Chord, next: Chord): void {
    const k = this.k;
    const bd = this.beatDur;
    const bassPc = c.bass ?? c.root;
    const bassNote = at(bassPc, 36);

    // upright bass on 1, sometimes a walk on 3
    this.add(0, (t) => I.uprightBass(k, t, mtof(bassNote), rand(0.3, 0.36), 1.0, s.bass));
    if (chance(0.4)) {
      const nextRoot = at(next.bass ?? next.root, 36);
      const walk = chance(0.5) ? bassNote + c.tones[2] : nextRoot + (chance(0.5) ? -1 : 2);
      this.add(2, (t) => I.uprightBass(k, t, mtof(walk > 47 ? walk - 12 : walk), rand(0.18, 0.24), 0.6, s.bass));
    }

    // pad: retrigger only on chord change, sustain over repeated bars
    if (c.name !== this.lastPadChord) {
      this.lastPadChord = c.name;
      let span = 1;
      while (span < 4 && this.prog[(this.bar + span) % 8] === this.prog[this.bar] && this.bar + span < 8) span++;
      const pcs = c.tones.length > 3 ? [1, 2, 3] : [1, 2, 0];
      const cutoff = lerpExp(1500, 800, this.night);
      for (const i of pcs) {
        const m = at(pcOf(c, i), 55);
        this.add(0, (t) => I.pad(k, t, mtof(m), span * 3 * bd + 0.3, 0.06, cutoff, s.pad));
      }
    }

    // plucked arpeggio or waltz strum
    const v = arpVoicing(c);
    if (this.strum) {
      for (const beat of [1, 2]) {
        [1, 2, 3].forEach((idx, j) => {
          this.add(beat, (t) => I.pluck(k, t + j * 0.018 + this.hum(), v[idx], rand(0.32, 0.4) * (beat === 1 ? 1 : 0.85), { out: s.pluck }));
        });
      }
    } else {
      this.arpPattern.forEach((idx, slot) => {
        if (idx === null) return;
        const accent = slot === 0 ? 1.1 : slot % 2 === 0 ? 0.95 : 0.8;
        this.add(slot / 2, (t) => I.pluck(k, t + this.hum(), v[idx], rand(0.42, 0.5) * accent, { out: s.pluck }));
      });
    }
  }

  private planMelody(s: Session, a: Chord, b: Chord): void {
    const k = this.k;
    const playProb = this.night > 0.6 ? 0.5 : 0.62;
    if (!chance(playProb)) {
      this.motif = chance(0.5) ? null : this.motif;
      return;
    }
    let rhythm: ReadonlyArray<readonly [number, number]>;
    let steps: number[];
    if (this.motif && chance(0.4)) {
      rhythm = this.motif.rhythm;
      steps = [...this.motif.steps];
      if (chance(0.5)) steps[randInt(0, steps.length - 1)] = pickWeighted(STEP_WEIGHTS);
    } else {
      rhythm = pick(RHYTHMS);
      steps = rhythm.map(() => pickWeighted(STEP_WEIGHTS));
    }
    this.motif = { rhythm, steps };

    let cur = this.melLast;
    const bd = this.beatDur;
    rhythm.forEach(([slot, len], i) => {
      const c = slot < 6 ? a : b;
      const scale = melodyScale(c);
      const strong = slot === 0 || slot === 6 || i === rhythm.length - 1;
      let m = stepInScale(cur, steps[i], scale);
      if (strong) m = nearestChordTone(m, c);
      if (m > MEL_HI) m -= 12;
      if (m < MEL_LO) m += 12;
      cur = m;
      const v = (strong ? 0.2 : 0.15) * rand(0.9, 1.1);
      const d = clamp(len * 0.5 * bd + 0.9, 1.0, 2.6);
      this.add(slot / 2, (t) => I.musicBox(k, t + this.hum() * 0.5, mtof(m), v, d, s.melody));
      if (i === rhythm.length - 1 && chance(0.3) && m + 12 <= 98) {
        this.add(slot / 2 + 0.5, (t) => I.musicBox(k, t, mtof(m + 12), v * 0.35, 1.2, s.melody));
      }
    });
    this.melLast = cur;
  }

  // ------------------------------------------------------------ combat layer

  private combatBar(s: Session, c: Chord): void {
    const k = this.k;
    const bd = this.beatDur;
    this.add(0, (t) => I.kick(k, t, 0.36, s.drums));
    this.add(0, (t) => I.swirl(k, t, bd * 0.95, 0.035, s.drums));
    this.add(1, (t) => I.brush(k, t, 0.18, 0.16, s.drums));
    this.add(2, (t) => I.brush(k, t, 0.15, 0.14, s.drums));
    if (chance(0.45)) this.add(2.5, (t) => I.brush(k, t, 0.06, 0.08, s.drums));

    // spiccato low strings
    const sr = at(c.bass ?? c.root, 43);
    this.ostinato.forEach((off, slot) => {
      if (off === null) return;
      const v = slot === 0 ? 0.1 : 0.075;
      this.add(slot / 2, (t) => I.bowed(k, t, mtof(sr + off), bd * 0.32, v, s.strings, 0.9));
    });

    // busier high plucks on every eighth
    const base = arpVoicing(c)[0];
    const hi = [base + 12 + c.tones[1], base + 12 + c.tones[2], base + 24, base + 24 + c.tones[1], base + 24 + c.tones[2]];
    this.hiPattern.forEach((idx, slot) => {
      this.add(slot / 2, (t) => I.pluck(k, t + this.hum(), hi[idx], rand(0.3, 0.38), { out: s.hiPluck, bright: 0.6 }));
    });

    // pizzicato counter-line, alternating figures
    const slots = this.bar % 2 === 0 ? [2, 4] : [3, 4, 5];
    const tones = chordPcs(c);
    for (const slot of slots) {
      const cands: number[] = [];
      for (let m = 62; m <= 77; m++) if (tones.includes(m % 12)) cands.push(m);
      cands.sort((x, y) => Math.abs(x - this.pizzLast + 2) - Math.abs(y - this.pizzLast + 2));
      const m = cands[chance(0.7) ? 0 : 1] ?? 69;
      this.pizzLast = m < 64 ? m + 12 : m;
      this.add(slot / 2, (t) => I.pluck(k, t + this.hum(), m, rand(0.36, 0.44), { out: s.pizz, d: 0.22, bright: 0.7 }));
    }
  }

  // ------------------------------------------------------------ boss layer

  private bossBar(s: Session, c: Chord): void {
    const k = this.k;
    const bd = this.beatDur;
    const root = at(c.root, 38);
    this.add(0, (t) => I.timpani(k, t, mtof(root), 0.5, 1.2, s.timp));
    if (this.bar % 4 === 3) {
      const n = 10;
      for (let i = 0; i < n; i++) {
        this.add(2 + i / n, (t) => I.timpani(k, t, mtof(root), 0.06 + (0.3 * i) / n, 0.35, s.timp, true));
      }
    }
    if (this.bar % 2 === 0) {
      const p = at(c.root, 50);
      const dur = 6 * bd + 0.4;
      for (const [m, rate] of [[p, 0.7], [p + 1, 0.93]] as const) {
        this.add(0, (t) =>
          k.tone({ t, f: mtof(m), wave: 'hollow', a: 0.9, h: dur - 0.9, d: 1.2, v: 0.07, lp: 700, trem: [rate, 0.7], out: s.wobble }),
        );
      }
    }
    const pat = [0, 1, 0, 1, 0, 7];
    pat.forEach((off, slot) => {
      this.add(slot / 2, (t) => I.bowed(k, t, mtof(root + off), bd * 0.22, slot === 0 ? 0.11 : 0.085, s.ostinato, 0.8));
    });
  }
}

// ---------------------------------------------------------------- melody helpers

function stepInScale(cur: number, steps: number, scale: readonly number[]): number {
  const notes: number[] = [];
  for (let m = MEL_LO - 5; m <= MEL_HI + 5; m++) if (scale.includes(((m % 12) + 12) % 12)) notes.push(m);
  let idx = 0;
  let best = Infinity;
  notes.forEach((m, i) => {
    const d = Math.abs(m - cur);
    if (d < best) {
      best = d;
      idx = i;
    }
  });
  // gentle pull toward the middle of the range
  const mid = (MEL_LO + MEL_HI) / 2;
  if (cur > mid + 6 && steps > 0 && chance(0.5)) steps = -steps;
  if (cur < mid - 6 && steps < 0 && chance(0.5)) steps = -steps;
  return notes[clamp(idx + steps, 0, notes.length - 1)];
}

function nearestChordTone(m: number, c: Chord): number {
  const tones = chordPcs(c);
  for (let d = 0; d < 7; d++) {
    if (tones.includes((((m + d) % 12) + 12) % 12)) return m + d;
    if (tones.includes((((m - d) % 12) + 12) % 12)) return m - d;
  }
  return m;
}

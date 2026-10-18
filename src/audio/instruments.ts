/**
 * Composite instruments built from Kit primitives. Shared by the SFX recipes,
 * the generative music and the ambience. All times are relative to the kit's t0.
 */
import { ksPluck, mtof } from './dsp';
import type { Kit, Partial } from './kit';

// ---------------------------------------------------------------- tuned percussion

/** Music box / celesta: FM plink settling into a pure tone, plus a glassy tine partial. */
export function musicBox(k: Kit, t: number, f: number, v: number, d = 1.6, out?: AudioNode): void {
  k.fm({ t, f, ratio: 4, index: 1.1, index2: 0.02, idxDecay: 0.12, a: 0.002, d, v: v * 0.8, lp: 9000, out });
  k.tone({ t, f: f * 2, a: 0.002, d: d * 0.45, v: v * 0.12, out });
  if (f * 5.33 < 12000) k.tone({ t, f: f * 5.33, a: 0.001, d: 0.09, v: v * 0.09, out });
}

/** Soft marimba bar with tuned 4th and ~10th partials and a felt mallet. */
export function marimba(k: Kit, t: number, f: number, v: number, d = 0.55, out?: AudioNode): void {
  k.partials({
    t,
    f,
    v,
    a: 0.0015,
    bend: 1.012,
    bendTime: 0.03,
    partials: [
      [1, 1, d],
      [3.99, 0.16, d * 0.18],
      [9.85, 0.04, 0.03],
    ],
    out,
  });
  k.noise({ t, a: 0.0008, d: 0.012, v: v * 0.12, bp: Math.min(f * 2, 6000), q: 1.2, out });
}

/** FM electric piano (Rhodes-like). */
export function epiano(k: Kit, t: number, f: number, v: number, d = 1.4, out?: AudioNode): void {
  k.fm({ t, f, ratio: 1, index: 1.6, index2: 0.25, idxDecay: 0.6, a: 0.003, d, v: v * 0.75, lp: 5000, out });
  k.fm({ t, f, ratio: 14, index: 0.5, index2: 0.01, idxDecay: 0.05, a: 0.001, d: 0.12, v: v * 0.12, out });
}

/** Church-bell partial series (hum, prime, tierce, quint, nominal...). */
export function churchBell(k: Kit, t: number, f: number, v: number, d = 3, out?: AudioNode): void {
  const partials: Partial[] = [
    [0.5, 0.55, d * 1.1],
    [0.5 * 1.004, 0.25, d * 1.05], // beating hum
    [1, 0.6, d * 0.75],
    [1.19, 0.4, d * 0.65],
    [1.5, 0.28, d * 0.5],
    [2, 0.45, d * 0.6],
    [2.01, 0.18, d * 0.55],
    [2.52, 0.16, d * 0.3],
    [3.01, 0.12, d * 0.22],
    [4.22, 0.06, d * 0.14],
  ];
  k.partials({ t, f, v, a: 0.004, partials, lp: 4200, out });
  k.noise({ t, a: 0.001, d: 0.03, v: v * 0.08, bp: f * 3, q: 1.5, out });
}

/** Glassy chime (used for sparkles and the firefly zap). */
export function chime(k: Kit, t: number, f: number, v: number, d = 0.5, out?: AudioNode): void {
  k.partials({
    t,
    f,
    v,
    a: 0.001,
    partials: [
      [1, 1, d],
      [2.32, 0.32, d * 0.5],
      [4.25, 0.12, d * 0.25],
      [6.8, 0.05, d * 0.12],
    ],
    lp: 9500,
    out,
  });
}

/** Little coin clink (metallic, inharmonic). */
export function clink(k: Kit, t: number, f: number, v: number, d = 0.22, out?: AudioNode): void {
  k.partials({
    t,
    f,
    v,
    a: 0.0008,
    partials: [
      [1, 1, d],
      [2.76, 0.32, d * 0.35],
      [5.4, 0.12, d * 0.15],
      [8.9, 0.04, 0.03],
    ],
    lp: 8000,
    out,
  });
}

/** Wooden knock: short pitched body + inharmonic overtone + click. */
export function knock(k: Kit, t: number, f: number, v: number, out?: AudioNode): void {
  k.tone({ t, f: [[0, f], [0.03, f * 0.78]], a: 0.0008, d: 0.08, v, out });
  k.tone({ t, f: f * 2.62, a: 0.0005, d: 0.025, v: v * 0.25, out });
  k.noise({ t, a: 0.0005, d: 0.012, v: v * 0.35, bp: Math.min(f * 5, 5000), q: 1.4, out });
}

/** Soft timpani: pitched membrane with a gentle mallet. `light` = cheaper stroke for rolls. */
export function timpani(k: Kit, t: number, f: number, v: number, d = 1.3, out?: AudioNode, light = false): void {
  const partials: Partial[] = light
    ? [[1, 1, d], [1.5, 0.45, d * 0.55]]
    : [[1, 1, d], [1.5, 0.45, d * 0.55], [1.98, 0.25, d * 0.4], [2.44, 0.12, d * 0.3]];
  k.partials({ t, f, v, a: 0.003, bend: 1.05, bendTime: 0.07, partials, lp: 1800, out });
  k.noise({ t, a: 0.002, d: 0.06, v: v * 0.25, lp: 700, color: 'pink', out });
}

// ---------------------------------------------------------------- sustained

/** Warm brass/horn: two detuned soft-saw voices through an enveloped lowpass. */
export function horn(
  k: Kit,
  t: number,
  f: number,
  dur: number,
  v: number,
  o: { bright?: number; a?: number; rel?: number; out?: AudioNode } = {},
): void {
  const bright = o.bright ?? 1;
  const a = o.a ?? 0.12;
  const lp: [number, number][] = [
    [0, f * 1.2],
    [a * 0.8, Math.min(f * 4.5 * bright, 5000)],
    [a + 0.25, Math.min(f * 3 * bright, 3500)],
  ];
  for (const det of [-5, 5]) {
    k.tone({
      t,
      f,
      det,
      wave: 'warm',
      a,
      h: Math.max(0, dur - a),
      d: o.rel ?? 0.35,
      v: v * 0.5,
      lp,
      lpQ: 0.9,
      vib: [4.8, 0.004, 0.35],
      out: o.out,
    });
  }
}

/**
 * Bowed low string. Short notes (spiccato ostinato) use a single voice without
 * vibrato: the chorus would be inaudible and they fire several times per bar.
 */
export function bowed(k: Kit, t: number, f: number, dur: number, v: number, out?: AudioNode, bright = 1): void {
  const short = dur < 0.3;
  for (const det of short ? [0] : [-6, 6]) {
    k.tone({
      t,
      f,
      det,
      wave: 'warm',
      a: Math.min(0.05, dur * 0.3),
      h: dur,
      d: short ? 0.14 : 0.18,
      v: short ? v * 0.8 : v * 0.5,
      lp: [[0, f * 2 + 200], [0.06, (f * 4 + 400) * bright]],
      lpQ: 0.6,
      vib: short ? undefined : [5.4, 0.003, 0.15],
      out,
    });
  }
}

/** Soft analogue-ish pad note (the detuned pair provides the movement; no LFOs for CPU's sake). */
export function pad(k: Kit, t: number, f: number, dur: number, v: number, cutoff: number, out?: AudioNode): void {
  for (const det of [-7, 7]) {
    k.tone({
      t,
      f,
      det,
      wave: 'warm',
      a: Math.min(1.2, dur * 0.4),
      h: Math.max(0, dur - 1.2),
      d: 1.6,
      v: v * 0.5,
      lp: cutoff,
      lpQ: 0.4,
      out,
    });
  }
}

/** Upright bass: sine + soft harmonics, short decay, a little finger thump. */
export function uprightBass(k: Kit, t: number, f: number, v: number, d = 0.9, out?: AudioNode): void {
  k.partials({
    t,
    f,
    v,
    a: 0.008,
    bend: 1.015,
    bendTime: 0.04,
    partials: [
      [1, 1, d],
      [2, 0.35, d * 0.6],
      [3, 0.12, d * 0.35],
      [4, 0.04, d * 0.2],
    ],
    lp: 900,
    out,
  });
  k.noise({ t, a: 0.002, d: 0.03, v: v * 0.12, lp: 300, color: 'brown', out });
}

// ---------------------------------------------------------------- plucked

/**
 * Nylon guitar / harp via cached Karplus-Strong buffers (two round-robin
 * variants per note, generated at 32 kHz to keep memory modest).
 * `d` shortens the note (pizzicato).
 */
export function pluck(
  k: Kit,
  t: number,
  midi: number,
  v: number,
  o: { d?: number; bright?: number; out?: AudioNode } = {},
): void {
  const f = mtof(midi);
  const t60 = Math.max(0.8, 2.6 - (f - 80) / 300);
  const buf = ksPluck(
    f,
    Math.min(k.sr, 32000),
    { seconds: Math.min(1.8, t60 * 0.8 + 0.3), bright: o.bright ?? 0.45, t60, pos: 0.16 },
    k.r() < 0.5 ? 0 : 1,
  );
  k.buffer({ t, buf, v, d: o.d, rate: 1 + (k.r() - 0.5) * 0.002, out: o.out });
}

// ---------------------------------------------------------------- drums (music)

export function kick(k: Kit, t: number, v: number, out?: AudioNode): void {
  k.tone({ t, f: [[0, 105], [0.09, 46]], a: 0.002, d: 0.32, v, lp: 220, out });
  k.noise({ t, a: 0.001, d: 0.02, v: v * 0.1, lp: 1100, color: 'pink', out });
}

/** Brushed snare tap (soft attack, filtered noise). */
export function brush(k: Kit, t: number, v: number, len = 0.16, out?: AudioNode): void {
  k.noise({ t, a: 0.006, d: len, v, bp: 3000, q: 0.6, lp: 6500, out });
  k.noise({ t, a: 0.002, d: 0.05, v: v * 0.35, bp: 1400, q: 1, color: 'pink', out });
}

/** Brush swirl: a slow swish across a beat. */
export function swirl(k: Kit, t: number, len: number, v: number, out?: AudioNode): void {
  k.noise({ t, a: len * 0.55, d: len * 0.6, v, bp: [[0, 2000], [len, 3200]], q: 0.5, lp: 6000, out });
}

// ---------------------------------------------------------------- wildlife

/** One bird note: sine with a pitch path and a bit of FM roughness. */
export function birdNote(
  k: Kit,
  t: number,
  path: ReadonlyArray<readonly [number, number]>,
  len: number,
  v: number,
  o: { trill?: number; out?: AudioNode } = {},
): void {
  k.tone({
    t,
    f: path,
    a: Math.min(0.012, len * 0.2),
    h: len * 0.35,
    d: len * 0.6,
    v,
    hp: 1400,
    lp: 8500,
    vib: [k.rand(35, 70), 0.012],
    trem: o.trill ? [o.trill, 0.9] : undefined,
    out: o.out,
  });
}

/** A soft owl "hoo". */
export function hoo(k: Kit, t: number, f: number, len: number, v: number, out?: AudioNode): void {
  k.tone({
    t,
    f: [[0, f * 0.95], [Math.min(0.08, len * 0.3), f], [len, f * 0.93]],
    wave: 'soft',
    a: Math.min(0.06, len * 0.3),
    h: len * 0.45,
    d: len * 0.5,
    v,
    lp: 1100,
    out,
  });
  k.noise({ t, a: 0.04, h: len * 0.3, d: len * 0.4, v: v * 0.08, bp: f, q: 3, color: 'pink', out });
}

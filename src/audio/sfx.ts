/**
 * SFX recipes. Each recipe is rendered into several random variations with an
 * OfflineAudioContext at unlock time, then normalised to its loudness target.
 * Runtime playback (rate limiting, jitter, pan, reverb send) lives in engine.ts.
 */
import { mtof, pick, randInt } from './dsp';
import * as I from './instruments';
import type { Kit, Path, Vowel } from './kit';

export type SfxName =
  // UI
  | 'ui_click'
  | 'ui_hover'
  | 'ui_open'
  | 'ui_close'
  | 'ui_error'
  | 'ui_page'
  // economy / building
  | 'build'
  | 'upgrade'
  | 'sell'
  | 'research'
  | 'coin'
  | 'ember'
  // towers
  | 'acorn_fire'
  | 'acorn_hit'
  | 'catapult_fire'
  | 'pumpkin_explode'
  | 'syrup_pulse'
  | 'zap'
  | 'owl_fire'
  | 'owl_hit'
  // zombies
  | 'zombie_groan'
  | 'zombie_hit'
  | 'armor_clank'
  | 'zombie_die'
  | 'brute_stomp'
  | 'boss_roar'
  | 'axe_chop'
  | 'tower_break'
  | 'repair'
  | 'announce'
  | 'trophy'
  // game flow
  | 'wave_start'
  | 'wave_clear'
  | 'life_lost'
  | 'game_over'
  | 'victory'
  | 'place_invalid';

export interface SfxSpec {
  /** seconds rendered per variation */
  dur: number;
  variations: number;
  /** loudness target: RMS dBFS over the active part */
  rms: number;
  /** room reverb send 0..1 */
  send: number;
  /** runtime random pitch jitter (fraction, e.g. 0.04 = ±4 %) */
  jitter: number;
  /** minimum ms between two plays of this sound */
  minInterval: number;
  /** max simultaneous voices of this sound */
  maxVoices: number;
  /** 0 (ambient chatter) .. 3 (UI / game flow, never dropped for combat noise) */
  priority: number;
  /** when at maxVoices: steal the oldest voice (true) or skip the new one (false) */
  steal: boolean;
  /** random start delay in ms (desynchronises rapid-fire flams) */
  delay: number;
  render(k: Kit, variation: number): void;
}

type Recipe = Omit<SfxSpec, 'steal' | 'delay' | 'priority'> & Partial<Pick<SfxSpec, 'steal' | 'delay' | 'priority'>>;

// ---------------------------------------------------------------- shared helpers

const scalePath = (p: ReadonlyArray<readonly [number, number]>, m: number): [number, number][] =>
  p.map(([t, v]) => [t, v * m]);

function whoosh(k: Kit, t: number, f1: number, f2: number, len: number, v: number): void {
  k.noise({ t, color: 'pink', a: len * 0.45, d: len * 0.6, v, bp: [[0, f1], [len, f2]], q: 1.3 });
}

/** Sparse tiny noise ticks, denser at the start. */
function crackle(k: Kit, t: number, n: number, span: number, v: number, lo = 2000, hi = 6000): void {
  for (let i = 0; i < n; i++) {
    const x = k.r();
    k.noise({
      t: t + x * x * span,
      a: 0.0003,
      d: k.rand(0.002, 0.007),
      v: v * k.rand(0.4, 1) * (1 - x * 0.5),
      bp: k.rand(lo, hi),
      q: k.rand(1, 3),
    });
  }
}

/** Rising-pitch blip: the sound of a bubble. */
function bubble(k: Kit, t: number, f: number, v: number): void {
  k.tone({ t, f: [[0, f], [0.05, f * 2.3]], a: 0.003, d: 0.07, v, lp: 2600 });
}

/** Falling-pitch blip: a droplet / splat fleck. */
function drip(k: Kit, t: number, f: number, v: number): void {
  k.tone({ t, f: [[0, f], [0.05, f * 0.55]], a: 0.001, d: 0.05, v });
}

const D_PENTA_HIGH = [86, 89, 91, 93, 96, 98]; // D6 F6 G6 A6 C7 D7

// ---------------------------------------------------------------- zombie voices

type GroanKind = 'uuh' | 'brains' | 'mrrgh' | 'ohh' | 'huh' | 'bleugh';
const GROANS: GroanKind[] = ['uuh', 'brains', 'mrrgh', 'ohh', 'huh', 'bleugh'];

function groan(k: Kit, kind: GroanKind): void {
  const b = k.rand(88, 126);
  let dur = k.rand(0.85, 1.3);
  const vib = [k.rand(4, 7), k.rand(0.015, 0.04)] as const;
  let f0: [number, number][];
  let vowels: [number, Vowel][];
  let growl: readonly [number, number] | undefined;
  switch (kind) {
    case 'uuh':
      f0 = [[0, b], [dur * 0.3, b * 1.12], [dur, b * 0.78]];
      vowels = [[0, 'u'], [dur * 0.35, 'uh'], [dur, 'uh']];
      break;
    case 'brains':
      dur = k.rand(1.1, 1.35);
      f0 = [[0, b * 0.9], [0.25, b * 1.18], [dur * 0.7, b * 1.05], [dur, b * 0.85]];
      vowels = [[0, 'm'], [0.1, 'r'], [0.22, 'a'], [dur * 0.62, 'a'], [dur * 0.8, 'i'], [dur * 0.93, 'n']];
      k.noise({ t: dur - 0.06, a: 0.03, d: 0.12, v: 0.035, hp: 4500 });
      break;
    case 'mrrgh':
      f0 = [[0, b * 0.85], [dur * 0.4, b * 0.98], [dur, b * 0.72]];
      vowels = [[0, 'm'], [0.15, 'o'], [dur * 0.6, 'uh'], [dur, 'uh']];
      growl = [k.rand(20, 28), 0.5];
      break;
    case 'ohh':
      f0 = [[0, b * 1.2], [dur * 0.25, b * 1.25], [dur, b * 0.62]];
      vowels = [[0, 'o'], [dur * 0.6, 'u'], [dur, 'u']];
      break;
    case 'huh':
      dur = k.rand(0.7, 0.85);
      f0 = [[0, b * 0.9], [dur * 0.5, b * 0.95], [dur, b * 1.4]];
      vowels = [[0, 'uh'], [dur * 0.6, 'uh'], [dur, 'a']];
      break;
    case 'bleugh':
      f0 = [[0, b * 1.1], [dur * 0.2, b * 1.15], [dur, b * 0.8]];
      vowels = [[0, 'm'], [0.05, 'e'], [dur * 0.3, 'uh'], [dur, 'u']];
      growl = [k.rand(16, 22), 0.25];
      break;
  }
  k.voice({ dur, f0, vowels, vib, growl, breath: 0.12, v: 0.9, a: 0.14, r: 0.3, lp: 2800 });
}

// ---------------------------------------------------------------- recipes

const RECIPES: Record<SfxName, Recipe> = {
  // ============================================================ UI
  ui_click: {
    dur: 0.12, variations: 5, rms: -23, send: 0.05, jitter: 0.04, minInterval: 25, maxVoices: 4, priority: 3,
    render(k) {
      const f = k.rand(980, 1120);
      k.tone({ f: [[0, f], [0.03, f * 0.72]], a: 0.001, d: 0.07, v: 0.6 });
      k.tone({ f: f * 2.71, a: 0.0006, d: 0.022, v: 0.12 });
      k.tone({ f: [[0, 420], [0.04, 330]], a: 0.002, d: 0.045, v: 0.18 });
      k.noise({ a: 0.0005, d: 0.01, v: 0.16, bp: k.rand(2800, 3600), q: 1.3 });
    },
  },
  ui_hover: {
    dur: 0.08, variations: 4, rms: -31, send: 0.04, jitter: 0.05, minInterval: 45, maxVoices: 2, priority: 2,
    render(k) {
      const f = k.rand(1750, 1950);
      k.tone({ f: [[0, f], [0.03, f * 0.93]], a: 0.003, d: 0.045, v: 0.4 });
      k.tone({ f: f * 2, a: 0.002, d: 0.02, v: 0.05 });
    },
  },
  ui_open: {
    dur: 0.6, variations: 3, rms: -23, send: 0.15, jitter: 0.03, minInterval: 80, maxVoices: 2, priority: 3,
    render(k, i) {
      whoosh(k, 0, 600, 2800, 0.22, 0.28);
      k.tone({ f: [[0, 420], [0.06, 880]], a: 0.003, d: 0.09, v: 0.3 });
      const [a, b] = [[81, 86], [79, 86], [81, 88]][i % 3];
      I.musicBox(k, 0.03, mtof(a), 0.34, 0.45);
      I.musicBox(k, k.rand(0.09, 0.11), mtof(b), 0.34, 0.5);
    },
  },
  ui_close: {
    dur: 0.6, variations: 3, rms: -24, send: 0.15, jitter: 0.03, minInterval: 80, maxVoices: 2, priority: 3,
    render(k, i) {
      whoosh(k, 0, 2600, 550, 0.22, 0.28);
      k.tone({ f: [[0, 880], [0.07, 400]], a: 0.003, d: 0.09, v: 0.3 });
      const [a, b] = [[86, 81], [86, 79], [88, 81]][i % 3];
      I.musicBox(k, 0.03, mtof(a), 0.3, 0.4);
      I.musicBox(k, k.rand(0.09, 0.11), mtof(b), 0.3, 0.45);
    },
  },
  ui_error: {
    dur: 0.42, variations: 3, rms: -22, send: 0.08, jitter: 0.03, minInterval: 150, maxVoices: 2, priority: 3,
    render(k) {
      const f1 = k.rand(300, 320);
      const f2 = f1 * 0.84;
      k.tone({ f: [[0, f1], [0.1, f1 * 0.97]], wave: 'reed', a: 0.008, h: 0.04, d: 0.08, v: 0.5, lp: 1300 });
      k.tone({ f: f1 / 2, a: 0.005, h: 0.03, d: 0.08, v: 0.2 });
      k.tone({ t: 0.13, f: [[0, f2], [0.18, f2 * 0.95]], wave: 'reed', a: 0.008, h: 0.06, d: 0.13, v: 0.5, lp: 1100 });
      k.tone({ t: 0.13, f: f2 / 2, a: 0.005, h: 0.05, d: 0.12, v: 0.2 });
      k.noise({ color: 'pink', a: 0.001, d: 0.02, v: 0.1, lp: 800 });
    },
  },
  ui_page: {
    dur: 0.42, variations: 5, rms: -24, send: 0.1, jitter: 0.05, minInterval: 80, maxVoices: 3, priority: 3,
    render(k) {
      const n = randInt(7, 11, k.r);
      for (let i = 0; i < n; i++) {
        const t = k.rand(0, 0.22);
        k.noise({ t, a: 0.002, d: k.rand(0.01, 0.035), v: k.rand(0.08, 0.22) * (1 - t * 2), bp: k.rand(2500, 6500), q: k.rand(0.8, 2), hp: 1500 });
      }
      k.noise({ a: 0.05, d: 0.2, v: 0.05, hp: 3000, lp: 9000 });
      k.noise({ t: k.rand(0.08, 0.12), color: 'pink', a: 0.06, d: 0.14, v: 0.35, bp: [[0, 500], [0.09, 1300], [0.2, 450]], q: 0.9 });
      k.noise({ t: k.rand(0.24, 0.3), color: 'pink', a: 0.002, d: 0.05, v: 0.22, lp: 900 });
    },
  },

  // ============================================================ economy / building
  build: {
    dur: 1.0, variations: 4, rms: -20, send: 0.15, jitter: 0.03, minInterval: 60, maxVoices: 3, priority: 3,
    render(k) {
      const base = k.rand(190, 230);
      const times = [0, 0.12 + k.rand(-0.01, 0.01), 0.24 + k.rand(-0.01, 0.01)];
      times.forEach((t, i) => I.knock(k, t, base * (i === 2 ? 0.88 : k.rand(0.97, 1.05)), i === 2 ? 0.75 : 0.5));
      k.tone({ t: times[2], f: [[0, 125], [0.08, 80]], a: 0.002, d: 0.15, v: 0.35 });
      const notes = pick([[81, 86], [79, 86], [81, 88], [78, 86]], k.r);
      notes.forEach((m, i) => I.musicBox(k, 0.36 + i * 0.075, mtof(m), 0.26, 0.55));
    },
  },
  upgrade: {
    dur: 1.15, variations: 3, rms: -20, send: 0.25, jitter: 0.02, minInterval: 80, maxVoices: 3, priority: 3,
    render(k, i) {
      const seq = [[74, 78, 81, 86], [77, 81, 84, 89], [74, 77, 81, 86]][i % 3];
      seq.forEach((m, j) => I.musicBox(k, j * 0.065, mtof(m), 0.28 + j * 0.03, 0.7));
      k.tone({ f: [[0, 300], [0.25, 1300]], a: 0.06, d: 0.2, v: 0.15, lp: 2200 });
      k.noise({ t: 0.05, a: 0.12, d: 0.45, v: 0.1, bp: 6500, q: 2, trem: [16, 0.8] });
      for (let j = 0; j < 4; j++) I.chime(k, 0.28 + k.rand(0, 0.35), mtof(pick(D_PENTA_HIGH, k.r)), 0.07, 0.3);
      k.tone({ f: mtof(seq[0] - 24), wave: 'hollow', a: 0.05, h: 0.1, d: 0.5, v: 0.18, lp: 800 });
    },
  },
  sell: {
    dur: 0.6, variations: 4, rms: -21, send: 0.12, jitter: 0.03, minInterval: 60, maxVoices: 3, priority: 3,
    render(k) {
      I.knock(k, 0, k.rand(260, 300), 0.4);
      k.tone({ f: [[0, 700], [0.05, 350]], a: 0.002, d: 0.06, v: 0.2 });
      const n = randInt(4, 6, k.r);
      let t = 0.05;
      for (let j = 0; j < n; j++) {
        I.clink(k, t, k.rand(2100, 2900) * (1 - j * 0.04), 0.25 - j * 0.025, 0.18);
        t += k.rand(0.035, 0.06);
      }
    },
  },
  research: {
    dur: 1.5, variations: 3, rms: -21, send: 0.3, jitter: 0.02, minInterval: 200, maxVoices: 2, priority: 3,
    render(k) {
      whoosh(k, 0, 400, 2400, 0.4, 0.22);
      [74, 78, 81, 86].forEach((m, j) => I.epiano(k, 0.22 + j * 0.035, mtof(m), 0.2, 1.1));
      I.musicBox(k, 0.42, mtof(pick([90, 93], k.r)), 0.16, 0.8);
      k.tone({ t: 0.15, f: mtof(50), wave: 'hollow', a: 0.25, h: 0.2, d: 0.7, v: 0.12, lp: 700 });
      for (let j = 0; j < 5; j++) I.chime(k, 0.45 + k.rand(0, 0.6), mtof(pick(D_PENTA_HIGH, k.r)), 0.05, 0.35);
    },
  },
  coin: {
    dur: 0.35, variations: 5, rms: -24, send: 0.1, jitter: 0.03, minInterval: 40, maxVoices: 5, priority: 2,
    render(k) {
      const f1 = k.rand(1290, 1350);
      I.clink(k, 0, f1, 0.35, 0.12);
      I.clink(k, 0.055, f1 * 1.335, 0.45, 0.28);
      k.noise({ a: 0.0005, d: 0.006, v: 0.06, hp: 6000 });
    },
  },
  ember: {
    dur: 0.5, variations: 5, rms: -24, send: 0.15, jitter: 0.05, minInterval: 40, maxVoices: 5, priority: 2,
    render(k) {
      k.noise({ color: 'pink', a: 0.04, d: 0.22, v: 0.3, bp: [[0, 500], [0.2, 1600]], q: 1.2 });
      crackle(k, 0, randInt(4, 7, k.r), 0.3, 0.3);
      const f = mtof(pick([81, 84, 86], k.r));
      k.fm({ t: 0.03, f: [[0, f], [0.3, f * 1.02]], ratio: 2, index: 0.6, idxDecay: 0.2, a: 0.01, d: 0.35, v: 0.16 });
      k.tone({ f: [[0, 180], [0.15, 340]], a: 0.02, d: 0.15, v: 0.15, lp: 900 });
    },
  },

  // ============================================================ towers
  acorn_fire: {
    dur: 0.14, variations: 6, rms: -26, send: 0.05, jitter: 0.05, minInterval: 35, maxVoices: 6, priority: 1, delay: 10,
    render(k) {
      k.noise({ a: 0.0008, d: 0.018, v: 0.35, bp: k.rand(1500, 2100), q: 0.8 });
      const f = k.rand(250, 290);
      k.tone({ f: [[0, f], [0.022, f * k.rand(2.2, 2.6)]], a: 0.002, h: 0.008, d: 0.07, v: 0.55, lp: 2400 });
      I.knock(k, k.rand(0.008, 0.014), k.rand(1050, 1250), 0.16);
    },
  },
  acorn_hit: {
    dur: 0.16, variations: 6, rms: -25, send: 0.06, jitter: 0.06, minInterval: 30, maxVoices: 6, priority: 1, delay: 8,
    render(k) {
      const f = k.rand(760, 880);
      k.tone({ f: [[0, f], [0.03, f * 0.68]], a: 0.001, d: 0.05, v: 0.4 });
      k.tone({ f: f * 2.6, a: 0.0005, d: 0.015, v: 0.1 });
      k.noise({ color: 'pink', a: 0.004, d: 0.08, v: 0.45, bp: [[0, 1400], [0.07, 500]], q: 2.5 });
      k.tone({ f: [[0, 210], [0.05, 120]], a: 0.002, d: 0.06, v: 0.2 });
    },
  },
  catapult_fire: {
    dur: 0.75, variations: 4, rms: -22, send: 0.1, jitter: 0.04, minInterval: 80, maxVoices: 4, priority: 1, delay: 10,
    render(k) {
      const cf = k.rand(900, 1300);
      const rate: Path = [[0, k.rand(28, 34)], [0.16, k.rand(50, 60)]];
      k.tone({ f: rate, wave: 'warm', a: 0.02, h: 0.08, d: 0.08, v: 1.3, bp: cf, q: 6, lp: 2600, trem: [23, 0.5] });
      k.tone({ f: rate, wave: 'warm', a: 0.02, h: 0.08, d: 0.08, v: 0.55, bp: cf * 2.1, q: 8 });
      const tt = 0.16;
      k.tone({ t: tt, f: [[0, 150], [0.07, 70]], a: 0.002, d: 0.12, v: 0.45 });
      k.noise({ t: tt, color: 'brown', a: 0.001, d: 0.08, v: 0.5, lp: 700 });
      I.knock(k, tt, k.rand(380, 440), 0.45);
      k.noise({ t: tt + 0.02, color: 'pink', a: 0.1, d: 0.3, v: 0.8, bp: [[0, 350], [0.18, 1500], [0.4, 500]], q: 1.4 });
    },
  },
  pumpkin_explode: {
    dur: 1.0, variations: 4, rms: -19, send: 0.15, jitter: 0.05, minInterval: 60, maxVoices: 4, priority: 2, delay: 6,
    render(k) {
      const juicy = k.bus({ drive: 2.2, gain: 0.8 });
      k.tone({ f: [[0, k.rand(110, 125)], [0.25, 42]], a: 0.003, d: 0.34, v: 0.5, out: juicy });
      k.tone({ f: [[0, 210], [0.04, 90]], a: 0.001, d: 0.08, v: 0.3, out: juicy });
      k.tone({ f: [[0, 260], [0.1, 160]], a: 0.002, d: 0.12, v: 0.4 });
      k.noise({ a: 0.002, d: 0.3, v: 1.1, lp: [[0, 4200], [0.3, 380]], lpQ: 1.2, out: juicy });
      k.noise({ color: 'pink', a: 0.01, d: 0.26, v: 1.1, bp: [[0, k.rand(850, 1050)], [0.2, 300]], q: 5 });
      const n = randInt(5, 9, k.r);
      for (let j = 0; j < n; j++) drip(k, k.rand(0.06, 0.5), k.rand(900, 1900), k.rand(0.12, 0.28));
    },
  },
  syrup_pulse: {
    dur: 0.8, variations: 5, rms: -23, send: 0.12, jitter: 0.05, minInterval: 120, maxVoices: 4, priority: 1, delay: 10,
    render(k) {
      k.noise({ color: 'brown', a: 0.03, d: 0.36, v: 0.7, lp: [[0, 300], [0.08, 1200], [0.4, 250]], lpQ: 2 });
      const n = randInt(4, 7, k.r);
      for (let j = 0; j < n; j++) bubble(k, k.rand(0.02, 0.45), k.rand(200, 450), k.rand(0.2, 0.36));
      k.tone({ f: [[0, 170], [0.25, 110]], a: 0.02, d: 0.25, v: 0.28, lp: 600, vib: [18, 0.15] });
    },
  },
  zap: {
    dur: 0.5, variations: 6, rms: -23, send: 0.22, jitter: 0.05, minInterval: 50, maxVoices: 5, priority: 1, delay: 6,
    render(k) {
      k.post({ lp: 8500 });
      k.tone({ f: [[0, k.rand(2200, 2600)], [0.12, 720]], a: 0.002, d: 0.15, v: 0.22, vib: [45, 0.06] });
      crackle(k, 0, randInt(10, 16, k.r), 0.16, 0.4, 2500, 7000);
      for (let j = 0; j < 3; j++) I.chime(k, j === 0 ? 0 : k.rand(0.02, 0.1), mtof(pick(D_PENTA_HIGH, k.r)), 0.18, k.rand(0.2, 0.35));
      k.noise({ a: 0.01, d: 0.2, v: 0.06, bp: 8000, q: 1, trem: [30, 0.9] });
    },
  },
  owl_fire: {
    dur: 0.4, variations: 5, rms: -23, send: 0.12, jitter: 0.04, minInterval: 80, maxVoices: 4, priority: 1, delay: 6,
    render(k) {
      const f = k.rand(440, 520);
      k.tone({ f: [[0, f], [0.04, f * 1.08], [0.13, f * 0.92]], wave: 'soft', a: 0.02, h: 0.03, d: 0.09, v: 0.5, lp: 1300 });
      k.noise({ color: 'pink', a: 0.02, d: 0.1, v: 0.12, bp: f, q: 3 });
      const tt = k.rand(0.09, 0.11);
      k.noise({ t: tt, a: 0.006, d: 0.08, v: 0.45, bp: [[0, 900], [0.06, 4800]], q: 2, hp: 600 });
      k.noise({ t: tt + 0.03, a: 0.001, d: 0.02, v: 0.12, hp: 5000 });
    },
  },
  owl_hit: {
    dur: 0.45, variations: 5, rms: -22, send: 0.08, jitter: 0.05, minInterval: 40, maxVoices: 4, priority: 1, delay: 6,
    render(k) {
      k.tone({ f: [[0, 200], [0.06, 85]], a: 0.001, d: 0.12, v: 0.45 });
      k.noise({ a: 0.0005, d: 0.008, v: 0.5, bp: 2500, q: 1 });
      I.knock(k, 0, k.rand(480, 560), 0.5);
      k.tone({ t: 0.015, f: k.rand(240, 290), a: 0.01, d: 0.3, v: 0.16, trem: [k.rand(24, 32), 0.9] });
    },
  },

  // ============================================================ zombies
  zombie_groan: {
    dur: 1.5, variations: 6, rms: -24, send: 0.12, jitter: 0.06, minInterval: 700, maxVoices: 3, priority: 0, steal: false, delay: 30,
    render(k, i) {
      groan(k, GROANS[i % GROANS.length]);
    },
  },
  zombie_hit: {
    dur: 0.16, variations: 6, rms: -25, send: 0.05, jitter: 0.06, minInterval: 30, maxVoices: 6, priority: 1, delay: 8,
    render(k) {
      k.tone({ f: [[0, k.rand(180, 210)], [0.05, 95]], a: 0.002, d: 0.08, v: 0.4 });
      k.tone({ f: [[0, k.rand(300, 340)], [0.04, 200]], a: 0.001, d: 0.045, v: 0.22 });
      k.noise({ color: 'pink', a: 0.002, d: 0.07, v: 0.75, lp: [[0, 2200], [0.06, 600]] });
      k.noise({ a: 0.0008, d: 0.012, v: 0.3, bp: k.rand(1000, 1400), q: 1.5 });
    },
  },
  armor_clank: {
    dur: 0.6, variations: 5, rms: -23, send: 0.12, jitter: 0.05, minInterval: 40, maxVoices: 4, priority: 1, delay: 6,
    render(k) {
      const f = k.rand(470, 560);
      k.partials({
        f, v: 0.6, a: 0.0008, bend: 1.01, bendTime: 0.02, lp: 6000,
        partials: [[1, 1, 0.38], [1.58, 0.55, 0.24], [2.31, 0.38, 0.17], [3.17, 0.2, 0.11], [4.43, 0.1, 0.07], [5.9, 0.05, 0.05]],
      });
      k.noise({ a: 0.0005, d: 0.012, v: 0.4, bp: 3200, q: 1 });
      k.tone({ f: [[0, f * 0.5], [0.06, f * 0.42]], a: 0.001, d: 0.08, v: 0.3 });
    },
  },
  zombie_die: {
    dur: 1.1, variations: 5, rms: -22, send: 0.12, jitter: 0.05, minInterval: 60, maxVoices: 4, priority: 2, delay: 10,
    render(k) {
      const b = k.rand(190, 240);
      k.voice({
        dur: 0.62,
        f0: [[0, b], [0.1, b * 1.1], [0.6, b * 0.36]],
        vowels: [[0, 'm'], [0.05, 'e'], [0.25, 'uh'], [0.6, 'u']],
        growl: [k.rand(20, 28), 0.55],
        breath: 0.15, a: 0.04, r: 0.15, v: 0.9, lp: 3000,
      });
      const tp = k.rand(0.45, 0.52);
      k.noise({ t: tp, color: 'pink', a: 0.015, d: 0.35, v: 0.5, bp: [[0, 950], [0.3, 300]], q: 0.8 });
      k.noise({ t: tp, color: 'brown', a: 0.01, d: 0.25, v: 0.3, lp: 450 });
      k.tone({ t: tp, f: [[0, 520], [0.05, 260]], a: 0.001, d: 0.05, v: 0.15 });
    },
  },
  brute_stomp: {
    dur: 0.5, variations: 5, rms: -21, send: 0.06, jitter: 0.05, minInterval: 90, maxVoices: 4, priority: 1, delay: 5,
    render(k) {
      k.tone({ f: [[0, k.rand(85, 95)], [0.12, 40]], a: 0.003, d: 0.28, v: 0.65 });
      k.tone({ f: [[0, k.rand(190, 220)], [0.08, 120]], a: 0.002, d: 0.1, v: 0.35 });
      k.noise({ color: 'brown', a: 0.002, d: 0.15, v: 0.9, lp: [[0, 1000], [0.1, 220]] });
      const n = randInt(3, 5, k.r);
      for (let j = 0; j < n; j++) {
        k.noise({ t: k.rand(0.005, 0.07), a: 0.0008, d: k.rand(0.008, 0.02), v: k.rand(0.08, 0.2), bp: k.rand(1500, 3000), q: 1.5 });
      }
    },
  },
  boss_roar: {
    dur: 2.2, variations: 3, rms: -18, send: 0.25, jitter: 0.03, minInterval: 1500, maxVoices: 1, priority: 3, steal: false,
    render(k) {
      const juicy = k.bus({ drive: 1.6, gain: 0.8 });
      const b = k.rand(85, 100);
      const dur = k.rand(1.7, 2.0);
      const f0: [number, number][] = [[0, b], [0.25, b * 1.5], [0.9, b * 1.35], [dur - 0.3, b * 0.62], [dur, b * 0.55]];
      const vowels: [number, Vowel][] = [[0, 'm'], [0.08, 'r'], [0.25, 'a'], [0.9, 'a'], [1.35, 'o'], [dur, 'u']];
      k.voice({ dur, f0, vowels, growl: [k.rand(26, 34), 0.45], vib: [5, 0.02], breath: 0.25, a: 0.12, r: 0.35, v: 0.9, lp: 2800, out: juicy });
      k.voice({ dur, f0: scalePath(f0, 0.5), vowels, growl: [k.rand(14, 18), 0.3], breath: 0.1, a: 0.15, r: 0.4, v: 0.45, lp: 1500, out: juicy });
      k.tone({ f: scalePath(f0, 0.5), a: 0.15, h: dur - 0.5, d: 0.35, v: 0.2, lp: 200 });
    },
  },

  // ============================================================ game flow
  wave_start: {
    dur: 3.6, variations: 2, rms: -20, send: 0.45, jitter: 0, minInterval: 1000, maxVoices: 1, priority: 3, steal: true,
    render(k, i) {
      I.churchBell(k, 0, mtof(62), 0.55, 3.2);
      I.churchBell(k, 1.55, mtof(i % 2 ? 57 : 55), 0.22, 2.0);
      I.horn(k, 0.5, mtof(57), 0.55, 0.22, { a: 0.25, rel: 0.3, bright: 0.7 });
      I.horn(k, 1.05, mtof(62), 1.2, 0.26, { a: 0.2, rel: 0.7, bright: 0.7 });
      I.horn(k, 1.05, mtof(50), 1.2, 0.12, { a: 0.3, rel: 0.7, bright: 0.6 });
    },
  },
  wave_clear: {
    dur: 1.9, variations: 3, rms: -20, send: 0.3, jitter: 0, minInterval: 500, maxVoices: 1, priority: 3, steal: true,
    render(k, i) {
      const jingles: [number, number][][] = [
        [[72, 0], [77, 0.1], [81, 0.2], [84, 0.3], [81, 0.45], [89, 0.62]],
        [[77, 0], [79, 0.1], [81, 0.2], [84, 0.3], [86, 0.42], [84, 0.54], [89, 0.7]],
        [[81, 0], [84, 0.1], [89, 0.2], [88, 0.36], [86, 0.46], [89, 0.62]],
      ];
      const j = jingles[i % jingles.length];
      j.forEach(([m, t], idx) => {
        const last = idx === j.length - 1;
        I.marimba(k, t, mtof(m), last ? 0.5 : 0.38, last ? 0.9 : 0.45);
        I.musicBox(k, t + 0.002, mtof(m + 12), last ? 0.1 : 0.06, last ? 1.2 : 0.5);
      });
      const end = j[j.length - 1][1];
      I.marimba(k, end, mtof(53), 0.35, 0.9);
      I.marimba(k, end, mtof(60), 0.2, 0.8);
      [89, 93, 96].forEach((m, q) => I.musicBox(k, end + 0.12 + q * 0.05, mtof(m), 0.07, 1));
    },
  },
  life_lost: {
    dur: 1.8, variations: 2, rms: -20, send: 0.2, jitter: 0.01, minInterval: 300, maxVoices: 2, priority: 3,
    render(k, i) {
      k.tone({ f: [[0, 105], [0.1, 55]], a: 0.003, d: 0.32, v: 0.5 });
      k.tone({ f: 190, a: 0.002, d: 0.15, v: 0.4 });
      k.tone({ f: 285, a: 0.002, d: 0.1, v: 0.2 });
      k.noise({ color: 'brown', a: 0.001, d: 0.12, v: 0.6, lp: 700 });
      for (let j = 0; j < 3; j++) k.noise({ t: k.rand(0.02, 0.09), a: 0.0005, d: 0.01, v: 0.1, bp: 2400, q: 3 });
      const [m1, m2] = i % 2 ? [67, 62] : [69, 65];
      const n1 = mtof(m1);
      const n2 = mtof(m2);
      I.epiano(k, 0.35, n1, 0.42, 0.5);
      k.tone({ t: 0.35, f: n1, wave: 'soft', a: 0.03, h: 0.2, d: 0.2, v: 0.15, lp: 2000 });
      I.epiano(k, 0.75, n2, 0.45, 1.0);
      k.tone({ t: 0.75, f: [[0, n2], [0.5, n2], [0.9, n2 * 0.97]], wave: 'soft', a: 0.04, h: 0.45, d: 0.4, v: 0.16, lp: 1800, vib: [5, 0.008, 0.2] });
    },
  },
  game_over: {
    dur: 4.2, variations: 1, rms: -21, send: 0.4, jitter: 0, minInterval: 2000, maxVoices: 1, priority: 3, steal: true,
    render(k) {
      const mel: [number, number, number][] = [[69, 0, 0.5], [67, 0.5, 0.5], [65, 1.0, 0.55], [64, 1.55, 0.65], [62, 2.2, 1.6]];
      for (const [m, t, l] of mel) {
        I.epiano(k, t, mtof(m), 0.3, l + 0.6);
        I.musicBox(k, t, mtof(m + 12), 0.05, 1);
      }
      const bass: [number, number, number][] = [[50, 0, 1], [46, 1.0, 0.55], [45, 1.55, 0.65], [38, 2.2, 1.6]];
      for (const [m, t, l] of bass) I.epiano(k, t, mtof(m), 0.24, l + 0.8);
      [50, 53, 57].forEach((m) => I.pad(k, 2.2, mtof(m), 1.5, 0.1, 900));
      I.musicBox(k, 2.6, mtof(86), 0.06, 1.4);
    },
  },
  victory: {
    dur: 4.8, variations: 1, rms: -20, send: 0.35, jitter: 0, minInterval: 2000, maxVoices: 1, priority: 3, steal: true,
    render(k) {
      const brass = (t: number, m: number, dur: number, v: number) => I.horn(k, t, mtof(m), dur, v, { a: 0.04, rel: 0.25, bright: 1.25 });
      brass(0, 60, 0.1, 0.3);
      brass(0.14, 60, 0.1, 0.3);
      brass(0.28, 60, 0.1, 0.32);
      brass(0.42, 65, 0.35, 0.4);
      brass(0.42, 57, 0.35, 0.2);
      brass(0.84, 69, 0.32, 0.4);
      brass(0.84, 60, 0.32, 0.2);
      brass(1.24, 72, 0.65, 0.45);
      brass(1.24, 67, 0.65, 0.22);
      brass(1.24, 64, 0.65, 0.2);
      brass(2.0, 69, 0.15, 0.36);
      brass(2.2, 72, 0.15, 0.38);
      brass(2.42, 77, 1.5, 0.48);
      brass(2.42, 72, 1.5, 0.24);
      brass(2.42, 69, 1.5, 0.22);
      brass(2.42, 65, 1.5, 0.2);
      I.timpani(k, 0.42, mtof(41), 0.5);
      I.timpani(k, 1.24, mtof(36), 0.45);
      for (let j = 0; j < 10; j++) I.timpani(k, 1.95 + j * 0.045, mtof(41), 0.08 + j * 0.03, 0.4, undefined, true);
      I.timpani(k, 2.42, mtof(41), 0.7, 1.8);
      [77, 81, 84, 89, 93].forEach((m, q) => I.musicBox(k, 2.48 + q * 0.07, mtof(m), 0.11, 1.4));
      k.noise({ t: 1.95, a: 0.45, d: 1.6, v: 0.05, hp: 5500, lp: 11000 });
      [53, 57, 60].forEach((m) => I.pad(k, 2.42, mtof(m), 1.6, 0.12, 1200));
    },
  },
  // ============================================================ lumberjack & repairs
  axe_chop: {
    dur: 0.45, variations: 5, rms: -21, send: 0.08, jitter: 0.05, minInterval: 70, maxVoices: 4, priority: 2, delay: 4,
    render(k) {
      // whoosh of the swing, then a woody bite into the tower
      k.noise({ color: 'pink', a: 0.05, d: 0.04, v: 0.25, bp: [[0, 600], [0.08, 1800]], q: 1.2 });
      const t = 0.085;
      I.knock(k, t, k.rand(330, 380), 0.75);
      k.tone({ t, f: [[0, k.rand(160, 180)], [0.06, 90]], a: 0.001, d: 0.12, v: 0.45 });
      k.noise({ t, a: 0.0006, d: 0.025, v: 0.55, bp: k.rand(2400, 3200), q: 2 });
      I.clink(k, t + 0.002, k.rand(2100, 2400), 0.06, 0.12);
      // a splinter or two
      for (let j = 0; j < 3; j++) k.noise({ t: t + k.rand(0.02, 0.09), a: 0.0006, d: k.rand(0.01, 0.02), v: k.rand(0.06, 0.14), bp: k.rand(1800, 3600), q: 1.4 });
    },
  },
  tower_break: {
    // the final axe blow lights the fuse: a straining creak, then BOOM right as
    // the tower blows (0.45 s, matching Tower.FUSE), debris raining down, and a
    // sad little two-note droop
    dur: 2.0, variations: 3, rms: -18, send: 0.16, jitter: 0.03, minInterval: 200, maxVoices: 2, priority: 3, delay: 4,
    render(k) {
      const rate: Path = [[0, k.rand(16, 20)], [0.42, k.rand(44, 52)]];
      k.tone({ f: rate, wave: 'warm', a: 0.04, h: 0.32, d: 0.06, v: 0.75, bp: [[0, 650], [0.42, 1100]], q: 6, lp: 2200, trem: [21, 0.55] });
      k.noise({ t: 0.2, color: 'pink', a: 0.2, d: 0.03, v: 0.25, bp: [[0, 900], [0.25, 2400]], q: 1.2 });
      const t = 0.45;
      const boom = k.bus({ drive: 2.4, gain: 0.85 });
      k.tone({ t, f: [[0, 120], [0.35, 34]], a: 0.002, d: 0.6, v: 0.85, out: boom });
      k.tone({ t, f: [[0, 260], [0.08, 90]], a: 0.001, d: 0.14, v: 0.45, out: boom });
      k.noise({ t, color: 'brown', a: 0.002, d: 0.7, v: 1.1, lp: [[0, 3200], [0.5, 260]], out: boom });
      k.noise({ t, a: 0.001, d: 0.12, v: 0.55, bp: 2200, q: 0.8 });
      I.timpani(k, t, mtof(31), 0.55, 1.2);
      // debris clattering back down
      for (let j = 0; j < 10; j++) I.knock(k, t + 0.25 + j * k.rand(0.05, 0.1), k.rand(240, 620), 0.32 - j * 0.025);
      for (let j = 0; j < 5; j++) I.clink(k, t + 0.3 + k.rand(0, 0.5), k.rand(1800, 2600), 0.05, 0.1);
      I.musicBox(k, 1.3, mtof(69), 0.11, 0.8);
      I.musicBox(k, 1.48, mtof(64), 0.11, 1.0);
    },
  },
  repair: {
    dur: 1.0, variations: 3, rms: -20, send: 0.18, jitter: 0.02, minInterval: 90, maxVoices: 3, priority: 3,
    render(k) {
      // three brisk hammer taps, then a bright "good as new" sparkle
      const base = k.rand(900, 1050);
      [0, 0.1, 0.2].forEach((t, i) => {
        I.clink(k, t, base * (i === 2 ? 1.2 : 1), 0.18);
        I.knock(k, t, k.rand(380, 420), 0.3);
      });
      const notes = pick([[81, 85, 88, 93], [79, 83, 86, 91]], k.r);
      notes.forEach((m, i) => I.chime(k, 0.34 + i * 0.06, mtof(m), 0.14, 0.6));
    },
  },
  announce: {
    // a herald's call for a new threat: drum roll, brassy D-minor fanfare, a cheeky twist at the end
    dur: 3.0, variations: 1, rms: -19, send: 0.32, jitter: 0, minInterval: 1500, maxVoices: 1, priority: 3, steal: true,
    render(k) {
      const brass = (t: number, m: number, dur: number, v: number) => I.horn(k, t, mtof(m), dur, v, { a: 0.035, rel: 0.25, bright: 1.3 });
      for (let j = 0; j < 12; j++) I.timpani(k, j * 0.04, mtof(38), 0.06 + j * 0.03, 0.35, undefined, true);
      I.timpani(k, 0.5, mtof(38), 0.65);
      brass(0.5, 62, 0.12, 0.34);
      brass(0.66, 62, 0.12, 0.34);
      brass(0.82, 69, 0.55, 0.44);
      brass(0.82, 65, 0.55, 0.24);
      brass(0.82, 62, 0.55, 0.22);
      I.timpani(k, 0.82, mtof(33), 0.45);
      brass(1.45, 70, 0.14, 0.38);
      brass(1.62, 69, 0.14, 0.36);
      brass(1.8, 74, 0.9, 0.48);
      brass(1.8, 69, 0.9, 0.24);
      brass(1.8, 65, 0.9, 0.22);
      brass(1.8, 62, 0.9, 0.2);
      I.timpani(k, 1.8, mtof(38), 0.6, 1.6);
      [86, 89, 93, 98].forEach((m, q) => I.musicBox(k, 1.95 + q * 0.07, mtof(m), 0.1, 1.2));
    },
  },
  trophy: {
    // a trophy lands on the shelf: two bright brass hits, a music-box run up the scale and a shimmer of chimes
    dur: 2.2, variations: 2, rms: -20, send: 0.35, jitter: 0, minInterval: 400, maxVoices: 2, priority: 3,
    render(k, i) {
      const root = i === 0 ? 74 : 77;
      const brass = (t: number, m: number, dur: number, v: number) => I.horn(k, t, mtof(m), dur, v, { a: 0.03, rel: 0.3, bright: 1.35 });
      brass(0, root - 12, 0.1, 0.26);
      brass(0.13, root - 5, 0.5, 0.34);
      brass(0.13, root - 12, 0.5, 0.2);
      brass(0.13, root - 8, 0.5, 0.18);
      I.timpani(k, 0.13, mtof(root - 36), 0.35, 0.9);
      [0, 4, 7, 12, 16].forEach((d, j) => I.musicBox(k, 0.2 + j * 0.06, mtof(root + d), 0.16 + j * 0.02, 1.2));
      k.noise({ t: 0.25, a: 0.15, d: 0.9, v: 0.06, bp: 7000, q: 1.5, trem: [18, 0.7] });
      for (let j = 0; j < 7; j++) I.chime(k, 0.45 + k.rand(0, 0.9), mtof(pick(D_PENTA_HIGH, k.r) + (i === 0 ? 0 : 3)), 0.06, 0.4);
      I.churchBell(k, 0.5, mtof(root + 12), 0.08, 1.4);
    },
  },
  place_invalid: {
    dur: 0.3, variations: 4, rms: -23, send: 0.06, jitter: 0.04, minInterval: 120, maxVoices: 2, priority: 3,
    render(k) {
      k.tone({ f: [[0, k.rand(250, 275)], [0.12, 150]], a: 0.002, d: 0.17, v: 0.7, lp: 1200 });
      k.tone({ f: [[0, 520], [0.05, 300]], a: 0.001, d: 0.05, v: 0.14 });
      k.noise({ color: 'pink', a: 0.001, d: 0.03, v: 0.3, lp: 900 });
    },
  },
};

export const SFX: Record<SfxName, SfxSpec> = Object.fromEntries(
  (Object.entries(RECIPES) as [SfxName, Recipe][]).map(([name, r]) => [
    name,
    { priority: 1, steal: r.dur < 0.5, delay: 0, ...r } satisfies SfxSpec,
  ]),
) as Record<SfxName, SfxSpec>;

export const SFX_NAMES = Object.keys(RECIPES) as SfxName[];

export const SFX_CATEGORIES: ReadonlyArray<{ label: string; names: readonly SfxName[] }> = [
  { label: 'Interface', names: ['ui_click', 'ui_hover', 'ui_open', 'ui_close', 'ui_error', 'ui_page', 'place_invalid'] },
  { label: 'Economy & Building', names: ['build', 'upgrade', 'sell', 'research', 'coin', 'ember'] },
  { label: 'Towers', names: ['acorn_fire', 'acorn_hit', 'catapult_fire', 'pumpkin_explode', 'syrup_pulse', 'zap', 'owl_fire', 'owl_hit'] },
  { label: 'Zombies', names: ['zombie_groan', 'zombie_hit', 'armor_clank', 'zombie_die', 'brute_stomp', 'boss_roar', 'axe_chop'] },
  { label: 'Repairs', names: ['tower_break', 'repair'] },
  { label: 'Announcements', names: ['announce', 'trophy'] },
  { label: 'Game Flow', names: ['wave_start', 'wave_clear', 'life_lost', 'game_over', 'victory'] },
];

/** Sounds that fire in rapid succession during combat (the lab offers a "spam ×10" button). */
export const RAPID_FIRE: readonly SfxName[] = [
  'ui_click', 'ui_hover', 'coin', 'ember', 'acorn_fire', 'acorn_hit', 'catapult_fire', 'pumpkin_explode', 'zap',
  'owl_fire', 'owl_hit', 'zombie_groan', 'zombie_hit', 'armor_clank', 'zombie_die', 'brute_stomp', 'syrup_pulse', 'axe_chop',
];

/** Pre-render order: what the player is likely to hear first. */
export const RENDER_ORDER: readonly SfxName[] = [
  'ui_click', 'ui_hover', 'ui_open', 'ui_close', 'place_invalid', 'ui_error', 'build', 'coin', 'wave_start',
  'acorn_fire', 'acorn_hit', 'zombie_groan', 'zombie_hit', 'zombie_die', 'ember', 'ui_page', 'sell', 'upgrade',
  'research', 'catapult_fire', 'pumpkin_explode', 'syrup_pulse', 'zap', 'owl_fire', 'owl_hit', 'armor_clank',
  'brute_stomp', 'wave_clear', 'life_lost', 'boss_roar', 'axe_chop', 'repair', 'tower_break', 'announce', 'trophy', 'game_over', 'victory',
];

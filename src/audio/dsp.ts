/**
 * Low-level DSP helpers shared by the SFX renderer, music and ambience.
 * Everything here is context-agnostic: buffers are created with the
 * `AudioBuffer` constructor so they can be shared between the realtime
 * context and the OfflineAudioContexts used for pre-rendering.
 */

export type Rng = () => number;

// ---------------------------------------------------------------- math utils

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Exponential interpolation, nice for frequencies. */
export const lerpExp = (a: number, b: number, t: number): number => a * Math.pow(b / a, t);
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const rand = (a: number, b: number, r: Rng = Math.random): number => a + (b - a) * r();
export const randInt = (a: number, b: number, r: Rng = Math.random): number => Math.floor(a + (b + 1 - a) * r());
export const chance = (p: number, r: Rng = Math.random): boolean => r() < p;
export const pick = <T>(arr: readonly T[], r: Rng = Math.random): T => arr[Math.floor(r() * arr.length) % arr.length];
/** Multiply x by a random factor in [1 - amt, 1 + amt]. */
export const jit = (x: number, amt: number, r: Rng = Math.random): number => x * (1 + (r() * 2 - 1) * amt);
export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (g: number): number => 20 * Math.log10(Math.max(g, 1e-9));

/** Weighted pick: items are [value, weight]. */
export function pickWeighted<T>(items: ReadonlyArray<readonly [T, number]>, r: Rng = Math.random): T {
  let total = 0;
  for (const [, w] of items) total += w;
  let x = r() * total;
  for (const [v, w] of items) {
    x -= w;
    if (x <= 0) return v;
  }
  return items[items.length - 1][0];
}

function makeBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
  return new AudioBuffer({ numberOfChannels: channels, length: Math.max(1, length), sampleRate });
}

// ---------------------------------------------------------------- noise

export type NoiseColor = 'white' | 'pink' | 'brown';
const noiseCache = new Map<string, AudioBuffer>();

/**
 * Seamlessly-looping noise buffer (crossfaded tail), RMS-normalised to ~0.35
 * so the three colours are interchangeable level-wise.
 */
export function noiseBuffer(color: NoiseColor, sampleRate: number, seconds = 3, variant = 0): AudioBuffer {
  const key = `${color}:${sampleRate}:${seconds}:${variant}`;
  const hit = noiseCache.get(key);
  if (hit) return hit;
  const len = Math.floor(seconds * sampleRate);
  const fade = Math.floor(0.08 * sampleRate);
  const raw = new Float32Array(len + fade);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = Math.random() * 2 - 1;
    if (color === 'white') raw[i] = w;
    else if (color === 'pink') {
      // Paul Kellet's refined pink filter
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    } else {
      last = (last + 0.02 * w) / 1.02;
      raw[i] = last;
    }
  }
  const buf = makeBuffer(1, len, sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = raw[i];
  // crossfade the overflow into the head so the loop point is inaudible
  for (let i = 0; i < fade; i++) {
    const x = i / fade;
    d[i] = d[i] * Math.sqrt(x) + raw[len + i] * Math.sqrt(1 - x);
  }
  // remove DC and normalise
  let mean = 0;
  for (let i = 0; i < len; i++) mean += d[i];
  mean /= len;
  let ss = 0;
  for (let i = 0; i < len; i++) {
    d[i] -= mean;
    ss += d[i] * d[i];
  }
  const g = 0.35 / Math.sqrt(ss / len || 1);
  for (let i = 0; i < len; i++) d[i] *= g;
  noiseCache.set(key, buf);
  return buf;
}

// ---------------------------------------------------------------- reverb impulse responses

export interface IROptions {
  seconds: number;
  rt60: number;
  preDelay?: number;
  /** One-pole lowpass cutoff at the start / end of the tail: progressive damping = warmth. */
  lpStart?: number;
  lpEnd?: number;
  /** Number of discrete early reflections. */
  early?: number;
  /** Fade-in of the diffuse tail, seconds (softens the onset). */
  attack?: number;
}

/** Generates a decorrelated stereo impulse response with frequency-dependent decay. */
export function impulseResponse(sampleRate: number, o: IROptions): AudioBuffer {
  const pre = Math.floor((o.preDelay ?? 0.01) * sampleRate);
  const len = Math.floor(o.seconds * sampleRate) + pre;
  const buf = makeBuffer(2, len, sampleRate);
  const lpStart = o.lpStart ?? 7000;
  const lpEnd = o.lpEnd ?? 1200;
  const attack = Math.max(1, Math.floor((o.attack ?? 0.01) * sampleRate));
  const decayK = 6.9078 / o.rt60; // ln(1000)
  const tail = len - pre;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < tail; i++) {
      const t = i / sampleRate;
      const fc = lpStart * Math.pow(lpEnd / lpStart, i / tail);
      const a = Math.exp((-2 * Math.PI * fc) / sampleRate);
      lp = lp * a + (Math.random() * 2 - 1) * (1 - a);
      // compensate the level loss of the lowpass so the decay curve stays honest
      const comp = Math.sqrt((1 + a) / (1 - a + 1e-9)) * 0.5;
      const env = Math.exp(-decayK * t) * Math.min(1, i / attack);
      d[pre + i] = lp * comp * env;
    }
    const early = o.early ?? 6;
    for (let e = 0; e < early; e++) {
      const t = rand(0.004, 0.045);
      const idx = pre + Math.floor(t * sampleRate);
      if (idx < len) d[idx] += (Math.random() < 0.5 ? -1 : 1) * rand(0.15, 0.4) * Math.exp(-decayK * t);
    }
    // tiny fade-out to avoid a click at the very end
    const fo = Math.min(len, Math.floor(0.05 * sampleRate));
    for (let i = 0; i < fo; i++) d[len - 1 - i] *= i / fo;
  }
  return buf;
}

// ---------------------------------------------------------------- Karplus-Strong

export interface PluckOptions {
  seconds?: number;
  /** 0..1, brightness of the excitation (0 = very soft thumb, 1 = pick). */
  bright?: number;
  /** T60 of the fundamental in seconds. */
  t60?: number;
  /** Pluck position 0..0.5 (comb filtering of the excitation). */
  pos?: number;
}

const ksCache = new Map<string, AudioBuffer>();

/**
 * Karplus-Strong plucked string. Exact tuning trick: the loop length is an
 * integer N + 0.5 (two-tap average), and the *buffer sample rate* is chosen
 * so that rate / (N + 0.5) == freq. Playback resamples to the context rate.
 */
export function ksPluck(freq: number, baseRate: number, o: PluckOptions = {}, variant = 0): AudioBuffer {
  const key = `${freq.toFixed(2)}:${baseRate}:${o.seconds}:${o.bright}:${o.t60}:${o.pos}:${variant}`;
  const hit = ksCache.get(key);
  if (hit) return hit;
  const N = Math.max(4, Math.round(baseRate / freq - 0.5));
  const rate = freq * (N + 0.5);
  const seconds = o.seconds ?? 1.6;
  const len = Math.ceil(seconds * rate);
  const buf = makeBuffer(1, len, rate);
  const y = buf.getChannelData(0);
  const bright = clamp(o.bright ?? 0.5, 0.02, 1);
  const t60 = o.t60 ?? 2;
  const rho = Math.pow(0.001, 1 / (t60 * freq));

  // excitation: lowpassed noise, comb-filtered by the pluck position
  const exc = new Float32Array(N);
  for (let i = 0; i < N; i++) exc[i] = Math.random() * 2 - 1;
  const a = 1 - bright;
  for (let pass = 0; pass < 2; pass++) {
    let s = exc[N - 1];
    for (let i = 0; i < N; i++) {
      s = s * a + exc[i] * (1 - a);
      exc[i] = s;
    }
  }
  const p = Math.max(1, Math.round((o.pos ?? 0.18) * N));
  for (let i = N - 1; i >= p; i--) exc[i] -= exc[i - p] * 0.9;
  let mean = 0;
  for (let i = 0; i < N; i++) mean += exc[i];
  mean /= N;
  for (let i = 0; i < N; i++) exc[i] -= mean;

  for (let n = 0; n < len; n++) {
    const x = n < N ? exc[n] : 0;
    const y1 = n - N >= 0 ? y[n - N] : 0;
    const y2 = n - N - 1 >= 0 ? y[n - N - 1] : 0;
    y[n] = x + rho * 0.5 * (y1 + y2);
  }
  // DC blocker + soft onset (2 ms) + fade out over the last 35 %
  let xm1 = 0, ym1 = 0, peak = 0;
  const onset = Math.max(1, Math.floor(0.002 * rate));
  const foStart = Math.floor(len * 0.65);
  for (let n = 0; n < len; n++) {
    const v = y[n] - xm1 + 0.995 * ym1;
    xm1 = y[n];
    ym1 = v;
    let g = 1;
    if (n < onset) g = n / onset;
    if (n > foStart) g *= 1 - (n - foStart) / (len - foStart);
    y[n] = v * g;
    peak = Math.max(peak, Math.abs(y[n]));
  }
  const norm = 0.6 / (peak || 1);
  for (let n = 0; n < len; n++) y[n] *= norm;
  ksCache.set(key, buf);
  return buf;
}

// ---------------------------------------------------------------- periodic waves

export type WaveName = 'warm' | 'reed' | 'glottal' | 'soft' | 'hollow';
const waveCache = new WeakMap<BaseAudioContext, Map<WaveName, PeriodicWave>>();

/** Band-limited custom waveforms with gentle harmonic roll-off (never raw saw/square). */
export function periodicWave(ctx: BaseAudioContext, name: WaveName): PeriodicWave {
  let m = waveCache.get(ctx);
  if (!m) {
    m = new Map();
    waveCache.set(ctx, m);
  }
  const hit = m.get(name);
  if (hit) return hit;
  const H = name === 'glottal' ? 48 : name === 'warm' ? 28 : 16;
  const real = new Float32Array(H + 1);
  const imag = new Float32Array(H + 1);
  for (let n = 1; n <= H; n++) {
    let amp = 0;
    switch (name) {
      case 'warm': // saw-like with steeper roll-off: strings / brass / pads
        amp = 1 / Math.pow(n, 1.45);
        break;
      case 'reed': // odd-heavy, clarinet / kazoo
        amp = (n % 2 === 1 ? 1 : 0.18) / Math.pow(n, 1.35);
        break;
      case 'glottal': // vocal source for formant voices
        amp = 1 / Math.pow(n, 1.05);
        break;
      case 'soft': // flute / ocarina, nearly a sine
        amp = n === 1 ? 1 : n === 2 ? 0.18 : n === 3 ? 0.06 : 0.01 / n;
        break;
      case 'hollow': // pad, mostly odd harmonics softly
        amp = (n % 2 === 1 ? 1 : 0.35) / (n * n);
        break;
    }
    imag[n] = amp;
  }
  const w = ctx.createPeriodicWave(real, imag);
  m.set(name, w);
  return w;
}

// ---------------------------------------------------------------- waveshaping

/** tanh curve with unity small-signal gain up to `knee`, smooth ceiling `ceil`. */
export function softClipCurve(knee = 0.6, ceil = 0.98, n = 4096): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  const room = ceil - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const ax = Math.abs(x);
    const y = ax <= knee ? ax : knee + room * Math.tanh((ax - knee) / room);
    c[i] = Math.sign(x) * y;
  }
  return c;
}

/** Symmetric tanh drive curve normalised to peak 1 (used for juicy SFX). */
export function driveCurve(drive: number, n = 2048): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(drive * x) / norm;
  }
  return c;
}

// ---------------------------------------------------------------- analysis

export interface Levels {
  peak: number;
  peakDb: number;
  /** plain RMS over the "active" part (10 ms windows within 20 dB of the loudest window) */
  rmsDb: number;
  /**
   * Perceptually weighted active RMS: BS.1770 K-weighting shelf plus a 70 Hz
   * high-pass, so sub-bass (inaudible on laptop speakers) doesn't count much.
   * This is what SFX are normalised to.
   */
  loudDb: number;
  activeSec: number;
  seconds: number;
}

function biquadInPlace(x: Float64Array, b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): void {
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = y;
    x[i] = y;
  }
}

/** Mono mix with K-weighting high shelf (+4 dB above ~1.7 kHz) and a 70 Hz high-pass. */
function weightedMono(buf: AudioBuffer): Float64Array {
  const len = buf.length;
  const ch = buf.numberOfChannels;
  const x = new Float64Array(len);
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) x[i] += d[i] / ch;
  }
  const fs = buf.sampleRate;
  {
    const G = 3.99984385397, Q = 0.7071752369554193, fc = 1681.974450955533;
    const A = Math.pow(10, G / 40), w0 = (2 * Math.PI * fc) / fs, al = Math.sin(w0) / (2 * Q), cw = Math.cos(w0), sA = Math.sqrt(A);
    biquadInPlace(
      x,
      A * (A + 1 + (A - 1) * cw + 2 * sA * al),
      -2 * A * (A - 1 + (A + 1) * cw),
      A * (A + 1 + (A - 1) * cw - 2 * sA * al),
      A + 1 - (A - 1) * cw + 2 * sA * al,
      2 * (A - 1 - (A + 1) * cw),
      A + 1 - (A - 1) * cw - 2 * sA * al,
    );
  }
  {
    const Q = 0.5, fc = 70;
    const w0 = (2 * Math.PI * fc) / fs, al = Math.sin(w0) / (2 * Q), cw = Math.cos(w0);
    biquadInPlace(x, (1 + cw) / 2, -(1 + cw), (1 + cw) / 2, 1 + al, -2 * cw, 1 - al);
  }
  return x;
}

/** Active RMS (dB) of a signal: mean power over 10 ms windows within 20 dB of the loudest. */
function activeRms(x: ArrayLike<number>, sampleRate: number): { db: number; activeSec: number } {
  const win = Math.max(1, Math.floor(sampleRate * 0.01));
  const nWin = Math.ceil(x.length / win);
  const wins = new Float64Array(nWin);
  for (let i = 0; i < x.length; i++) wins[(i / win) | 0] += x[i] * x[i];
  let maxW = 0;
  for (let w = 0; w < nWin; w++) {
    wins[w] /= win;
    if (wins[w] > maxW) maxW = wins[w];
  }
  let sum = 0, count = 0;
  for (let w = 0; w < nWin; w++) {
    if (wins[w] > 0 && wins[w] >= maxW * 0.01) {
      sum += wins[w];
      count++;
    }
  }
  return { db: gainToDb(count ? Math.sqrt(sum / count) : 0), activeSec: (count * win) / sampleRate };
}

export function analyze(buf: AudioBuffer): Levels {
  const ch = buf.numberOfChannels;
  const len = buf.length;
  let peak = 0;
  const mono = new Float64Array(len);
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const v = d[i];
      const av = v < 0 ? -v : v;
      if (av > peak) peak = av;
      mono[i] += v / ch;
    }
  }
  const plain = activeRms(mono, buf.sampleRate);
  const loud = activeRms(weightedMono(buf), buf.sampleRate);
  return {
    peak,
    peakDb: gainToDb(peak),
    rmsDb: plain.db,
    loudDb: loud.db,
    activeSec: plain.activeSec,
    seconds: buf.duration,
  };
}

export function scaleBuffer(buf: AudioBuffer, g: number): void {
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= g;
  }
}

/** Normalise to a target weighted loudness, never letting the peak exceed `maxPeak`. Returns applied gain. */
export function normalize(buf: AudioBuffer, targetDb: number, maxPeak = 0.9): number {
  const l = analyze(buf);
  if (l.peak <= 0) return 1;
  let g = dbToGain(targetDb - l.loudDb);
  if (l.peak * g > maxPeak) g = maxPeak / l.peak;
  scaleBuffer(buf, g);
  return g;
}

/**
 * Copy `[start, start+length)` of `src` into a new mono/stereo buffer, trimming
 * trailing silence (< -66 dB) and applying a short fade-out.
 */
export function sliceTrim(src: AudioBuffer, start: number, length: number): AudioBuffer {
  const ch = src.numberOfChannels;
  const sr = src.sampleRate;
  let end = start + length;
  const floor = 0.0005;
  let lastLoud = start;
  for (let c = 0; c < ch; c++) {
    const d = src.getChannelData(c);
    for (let i = end - 1; i > lastLoud; i--) {
      if (Math.abs(d[i]) > floor) {
        lastLoud = i;
        break;
      }
    }
  }
  end = Math.min(end, lastLoud + Math.floor(0.02 * sr));
  const n = Math.max(1, end - start);
  const out = makeBuffer(ch, n, sr);
  const fade = Math.min(n, Math.floor(0.012 * sr));
  for (let c = 0; c < ch; c++) {
    const s = src.getChannelData(c);
    const d = out.getChannelData(c);
    d.set(s.subarray(start, start + n));
    for (let i = 0; i < fade; i++) d[n - 1 - i] *= i / fade;
  }
  return out;
}

// ---------------------------------------------------------------- crickets

/** A single cricket chirp: a few amplitude-modulated pulses of a ~4.5 kHz tone. */
export function cricketChirp(sampleRate: number, pulses = 3, carrier = 4500): AudioBuffer {
  const pulseLen = 0.016;
  const spacing = 0.024;
  const total = spacing * (pulses - 1) + pulseLen + 0.01;
  const len = Math.floor(total * sampleRate);
  const buf = makeBuffer(1, len, sampleRate);
  const d = buf.getChannelData(0);
  for (let p = 0; p < pulses; p++) {
    const s0 = Math.floor(p * spacing * sampleRate);
    const pl = Math.floor(pulseLen * sampleRate);
    const amp = 0.7 + 0.3 * Math.sin((p / Math.max(1, pulses - 1)) * Math.PI);
    for (let i = 0; i < pl && s0 + i < len; i++) {
      const t = i / sampleRate;
      const w = Math.sin((Math.PI * i) / pl);
      const env = w * w;
      const f = carrier * (1 - 0.015 * (i / pl));
      d[s0 + i] +=
        amp * env * (Math.sin(2 * Math.PI * f * t) + 0.12 * Math.sin(2 * Math.PI * 2 * f * t));
    }
  }
  return buf;
}

/**
 * AudioEngine: context lifecycle, mixing graph, SFX voice management,
 * and the shared lookahead clock that drives music and ambience.
 *
 * Graph:
 *   SFX voice -> gain -> (pan) -> sfxBus[vol] ------------------------------> master
 *                             \-> send -> sfxSend[vol] -> room convolver ---> master
 *   Music.output (night LP) -> musicVol -> master
 *                                       \-> musicHallSend -> hall convolver -> master
 *   Ambience.output -> ambVol -> master ; Ambience.wet -> ambWetVol -> hall
 *   master[vol * mute * trim] -> limiter (DynamicsCompressor) -> soft clipper -> destination
 */
import { Ambience } from './ambience';
import { type Levels, analyze, clamp, dbToGain, impulseResponse, normalize, softClipCurve } from './dsp';
import { Music, type MusicState } from './music';
import { renderSfx } from './render';
import { RENDER_ORDER, SFX, type SfxName } from './sfx';

export interface PlayOpts {
  /** 0..1 multiplier, default 1 */
  volume?: number;
  /** -1..1 stereo pan */
  pan?: number;
  /** playback-rate-like multiplier, default 1 */
  pitch?: number;
}

export interface Volumes {
  master: number;
  music: number;
  sfx: number;
  ambience: number;
}

export interface AudioStats {
  state: AudioContextState | 'locked';
  sampleRate: number;
  voices: number;
  rendered: number;
  total: number;
  renderMs: number;
  music: MusicState | null;
  ambience: boolean;
  /** current master limiter gain reduction in dB (0 = idle) */
  limiterDb: number;
}

const STORAGE_KEY = 'lh_audio';
const DEFAULTS: Volumes = { master: 0.8, music: 0.55, sfx: 0.8, ambience: 0.5 };
const MAX_VOICES = 48;
const LOOKAHEAD = 0.25;
const TICK_MS = 25;
/** makeup gain so the defaults land at a comfortable listening level */
const MASTER_TRIM = dbToGain(7);
const MUSIC_TRIM = dbToGain(3);
const AMBIENCE_TRIM = dbToGain(0);
/** perceptual slider taper */
const taper = (v: number): number => v * v;

interface Voice {
  name: SfxName;
  src: AudioBufferSourceNode;
  gain: GainNode;
  nodes: AudioNode[];
  start: number;
  priority: number;
}

interface SfxState {
  last: number;
  density: number;
  voices: Voice[];
  lastVariant: number;
}

interface Graph {
  master: GainNode;
  limiter: DynamicsCompressorNode;
  sfxBus: GainNode;
  sfxSend: GainNode;
  musicVol: GainNode;
  musicHallSend: GainNode;
  ambVol: GainNode;
  ambWetVol: GainNode;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private g: Graph | null = null;
  private music: Music | null = null;
  private ambience: Ambience | null = null;

  private readonly rendered = new Map<SfxName, AudioBuffer[]>();
  private readonly samples = new Map<SfxName, AudioBuffer>();
  private readonly states = new Map<SfxName, SfxState>();
  private voices: Voice[] = [];
  private renderPromise: Promise<void> | null = null;
  private renderMs = 0;

  private volumes: Volumes = { ...DEFAULTS };
  private muted = false;
  private wantMusic = false;
  private wantAmbience = false;
  private intensity = 0;
  private boss = false;
  private timeOfDay = 0;
  private timer: number | null = null;
  private suspendedByVisibility = false;

  constructor() {
    this.load();
  }

  // ================================================================ lifecycle

  /** Must be called from a user gesture. Creates/resumes the AudioContext. Safe to call repeatedly. */
  async unlock(): Promise<void> {
    try {
      if (!this.ctx) this.init();
      const ctx = this.ctx;
      if (!ctx) return;
      if (ctx.state !== 'running') {
        // resume() can stay pending outside a gesture: never let unlock() hang
        await Promise.race([ctx.resume().catch(() => undefined), new Promise((r) => setTimeout(r, 400))]);
      }
      this.primeOutput(ctx);
      if (!this.renderPromise) this.renderPromise = this.prerenderAll();
      if (this.wantMusic) this.music?.start();
      if (this.wantAmbience) this.ambience?.start();
    } catch (e) {
      console.warn('[audio] unlock failed', e);
    }
  }

  /** Resolves when every SFX has been pre-rendered (or immediately if locked). */
  whenReady(): Promise<void> {
    return this.renderPromise ?? Promise.resolve();
  }

  private init(): void {
    if (typeof window === 'undefined') return;
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const sr = ctx.sampleRate;
    const gain = (v = 1): GainNode => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };

    // ---- master chain: limiter + gentle soft clip
    const master = gain(0);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 4;
    limiter.ratio.value = 16;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.2;
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve(0.7, 0.985);
    clip.oversample = '2x';
    master.connect(limiter).connect(clip).connect(ctx.destination);

    // ---- reverbs: short warm room for SFX, long hall for music & ambience
    const room = ctx.createConvolver();
    room.buffer = impulseResponse(sr, { seconds: 1.1, rt60: 0.8, preDelay: 0.008, lpStart: 6500, lpEnd: 1800, early: 8, attack: 0.004 });
    const hall = ctx.createConvolver();
    hall.buffer = impulseResponse(sr, { seconds: 3.6, rt60: 2.9, preDelay: 0.025, lpStart: 5200, lpEnd: 800, early: 10, attack: 0.03 });
    room.connect(gain(0.8)).connect(master);
    hall.connect(gain(0.75)).connect(master);

    // ---- buses
    const sfxBus = gain();
    sfxBus.connect(master);
    const sfxSend = gain();
    sfxSend.connect(room);

    const musicVol = gain();
    musicVol.connect(master);
    const musicHallSend = gain(0.26);
    musicVol.connect(musicHallSend).connect(hall);

    const ambVol = gain();
    ambVol.connect(master);
    const ambWetVol = gain();
    ambWetVol.connect(hall);

    this.g = { master, limiter, sfxBus, sfxSend, musicVol, musicHallSend, ambVol, ambWetVol };

    this.music = new Music(ctx, musicHallSend);
    this.music.output.connect(musicVol);
    this.music.setIntensity(this.intensity);
    this.music.setBoss(this.boss);
    this.music.setNight(this.timeOfDay);

    this.ambience = new Ambience(ctx);
    this.ambience.output.connect(ambVol);
    this.ambience.wet.connect(ambWetVol);
    this.ambience.setNight(this.timeOfDay);

    this.applyVolumes(true);
    this.timer = window.setInterval(this.tick, TICK_MS);

    // pause audio with the tab; resume on return
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) {
        if (this.ctx.state === 'running') {
          this.suspendedByVisibility = true;
          void this.ctx.suspend().catch(() => undefined);
        }
      } else if (this.suspendedByVisibility) {
        this.suspendedByVisibility = false;
        void this.ctx.resume().catch(() => undefined);
      }
    });
    // iOS/Safari can "interrupt" the context; any later gesture brings it back
    const kick = () => {
      if (this.ctx && this.ctx.state !== 'running' && !document.hidden) void this.ctx.resume().catch(() => undefined);
    };
    window.addEventListener('pointerdown', kick, { passive: true });
    window.addEventListener('keydown', kick, { passive: true });
  }

  /** Plays one silent sample: required by some mobile browsers to really unlock output. */
  private primeOutput(ctx: AudioContext): void {
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.onended = () => src.disconnect();
    src.start();
  }

  private async prerenderAll(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = performance.now();
    const queue = [...RENDER_ORDER];
    const worker = async () => {
      for (let name = queue.shift(); name; name = queue.shift()) {
        try {
          this.rendered.set(name, await renderSfx(SFX[name], ctx.sampleRate));
        } catch (e) {
          console.warn(`[audio] failed to render ${name}`, e);
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    this.renderMs = performance.now() - t0;
  }

  private tick = (): void => {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    try {
      this.music?.scheduleUntil(now, now + LOOKAHEAD);
      this.ambience?.scheduleUntil(now, now + LOOKAHEAD + 0.1);
    } catch (e) {
      console.warn('[audio] scheduler error', e);
    }
  };

  // ================================================================ SFX

  play(name: SfxName, opts?: PlayOpts): void {
    try {
      this.playInternal(name, opts ?? {});
    } catch {
      /* play() never throws */
    }
  }

  private state(name: SfxName): SfxState {
    let s = this.states.get(name);
    if (!s) {
      s = { last: -Infinity, density: 0, voices: [], lastVariant: -1 };
      this.states.set(name, s);
    }
    return s;
  }

  private playInternal(name: SfxName, opts: PlayOpts): void {
    const ctx = this.ctx;
    const g = this.g;
    if (!ctx || !g || ctx.state !== 'running' || this.muted) return;
    const spec = SFX[name];
    if (!spec) return;
    const sample = this.samples.get(name);
    const bufs = sample ? [sample] : this.rendered.get(name);
    if (!bufs || bufs.length === 0) return;

    const now = ctx.currentTime;
    const st = this.state(name);
    if (now - st.last < spec.minInterval / 1000) return;

    // per-sound polyphony
    if (st.voices.length >= spec.maxVoices) {
      if (!spec.steal) return;
      this.kill(st.voices[0], now);
    }
    // global polyphony: steal the oldest, least important voice
    if (this.voices.length >= MAX_VOICES) {
      let victim: Voice | null = null;
      for (const v of this.voices) {
        if (v.priority > spec.priority) continue;
        if (!victim || v.priority < victim.priority || (v.priority === victim.priority && v.start < victim.start)) victim = v;
      }
      if (!victim) return;
      this.kill(victim, now);
    }

    // spam ducking: the more often a sound fires, the quieter each instance
    st.density = st.density * Math.exp(-(now - st.last) / 0.35) + 1;
    st.last = now;
    const duck = Math.max(0.42, 1 - 0.085 * (st.density - 1));

    let vi = Math.floor(Math.random() * bufs.length);
    if (bufs.length > 1 && vi === st.lastVariant) vi = (vi + 1 + Math.floor(Math.random() * (bufs.length - 1))) % bufs.length;
    st.lastVariant = vi;

    const jitterDb = spec.jitter > 0 ? (Math.random() * 2 - 1) * 1.2 : 0;
    const vol = clamp(opts.volume ?? 1, 0, 2) * duck * dbToGain(jitterDb);
    const rate = clamp(opts.pitch ?? 1, 0.25, 4) * (1 + (Math.random() * 2 - 1) * spec.jitter);
    const when = now + (spec.delay > 0 ? (Math.random() * spec.delay) / 1000 : 0);

    const src = ctx.createBufferSource();
    src.buffer = bufs[vi];
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    const nodes: AudioNode[] = [src, gain];
    src.connect(gain);
    let out: AudioNode = gain;
    const pan = clamp(opts.pan ?? 0, -1, 1);
    if (Math.abs(pan) > 0.01) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      gain.connect(p);
      nodes.push(p);
      out = p;
    }
    out.connect(g.sfxBus);
    if (spec.send > 0) {
      const send = ctx.createGain();
      send.gain.value = spec.send;
      out.connect(send).connect(g.sfxSend);
      nodes.push(send);
    }

    const voice: Voice = { name, src, gain, nodes, start: now, priority: spec.priority };
    st.voices.push(voice);
    this.voices.push(voice);
    src.onended = () => {
      for (const n of nodes) n.disconnect();
      this.forget(voice);
    };
    src.start(when);
  }

  private kill(v: Voice, now: number): void {
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setTargetAtTime(0, now, 0.012);
    try {
      v.src.stop(now + 0.06);
    } catch {
      /* not started yet / already stopped */
    }
    this.forget(v);
  }

  private forget(v: Voice): void {
    const st = this.states.get(v.name);
    if (st) {
      const i = st.voices.indexOf(v);
      if (i >= 0) st.voices.splice(i, 1);
    }
    const j = this.voices.indexOf(v);
    if (j >= 0) this.voices.splice(j, 1);
  }

  /**
   * Use a real recording instead of the synth for `name`. The sample is
   * loudness-matched to the synth's target and still gets volume/pan/pitch/jitter.
   */
  async registerSample(name: SfxName, url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`[audio] could not load ${url}: ${res.status}`);
    const data = await res.arrayBuffer();
    const decoder: BaseAudioContext = this.ctx ?? new OfflineAudioContext(1, 1, 44100);
    const buf = await decoder.decodeAudioData(data);
    const spec = SFX[name];
    if (spec) normalize(buf, spec.rms, 0.95);
    this.samples.set(name, buf);
  }

  // ================================================================ music & ambience

  startMusic(): void {
    this.wantMusic = true;
    if (this.ctx) this.music?.start();
  }

  stopMusic(fadeSeconds = 1.5): void {
    this.wantMusic = false;
    this.music?.stop(fadeSeconds);
  }

  setMusicIntensity(v: number): void {
    this.intensity = clamp(Number.isFinite(v) ? v : 0, 0, 1);
    this.music?.setIntensity(this.intensity);
  }

  setBossMode(on: boolean): void {
    this.boss = !!on;
    this.music?.setBoss(this.boss);
  }

  setTimeOfDay(t: number): void {
    this.timeOfDay = clamp(Number.isFinite(t) ? t : 0, 0, 1);
    this.music?.setNight(this.timeOfDay);
    this.ambience?.setNight(this.timeOfDay);
  }

  startAmbience(): void {
    this.wantAmbience = true;
    if (this.ctx) this.ambience?.start();
  }

  stopAmbience(fadeSeconds = 2): void {
    this.wantAmbience = false;
    this.ambience?.stop(fadeSeconds);
  }

  // ================================================================ volumes

  setVolumes(v: Partial<Volumes>): void {
    for (const key of ['master', 'music', 'sfx', 'ambience'] as const) {
      const x = v[key];
      if (typeof x === 'number' && Number.isFinite(x)) this.volumes[key] = clamp(x, 0, 1);
    }
    this.applyVolumes();
    this.save();
  }

  getVolumes(): Volumes {
    return { ...this.volumes };
  }

  setMuted(m: boolean): void {
    this.muted = !!m;
    this.applyVolumes();
    this.save();
  }

  isMuted(): boolean {
    return this.muted;
  }

  private applyVolumes(immediate = false): void {
    const ctx = this.ctx;
    const g = this.g;
    if (!ctx || !g) return;
    const now = ctx.currentTime;
    const set = (p: AudioParam, v: number) => (immediate ? p.setValueAtTime(v, now) : p.setTargetAtTime(v, now, 0.04));
    set(g.master.gain, this.muted ? 0 : taper(this.volumes.master) * MASTER_TRIM);
    set(g.sfxBus.gain, taper(this.volumes.sfx));
    set(g.sfxSend.gain, taper(this.volumes.sfx));
    set(g.musicVol.gain, taper(this.volumes.music) * MUSIC_TRIM);
    set(g.ambVol.gain, taper(this.volumes.ambience) * AMBIENCE_TRIM);
    set(g.ambWetVol.gain, taper(this.volumes.ambience) * AMBIENCE_TRIM);
  }

  private load(): void {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (!raw) return;
      const d = JSON.parse(raw) as Partial<Volumes> & { muted?: boolean };
      for (const key of ['master', 'music', 'sfx', 'ambience'] as const) {
        const x = d[key];
        if (typeof x === 'number' && Number.isFinite(x)) this.volumes[key] = clamp(x, 0, 1);
      }
      this.muted = d.muted === true;
    } catch {
      /* corrupt or unavailable storage: keep defaults */
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...this.volumes, muted: this.muted }));
    } catch {
      /* storage unavailable (private mode) */
    }
  }

  // ================================================================ diagnostics (used by the Audio Lab)

  getStats(): AudioStats {
    return {
      state: this.ctx ? this.ctx.state : 'locked',
      sampleRate: this.ctx?.sampleRate ?? 0,
      voices: this.voices.length,
      rendered: this.rendered.size,
      total: RENDER_ORDER.length,
      renderMs: Math.round(this.renderMs),
      music: this.music && this.music.playing ? this.music.getState() : null,
      ambience: !!this.ambience?.playing,
      limiterDb: this.g ? Math.round(this.g.limiter.reduction * 10) / 10 : 0,
    };
  }

  /** Peak / RMS of every pre-rendered variation. */
  analyzeSfx(): Partial<Record<SfxName, Levels[]>> {
    const out: Partial<Record<SfxName, Levels[]>> = {};
    for (const [name, bufs] of this.rendered) out[name] = bufs.map(analyze);
    return out;
  }

  /** Renders `seconds` of music offline (dry, pre-volume) and returns its levels. */
  async renderMusicPreview(seconds: number, o: { intensity?: number; boss?: boolean; night?: number } = {}): Promise<{ levels: Levels; buffer: AudioBuffer }> {
    const sr = this.ctx?.sampleRate ?? 48000;
    const off = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(seconds * sr), sampleRate: sr });
    const m = new Music(off, null);
    m.output.connect(off.destination);
    m.setIntensity(o.intensity ?? 0, 0);
    m.setBoss(!!o.boss, 0);
    m.setNight(o.night ?? 0, 0);
    m.start(0);
    m.scheduleUntil(0, seconds);
    const buffer = await off.startRendering();
    return { levels: analyze(buffer), buffer };
  }

  /** Renders `seconds` of ambience offline (dry + wet sends summed, pre-volume). */
  async renderAmbiencePreview(seconds: number, night = 0): Promise<{ levels: Levels; buffer: AudioBuffer }> {
    const sr = this.ctx?.sampleRate ?? 48000;
    const off = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(seconds * sr), sampleRate: sr });
    const a = new Ambience(off);
    a.output.connect(off.destination);
    a.setNight(night, 0);
    a.start(0);
    for (let t = 0; t < seconds; t += 0.25) a.scheduleUntil(t, t + 0.35);
    const buffer = await off.startRendering();
    return { levels: analyze(buffer), buffer };
  }

  /** Plays an arbitrary buffer through the music bus (lab use: audition offline renders). */
  playBuffer(buffer: AudioBuffer): void {
    const ctx = this.ctx;
    if (!ctx || !this.g) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.g.musicVol);
    src.onended = () => src.disconnect();
    src.start();
  }

  /** Releases the context entirely (not needed in normal play). */
  async dispose(): Promise<void> {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    const ctx = this.ctx;
    this.ctx = null;
    this.g = null;
    this.music = null;
    this.ambience = null;
    this.voices = [];
    this.states.clear();
    this.rendered.clear();
    this.renderPromise = null;
    if (ctx) await ctx.close().catch(() => undefined);
  }
}

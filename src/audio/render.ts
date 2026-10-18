/**
 * Offline pre-rendering of SFX variations. All variations of one sound are
 * rendered into a single OfflineAudioContext (one slot each) and sliced
 * afterwards, which is much cheaper than one context per variation.
 */
import { normalize, sliceTrim } from './dsp';
import { Kit } from './kit';
import type { SfxSpec } from './sfx';

const GAP = 0.05;

export async function renderSfx(spec: SfxSpec, sampleRate: number): Promise<AudioBuffer[]> {
  const slot = spec.dur + GAP;
  const n = Math.max(1, spec.variations);
  const length = Math.ceil(slot * n * sampleRate);
  const ctx = new OfflineAudioContext({ numberOfChannels: 1, length, sampleRate });
  for (let i = 0; i < n; i++) {
    const bus = ctx.createGain();
    bus.connect(ctx.destination);
    spec.render(new Kit(ctx, bus, i * slot), i);
  }
  const rendered = await ctx.startRendering();
  const out: AudioBuffer[] = [];
  for (let i = 0; i < n; i++) {
    const b = sliceTrim(rendered, Math.floor(i * slot * sampleRate), Math.floor(spec.dur * sampleRate));
    normalize(b, spec.rms, 0.89);
    out.push(b);
  }
  return out;
}

/**
 * Lantern Hollow audio: fully procedural (Web Audio API, zero dependencies).
 *
 *   import { audio } from './audio';
 *   canvas.addEventListener('pointerdown', () => audio.unlock(), { once: true });
 *   audio.play('acorn_fire', { pan: screenX * 2 - 1 });
 *   audio.startMusic(); audio.setMusicIntensity(1); audio.setTimeOfDay(0.8);
 */
import { AudioEngine } from './engine';

export type { PlayOpts, Volumes, AudioStats } from './engine';
export type { SfxName } from './sfx';
export { SFX_NAMES, SFX_CATEGORIES, RAPID_FIRE } from './sfx';

export const audio = new AudioEngine();

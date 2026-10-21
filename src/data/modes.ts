/**
 * Game modes, picked on the title screen. The three difficulties only change zombie health
 * (multiplied on top of the nightly curve); Lantern Rush keeps Easy's health but never waits
 * for Nightfall: after each dawn a short day runs on a timer, then the next night starts.
 */
export type ModeId = 'easy' | 'medium' | 'hard' | 'rush';

export interface ModeDef {
  id: ModeId;
  name: string;
  blurb: string;
  /** zombie health multiplier; Easy's 1.06 is the original "pretty balanced, a smidge harder" tuning.
   *  Medium is half again as tough and Hard doubles it (Hard at 3x was a pure numbers game by night 6). */
  hp: number;
  /** multiplier on kill gold and the dawn bonus: tougher zombies pay better, and repairs cost more */
  gold: number;
  /** seconds of daylight between nights, or null to wait for Nightfall */
  dayTimer: number | null;
}

export const MODES: Record<ModeId, ModeDef> = {
  easy: { id: 'easy', name: 'Easy', blurb: 'The cozy classic. Take your time between nights.', hp: 1.06, gold: 1, dayTimer: null },
  medium: { id: 'medium', name: 'Medium', blurb: 'Zombies take half again the beating to fall.', hp: 1.5, gold: 1.15, dayTimer: null },
  hard: { id: 'hard', name: 'Hard', blurb: 'Double-tough zombies. Every tower counts.', hp: 2, gold: 1.3, dayTimer: null },
  rush: { id: 'rush', name: 'Lantern Rush', blurb: 'No waiting for Nightfall. Each dawn gives you 15 seconds, then they come again.', hp: 1.06, gold: 1, dayTimer: 15 },
};

export const MODE_ORDER: ModeId[] = ['easy', 'medium', 'hard', 'rush'];

/** Saves from before modes were Easy games. */
export const modeOf = (id: unknown): ModeDef => MODES[id as ModeId] ?? MODES.easy;

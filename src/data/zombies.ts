export type ZombieId = 'shambler' | 'sprinter' | 'pothead' | 'brute' | 'lumberjack' | 'king';

export interface ZombieDef {
  id: ZombieId;
  name: string;
  hp: number;
  /** tiles per second */
  speed: number;
  /** flat damage reduction per hit (minimum 1 damage always gets through) */
  armor: number;
  gold: number;
  /** cottage hearts lost if it reaches the door */
  lives: number;
  scale: number;
  boss?: boolean;
  blurb: string;
}

export const ZOMBIES: Record<ZombieId, ZombieDef> = {
  shambler: {
    id: 'shambler', name: 'Shambler', hp: 30, speed: 0.85, armor: 0, gold: 3, lives: 1, scale: 1,
    blurb: 'Slow, sleepy, hungry. Mostly harmless alone.',
  },
  sprinter: {
    id: 'sprinter', name: 'Sprinter', hp: 17, speed: 1.75, armor: 0, gold: 3, lives: 1, scale: 0.9,
    blurb: 'Late for dinner and in a real hurry about it.',
  },
  pothead: {
    id: 'pothead', name: 'Pot-head', hp: 44, speed: 0.75, armor: 4, gold: 5, lives: 1, scale: 1,
    blurb: 'Wears a cooking pot. Small hits just go "tonk".',
  },
  brute: {
    id: 'brute', name: 'Brute', hp: 170, speed: 0.55, armor: 1, gold: 12, lives: 3, scale: 1.55,
    blurb: 'Big. Very big. Takes a lot of acorns to topple.',
  },
  lumberjack: {
    id: 'lumberjack', name: 'Lumberjack', hp: 62, speed: 0.8, armor: 1, gold: 8, lives: 2, scale: 1.35,
    blurb: 'Stops to chop at towers beside the road. Each swing knocks 5% off a tower, and at 0% it explodes.',
  },
  king: {
    id: 'king', name: 'Pumpkin King', hp: 620, speed: 0.4, armor: 2, gold: 90, lives: 8, scale: 2.1, boss: true,
    blurb: 'The lord of the patch. His crown is mostly decorative.',
  },
};

/** HP multiplier applied to every zombie in night `n` (1-based). */
export function hpScale(n: number): number {
  return Math.pow(1 + 0.27 * (n - 1), 1.52);
}

/** Gold per kill grows slower than HP so the economy stays tight. */
export function goldScale(n: number): number {
  return 1 + 0.02 * (n - 1);
}

/** How lumberjacks treat your towers (agreed design: 5% a swing, 10 swings max). */
export const CHOP = {
  /** chance to stop at each tower it walks past on night 11 (see chopChance) */
  chance: 0.1,
  /** extra chance per night after 11 */
  chancePerNight: 0.03,
  /** endless mode keeps climbing, but never past this */
  maxChance: 0.75,
  /** condition lost per swing */
  damage: 0.05,
  /** swings at any one tower before moving on */
  maxSwings: 10,
  /** seconds per swing */
  swingTime: 0.85,
  /** how close (tiles) a tower must be to the lumberjack */
  reach: 1.45,
} as const;

/** Chance a lumberjack stops to chop each tower it passes: 10% on night 11, +3% a night (37% by night 20). */
export function chopChance(night: number): number {
  return Math.min(CHOP.maxChance, CHOP.chance + CHOP.chancePerNight * Math.max(0, night - 11));
}

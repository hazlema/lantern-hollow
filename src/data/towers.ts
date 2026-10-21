export type TowerId = 'acorn' | 'catapult' | 'sprinkler' | 'lantern' | 'owl';
export type TargetMode = 'first' | 'last' | 'strong' | 'close';

export interface TowerDef {
  id: TowerId;
  name: string;
  blurb: string;
  cost: number;
  damage: number;
  /** shots (or pulses) per second */
  rate: number;
  range: number;
  /** splash radius for area attacks */
  splash?: number;
  /** artillery can't hit zombies closer than this (tiles) */
  minRange?: number;
  /** projectile speed in tiles/sec (0 = instant) */
  projectileSpeed: number;
  defaultTarget: TargetMode;
  hotkey: string;
}

export const TOWERS: Record<TowerId, TowerDef> = {
  acorn: {
    id: 'acorn', name: 'Acorn Turret', hotkey: '1',
    blurb: 'A trusty oak barrel that pelts zombies with acorns. Fast and dependable.',
    cost: 60, damage: 9, rate: 1.6, range: 2.4, projectileSpeed: 13, defaultTarget: 'first',
  },
  catapult: {
    id: 'catapult', name: 'Pumpkin Catapult', hotkey: '2',
    blurb: 'Lobs ripe pumpkins that burst in a gooey splash. Great against crowds, but it can\u2019t hit zombies right beside it.',
    cost: 115, damage: 26, rate: 0.4, range: 3.4, minRange: 1.3, splash: 1.1, projectileSpeed: 6.5, defaultTarget: 'first',
  },
  sprinkler: {
    id: 'sprinkler', name: 'Syrup Sprinkler', hotkey: '3',
    blurb: 'Sprays sticky maple syrup. Zombies in range slow to a sad shuffle.',
    cost: 80, damage: 2, rate: 0.9, range: 1.8, projectileSpeed: 0, defaultTarget: 'close',
  },
  lantern: {
    id: 'lantern', name: 'Firefly Lantern', hotkey: '4',
    blurb: 'A jar of furious fireflies. Zaps arc between several zombies at once.',
    cost: 135, damage: 15, rate: 0.9, range: 2.4, projectileSpeed: 0, defaultTarget: 'first',
  },
  owl: {
    id: 'owl', name: 'Owl Roost', hotkey: '5',
    blurb: 'A wise old owl with very sharp feathers. Huge range, hits like a hammer.',
    cost: 170, damage: 72, rate: 0.36, range: 5.0, projectileSpeed: 20, defaultTarget: 'strong',
  },
};

export const TOWER_ORDER: TowerId[] = ['acorn', 'catapult', 'sprinkler', 'lantern', 'owl'];

export const MAX_LEVEL = 3;

/** No upgrading until the first big fight: a fresh run can't open with a maxed-out tower. */
export const UPGRADE_UNLOCK_NIGHT = 10;
export const upgradesUnlocked = (night: number) => night >= UPGRADE_UNLOCK_NIGHT;

/** Gold cost to go from `level` to `level + 1`. */
export function upgradeCost(def: TowerDef, level: number): number {
  return Math.round(def.cost * (level === 1 ? 0.8 : 1.3) / 5) * 5;
}

/** Per-level stat multipliers (level is 1-based). */
export function levelMult(level: number) {
  const l = level - 1;
  return { damage: 1 + 0.7 * l, rate: 1 + 0.12 * l, range: 1 + 0.1 * l };
}

export const SELL_REFUND = 0.7;

/** Firefly zaps lose this much punch with every jump (1st hit 100%, then 70%, 49%, ...). */
export const CHAIN_FALLOFF = 0.7;

/** Repairs wait for dawn, unless you've learned the Night Toolbox. */
export const repairsAllowed = (night: boolean, nightRepairs: boolean) => !night || nightRepairs;

/** Emergency repairs while the invasion is on cost this much more. */
export const NIGHT_REPAIR_MULT = 2;

/**
 * Gold to fix a tower back to full condition: 60% of what you've sunk into it,
 * scaled by damage. Doubled mid-invasion; normal price once the night is over.
 */
export function repairCost(spent: number, condition: number, night = false): number {
  const missing = Math.max(0, Math.min(1, 1 - condition));
  if (missing <= 0) return 0;
  return Math.max(5, Math.round((spent * missing * 0.6) / 5) * 5) * (night ? NIGHT_REPAIR_MULT : 1);
}

/** Damaged towers hit softer: output scales with condition; a broken tower does nothing. */
export function conditionMult(condition: number): number {
  return condition <= 0 ? 0 : condition;
}

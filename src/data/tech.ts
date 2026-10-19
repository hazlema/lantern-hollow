import type { TowerId } from './towers';

export type TechId =
  | 'acorn_hard' | 'acorn_reload' | 'acorn_twin' | 'acorn_golden'
  | 'cat_unlock' | 'cat_big' | 'cat_spicy'
  | 'syr_unlock' | 'syr_sticky' | 'syr_molasses'
  | 'lan_unlock' | 'lan_swarm' | 'lan_overcharge'
  | 'owl_unlock' | 'owl_keen' | 'owl_storm'
  | 'home_thrifty' | 'home_door' | 'home_toolbox' | 'home_harvest' | 'home_interest';

export interface TechDef {
  id: TechId;
  name: string;
  desc: string;
  cost: number;
  requires: TechId[];
  /** Almanac chapter (column) and tier (row) for layout. */
  branch: number;
  tier: number;
  /** icon key in public/art/icons */
  icon: string;
}

export const BRANCHES = ['Acorn Works', 'Harvest', 'Sticky', 'Lantern Lore', 'Night Watch', 'Homestead'];

const T = (
  id: TechId, name: string, desc: string, cost: number, requires: TechId[], branch: number, tier: number, icon: string = id,
): TechDef => ({ id, name, desc, cost, requires, branch, tier, icon });

export const TECHS: TechDef[] = [
  T('acorn_hard', 'Hardened Acorns', 'Acorns are kiln-dried. +30% Acorn Turret damage.', 1, [], 0, 0),
  T('acorn_reload', 'Quick Reload', 'Squirrel apprentices. +25% Acorn Turret fire rate.', 2, ['acorn_hard'], 0, 1),
  T('acorn_twin', 'Twin Barrels', 'Acorn Turrets fire two acorns per shot.', 3, ['acorn_reload'], 0, 2),
  T('acorn_golden', 'Golden Acorns', '15% chance for an acorn to deal triple damage.', 3, ['acorn_twin'], 0, 3),

  T('cat_unlock', 'Pumpkin Catapult', 'Unlocks the Pumpkin Catapult: splash damage on crowds.', 2, [], 1, 0, 'tower_catapult'),
  T('cat_big', 'Prize Pumpkins', 'Bigger pumpkins. +40% splash radius, +15% damage.', 2, ['cat_unlock'], 1, 1),
  T('cat_spicy', 'Spicy Pumpkins', 'Pumpkins leave a burning patch that singes zombies.', 3, ['cat_big'], 1, 2),

  T('syr_unlock', 'Syrup Sprinkler', 'Unlocks the Syrup Sprinkler: slows zombies in range.', 1, [], 2, 0, 'tower_sprinkler'),
  T('syr_sticky', 'Extra Sticky', 'Thicker syrup. Slow increases from 35% to 55%.', 2, ['syr_unlock'], 2, 1),
  T('syr_molasses', 'Molasses', 'Syrupy zombies take +20% damage from everything.', 3, ['syr_sticky'], 2, 2),

  T('lan_unlock', 'Firefly Lantern', 'Unlocks the Firefly Lantern: chain zaps between zombies.', 2, [], 3, 0, 'tower_lantern'),
  T('lan_swarm', 'Bigger Swarm', 'Zaps jump to 2 more zombies.', 2, ['lan_unlock'], 3, 1),
  T('lan_overcharge', 'Overcharge', 'The first zombie each zap hits takes double damage.', 3, ['lan_swarm'], 3, 2),

  T('owl_unlock', 'Owl Roost', 'Unlocks the Owl Roost: long range sniper.', 3, [], 4, 0, 'tower_owl'),
  T('owl_keen', 'Keen Eyes', 'Every tower gains +15% range.', 3, ['owl_unlock'], 4, 1),
  T('owl_storm', 'Feather Storm', 'Owl feathers pierce through up to 3 zombies.', 3, ['owl_keen'], 4, 2),

  T('home_thrifty', 'Thrifty', 'Towers and upgrades cost 10% less.', 1, [], 5, 0),
  T('home_door', 'Sturdy Door', '+5 cottage hearts, and heals 5 right now.', 2, ['home_thrifty'], 5, 1),
  T('home_toolbox', 'Night Toolbox', 'Lets you repair towers during the invasion (at the emergency rate: double cost). Without it, repairs wait for dawn.', 2, ['home_door'], 5, 2),
  T('home_harvest', 'Harvest Bonus', '+25% gold from zombies.', 2, ['home_toolbox'], 5, 3),
  T('home_interest', 'Piggy Bank', 'At dawn, earn 5% interest on unspent gold (max 50).', 3, ['home_harvest'], 5, 4),
];

export const TECH_BY_ID = Object.fromEntries(TECHS.map((t) => [t.id, t])) as Record<TechId, TechDef>;

export const TOWER_UNLOCK: Partial<Record<TowerId, TechId>> = {
  catapult: 'cat_unlock', sprinkler: 'syr_unlock', lantern: 'lan_unlock', owl: 'owl_unlock',
};

export function canResearch(id: TechId, owned: ReadonlySet<TechId>, embers: number): boolean {
  const t = TECH_BY_ID[id];
  return !owned.has(id) && embers >= t.cost && t.requires.every((r) => owned.has(r));
}

export function isAvailable(id: TechId, owned: ReadonlySet<TechId>): boolean {
  return !owned.has(id) && TECH_BY_ID[id].requires.every((r) => owned.has(r));
}

/** Everything the tech tree changes, flattened into numbers the simulation reads. */
export interface Mods {
  damage: Record<TowerId, number>;
  rate: Record<TowerId, number>;
  rangeAll: number;
  acornShots: number;
  acornCrit: number;
  splashMult: number;
  burn: boolean;
  slow: number;
  molasses: boolean;
  chainTargets: number;
  overcharge: boolean;
  owlPierce: number;
  costMult: number;
  goldMult: number;
  interest: boolean;
  /** may repair towers mid-invasion (Night Toolbox) */
  nightRepairs: boolean;
  unlocked: Set<TowerId>;
}

export function computeMods(owned: ReadonlySet<TechId>): Mods {
  const has = (id: TechId) => owned.has(id);
  const one = (): Record<TowerId, number> => ({ acorn: 1, catapult: 1, sprinkler: 1, lantern: 1, owl: 1 });
  const m: Mods = {
    damage: one(), rate: one(), rangeAll: 1,
    acornShots: 1, acornCrit: 0, splashMult: 1, burn: false, slow: 0.35, molasses: false,
    chainTargets: 3, overcharge: false, owlPierce: 1, costMult: 1, goldMult: 1, interest: false, nightRepairs: false,
    unlocked: new Set<TowerId>(['acorn']),
  };
  if (has('acorn_hard')) m.damage.acorn *= 1.3;
  if (has('acorn_reload')) m.rate.acorn *= 1.25;
  if (has('acorn_twin')) m.acornShots = 2;
  if (has('acorn_golden')) m.acornCrit = 0.15;
  if (has('cat_unlock')) m.unlocked.add('catapult');
  if (has('cat_big')) { m.splashMult = 1.4; m.damage.catapult *= 1.15; }
  if (has('cat_spicy')) m.burn = true;
  if (has('syr_unlock')) m.unlocked.add('sprinkler');
  if (has('syr_sticky')) m.slow = 0.55;
  if (has('syr_molasses')) m.molasses = true;
  if (has('lan_unlock')) m.unlocked.add('lantern');
  if (has('lan_swarm')) m.chainTargets += 2;
  if (has('lan_overcharge')) m.overcharge = true;
  if (has('owl_unlock')) m.unlocked.add('owl');
  if (has('owl_keen')) m.rangeAll = 1.15;
  if (has('owl_storm')) m.owlPierce = 3;
  if (has('home_thrifty')) m.costMult = 0.9;
  if (has('home_harvest')) m.goldMult = 1.25;
  if (has('home_interest')) m.interest = true;
  if (has('home_toolbox')) m.nightRepairs = true;
  return m;
}

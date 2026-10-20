import { TOWER_UNLOCK, type TechId } from './tech';
import { TOTAL_NIGHTS } from './waves';
import type { TowerId } from './towers';

export type TrophyId =
  | 'night5' | 'night10' | 'night15' | 'win'
  | 'noup15' | 'noup20'
  | 'perfect5' | 'perfect10' | 'perfect15' | 'perfect20' | 'perfectGame'
  | 'gold100' | 'gold500' | 'gold1000' | 'gold5000'
  | 'unlock_catapult' | 'unlock_sprinkler' | 'unlock_lantern' | 'unlock_owl' | 'allTowers'
  | 'king' | 'destroyer' | 'lost'
  | 'rush5' | 'rush10' | 'rush15' | 'rushWin';

/** Frame colour on the shelf: bronze, silver, gold, or the lantern-glow top tier. */
export type TrophyTier = 1 | 2 | 3 | 4;

export interface TrophyDef {
  id: TrophyId;
  name: string;
  /** how to earn it (shown on the shelf, locked or not) */
  desc: string;
  shelf: number;
  tier: TrophyTier;
  /** icon key in public/art/icons */
  icon: string;
}

export const SHELVES = ['The Long Night', 'Flawless', 'The Old Ways', 'Treasure', 'Discoveries', 'Odd Moments', 'Lantern Rush'];

const T = (id: TrophyId, name: string, desc: string, shelf: number, tier: TrophyTier, icon = `trophy_${id}`): TrophyDef =>
  ({ id, name, desc, shelf, tier, icon });

export const TROPHIES: TrophyDef[] = [
  T('night5', 'Night Owl', 'Survive the first 5 nights.', 0, 1),
  T('night10', 'Graveyard Shift', 'Survive the first 10 nights.', 0, 2),
  T('night15', 'Witching Hour', 'Survive the first 15 nights.', 0, 3),
  T('win', 'Home Sweet Home', `Survive all ${TOTAL_NIGHTS} nights and save the hollow.`, 0, 4),

  T('perfect5', 'Not a Scratch', 'Survive 5 nights without losing a single heart.', 1, 1),
  T('perfect10', 'Tidy Porch', 'Survive 10 nights without losing a single heart.', 1, 2),
  T('perfect15', 'Untouchable', 'Survive 15 nights without losing a single heart.', 1, 3),
  T('perfect20', 'Spotless Hollow', `Survive all ${TOTAL_NIGHTS} nights without losing a single heart.`, 1, 4),

  T('noup15', 'Sticks & Stones', 'Survive 15 nights without upgrading a tower.', 2, 3),
  T('noup20', 'Old School', `Survive all ${TOTAL_NIGHTS} nights without upgrading a tower.`, 2, 4),
  T('perfectGame', 'Sleepy Hollow', `The perfect game: all ${TOTAL_NIGHTS} nights, no hearts lost, no upgrades.`, 2, 4),

  T('gold100', 'Pocket Change', 'Win with at least 100 gold in your pocket.', 3, 1),
  T('gold500', 'Nest Egg', 'Win with at least 500 gold in your pocket.', 3, 2),
  T('gold1000', 'Mattress Money', 'Win with at least 1,000 gold in your pocket.', 3, 3),
  T('gold5000', "Dragon's Hoard", 'Win with at least 5,000 gold in your pocket.', 3, 4),

  T('unlock_catapult', 'Gourd Almighty', 'Research the Pumpkin Catapult.', 4, 1, 'tower_catapult'),
  T('unlock_sprinkler', 'Sticky Situation', 'Research the Syrup Sprinkler.', 4, 1, 'tower_sprinkler'),
  T('unlock_lantern', 'Bright Idea', 'Research the Firefly Lantern.', 4, 1, 'tower_lantern'),
  T('unlock_owl', "Hoo's There?", 'Research the Owl Roost.', 4, 1, 'tower_owl'),
  T('allTowers', 'Full Toolshed', 'Unlock every tower in a single game.', 4, 3),

  T('king', 'Smashing Pumpkins', 'Defeat the Pumpkin King.', 5, 3),
  T('destroyer', 'Destroyer of Worlds', 'Have one of your towers blown sky-high by a lumberjack.', 5, 2),
  T('lost', "Soup's On", 'Let the zombies into the cottage. They were only hungry.', 5, 1),

  T('rush5', 'Quick Feet', 'Survive the first 5 nights of Lantern Rush.', 6, 1),
  T('rush10', 'Second Wind', 'Survive the first 10 nights of Lantern Rush.', 6, 2),
  T('rush15', 'No Time for Naps', 'Survive the first 15 nights of Lantern Rush.', 6, 3),
  T('rushWin', 'Rush Hour', `Survive all ${TOTAL_NIGHTS} nights of Lantern Rush.`, 6, 4),
];

export const TROPHY_BY_ID = Object.fromEntries(TROPHIES.map((t) => [t.id, t])) as Record<TrophyId, TrophyDef>;

/** What the current run has done that rules trophies out. Lives in the save. */
export interface RunRecord {
  /** lost at least one heart */
  hurt: boolean;
  /** upgraded at least one tower */
  upgraded: boolean;
}

const MILESTONES = [5, 10, 15, 20];

/** Trophies earned at the dawn after night `n`; a Lantern Rush run also earns the rush shelf. */
export function dawnTrophies(n: number, run: RunRecord, rush = false): TrophyId[] {
  if (!MILESTONES.includes(n) || n > TOTAL_NIGHTS) return [];
  const out: TrophyId[] = [n === TOTAL_NIGHTS ? 'win' : `night${n}` as TrophyId];
  if (rush) out.push(n === TOTAL_NIGHTS ? 'rushWin' : `rush${n}` as TrophyId);
  if (!run.hurt) out.push(`perfect${n}` as TrophyId);
  if (!run.upgraded && n >= 15) out.push(`noup${n}` as TrophyId);
  if (n === TOTAL_NIGHTS && !run.hurt && !run.upgraded) out.push('perfectGame');
  return out;
}

const GOLD: [number, TrophyId][] = [[100, 'gold100'], [500, 'gold500'], [1000, 'gold1000'], [5000, 'gold5000']];

/** Treasure trophies for the gold left over at the end of the final night. */
export function goldTrophies(gold: number): TrophyId[] {
  return GOLD.filter(([g]) => gold >= g).map(([, id]) => id);
}

/** Discovery trophies for the towers researched so far. */
export function researchTrophies(owned: ReadonlySet<TechId>): TrophyId[] {
  const towers = Object.entries(TOWER_UNLOCK) as [TowerId, TechId][];
  const out = towers.filter(([, tech]) => owned.has(tech)).map(([id]) => `unlock_${id}` as TrophyId);
  if (towers.every(([, tech]) => owned.has(tech))) out.push('allTowers');
  return out;
}

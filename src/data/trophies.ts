import { MODES, MODE_ORDER, type ModeId } from './modes';
import { TOWER_UNLOCK, type TechId } from './tech';
import { TOTAL_NIGHTS } from './waves';
import type { TowerId } from './towers';

type Milestone = 5 | 10 | 15 | 'Win';

/** The Long Night: one set per mode, e.g. `hard10` or `rushWin`. */
export type NightTrophyId = `${ModeId}${Milestone}`;

export type TrophyId =
  | NightTrophyId
  | 'noup15' | 'noup20'
  | 'perfect5' | 'perfect10' | 'perfect15' | 'perfect20' | 'perfectGame'
  | 'gold100' | 'gold500' | 'gold1000' | 'gold5000'
  | 'unlock_catapult' | 'unlock_sprinkler' | 'unlock_lantern' | 'unlock_owl' | 'allTowers'
  | 'king' | 'destroyer' | 'lost';

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

export const SHELVES = ['Easy Nights', 'Medium Nights', 'Hard Nights', 'Lantern Rush', 'Flawless', 'The Old Ways', 'Treasure', 'Discoveries', 'Odd Moments'] as const;
type Shelf = (typeof SHELVES)[number];

const T = (id: TrophyId, name: string, desc: string, shelf: Shelf, tier: TrophyTier, icon = `trophy_${id}`): TrophyDef =>
  ({ id, name, desc, shelf: SHELVES.indexOf(shelf), tier, icon });

/** The difficulties share their names and art; Lantern Rush has its own. */
const NIGHT_NAMES: Record<ModeId, [string, string, string, string]> = {
  easy: ['Night Owl', 'Graveyard Shift', 'Witching Hour', 'Home Sweet Home'],
  medium: ['Night Owl', 'Graveyard Shift', 'Witching Hour', 'Home Sweet Home'],
  hard: ['Night Owl', 'Graveyard Shift', 'Witching Hour', 'Home Sweet Home'],
  rush: ['Quick Feet', 'Second Wind', 'No Time for Naps', 'Rush Hour'],
};
const SHARED_ART = ['trophy_night5', 'trophy_night10', 'trophy_night15', 'trophy_win'];

const nightTrophies = (mode: ModeId): TrophyDef[] => {
  const m = MODES[mode];
  const where = mode === 'rush' ? 'of Lantern Rush' : `on ${m.name}`;
  const shelf: Shelf = mode === 'rush' ? 'Lantern Rush' : `${m.name} Nights` as Shelf;
  return ([5, 10, 15, 'Win'] as Milestone[]).map((ms, i) => T(
    `${mode}${ms}`, NIGHT_NAMES[mode][i],
    ms === 'Win' ? `Survive all ${TOTAL_NIGHTS} nights ${where}.` : `Survive the first ${ms} nights ${where}.`,
    shelf, (i + 1) as TrophyTier, mode === 'rush' ? undefined : SHARED_ART[i],
  ));
};

export const TROPHIES: TrophyDef[] = [
  ...MODE_ORDER.flatMap(nightTrophies),

  T('perfect5', 'Not a Scratch', 'Survive 5 nights without losing a single heart.', 'Flawless', 1),
  T('perfect10', 'Tidy Porch', 'Survive 10 nights without losing a single heart.', 'Flawless', 2),
  T('perfect15', 'Untouchable', 'Survive 15 nights without losing a single heart.', 'Flawless', 3),
  T('perfect20', 'Spotless Hollow', `Survive all ${TOTAL_NIGHTS} nights without losing a single heart.`, 'Flawless', 4),

  T('noup15', 'Sticks & Stones', 'Survive 15 nights without upgrading a tower.', 'The Old Ways', 3),
  T('noup20', 'Old School', `Survive all ${TOTAL_NIGHTS} nights without upgrading a tower.`, 'The Old Ways', 4),
  T('perfectGame', 'Sleepy Hollow', `The perfect game: all ${TOTAL_NIGHTS} nights, no hearts lost, no upgrades.`, 'The Old Ways', 4),

  T('gold100', 'Pocket Change', 'Win with at least 100 gold in your pocket.', 'Treasure', 1),
  T('gold500', 'Nest Egg', 'Win with at least 500 gold in your pocket.', 'Treasure', 2),
  T('gold1000', 'Mattress Money', 'Win with at least 1,000 gold in your pocket.', 'Treasure', 3),
  T('gold5000', "Dragon's Hoard", 'Win with at least 5,000 gold in your pocket.', 'Treasure', 4),

  T('unlock_catapult', 'Gourd Almighty', 'Research the Pumpkin Catapult.', 'Discoveries', 1, 'tower_catapult'),
  T('unlock_sprinkler', 'Sticky Situation', 'Research the Syrup Sprinkler.', 'Discoveries', 1, 'tower_sprinkler'),
  T('unlock_lantern', 'Bright Idea', 'Research the Firefly Lantern.', 'Discoveries', 1, 'tower_lantern'),
  T('unlock_owl', "Hoo's There?", 'Research the Owl Roost.', 'Discoveries', 1, 'tower_owl'),
  T('allTowers', 'Full Toolshed', 'Unlock every tower in a single game.', 'Discoveries', 3),

  T('king', 'Smashing Pumpkins', 'Defeat the Pumpkin King.', 'Odd Moments', 3),
  T('destroyer', 'Destroyer of Worlds', 'Have one of your towers blown sky-high by a lumberjack.', 'Odd Moments', 2),
  T('lost', "Soup's On", 'Let the zombies into the cottage. They were only hungry.', 'Odd Moments', 1),
];

/** Before modes, the night trophies were mode-less; those games played at Easy's health. */
export const RENAMED: Record<string, TrophyId> = { night5: 'easy5', night10: 'easy10', night15: 'easy15', win: 'easyWin' };

export const TROPHY_BY_ID = Object.fromEntries(TROPHIES.map((t) => [t.id, t])) as Record<TrophyId, TrophyDef>;

/** What the current run has done that rules trophies out. Lives in the save. */
export interface RunRecord {
  /** lost at least one heart */
  hurt: boolean;
  /** upgraded at least one tower */
  upgraded: boolean;
}

const MILESTONES = [5, 10, 15, 20];

/** Trophies earned at the dawn after night `n` of a game played in `mode`. */
export function dawnTrophies(n: number, run: RunRecord, mode: ModeId = 'easy'): TrophyId[] {
  if (!MILESTONES.includes(n) || n > TOTAL_NIGHTS) return [];
  const out: TrophyId[] = [`${mode}${n === TOTAL_NIGHTS ? 'Win' : n as Milestone}`];
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

import type { ZombieId } from './zombies';

export const TOTAL_NIGHTS = 20;

/** Extra breathing room added to every group's spawn interval (seconds). */
export const SPAWN_SPACING = 0.3;
/** No two zombies ever spawn closer together than this, even across groups (seconds). */
export const MIN_SPAWN_GAP = 0.3;

export interface SpawnGroup {
  type: ZombieId;
  count: number;
  /** seconds between spawns inside the group */
  interval: number;
  /** seconds after the night starts before this group begins */
  delay: number;
}

/** The roster for night `n` (1-based). Nights past TOTAL_NIGHTS keep scaling for endless mode. */
export function buildNight(n: number): SpawnGroup[] {
  const g: SpawnGroup[] = [];
  const add = (type: ZombieId, count: number, interval: number, delay: number) => {
    if (count > 0) g.push({ type, count: Math.round(count), interval: interval + SPAWN_SPACING, delay });
  };

  // The bread and butter: shamblers every night, the crowd growing slowly.
  add('shambler', 6 + n * 2, Math.max(0.5, 1.2 - n * 0.035), 0);

  if (n >= 3) add('sprinter', 2 + (n - 3) * 1.3, 0.6, 5 + (n % 3));
  if (n >= 5) add('pothead', 2 + (n - 5) * 1.1, 1.2, 9);
  if (n >= 7) add('brute', 1 + Math.floor((n - 7) / 1.6), 3.5, 15);
  // A late sprinter rush to punish thin defences.
  if (n >= 8) add('sprinter', n % 2 === 0 ? 4 + n * 0.5 : 2 + n * 0.3, 0.35, 24);
  if (n >= 12) add('shambler', n * 1.2, 0.4, 30);
  // after the first Pumpkin King falls, lumberjacks start chopping at your towers
  if (n >= 11) add('lumberjack', 2 + (n - 11) * 0.7, 3.2, 10);
  // the last stretch: armoured pot-head columns and brute escorts
  if (n >= 15) add('pothead', (n - 12) * 1.6, 0.55, 38);
  if (n >= 16) add('brute', Math.floor((n - 14) / 2), 2.5, 44);

  // the Pumpkin King is the finale: he rises once the rest of the night is underway
  if (n % 10 === 0) {
    const end = Math.max(...g.map((gr) => gr.delay + (gr.count - 1) * gr.interval));
    add('king', 1 + Math.floor((n - 10) / 10), 10, Math.max(20, end - 6));
  }

  return g;
}

/**
 * Every spawn of the night in order. Overlapping groups get nudged apart so
 * two zombies never pop out of the crypt on top of each other.
 */
export function spawnSchedule(n: number): { t: number; type: ZombieId }[] {
  const out: { t: number; type: ZombieId }[] = [];
  for (const g of buildNight(n)) for (let i = 0; i < g.count; i++) out.push({ t: g.delay + i * g.interval, type: g.type });
  out.sort((a, b) => a.t - b.t);
  for (let i = 1; i < out.length; i++) out[i].t = Math.max(out[i].t, out[i - 1].t + MIN_SPAWN_GAP);
  return out;
}

export function nightTotal(n: number): number {
  return buildNight(n).reduce((s, gr) => s + gr.count, 0);
}

/** Gold handed out at dawn for surviving. */
export function dawnBonus(n: number): number {
  return 20 + n * 3;
}

/** Embers for the Almanac earned at dawn. */
export function dawnEmbers(n: number, flawless: boolean): number {
  return 1 + (flawless ? 1 : 0) + (n % 5 === 0 ? 1 : 0);
}

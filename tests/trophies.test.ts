import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { TROPHIES, SHELVES, dawnTrophies, goldTrophies, researchTrophies } from '../src/data/trophies';
import type { TechId } from '../src/data/tech';

const clean = { hurt: false, upgraded: false };

describe('trophies', () => {
  it('ids are unique and every shelf is used', () => {
    expect(new Set(TROPHIES.map((t) => t.id)).size).toBe(TROPHIES.length);
    SHELVES.forEach((_, s) => expect(TROPHIES.some((t) => t.shelf === s), SHELVES[s]).toBe(true));
  });

  it('every trophy has its painted icon', () => {
    for (const t of TROPHIES) expect(existsSync(resolve(import.meta.dirname, '../public/art/icons', `${t.icon}.webp`)), `${t.id} -> ${t.icon}`).toBe(true);
    expect(existsSync(resolve(import.meta.dirname, '../public/art/icons/trophy_cup.webp'))).toBe(true);
  });

  it('only milestone dawns award anything', () => {
    for (const n of [1, 4, 6, 9, 11, 19, 21, 25, 40]) expect(dawnTrophies(n, clean), `night ${n}`).toEqual([]);
  });

  it('a clean run collects night, perfect and no-upgrade trophies', () => {
    expect(dawnTrophies(5, clean)).toEqual(['night5', 'perfect5']);
    expect(dawnTrophies(10, clean)).toEqual(['night10', 'perfect10']);
    expect(dawnTrophies(15, clean)).toEqual(['night15', 'perfect15', 'noup15']);
    expect(dawnTrophies(20, clean)).toEqual(['win', 'perfect20', 'noup20', 'perfectGame']);
  });

  it('a Lantern Rush run adds the rush trophy at each milestone', () => {
    expect(dawnTrophies(5, clean, true)).toEqual(['night5', 'rush5', 'perfect5']);
    expect(dawnTrophies(10, { hurt: true, upgraded: true }, true)).toEqual(['night10', 'rush10']);
    expect(dawnTrophies(20, { hurt: true, upgraded: true }, true)).toEqual(['win', 'rushWin']);
    expect(dawnTrophies(6, clean, true)).toEqual([]);
  });

  it('losing a heart or upgrading rules out the matching trophies', () => {
    expect(dawnTrophies(20, { hurt: true, upgraded: false })).toEqual(['win', 'noup20']);
    expect(dawnTrophies(20, { hurt: false, upgraded: true })).toEqual(['win', 'perfect20']);
    expect(dawnTrophies(15, { hurt: true, upgraded: true })).toEqual(['night15']);
  });

  it('gold trophies stack by threshold', () => {
    expect(goldTrophies(99)).toEqual([]);
    expect(goldTrophies(100)).toEqual(['gold100']);
    expect(goldTrophies(1200)).toEqual(['gold100', 'gold500', 'gold1000']);
    expect(goldTrophies(5000)).toHaveLength(4);
  });

  it('research unlocks a trophy per tower, plus the full set', () => {
    expect(researchTrophies(new Set<TechId>(['acorn_hard']))).toEqual([]);
    expect(researchTrophies(new Set<TechId>(['cat_unlock']))).toEqual(['unlock_catapult']);
    const all = researchTrophies(new Set<TechId>(['cat_unlock', 'syr_unlock', 'lan_unlock', 'owl_unlock']));
    expect(all).toContain('allTowers');
    expect(all).toHaveLength(5);
  });
});

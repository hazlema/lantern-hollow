import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { TECHS } from '../src/data/tech';
import { TOWER_ORDER } from '../src/data/towers';
import { ZOMBIES } from '../src/data/zombies';

const icon = (key: string) => resolve(import.meta.dirname, '../public/art/icons', `${key}.webp`);

describe('art assets', () => {
  it('every tech has its painted icon', () => {
    for (const t of TECHS) expect(existsSync(icon(t.icon)), `${t.id} -> ${t.icon}.webp`).toBe(true);
  });
  it('every tower has a card icon', () => {
    for (const id of TOWER_ORDER) expect(existsSync(icon(`tower_${id}`)), id).toBe(true);
  });
  it('every zombie has a portrait', () => {
    for (const id of Object.keys(ZOMBIES)) expect(existsSync(icon(`z_${id}`)), id).toBe(true);
  });
  it('title and backdrop art exist', () => {
    for (const f of ['title.jpg', 'backdrop.jpg', 'favicon.png', 'lumberjack_hero.webp']) expect(existsSync(resolve(import.meta.dirname, '../public/art', f)), f).toBe(true);
  });
});
